//! The exported API. Every `pub fn` here (except in `manual`) is exported to JavaScript by the generator.
//! Parameters may only be `u32 i32 f32 f64 bool &str &[u8] &[f32] &[u32]`. Return values may be those
//! types (owned as `String Vec<u8> Vec<f32> Vec<u32>`), `()`, or `R<...>` of them.

pub mod canvas;
pub mod effects;
pub mod font;
pub mod gpu;
pub mod image;
pub mod manual;
pub mod math;
pub mod misc;
pub mod paint;
pub mod path;
pub mod path_motion;
pub mod physics;
pub mod picture;
pub mod shader;
pub mod surface;
pub mod svg;
pub mod taffy;
pub mod textlayout;
