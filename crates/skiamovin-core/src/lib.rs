#![allow(deprecated)]
// The API is flat on purpose (numbers in, numbers out), so some functions take many arguments.
#![allow(clippy::too_many_arguments)]
//! Skiamovin core: the API shared by the Node (napi) and WebAssembly (emscripten) builds.
//!
//! Public functions in `api/` take and return only plain values (numbers, bools, strings, slices, vectors
//! and `R<T>`). Objects live in a per-thread table and are referenced by `u32` handles.
//! `scripts/gen-bindings.mjs` reads `src/api/*.rs` and generates the Node and WebAssembly bindings.

pub mod api;
pub mod convert;
pub mod handles;

pub use skia_safe;

/// Result type used across the API. Errors become thrown JS errors.
pub type R<T> = Result<T, String>;

/// Callback that measures layout leaves in JavaScript.
/// Arguments are (node, known_w, known_h, avail_w, avail_h). Unknown sizes are NaN, and available
/// space is -1 for min-content and -2 for max-content. Returns (width, height).
pub type MeasureCallback<'a> = dyn FnMut(u32, f32, f32, f32, f32) -> (f32, f32) + 'a;
