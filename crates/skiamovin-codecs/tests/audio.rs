#![cfg(target_os = "macos")]

mod common;

use skiamovin_codecs::*;
use std::process::Command;

#[test]
fn aac_roundtrip() {
    const SR: u32 = 48000;
    const CH: usize = 2;
    let total = SR as usize * 2;
    let pcm: Vec<f32> = (0..total)
        .flat_map(|i| {
            let s = (2.0 * std::f32::consts::PI * 440.0 * i as f32 / SR as f32).sin() * 0.5;
            [s, s]
        })
        .collect();

    let mut enc = AudioEncoder::new(SR, CH as u32, Some(128_000)).expect("aac encoder");
    let asc = enc.description();
    println!("ASC {:02x?}, priming {}", asc, enc.priming_frames());
    assert_eq!(asc, vec![0x11, 0x90], "AAC-LC 48 kHz stereo AudioSpecificConfig");

    // Feed odd-sized chunks to exercise internal buffering.
    let mut packets = Vec::new();
    let chunk = 1000;
    for (k, c) in pcm.chunks(chunk * CH).enumerate() {
        enc.encode_f32_interleaved(c, (k * chunk) as i64 * 1_000_000 / SR as i64).unwrap();
        packets.extend(enc.take_packets());
    }
    enc.flush().unwrap();
    packets.extend(enc.take_packets());
    println!("{} AAC packets", packets.len());
    assert!(packets.len() >= total / 1024);
    for (i, p) in packets.iter().enumerate() {
        assert!(!p.data.is_empty());
        assert_ne!(&p.data[..2.min(p.data.len())], &[0xff, 0xf1][..], "no ADTS header expected");
        assert_eq!(p.timestamp_us, (i as i64 * 1024 * 1_000_000) / SR as i64);
    }

    let mut dec = AudioDecoder::new(AudioCodec::Aac, SR, CH as u32, Some(&asc)).expect("aac decoder");
    let mut out = Vec::new();
    for p in &packets {
        dec.decode(&p.data, p.timestamp_us).unwrap();
        out.extend(dec.take_audio());
    }
    dec.flush().unwrap();
    out.extend(dec.take_audio());
    let frames: usize = out.iter().map(|a| a.frames).sum();
    println!("decoded {frames} frames (input {total})");
    assert!((frames as i64 - total as i64).abs() <= 4096, "decoded {frames} frames");
    assert!(out.iter().all(|a| a.channels == 2 && a.sample_rate == SR));
    for w in out.windows(2) {
        assert!(w[1].timestamp_us > w[0].timestamp_us);
    }

    let samples: Vec<f32> = out.iter().flat_map(|a| a.samples.iter().copied()).collect();
    let mono = common::to_mono(&samples, CH);
    let mid = mono.len() / 2;
    let freq = common::dominant_frequency(&mono[mid - 4800..mid + 4800], SR as f64, 100, 2000);
    println!("dominant frequency {freq} Hz");
    assert!((freq - 440.0).abs() <= 5.0, "dominant {freq} Hz");
    let peak = mono[mid - 4800..mid + 4800].iter().fold(0f32, |m, s| m.max(s.abs()));
    assert!(peak > 0.3 && peak < 0.7, "unexpected amplitude {peak}");
}

#[test]
fn aac_mono_44k() {
    let mut enc = AudioEncoder::new(44100, 1, None).unwrap();
    assert_eq!(enc.description(), vec![0x12, 0x08]);
    let pcm: Vec<f32> = (0..44100).map(|i| (i as f32 * 0.05).sin() * 0.3).collect();
    enc.encode_f32_interleaved(&pcm, 0).unwrap();
    enc.flush().unwrap();
    let packets = enc.take_packets();
    assert!(packets.len() >= 43);
    let mut dec = AudioDecoder::new(AudioCodec::Aac, 44100, 1, Some(&enc.description())).unwrap();
    for p in &packets {
        dec.decode(&p.data, p.timestamp_us).unwrap();
    }
    dec.flush().unwrap();
    let frames: usize = dec.take_audio().iter().map(|a| a.frames).sum();
    assert!((frames as i64 - 44100).abs() <= 4096, "{frames}");
}

/// Minimal MP3 frame splitter (skips ID3v2, syncs on frame headers).
fn split_mp3(data: &[u8]) -> (Vec<&[u8]>, u32, u32) {
    let mut i = 0;
    if data.len() > 10 && &data[..3] == b"ID3" {
        let size = data[6..10].iter().fold(0usize, |a, &b| (a << 7) | (b & 0x7f) as usize);
        i = 10 + size + if data[5] & 0x10 != 0 { 10 } else { 0 };
    }
    let mut frames = Vec::new();
    let (mut rate, mut channels) = (0, 0);
    while i + 4 <= data.len() {
        let h = u32::from_be_bytes(data[i..i + 4].try_into().unwrap());
        if h >> 21 != 0x7ff {
            i += 1;
            continue;
        }
        let version = (h >> 19) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
        let layer = (h >> 17) & 3; // 1 = Layer III
        let br_idx = ((h >> 12) & 0xf) as usize;
        let sr_idx = ((h >> 10) & 3) as usize;
        let pad = ((h >> 9) & 1) as usize;
        let mode = (h >> 6) & 3;
        if version == 1 || layer != 1 || br_idx == 0 || br_idx == 15 || sr_idx == 3 {
            i += 1;
            continue;
        }
        const BR1: [usize; 15] = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
        const BR2: [usize; 15] = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
        let base_sr = [44100usize, 48000, 32000][sr_idx];
        let (sr, br, coef) = match version {
            3 => (base_sr, BR1[br_idx] * 1000, 144),
            2 => (base_sr / 2, BR2[br_idx] * 1000, 72),
            _ => (base_sr / 4, BR2[br_idx] * 1000, 72),
        };
        let len = coef * br / sr + pad;
        if i + len > data.len() {
            break;
        }
        rate = sr as u32;
        channels = if mode == 3 { 1 } else { 2 };
        frames.push(&data[i..i + len]);
        i += len;
    }
    (frames, rate, channels)
}

#[test]
fn mp3_decode() {
    let Some(ffmpeg) = common::find_tool("ffmpeg") else {
        println!("ffmpeg not found; skipping MP3 test");
        return;
    };
    let path = common::out_dir().join("sine.mp3");
    let status = Command::new(ffmpeg)
        .args(["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=1000:duration=1", "-ac", "2", "-ar", "44100"])
        .arg(&path)
        .status()
        .expect("run ffmpeg");
    if !status.success() {
        println!("ffmpeg could not produce MP3 (no encoder?); skipping");
        return;
    }
    let data = std::fs::read(&path).unwrap();
    let (frames, rate, channels) = split_mp3(&data);
    println!("{} MP3 frames, {rate} Hz, {channels} ch", frames.len());
    assert_eq!(rate, 44100);
    assert!(frames.len() >= 38);

    let mut dec = AudioDecoder::new(AudioCodec::Mp3, rate, channels, None).expect("mp3 decoder");
    for (k, f) in frames.iter().enumerate() {
        dec.decode(f, (k as i64 * 1152 * 1_000_000) / 44100).unwrap();
    }
    dec.flush().unwrap();
    let out = dec.take_audio();
    let total: usize = out.iter().map(|a| a.frames).sum();
    println!("decoded {total} frames");
    assert!((total as i64 - 44100).abs() <= 4096, "decoded {total} frames");

    let samples: Vec<f32> = out.iter().flat_map(|a| a.samples.iter().copied()).collect();
    let mono = common::to_mono(&samples, channels as usize);
    let mid = mono.len() / 2;
    let freq = common::dominant_frequency(&mono[mid - 4410..mid + 4410], 44100.0, 100, 5000);
    println!("dominant frequency {freq} Hz");
    assert!((freq - 1000.0).abs() <= 5.0, "dominant {freq} Hz");
}
