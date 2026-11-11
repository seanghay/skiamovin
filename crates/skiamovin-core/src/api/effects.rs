//! Image filters, color filters, mask filters, path effects and blenders.

use crate::convert::{blend_mode, color, matrix, rect_opt, sampling, tile_mode};
use crate::handles::{cloned, cloned_opt, put};
use crate::R;
use skia_safe::image_filters::CropRect;
use skia_safe::{
    color_filters, image_filters, runtime_effect::RuntimeShaderBuilder, BlendMode, Blender, BlurStyle, ColorChannel,
    ColorFilter, ColorMatrix, ImageFilter, MaskFilter, PathEffect, RuntimeEffect, Shader,
};

fn input(h: u32) -> R<Option<ImageFilter>> {
    cloned_opt::<ImageFilter>(h)
}

fn crop(r: &[f32]) -> R<CropRect> {
    Ok(match rect_opt(r)? {
        Some(r) => CropRect::from(r),
        None => CropRect::NO_CROP_RECT,
    })
}

fn wrap(f: Option<ImageFilter>, what: &str) -> R<u32> {
    f.map(put).ok_or_else(|| format!("{what} failed"))
}

// ---- image filters ----

pub fn image_filter_blur(sx: f32, sy: f32, tile: u32, input_h: u32, crop_rect: &[f32]) -> R<u32> {
    wrap(image_filters::blur((sx, sy), tile_mode(tile), input(input_h)?, crop(crop_rect)?), "blur")
}

pub fn image_filter_drop_shadow(
    dx: f32,
    dy: f32,
    sx: f32,
    sy: f32,
    argb: u32,
    input_h: u32,
    crop_rect: &[f32],
) -> R<u32> {
    wrap(
        image_filters::drop_shadow((dx, dy), (sx, sy), color(argb), None, input(input_h)?, crop(crop_rect)?),
        "dropShadow",
    )
}

pub fn image_filter_drop_shadow_only(
    dx: f32,
    dy: f32,
    sx: f32,
    sy: f32,
    argb: u32,
    input_h: u32,
    crop_rect: &[f32],
) -> R<u32> {
    wrap(
        image_filters::drop_shadow_only((dx, dy), (sx, sy), color(argb), None, input(input_h)?, crop(crop_rect)?),
        "dropShadowOnly",
    )
}

pub fn image_filter_color_filter(cf: u32, input_h: u32, crop_rect: &[f32]) -> R<u32> {
    let f = cloned::<ColorFilter>(cf)?;
    wrap(image_filters::color_filter(f, input(input_h)?, crop(crop_rect)?), "colorFilter")
}

pub fn image_filter_compose(outer: u32, inner: u32) -> R<u32> {
    wrap(image_filters::compose(cloned::<ImageFilter>(outer)?, cloned::<ImageFilter>(inner)?), "compose")
}

/// `filters` may contain 0 for "the source".
pub fn image_filter_merge(filters: &[u32], crop_rect: &[f32]) -> R<u32> {
    let fs: Vec<Option<ImageFilter>> = filters.iter().map(|h| cloned_opt::<ImageFilter>(*h)).collect::<R<_>>()?;
    wrap(image_filters::merge(fs, crop(crop_rect)?), "merge")
}

pub fn image_filter_offset(dx: f32, dy: f32, input_h: u32, crop_rect: &[f32]) -> R<u32> {
    wrap(image_filters::offset((dx, dy), input(input_h)?, crop(crop_rect)?), "offset")
}

pub fn image_filter_matrix_transform(m: &[f32], sampling_code: u32, input_h: u32) -> R<u32> {
    let m = matrix(m)?;
    wrap(image_filters::matrix_transform(&m, sampling(sampling_code), input(input_h)?), "matrixTransform")
}

/// Channel codes 0 R, 1 G, 2 B, 3 A.
pub fn image_filter_displacement_map(
    x_channel: u32,
    y_channel: u32,
    scale: f32,
    displacement: u32,
    color_h: u32,
    crop_rect: &[f32],
) -> R<u32> {
    let ch = |c: u32| match c {
        0 => ColorChannel::R,
        1 => ColorChannel::G,
        2 => ColorChannel::B,
        _ => ColorChannel::A,
    };
    wrap(
        image_filters::displacement_map(
            (ch(x_channel), ch(y_channel)),
            scale,
            cloned_opt::<ImageFilter>(displacement)?,
            input(color_h)?,
            crop(crop_rect)?,
        ),
        "displacementMap",
    )
}

pub fn image_filter_dilate(rx: f32, ry: f32, input_h: u32, crop_rect: &[f32]) -> R<u32> {
    wrap(image_filters::dilate((rx, ry), input(input_h)?, crop(crop_rect)?), "dilate")
}

pub fn image_filter_erode(rx: f32, ry: f32, input_h: u32, crop_rect: &[f32]) -> R<u32> {
    wrap(image_filters::erode((rx, ry), input(input_h)?, crop(crop_rect)?), "erode")
}

pub fn image_filter_shader(shader: u32, dither: bool, crop_rect: &[f32]) -> R<u32> {
    let s = cloned::<Shader>(shader)?;
    let d = if dither { skia_safe::image_filters::Dither::Yes } else { skia_safe::image_filters::Dither::No };
    wrap(image_filters::shader_with_dither(s, d, crop(crop_rect)?), "shader")
}

pub fn image_filter_image(image: u32, sampling_code: u32) -> R<u32> {
    let img = cloned::<skia_safe::Image>(image)?;
    let b = img.bounds();
    let r = skia_safe::Rect::from_irect(b);
    wrap(image_filters::image(img, Some(&r), Some(&r), sampling(sampling_code)), "image")
}

pub fn image_filter_blend(mode: u32, background: u32, foreground: u32, crop_rect: &[f32]) -> R<u32> {
    wrap(
        image_filters::blend(
            blend_mode(mode),
            cloned_opt::<ImageFilter>(background)?,
            cloned_opt::<ImageFilter>(foreground)?,
            crop(crop_rect)?,
        ),
        "blend",
    )
}

/// An image filter that runs a runtime shader with `child_name` bound to the filter input.
pub fn image_filter_runtime_shader(effect: u32, uniforms: &[u8], child_name: &str, input_h: u32) -> R<u32> {
    let e = cloned::<RuntimeEffect>(effect)?;
    let mut b = RuntimeShaderBuilder::new(e.clone());
    for u in e.uniforms() {
        let off = u.offset();
        let size = u.size_in_bytes();
        if off + size > uniforms.len() {
            return Err(format!("uniform data too short for '{}'", u.name()));
        }
        let bytes = &uniforms[off..off + size];
        let ty = format!("{:?}", u.ty());
        if ty.starts_with("Int") {
            let v: Vec<i32> = bytes.chunks_exact(4).map(|c| i32::from_le_bytes(c.try_into().unwrap())).collect();
            b.set_uniform_int(u.name(), &v).map_err(|e| format!("{e:?}"))?;
        } else {
            let v: Vec<f32> = bytes.chunks_exact(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect();
            b.set_uniform_float(u.name(), &v).map_err(|e| format!("{e:?}"))?;
        }
    }
    wrap(image_filters::runtime_shader(&b, child_name, input(input_h)?), "runtimeShader")
}

// ---- color filters ----

pub fn color_filter_blend(argb: u32, mode: u32) -> R<u32> {
    color_filters::blend(color(argb), blend_mode(mode)).map(put).ok_or_else(|| "color filter blend failed".into())
}

/// 20 numbers, row-major 4x5 (RGBA rows; the last column is a bias from 0 to 1).
pub fn color_filter_matrix(m: &[f32]) -> R<u32> {
    if m.len() != 20 {
        return Err("color matrix needs 20 numbers".into());
    }
    let cm = ColorMatrix::new(
        m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], m[12], m[13], m[14], m[15], m[16],
        m[17], m[18], m[19],
    );
    Ok(put(color_filters::matrix(&cm, None)))
}

pub fn color_filter_lighting(mul: u32, add: u32) -> R<u32> {
    color_filters::lighting(color(mul), color(add)).map(put).ok_or_else(|| "lighting failed".into())
}

/// 1024 bytes: A, R, G, B tables of 256 entries each.
pub fn color_filter_table(tables: &[u8]) -> R<u32> {
    if tables.len() != 1024 {
        return Err("table filter needs 4x256 bytes (A, R, G, B)".into());
    }
    let t = |i: usize| -> &[u8; 256] { tables[i * 256..(i + 1) * 256].try_into().unwrap() };
    color_filters::table_argb(Some(t(0)), Some(t(1)), Some(t(2)), Some(t(3)))
        .map(put)
        .ok_or_else(|| "table filter failed".into())
}

pub fn color_filter_compose(outer: u32, inner: u32) -> R<u32> {
    color_filters::compose(cloned::<ColorFilter>(outer)?, cloned::<ColorFilter>(inner)?)
        .map(put)
        .ok_or_else(|| "compose failed".into())
}

pub fn color_filter_srgb_to_linear() -> u32 {
    put(color_filters::srgb_to_linear_gamma())
}

pub fn color_filter_linear_to_srgb() -> u32 {
    put(color_filters::linear_to_srgb_gamma())
}

pub fn color_filter_luma() -> u32 {
    put(skia_safe::luma_color_filter::new())
}

// ---- mask filters ----

/// style: 0 normal, 1 solid, 2 outer, 3 inner.
pub fn mask_filter_blur(style: u32, sigma: f32, respect_ctm: bool) -> R<u32> {
    let s = match style {
        1 => BlurStyle::Solid,
        2 => BlurStyle::Outer,
        3 => BlurStyle::Inner,
        _ => BlurStyle::Normal,
    };
    MaskFilter::blur(s, sigma, respect_ctm).map(put).ok_or_else(|| "mask blur failed".into())
}

pub fn mask_filter_shader(shader: u32) -> R<u32> {
    Ok(put(skia_safe::shader_mask_filter::new(cloned::<Shader>(shader)?)))
}

// ---- path effects ----

pub fn path_effect_dash(intervals: &[f32], phase: f32) -> R<u32> {
    PathEffect::dash(intervals, phase).map(put).ok_or_else(|| "dash failed (need an even number of intervals)".into())
}

pub fn path_effect_corner(radius: f32) -> R<u32> {
    PathEffect::corner_path(radius).map(put).ok_or_else(|| "corner failed".into())
}

pub fn path_effect_discrete(seg_length: f32, deviation: f32, seed: u32) -> R<u32> {
    PathEffect::discrete(seg_length, deviation, seed).map(put).ok_or_else(|| "discrete failed".into())
}

/// Keeps the part of each contour between `start` and `stop` (0 to 1). `inverted` keeps the rest.
pub fn path_effect_trim(start: f32, stop: f32, inverted: bool) -> R<u32> {
    let mode =
        if inverted { skia_safe::trim_path_effect::Mode::Inverted } else { skia_safe::trim_path_effect::Mode::Normal };
    PathEffect::trim(start, stop, mode).map(put).ok_or_else(|| "trim failed".into())
}

pub fn path_effect_compose(outer: u32, inner: u32) -> R<u32> {
    Ok(put(PathEffect::compose(cloned::<PathEffect>(outer)?, cloned::<PathEffect>(inner)?)))
}

pub fn path_effect_sum(first: u32, second: u32) -> R<u32> {
    Ok(put(PathEffect::sum(cloned::<PathEffect>(first)?, cloned::<PathEffect>(second)?)))
}

/// Stamps `path` along the target. style: 0 translate, 1 rotate, 2 morph.
pub fn path_effect_path_1d(path: u32, advance: f32, phase: f32, style: u32) -> R<u32> {
    use skia_safe::path_1d_path_effect::Style;
    let p = crate::api::path::path_of(path)?;
    let s = match style {
        1 => Style::Rotate,
        2 => Style::Morph,
        _ => Style::Translate,
    };
    PathEffect::path_1d(&p, advance, phase, s).map(put).ok_or_else(|| "path1d failed".into())
}

// ---- blenders ----

pub fn blender_mode(mode: u32) -> u32 {
    put(Blender::mode(blend_mode(mode)))
}

pub fn blender_arithmetic(k1: f32, k2: f32, k3: f32, k4: f32, enforce_premul: bool) -> R<u32> {
    skia_safe::blenders::arithmetic(k1, k2, k3, k4, enforce_premul).map(put).ok_or_else(|| "arithmetic failed".into())
}

#[allow(dead_code)]
fn _unused(_: BlendMode) {}
