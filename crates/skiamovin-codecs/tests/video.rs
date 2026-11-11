#![cfg(target_os = "macos")]

mod common;

use skiamovin_codecs::*;
use std::process::Command;

const W: u32 = 640;
const H: u32 = 360;
const FRAMES: usize = 60;
const FRAME_US: i64 = 33_333;

/// Synthetic BGRA frame: colored gradient + a moving white box.
fn make_frame(i: usize) -> Vec<u8> {
    let (w, h) = (W as usize, H as usize);
    let mut buf = vec![0u8; w * h * 4];
    let bx = (i * 8) % (w - 80);
    let by = (140.0 + (i as f64 * 0.2).sin() * 60.0) as usize;
    for y in 0..h {
        for x in 0..w {
            let p = (y * w + x) * 4;
            let in_box = x >= bx && x < bx + 80 && y >= by && y < by + 80;
            if in_box {
                buf[p..p + 4].copy_from_slice(&[255, 255, 255, 255]);
            } else {
                buf[p] = (x * 255 / w) as u8; // B
                buf[p + 1] = (y * 255 / h) as u8; // G
                buf[p + 2] = ((i * 4 + (x + y) / 8) % 256) as u8; // R
                buf[p + 3] = 255;
            }
        }
    }
    buf
}

/// PSNR of BT.709 brightness computed from BGR. Comparing brightness only
/// avoids color filter differences between decoders.
fn psnr_luma(a: &[u8], b: &[u8], w: usize, h: usize, stride_b: usize) -> f64 {
    let y = |p: &[u8]| 0.0722 * p[0] as f64 + 0.7152 * p[1] as f64 + 0.2126 * p[2] as f64;
    let mut se = 0f64;
    for row in 0..h {
        for x in 0..w {
            let d = y(&a[(row * w + x) * 4..]) - y(&b[row * stride_b + x * 4..]);
            se += d * d;
        }
    }
    let mse = se / (w * h) as f64;
    if mse == 0.0 {
        return 99.0;
    }
    10.0 * (255.0f64 * 255.0 / mse).log10()
}

/// PSNR over B, G, R channels.
fn psnr_bgr(a: &[u8], b: &[u8], w: usize, h: usize, stride_b: usize) -> f64 {
    let mut se = 0f64;
    for y in 0..h {
        for x in 0..w {
            let pa = (y * w + x) * 4;
            let pb = y * stride_b + x * 4;
            for c in 0..3 {
                let d = a[pa + c] as f64 - b[pb + c] as f64;
                se += d * d;
            }
        }
    }
    let mse = se / (w * h * 3) as f64;
    if mse == 0.0 {
        return 99.0;
    }
    10.0 * (255.0f64 * 255.0 / mse).log10()
}

fn encode_all(codec: VideoCodec) -> (Vec<EncodedVideoPacket>, Vec<u8>, bool) {
    let mut cfg = VideoEncoderConfig::new(codec, W, H);
    cfg.bitrate = Some(4_000_000);
    cfg.frame_rate = Some(30.0);
    cfg.key_frame_interval = Some(1.0);
    let mut enc = VideoEncoder::new(cfg).expect("create encoder");
    let mut packets = Vec::new();
    for i in 0..FRAMES {
        let frame = make_frame(i);
        enc.encode_bgra(&frame, W as usize * 4, i as i64 * FRAME_US, FRAME_US, i == 0).expect("encode");
        packets.extend(enc.take_packets());
    }
    enc.flush().expect("flush");
    packets.extend(enc.take_packets());
    let desc = enc.description().expect("description after encoding");
    (packets, desc, enc.is_hardware_accelerated())
}

fn decode_and_check(codec: VideoCodec, packets: &[EncodedVideoPacket], desc: &[u8]) {
    let mut dec = VideoDecoder::new(codec, desc, W, H).expect("create decoder");
    let mut frames = Vec::new();
    for p in packets {
        dec.decode(&p.data, p.timestamp_us, p.duration_us, p.key).expect("decode");
        frames.extend(dec.take_frames());
    }
    dec.flush().expect("decoder flush");
    frames.extend(dec.take_frames());
    assert_eq!(frames.len(), FRAMES, "decoded frame count");
    let mut min_psnr = f64::MAX;
    let mut sum = 0.0;
    for (i, f) in frames.iter().enumerate() {
        assert_eq!((f.width, f.height), (W, H));
        assert_eq!(f.timestamp_us, i as i64 * FRAME_US, "timestamps in presentation order");
        let p = psnr_bgr(&make_frame(i), &f.bgra, W as usize, H as usize, f.stride);
        min_psnr = min_psnr.min(p);
        sum += p;
    }
    println!("{codec:?}: avg PSNR {:.2} dB, min {:.2} dB", sum / FRAMES as f64, min_psnr);
    assert!(min_psnr > 30.0, "{codec:?} min PSNR {min_psnr:.2} dB too low");
}

fn check_common(packets: &[EncodedVideoPacket]) {
    assert_eq!(packets.len(), FRAMES, "one packet per frame");
    assert!(packets[0].key, "first packet must be a key frame");
    for (i, p) in packets.iter().enumerate() {
        assert_eq!(p.timestamp_us, i as i64 * FRAME_US, "packets in presentation order");
        assert_eq!(p.duration_us, FRAME_US);
        // Validate the 4-byte length prefixes cover the packet exactly.
        let mut off = 0;
        while off < p.data.len() {
            let n = u32::from_be_bytes(p.data[off..off + 4].try_into().unwrap()) as usize;
            off += 4 + n;
        }
        assert_eq!(off, p.data.len(), "length-prefixed NAL structure");
    }
    // key_frame_interval = 1s at 30 fps => at least one more key frame.
    assert!(packets.iter().skip(1).any(|p| p.key), "expected periodic key frames");
}

/// avcC -> (SPS list, PPS list)
fn parse_avcc(d: &[u8]) -> (Vec<Vec<u8>>, Vec<Vec<u8>>) {
    let mut i = 5;
    let nsps = (d[i] & 0x1f) as usize;
    i += 1;
    let mut sps = Vec::new();
    for _ in 0..nsps {
        let n = u16::from_be_bytes([d[i], d[i + 1]]) as usize;
        sps.push(d[i + 2..i + 2 + n].to_vec());
        i += 2 + n;
    }
    let npps = d[i] as usize;
    i += 1;
    let mut pps = Vec::new();
    for _ in 0..npps {
        let n = u16::from_be_bytes([d[i], d[i + 1]]) as usize;
        pps.push(d[i + 2..i + 2 + n].to_vec());
        i += 2 + n;
    }
    (sps, pps)
}

fn to_annex_b(packets: &[EncodedVideoPacket], avcc: &[u8]) -> Vec<u8> {
    const SC: [u8; 4] = [0, 0, 0, 1];
    let (sps, pps) = parse_avcc(avcc);
    let mut out = Vec::new();
    for p in packets {
        if p.key {
            for ps in sps.iter().chain(pps.iter()) {
                out.extend_from_slice(&SC);
                out.extend_from_slice(ps);
            }
        }
        let mut off = 0;
        while off < p.data.len() {
            let n = u32::from_be_bytes(p.data[off..off + 4].try_into().unwrap()) as usize;
            out.extend_from_slice(&SC);
            out.extend_from_slice(&p.data[off + 4..off + 4 + n]);
            off += 4 + n;
        }
    }
    out
}

#[test]
fn avc_roundtrip() {
    let (packets, desc, hw) = encode_all(VideoCodec::Avc);
    println!("AVC: {} packets, hw={hw}, avcC={:02x?}", packets.len(), &desc[..desc.len().min(8)]);
    check_common(&packets);
    // AVCDecoderConfigurationRecord
    assert_eq!(desc[0], 1, "configurationVersion");
    assert!(matches!(desc[1], 66 | 77 | 100), "profile_idc {}", desc[1]);
    assert_eq!(desc[4] & 0xfc, 0xfc, "reserved bits");
    assert_eq!(desc[4] & 0x03, 3, "4-byte NAL lengths");
    assert!(desc[5] & 0x1f >= 1, "at least one SPS");
    let (sps, pps) = parse_avcc(&desc);
    assert_eq!(sps[0][0] & 0x1f, 7);
    assert_eq!(pps[0][0] & 0x1f, 8);

    // Annex-B dump + ffprobe validation.
    let path = common::out_dir().join("out.h264");
    std::fs::write(&path, to_annex_b(&packets, &desc)).unwrap();
    match common::find_tool("ffprobe") {
        None => println!("ffprobe not found; skipping Annex-B validation"),
        Some(ffprobe) => {
            let out = Command::new(ffprobe)
                .args([
                    "-v",
                    "error",
                    "-count_frames",
                    "-show_entries",
                    "stream=codec_name,width,height,nb_read_frames",
                    "-of",
                    "default=noprint_wrappers=1",
                ])
                .arg(&path)
                .output()
                .expect("run ffprobe");
            let text = String::from_utf8_lossy(&out.stdout);
            println!("ffprobe: {}", text.trim().replace('\n', ", "));
            assert!(out.status.success(), "ffprobe failed: {}", String::from_utf8_lossy(&out.stderr));
            assert!(text.contains("codec_name=h264"), "{text}");
            assert!(text.contains("width=640"), "{text}");
            assert!(text.contains("height=360"), "{text}");
            assert!(text.contains("nb_read_frames=60"), "{text}");
        }
    }

    decode_and_check(VideoCodec::Avc, &packets, &desc);
}

#[test]
fn hevc_roundtrip() {
    let (packets, desc, hw) = encode_all(VideoCodec::Hevc);
    println!("HEVC: {} packets, hw={hw}, hvcC len {}", packets.len(), desc.len());
    check_common(&packets);
    // HEVCDecoderConfigurationRecord
    assert_eq!(desc[0], 1, "configurationVersion");
    assert!(desc.len() > 23, "hvcC too short");
    assert_eq!(desc[21] & 0x03, 3, "4-byte NAL lengths");
    let num_arrays = desc[22] as usize;
    assert!(num_arrays >= 3, "expected VPS/SPS/PPS arrays, got {num_arrays}");
    let mut types = Vec::new();
    let mut i = 23;
    for _ in 0..num_arrays {
        types.push(desc[i] & 0x3f);
        let n = u16::from_be_bytes([desc[i + 1], desc[i + 2]]) as usize;
        i += 3;
        for _ in 0..n {
            let l = u16::from_be_bytes([desc[i], desc[i + 1]]) as usize;
            i += 2 + l;
        }
    }
    assert_eq!(i, desc.len(), "hvcC arrays parse exactly");
    for t in [32, 33, 34] {
        assert!(types.contains(&t), "missing NAL type {t} in hvcC ({types:?})");
    }
    decode_and_check(VideoCodec::Hevc, &packets, &desc);
}

#[test]
fn avc_alpha_rejected() {
    let mut cfg = VideoEncoderConfig::new(VideoCodec::Avc, W, H);
    cfg.alpha = true;
    assert!(VideoEncoder::new(cfg).is_err());
}

#[test]
fn bad_stride_rejected() {
    let mut enc = VideoEncoder::new(VideoEncoderConfig::new(VideoCodec::Avc, W, H)).unwrap();
    assert!(enc.encode_bgra(&[0u8; 16], 4, 0, 0, false).is_err());
}

/// With reorder depth 0, a stream without B-frames still decodes in order.
#[test]
fn decoder_low_latency_mode() {
    let (packets, desc, _) = encode_all(VideoCodec::Avc);
    let mut dec = VideoDecoder::new(VideoCodec::Avc, &desc, W, H).unwrap();
    dec.set_reorder_depth(0);
    let mut got = 0;
    for p in &packets {
        dec.decode(&p.data, p.timestamp_us, p.duration_us, p.key).unwrap();
        let f = dec.take_frames();
        // With depth 0 each synchronous decode yields its frame immediately.
        got += f.len();
    }
    dec.flush().unwrap();
    got += dec.take_frames().len();
    assert_eq!(got, FRAMES);
}

mod iosurface_ffi {
    use std::ffi::c_void;
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        pub static kCFTypeDictionaryKeyCallBacks: [usize; 6];
        pub static kCFTypeDictionaryValueCallBacks: [usize; 5];
        pub fn CFDictionaryCreateMutable(a: *const c_void, c: isize, k: *const c_void, v: *const c_void)
            -> *mut c_void;
        pub fn CFDictionarySetValue(d: *mut c_void, k: *const c_void, v: *const c_void);
        pub fn CFNumberCreate(a: *const c_void, t: isize, v: *const c_void) -> *const c_void;
        pub fn CFRelease(r: *const c_void);
    }
    #[link(name = "IOSurface", kind = "framework")]
    extern "C" {
        pub static kIOSurfaceWidth: *const c_void;
        pub static kIOSurfaceHeight: *const c_void;
        pub static kIOSurfaceBytesPerElement: *const c_void;
        pub static kIOSurfacePixelFormat: *const c_void;
        pub fn IOSurfaceCreate(props: *const c_void) -> *mut c_void;
        pub fn IOSurfaceLock(s: *mut c_void, opts: u32, seed: *mut u32) -> i32;
        pub fn IOSurfaceUnlock(s: *mut c_void, opts: u32, seed: *mut u32) -> i32;
        pub fn IOSurfaceGetBaseAddress(s: *mut c_void) -> *mut c_void;
        pub fn IOSurfaceGetBytesPerRow(s: *mut c_void) -> usize;
    }
}

#[test]
fn iosurface_encode() {
    use iosurface_ffi::*;
    use std::ffi::c_void;
    unsafe {
        let dict = CFDictionaryCreateMutable(
            std::ptr::null(),
            0,
            &kCFTypeDictionaryKeyCallBacks as *const _ as *const c_void,
            &kCFTypeDictionaryValueCallBacks as *const _ as *const c_void,
        );
        let num = |v: i32| CFNumberCreate(std::ptr::null(), 3, &v as *const i32 as *const c_void);
        let vals = [
            (kIOSurfaceWidth, num(W as i32)),
            (kIOSurfaceHeight, num(H as i32)),
            (kIOSurfaceBytesPerElement, num(4)),
            (kIOSurfacePixelFormat, num(u32::from_be_bytes(*b"BGRA") as i32)),
        ];
        for (k, v) in vals {
            CFDictionarySetValue(dict, k, v);
            CFRelease(v);
        }
        let mut cfg = VideoEncoderConfig::new(VideoCodec::Avc, W, H);
        cfg.bitrate = Some(4_000_000);
        let mut enc = VideoEncoder::new(cfg).unwrap();
        // One surface per frame, since VideoToolbox may still read a surface
        // after encode returns.
        let mut surfaces = Vec::new();
        for i in 0..10 {
            let surf = IOSurfaceCreate(dict);
            assert!(!surf.is_null());
            IOSurfaceLock(surf, 0, std::ptr::null_mut());
            let base = IOSurfaceGetBaseAddress(surf) as *mut u8;
            let bpr = IOSurfaceGetBytesPerRow(surf);
            let src = make_frame(i);
            for y in 0..H as usize {
                std::ptr::copy_nonoverlapping(src.as_ptr().add(y * W as usize * 4), base.add(y * bpr), W as usize * 4);
            }
            IOSurfaceUnlock(surf, 0, std::ptr::null_mut());
            enc.encode_iosurface(surf, i as i64 * FRAME_US, FRAME_US, false).unwrap();
            surfaces.push(surf);
        }
        enc.flush().unwrap();
        let packets = enc.take_packets();
        assert_eq!(packets.len(), 10);
        assert!(packets[0].key);
        let desc = enc.description().unwrap();
        let mut dec = VideoDecoder::new(VideoCodec::Avc, &desc, W, H).unwrap();
        for p in &packets {
            dec.decode(&p.data, p.timestamp_us, p.duration_us, p.key).unwrap();
        }
        dec.flush().unwrap();
        let frames = dec.take_frames();
        assert_eq!(frames.len(), 10);
        for (i, f) in frames.iter().enumerate() {
            let p = psnr_bgr(&make_frame(i), &f.bgra, W as usize, H as usize, f.stride);
            assert!(p > 30.0, "iosurface frame {i} PSNR {p:.2}");
        }
        drop(enc);
        for s in surfaces {
            CFRelease(s);
        }
        CFRelease(dict);
    }
}

/// Find a box payload by its fourcc with a simple scan.
fn find_box<'a>(file: &'a [u8], fourcc: &[u8; 4]) -> Option<&'a [u8]> {
    let pos = file.windows(4).position(|w| w == fourcc)?;
    let size = u32::from_be_bytes(file[pos - 4..pos].try_into().unwrap()) as usize;
    Some(&file[pos + 4..pos - 4 + size])
}

/// Decode a stream with B-frames made by ffmpeg. Frames must come out in
/// presentation order and match ffmpeg's own decode.
fn reorder_test(codec: VideoCodec, encoder: &str, atom: &[u8; 4], name: &str) {
    let (Some(ffmpeg), Some(ffprobe)) = (common::find_tool("ffmpeg"), common::find_tool("ffprobe")) else {
        println!("ffmpeg/ffprobe not found; skipping");
        return;
    };
    let dir = common::out_dir();
    let mp4 = dir.join(name);
    let mut cmd = Command::new(&ffmpeg);
    cmd.args(["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30", "-frames:v", "48"])
        .args(["-c:v", encoder, "-bf", "3", "-g", "24", "-pix_fmt", "yuv420p"])
        .args(["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"]);
    if codec == VideoCodec::Hevc {
        cmd.args(["-tag:v", "hvc1", "-x265-params", "log-level=error:b-pyramid=1"]);
    } else {
        cmd.args(["-x264-params", "b-pyramid=normal"]);
    }
    if !cmd.arg(&mp4).status().map(|s| s.success()).unwrap_or(false) {
        println!("{encoder} unavailable; skipping");
        return;
    }
    let file = std::fs::read(&mp4).unwrap();
    let desc = find_box(&file, atom).expect("config box").to_vec();

    let out = Command::new(&ffprobe)
        .args(["-v", "error", "-select_streams", "v", "-show_entries", "packet=pts,dts,duration,pos,size,flags"])
        .args(["-of", "csv=p=0"])
        .arg(&mp4)
        .output()
        .unwrap();
    let text = String::from_utf8(out.stdout).unwrap();
    // Columns: pts,dts,duration,size,pos,flags
    let mut packets = Vec::new();
    let mut reordered = false;
    let mut last_pts = i64::MIN;
    for line in text.lines().filter(|l| !l.is_empty()) {
        let f: Vec<&str> = line.split(',').collect();
        let pts: i64 = f[0].parse().unwrap();
        let dur: i64 = f[2].parse().unwrap();
        let size: usize = f[3].parse().unwrap();
        let pos: usize = f[4].parse().unwrap();
        let key = f[5].contains('K');
        if pts < last_pts {
            reordered = true;
        }
        last_pts = pts;
        packets.push((file[pos..pos + size].to_vec(), pts, dur, key));
    }
    assert!(reordered, "test stream should contain B-frame reordering");
    let tb_out = Command::new(&ffprobe)
        .args(["-v", "error", "-select_streams", "v", "-show_entries", "stream=time_base", "-of", "csv=p=0"])
        .arg(&mp4)
        .output()
        .unwrap();
    let tb_text = String::from_utf8(tb_out.stdout).unwrap();
    let tb: i64 = tb_text.trim().split('/').nth(1).unwrap().parse().unwrap(); // "1/15360"
    let mut dec = VideoDecoder::new(codec, &desc, 320, 240).unwrap();
    let mut frames = Vec::new();
    for (data, pts, dur, key) in &packets {
        dec.decode(data, pts * 1_000_000 / tb, dur * 1_000_000 / tb, *key).unwrap();
        frames.extend(dec.take_frames());
    }
    dec.flush().unwrap();
    frames.extend(dec.take_frames());
    assert_eq!(frames.len(), 48);
    for w in frames.windows(2) {
        assert!(w[1].timestamp_us > w[0].timestamp_us, "presentation order");
    }

    // Async decode must give identical frames and timestamps.
    let mut dec = VideoDecoder::new(codec, &desc, 320, 240).unwrap();
    dec.set_async(true);
    let mut async_frames = Vec::new();
    for (data, pts, dur, key) in &packets {
        dec.decode(data, pts * 1_000_000 / tb, dur * 1_000_000 / tb, *key).unwrap();
        async_frames.extend(dec.take_frames());
    }
    dec.flush().unwrap();
    assert_eq!(dec.pending(), 0);
    async_frames.extend(dec.take_frames());
    assert_eq!(async_frames.len(), frames.len(), "async frame count");
    for (i, (a, s)) in async_frames.iter().zip(&frames).enumerate() {
        assert_eq!((a.timestamp_us, a.duration_us), (s.timestamp_us, s.duration_us), "async frame {i} timing");
        assert!(a.bgra == s.bgra, "async frame {i} pixels differ from sync decode");
    }

    // Compare against ffmpeg's decode (presentation order).
    let raw = Command::new(&ffmpeg)
        .args(["-v", "error", "-i"])
        .arg(&mp4)
        .args([
            "-vf",
            "scale=in_color_matrix=bt709:in_range=tv:flags=accurate_rnd+full_chroma_int",
            "-pix_fmt",
            "bgra",
            "-f",
            "rawvideo",
            "-",
        ])
        .output()
        .unwrap()
        .stdout;
    let fsz = 320 * 240 * 4;
    assert_eq!(raw.len(), fsz * 48);
    let mut min = f64::MAX;
    for (i, f) in frames.iter().enumerate() {
        let p = psnr_luma(&raw[i * fsz..(i + 1) * fsz], &f.bgra, 320, 240, f.stride);
        min = min.min(p);
        // The matching ffmpeg frame must be the best match (proves ordering).
        for j in [i.wrapping_sub(1), i + 1].into_iter().filter(|&j| j < 48) {
            let q = psnr_luma(&raw[j * fsz..(j + 1) * fsz], &f.bgra, 320, 240, f.stride);
            assert!(p > q, "frame {i} matches ffmpeg frame {j} better ({q:.2} > {p:.2})");
        }
    }
    println!("{codec:?} B-frame stream: min luma PSNR vs ffmpeg decode {min:.2} dB");
    assert!(min > 35.0, "frame order/content mismatch (min PSNR {min:.2})");
}

#[test]
fn avc_bframes_reordered() {
    reorder_test(VideoCodec::Avc, "libx264", b"avcC", "bframes_avc.mp4");
}

#[test]
fn hevc_bframes_reordered() {
    reorder_test(VideoCodec::Hevc, "libx265", b"hvcC", "bframes_hevc.mp4");
}

#[test]
fn hevc_alpha_encode() {
    let mut cfg = VideoEncoderConfig::new(VideoCodec::Hevc, 320, 240);
    cfg.alpha = true;
    let mut enc = match VideoEncoder::new(cfg) {
        Ok(e) => e,
        Err(e) => {
            println!("HEVC alpha unsupported here: {e}");
            return;
        }
    };
    // Left half opaque red, right half fully transparent.
    let mut frame = vec![0u8; 320 * 240 * 4];
    for px in frame.chunks_exact_mut(4).enumerate().filter(|(i, _)| i % 320 < 160).map(|(_, p)| p) {
        px.copy_from_slice(&[0, 0, 255, 255]);
    }
    for i in 0..5 {
        enc.encode_bgra(&frame, 320 * 4, i * FRAME_US, FRAME_US, false).unwrap();
    }
    enc.flush().unwrap();
    let packets = enc.take_packets();
    assert_eq!(packets.len(), 5);
    let desc = enc.description().unwrap();
    let mut dec = VideoDecoder::new(VideoCodec::Hevc, &desc, 320, 240).unwrap();
    for p in &packets {
        dec.decode(&p.data, p.timestamp_us, p.duration_us, p.key).unwrap();
    }
    dec.flush().unwrap();
    let frames = dec.take_frames();
    assert_eq!(frames.len(), 5);
    let f = &frames[0];
    let a_left = f.bgra[(120 * f.stride) + 40 * 4 + 3];
    let a_right = f.bgra[(120 * f.stride) + 280 * 4 + 3];
    println!("alpha left {a_left} right {a_right}");
    assert!(a_left > 240 && a_right < 15, "alpha not preserved: {a_left} / {a_right}");
}

#[test]
fn quality_mode_without_bitrate() {
    let mut enc = VideoEncoder::new(VideoEncoderConfig::new(VideoCodec::Avc, W, H)).unwrap();
    for i in 0..10 {
        enc.encode_bgra(&make_frame(i), W as usize * 4, i as i64 * FRAME_US, FRAME_US, false).unwrap();
    }
    enc.flush().unwrap();
    let packets = enc.take_packets();
    assert_eq!(packets.len(), 10);
    let bytes: usize = packets.iter().map(|p| p.data.len()).sum();
    println!("quality mode: {bytes} bytes for 10 frames");
}
