//! Hand-written bindings that need host callbacks or Node-only features.

use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Taffy layout with a JavaScript measure function `(node, knownW, knownH, availW, availH) => [w, h]`.
#[napi(js_name = "taffy_compute_layout_with_measure")]
#[allow(clippy::type_complexity)]
pub fn taffy_compute_layout_with_measure(
    tree: u32,
    node: u32,
    avail_w: f64,
    avail_h: f64,
    measure: Function<FnArgs<(u32, f64, f64, f64, f64)>, Float64Array>,
) -> Result<()> {
    let mut failure: Option<napi::Error> = None;
    let mut cb = |id: u32, kw: f32, kh: f32, aw: f32, ah: f32| -> (f32, f32) {
        if failure.is_some() {
            return (0.0, 0.0);
        }
        match measure.call((id, kw as f64, kh as f64, aw as f64, ah as f64).into()) {
            Ok(r) if r.len() >= 2 => (r[0] as f32, r[1] as f32),
            Ok(_) => (0.0, 0.0),
            Err(e) => {
                failure = Some(e);
                (0.0, 0.0)
            }
        }
    };
    skiamovin_core::api::manual::taffy_compute_layout_with_measure(tree, node, avail_w as f32, avail_h as f32, &mut cb)
        .map_err(|e| napi::Error::new(napi::Status::GenericFailure, e))?;
    if let Some(e) = failure {
        return Err(e);
    }
    Ok(())
}

#[napi(js_name = "platform_info")]
pub fn platform_info() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}
