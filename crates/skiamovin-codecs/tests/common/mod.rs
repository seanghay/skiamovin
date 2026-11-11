#![allow(dead_code)]

use std::path::PathBuf;

/// `<workspace>/target/codec-test`, created on demand.
pub fn out_dir() -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/codec-test");
    std::fs::create_dir_all(&dir).unwrap();
    dir.canonicalize().unwrap()
}

/// Locate a tool (PATH or /opt/homebrew/bin).
pub fn find_tool(name: &str) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> =
        std::env::var_os("PATH").map(|p| std::env::split_paths(&p).map(|d| d.join(name)).collect()).unwrap_or_default();
    candidates.push(PathBuf::from("/opt/homebrew/bin").join(name));
    candidates.push(PathBuf::from("/usr/local/bin").join(name));
    candidates.into_iter().find(|p| p.is_file())
}

/// The strongest frequency in Hz between `lo` and `hi`, in 1 Hz steps.
pub fn dominant_frequency(mono: &[f32], sample_rate: f64, lo: u32, hi: u32) -> f64 {
    let n = mono.len();
    let windowed: Vec<f64> = mono
        .iter()
        .enumerate()
        .map(|(i, &s)| {
            let w = 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / (n - 1) as f64).cos();
            s as f64 * w
        })
        .collect();
    let mut best = (0.0f64, 0.0f64);
    for f in lo..=hi {
        let w = 2.0 * std::f64::consts::PI * f as f64 / sample_rate;
        let coeff = 2.0 * w.cos();
        let (mut s1, mut s2) = (0.0f64, 0.0f64);
        for &x in &windowed {
            let s0 = x + coeff * s1 - s2;
            s2 = s1;
            s1 = s0;
        }
        let power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
        if power > best.1 {
            best = (f as f64, power);
        }
    }
    best.0
}

/// Mix interleaved samples down to mono.
pub fn to_mono(interleaved: &[f32], channels: usize) -> Vec<f32> {
    interleaved.chunks_exact(channels).map(|c| c.iter().sum::<f32>() / channels as f32).collect()
}
