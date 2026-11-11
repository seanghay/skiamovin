fn main() {
    // Expose the skia-safe version for diagnostics.
    let lock = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../Cargo.lock")).unwrap_or_default();
    let mut v = "unknown".to_string();
    let mut in_pkg = false;
    for line in lock.lines() {
        if line == "name = \"skia-safe\"" {
            in_pkg = true;
            continue;
        }
        if in_pkg && line.starts_with("version = ") {
            v = line[11..line.len() - 1].to_string();
            break;
        }
    }
    println!("cargo:rustc-env=SKIA_SAFE_VERSION={v}");
    println!("cargo:rerun-if-changed=../../Cargo.lock");
}
