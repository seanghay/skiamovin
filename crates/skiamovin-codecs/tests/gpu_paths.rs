#![cfg(target_os = "macos")]

//! Tests for encoder in-flight limits, IOSurface encoding, uncopied decode
//! output, and a timing benchmark.

use skiamovin_codecs::*;
use std::time::{Duration, Instant};

const W: u32 = 640;
const H: u32 = 360;
const FRAME_US: i64 = 33_333;

/// Synthetic BGRA frame: gradient + moving white box.
fn make_frame(i: usize, w: usize, h: usize) -> Vec<u8> {
    let mut buf = vec![0u8; w * h * 4];
    fill_frame(i, w, h, &mut buf, w * 4);
    buf
}

fn fill_frame(i: usize, w: usize, h: usize, dst: &mut [u8], stride: usize) {
    let bs = h / 4;
    let bx = (i * 8) % (w - bs);
    let by = (h as f64 * 0.4 + (i as f64 * 0.2).sin() * h as f64 * 0.15) as usize;
    for y in 0..h {
        let row = &mut dst[y * stride..y * stride + w * 4];
        for x in 0..w {
            let p = &mut row[x * 4..x * 4 + 4];
            if x >= bx && x < bx + bs && y >= by && y < by + bs {
                p.copy_from_slice(&[255, 255, 255, 255]);
            } else {
                p[0] = (x * 255 / w) as u8;
                p[1] = (y * 255 / h) as u8;
                p[2] = ((i * 4 + (x + y) / 8) % 256) as u8;
                p[3] = 255;
            }
        }
    }
}

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

fn config(w: u32, h: u32) -> VideoEncoderConfig {
    let mut cfg = VideoEncoderConfig::new(VideoCodec::Avc, w, h);
    cfg.bitrate = Some(4_000_000);
    cfg.frame_rate = Some(30.0);
    cfg
}

fn decode_all(desc: &[u8], packets: &[EncodedVideoPacket], w: u32, h: u32) -> Vec<DecodedVideoFrame> {
    let mut dec = VideoDecoder::new(VideoCodec::Avc, desc, w, h).unwrap();
    let mut frames = Vec::new();
    for p in packets {
        dec.decode(&p.data, p.timestamp_us, p.duration_us, p.key).unwrap();
        frames.extend(dec.take_frames());
    }
    dec.flush().unwrap();
    frames.extend(dec.take_frames());
    frames
}

#[test]
fn encoder_in_flight_bounded_and_resumable() {
    let mut cfg = config(W, H);
    // Key frame every 20 frames. An extra key frame at 30, where we wait,
    // would mean wait_in_flight changed the key frame spacing.
    cfg.key_frame_interval = Some(20.0 / 30.0);
    let mut enc = VideoEncoder::new(cfg).unwrap();
    let mut packets = Vec::new();
    let mut max_seen = 0;
    for i in 0..30 {
        enc.encode_bgra(&make_frame(i, W as usize, H as usize), W as usize * 4, i as i64 * FRAME_US, FRAME_US, i == 0)
            .unwrap();
        max_seen = max_seen.max(enc.in_flight());
        packets.extend(enc.take_packets());
    }
    enc.wait_in_flight(2).unwrap();
    assert!(enc.in_flight() <= 2, "in_flight {} after wait_in_flight(2)", enc.in_flight());
    // In-flight frames eventually complete on their own as well.
    let t0 = Instant::now();
    while enc.in_flight() > 8 && t0.elapsed() < Duration::from_secs(2) {
        std::thread::sleep(Duration::from_millis(1));
    }
    assert!(enc.in_flight() <= 8);
    enc.wait_in_flight(0).unwrap();
    assert_eq!(enc.in_flight(), 0);
    packets.extend(enc.take_packets());
    assert_eq!(packets.len(), 30, "all first 30 frames emitted after wait_in_flight(0)");
    eprintln!("in-flight: max observed during submit = {max_seen}");

    for i in 30..60 {
        enc.encode_bgra(&make_frame(i, W as usize, H as usize), W as usize * 4, i as i64 * FRAME_US, FRAME_US, false)
            .unwrap();
        packets.extend(enc.take_packets());
    }
    enc.flush().unwrap();
    assert_eq!(enc.in_flight(), 0);
    packets.extend(enc.take_packets());
    assert_eq!(packets.len(), 60);
    let keys: Vec<usize> = packets.iter().enumerate().filter(|(_, p)| p.key).map(|(i, _)| i).collect();
    eprintln!("in-flight: key frames at {keys:?}");
    assert_eq!(keys[0], 0);
    // VideoToolbox may add extra key frames on its own, so only check that
    // the gap never exceeds 20 and that a key frame at 30 follows one at 10.
    for pair in keys.windows(2) {
        assert!(pair[1] - pair[0] <= 20, "key cadence broken: {keys:?}");
    }
    assert!(60 - keys.last().unwrap() <= 20, "key cadence broken: {keys:?}");
    if keys.contains(&30) {
        assert!(keys.contains(&10), "wait_in_flight forced a key frame at 30: {keys:?}");
    }
    for (i, p) in packets.iter().enumerate() {
        assert_eq!(p.timestamp_us, i as i64 * FRAME_US);
    }

    let frames = decode_all(&enc.description().unwrap(), &packets, W, H);
    assert_eq!(frames.len(), 60);
    for (i, f) in frames.iter().enumerate() {
        let p = psnr_bgr(&make_frame(i, W as usize, H as usize), &f.bgra, W as usize, H as usize, f.stride);
        assert!(p > 30.0, "frame {i} PSNR {p:.2}");
    }
}

#[test]
fn iosurface_ring_encode() {
    const RING: usize = 3;
    const N: usize = 60;
    let mut enc = VideoEncoder::new(config(W, H)).unwrap();
    let mut ring: Vec<IOSurfaceHandle> = (0..RING).map(|_| create_iosurface_bgra(W, H).unwrap()).collect();
    assert!(!ring[0].as_ptr().is_null());
    assert_eq!((ring[0].width(), ring[0].height()), (W, H));
    assert!(ring[0].bytes_per_row() >= W as usize * 4);
    let mut packets = Vec::new();
    let mut busy_after_wait = 0;
    for i in 0..N {
        // Frame i - RING (last user of this surface) must be finished.
        enc.wait_in_flight(RING - 1).unwrap();
        let s = &mut ring[i % RING];
        if s.is_in_use() {
            busy_after_wait += 1;
        }
        let bpr = s.bytes_per_row();
        s.with_locked_mut(|bytes| fill_frame(i, W as usize, H as usize, bytes, bpr)).unwrap();
        unsafe { enc.encode_iosurface(s.as_ptr(), i as i64 * FRAME_US, FRAME_US, i == 0).unwrap() };
        assert!(enc.in_flight() <= RING);
        packets.extend(enc.take_packets());
    }
    enc.flush().unwrap();
    packets.extend(enc.take_packets());
    eprintln!("iosurface ring: surface still IOSurfaceIsInUse after wait: {busy_after_wait}/{N}");
    assert_eq!(packets.len(), N);
    let frames = decode_all(&enc.description().unwrap(), &packets, W, H);
    assert_eq!(frames.len(), N);
    let mut min = f64::MAX;
    for (i, f) in frames.iter().enumerate() {
        let p = psnr_bgr(&make_frame(i, W as usize, H as usize), &f.bgra, W as usize, H as usize, f.stride);
        min = min.min(p);
        assert!(p > 30.0, "ring frame {i} PSNR {p:.2} (surface overwritten while in flight?)");
    }
    eprintln!("iosurface ring: min PSNR {min:.2} dB");
}

#[test]
fn zero_copy_decode_matches_copy_path() {
    const N: usize = 30;
    let mut enc = VideoEncoder::new(config(W, H)).unwrap();
    let mut packets = Vec::new();
    for i in 0..N {
        enc.encode_bgra(&make_frame(i, W as usize, H as usize), W as usize * 4, i as i64 * FRAME_US, FRAME_US, i == 0)
            .unwrap();
    }
    enc.flush().unwrap();
    packets.extend(enc.take_packets());
    let desc = enc.description().unwrap();
    let copied = decode_all(&desc, &packets, W, H);

    let mut dec = VideoDecoder::new(VideoCodec::Avc, &desc, W, H).unwrap();
    dec.set_zero_copy(true);
    let mut surfaces = Vec::new();
    for p in &packets {
        dec.decode(&p.data, p.timestamp_us, p.duration_us, p.key).unwrap();
        surfaces.extend(dec.take_surfaces());
        assert!(dec.take_frames().is_empty(), "take_frames is empty in zero-copy mode");
    }
    dec.flush().unwrap();
    surfaces.extend(dec.take_surfaces());
    assert_eq!(surfaces.len(), N);
    assert_eq!(copied.len(), N);
    // Surfaces outlive the decoder.
    drop(dec);
    // Must be Send.
    fn assert_send<T: Send>(_: &T) {}
    assert_send(&surfaces[0]);
    for (i, (s, c)) in surfaces.iter().zip(&copied).enumerate() {
        assert_eq!((s.width, s.height), (W, H));
        assert_eq!(s.timestamp_us, i as i64 * FRAME_US);
        assert_eq!(s.duration_us, FRAME_US);
        assert!(!s.iosurface().is_null(), "frame {i} not IOSurface-backed");
        let f = s.to_bgra();
        assert_eq!((f.width, f.height, f.stride, f.timestamp_us), (c.width, c.height, c.stride, c.timestamp_us));
        if f.bgra != c.bgra {
            let p = psnr_bgr(&c.bgra, &f.bgra, W as usize, H as usize, f.stride);
            assert!(p > 50.0, "frame {i}: zero-copy vs copy PSNR {p:.2}");
        }
    }
    // Send to another thread and read there.
    let s = surfaces.pop().unwrap();
    let f = std::thread::spawn(move || s.to_bgra()).join().unwrap();
    assert_eq!(f.bgra.len(), W as usize * H as usize * 4);
}

#[test]
fn benchmark_gpu_paths() {
    const BW: u32 = 1920;
    const BH: u32 = 1080;
    const N: usize = 240;
    const RING: usize = 4;
    let (w, h) = (BW as usize, BH as usize);
    // A few precomputed frames (generation is excluded from encode timings).
    let srcs: Vec<Vec<u8>> = (0..8).map(|i| make_frame(i * 3, w, h)).collect();
    let ms = |d: Duration| d.as_secs_f64() * 1000.0;

    // (a) encode_bgra from a Vec
    let mut enc = VideoEncoder::new(config(BW, BH)).unwrap();
    let hw = enc.is_hardware_accelerated();
    let t0 = Instant::now();
    let mut submit = Duration::ZERO;
    let mut packets = Vec::new();
    for i in 0..N {
        let t = Instant::now();
        enc.encode_bgra(&srcs[i % srcs.len()], w * 4, i as i64 * FRAME_US, FRAME_US, i == 0).unwrap();
        submit += t.elapsed();
        packets.extend(enc.take_packets());
    }
    enc.flush().unwrap();
    packets.extend(enc.take_packets());
    let total_a = t0.elapsed();
    assert_eq!(packets.len(), N);
    let desc = enc.description().unwrap();
    drop(enc);
    eprintln!(
        "[bench] 1080p x{N} (hw encoder: {hw}) (a) encode_bgra: submit {:.2} ms/frame, total incl. flush {:.0} ms ({:.2} ms/frame)",
        ms(submit) / N as f64,
        ms(total_a),
        ms(total_a) / N as f64
    );

    // (b) encode_iosurface from a ring of 4, wait_in_flight(2)
    for speed in [false, true] {
        let mut cfg = config(BW, BH);
        cfg.speed_over_quality = speed;
        let mut enc = VideoEncoder::new(cfg).unwrap();
        let mut ring: Vec<IOSurfaceHandle> = (0..RING).map(|_| create_iosurface_bgra(BW, BH).unwrap()).collect();
        let t0 = Instant::now();
        let (mut fill, mut wait, mut submit) = (Duration::ZERO, Duration::ZERO, Duration::ZERO);
        let mut count = 0;
        for i in 0..N {
            let t = Instant::now();
            enc.wait_in_flight(2).unwrap();
            wait += t.elapsed();
            let s = &mut ring[i % RING];
            let bpr = s.bytes_per_row();
            let src = &srcs[i % srcs.len()];
            let t = Instant::now();
            s.with_locked_mut(|bytes| {
                for y in 0..h {
                    bytes[y * bpr..y * bpr + w * 4].copy_from_slice(&src[y * w * 4..(y + 1) * w * 4]);
                }
            })
            .unwrap();
            fill += t.elapsed();
            let t = Instant::now();
            unsafe { enc.encode_iosurface(s.as_ptr(), i as i64 * FRAME_US, FRAME_US, i == 0).unwrap() };
            submit += t.elapsed();
            count += enc.take_packets().len();
        }
        enc.flush().unwrap();
        count += enc.take_packets().len();
        let total = t0.elapsed();
        assert_eq!(count, N);
        eprintln!(
            "[bench] (b) encode_iosurface ring={RING} wait_in_flight(2) speed_over_quality={speed}: \
             submit {:.2} ms/frame, wait {:.2} ms/frame, CPU fill {:.2} ms/frame, total incl. flush {:.0} ms \
             ({:.2} ms/frame, {:.2} ms/frame excl. fill)",
            ms(submit) / N as f64,
            ms(wait) / N as f64,
            ms(fill) / N as f64,
            ms(total),
            ms(total) / N as f64,
            ms(total - fill) / N as f64
        );
    }

    // (c) decode, single stream: copied vs uncopied output, sync vs async
    for asynchronous in [false, true] {
        for zero_copy in [false, true] {
            let mut dec = VideoDecoder::new(VideoCodec::Avc, &desc, BW, BH).unwrap();
            dec.set_zero_copy(zero_copy);
            dec.set_async(asynchronous);
            dec.set_reorder_depth(0);
            let t0 = Instant::now();
            let mut n = 0;
            for p in &packets {
                dec.decode(&p.data, p.timestamp_us, p.duration_us, p.key).unwrap();
                dec.wait_pending(8).unwrap();
                // Drop surfaces right away, as a renderer would after drawing.
                n += dec.take_frames().len() + dec.take_surfaces().len();
            }
            dec.flush().unwrap();
            n += dec.take_frames().len() + dec.take_surfaces().len();
            let total = t0.elapsed();
            assert_eq!(n, N);
            eprintln!(
                "[bench] (c) decode 1 stream {} {}: {:.2} ms/frame ({:.0} ms total)",
                if asynchronous { "async" } else { "sync " },
                if zero_copy { "zero-copy" } else { "copy     " },
                ms(total) / N as f64,
                ms(total)
            );
        }
    }

    // (d) 4 decoders fed round-robin (one caller thread), sync vs async.
    // Each decoder gets its own session; they all decode the stream from (a).
    const STREAMS: usize = 4;
    for zero_copy in [false, true] {
        for asynchronous in [false, true] {
            let mut decs: Vec<VideoDecoder> = (0..STREAMS)
                .map(|_| {
                    let mut d = VideoDecoder::new(VideoCodec::Avc, &desc, BW, BH).unwrap();
                    d.set_zero_copy(zero_copy);
                    d.set_async(asynchronous);
                    d.set_reorder_depth(0);
                    d
                })
                .collect();
            let t0 = Instant::now();
            let mut n = 0;
            for p in &packets {
                for d in decs.iter_mut() {
                    d.decode(&p.data, p.timestamp_us, p.duration_us, p.key).unwrap();
                }
                for d in decs.iter_mut() {
                    d.wait_pending(4).unwrap();
                    n += d.take_frames().len() + d.take_surfaces().len();
                }
            }
            for d in decs.iter_mut() {
                d.flush().unwrap();
                n += d.take_frames().len() + d.take_surfaces().len();
            }
            let total = t0.elapsed();
            assert_eq!(n, N * STREAMS);
            eprintln!(
                "[bench] (d) decode {STREAMS}x1080p round-robin {} {}: {:.2} ms/frame ({:.0} ms total for {} frames)",
                if asynchronous { "async" } else { "sync " },
                if zero_copy { "zero-copy" } else { "copy     " },
                ms(total) / (N * STREAMS) as f64,
                ms(total),
                N * STREAMS
            );
        }
    }
}

fn encode_stream(codec: VideoCodec, n: usize) -> (Vec<EncodedVideoPacket>, Vec<u8>) {
    let mut cfg = config(W, H);
    cfg.codec = codec;
    cfg.key_frame_interval = Some(1.0);
    let mut enc = VideoEncoder::new(cfg).unwrap();
    for i in 0..n {
        enc.encode_bgra(&make_frame(i, W as usize, H as usize), W as usize * 4, i as i64 * FRAME_US, FRAME_US, i == 0)
            .unwrap();
    }
    enc.flush().unwrap();
    (enc.take_packets(), enc.description().unwrap())
}

#[test]
fn async_decode_matches_sync() {
    const N: usize = 60;
    for codec in [VideoCodec::Avc, VideoCodec::Hevc] {
        let (packets, desc) = encode_stream(codec, N);
        assert_eq!(packets.len(), N);
        let mut sync = VideoDecoder::new(codec, &desc, W, H).unwrap();
        let mut sync_frames = Vec::new();
        for p in &packets {
            sync.decode(&p.data, p.timestamp_us, p.duration_us, p.key).unwrap();
            assert_eq!(sync.pending(), 0, "sync decode leaves nothing pending");
            sync_frames.extend(sync.take_frames());
        }
        sync.flush().unwrap();
        sync_frames.extend(sync.take_frames());

        // Async, copy path; submit everything without waiting.
        let mut dec = VideoDecoder::new(codec, &desc, W, H).unwrap();
        dec.set_async(true);
        let mut frames = Vec::new();
        let mut max_pending = 0;
        for p in &packets {
            dec.decode(&p.data, p.timestamp_us, p.duration_us, p.key).unwrap();
            max_pending = max_pending.max(dec.pending());
            frames.extend(dec.take_frames());
        }
        dec.wait_pending(2).unwrap();
        assert!(dec.pending() <= 2);
        dec.wait_pending(0).unwrap();
        assert_eq!(dec.pending(), 0);
        dec.flush().unwrap();
        frames.extend(dec.take_frames());
        eprintln!("{codec:?} async: max pending {max_pending}");
        assert_eq!(frames.len(), N);
        assert_eq!(sync_frames.len(), N);
        for (i, (a, s)) in frames.iter().zip(&sync_frames).enumerate() {
            assert_eq!(a.timestamp_us, i as i64 * FRAME_US);
            assert_eq!((a.timestamp_us, a.duration_us), (s.timestamp_us, s.duration_us));
            assert!(a.bgra == s.bgra, "{codec:?} async frame {i} differs from sync");
        }

        // Async, uncopied output, limited backlog.
        let mut dec = VideoDecoder::new(codec, &desc, W, H).unwrap();
        dec.set_async(true);
        dec.set_zero_copy(true);
        let mut surfaces = Vec::new();
        for p in &packets {
            dec.decode(&p.data, p.timestamp_us, p.duration_us, p.key).unwrap();
            dec.wait_pending(3).unwrap();
            assert!(dec.pending() <= 3);
            surfaces.extend(dec.take_surfaces());
        }
        dec.flush().unwrap();
        surfaces.extend(dec.take_surfaces());
        assert_eq!(surfaces.len(), N);
        for (i, (a, s)) in surfaces.iter().zip(&sync_frames).enumerate() {
            assert_eq!(a.timestamp_us, s.timestamp_us);
            assert!(!a.iosurface().is_null());
            assert!(a.to_bgra().bgra == s.bgra, "{codec:?} async zero-copy frame {i} differs from sync");
        }
    }
}

#[test]
fn async_decoders_on_parallel_threads() {
    // Several async decoders driven from different threads at once.
    let (packets, desc) = encode_stream(VideoCodec::Avc, 30);
    let packets = std::sync::Arc::new(packets);
    let handles: Vec<_> = (0..4)
        .map(|_| {
            let (packets, desc) = (packets.clone(), desc.clone());
            std::thread::spawn(move || {
                let mut dec = VideoDecoder::new(VideoCodec::Avc, &desc, W, H).unwrap();
                dec.set_async(true);
                let mut ts = Vec::new();
                for p in packets.iter() {
                    dec.decode(&p.data, p.timestamp_us, p.duration_us, p.key).unwrap();
                    ts.extend(dec.take_frames().iter().map(|f| f.timestamp_us));
                }
                dec.flush().unwrap();
                ts.extend(dec.take_frames().iter().map(|f| f.timestamp_us));
                ts
            })
        })
        .collect();
    for h in handles {
        let ts = h.join().unwrap();
        assert_eq!(ts, (0..30).map(|i| i as i64 * FRAME_US).collect::<Vec<_>>());
    }
}
