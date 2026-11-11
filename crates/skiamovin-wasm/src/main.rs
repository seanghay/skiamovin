//! WebAssembly build of Skiamovin (emscripten). `generated.rs` is produced by scripts/gen-bindings.mjs.
#![allow(clippy::missing_safety_doc)]

mod generated;
mod rt;

use skiamovin_core::api;

extern "C" {
    /// Provided by library.js: calls back into JavaScript to measure a Taffy leaf.
    fn skm_js_measure(cb: u32, node: u32, kw: f32, kh: f32, aw: f32, ah: f32, out: *mut f32);
}

#[no_mangle]
pub extern "C" fn skm_taffy_compute_layout_with_measure(tree: u32, node: u32, aw: f32, ah: f32, cb: u32) {
    let mut out = [0f32; 2];
    let mut f = |id: u32, kw: f32, kh: f32, aw: f32, ah: f32| -> (f32, f32) {
        unsafe { skm_js_measure(cb, id, kw, kh, aw, ah, out.as_mut_ptr()) };
        (out[0], out[1])
    };
    if let Err(e) = api::manual::taffy_compute_layout_with_measure(tree, node, aw, ah, &mut f) {
        rt::set_error(e);
    }
}

fn main() {}
