//! Conversions from plain numbers and flat float arrays to Skia types.

use crate::R;
use skia_safe::{
    AlphaType, BlendMode, Color, Color4f, ColorSpace, ColorType, CubicResampler, FilterMode, Matrix, MipmapMode, Point,
    RRect, Rect, SamplingOptions, TileMode, Vector, M44,
};

pub fn rect(l: f32, t: f32, r: f32, b: f32) -> Rect {
    Rect::new(l, t, r, b)
}

/// `[l, t, r, b]`, or `None` when empty (used for optional rect parameters).
pub fn rect_opt(v: &[f32]) -> R<Option<Rect>> {
    match v.len() {
        0 => Ok(None),
        4 => Ok(Some(Rect::new(v[0], v[1], v[2], v[3]))),
        n => Err(format!("expected 4 numbers for a rect, got {n}")),
    }
}

/// `[l, t, r, b, x0, y0, x1, y1, x2, y2, x3, y3]` (rect + radii for TL, TR, BR, BL).
pub fn rrect(v: &[f32]) -> R<RRect> {
    if v.len() != 12 {
        return Err(format!("expected 12 numbers for an rrect, got {}", v.len()));
    }
    let r = Rect::new(v[0], v[1], v[2], v[3]);
    let radii = [Vector::new(v[4], v[5]), Vector::new(v[6], v[7]), Vector::new(v[8], v[9]), Vector::new(v[10], v[11])];
    Ok(RRect::new_rect_radii(r, &radii))
}

/// Row-major 3x3 matrix. Empty slice = identity / none.
pub fn matrix_opt(v: &[f32]) -> R<Option<Matrix>> {
    match v.len() {
        0 => Ok(None),
        9 => Ok(Some(Matrix::new_all(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8]))),
        16 => Ok(Some(m44(v)?.to_m33())),
        n => Err(format!("expected 9 numbers for a matrix, got {n}")),
    }
}

pub fn matrix(v: &[f32]) -> R<Matrix> {
    Ok(matrix_opt(v)?.unwrap_or_default())
}

pub fn matrix_to_vec(m: &Matrix) -> Vec<f32> {
    let mut out = [0.0f32; 9];
    m.get_9(&mut out);
    out.to_vec()
}

/// Row-major 4x4.
pub fn m44(v: &[f32]) -> R<M44> {
    if v.len() != 16 {
        return Err(format!("expected 16 numbers for an M44, got {}", v.len()));
    }
    Ok(M44::row_major(v.try_into().unwrap()))
}

pub fn m44_to_vec(m: &M44) -> Vec<f32> {
    // skia-safe's M44 stores column-major; return row-major.
    let mut out = vec![0.0f32; 16];
    for r in 0..4 {
        for c in 0..4 {
            out[r * 4 + c] = m.rc(r, c);
        }
    }
    out
}

pub fn points(v: &[f32]) -> Vec<Point> {
    v.as_chunks::<2>().0.iter().map(|c| Point::new(c[0], c[1])).collect()
}

pub fn color4f(v: &[f32]) -> R<Color4f> {
    if v.len() != 4 {
        return Err(format!("expected 4 numbers for a color, got {}", v.len()));
    }
    Ok(Color4f::new(v[0], v[1], v[2], v[3]))
}

/// Flat `[r, g, b, a, r, g, b, a, ...]`.
pub fn colors4f(v: &[f32]) -> Vec<Color4f> {
    v.as_chunks::<4>().0.iter().map(|c| Color4f::new(c[0], c[1], c[2], c[3])).collect()
}

pub fn color(c: u32) -> Color {
    Color::new(c)
}

pub fn tile_mode(v: u32) -> TileMode {
    match v {
        1 => TileMode::Repeat,
        2 => TileMode::Mirror,
        3 => TileMode::Decal,
        _ => TileMode::Clamp,
    }
}

/// Sampling codes: 0 nearest, 1 linear, 2 linear + linear mipmaps, 3 cubic Mitchell, 4 cubic Catmull-Rom,
/// 5 nearest + nearest mipmaps, 6 linear + nearest mipmaps.
pub fn sampling(code: u32) -> SamplingOptions {
    match code {
        0 => SamplingOptions::new(FilterMode::Nearest, MipmapMode::None),
        2 => SamplingOptions::new(FilterMode::Linear, MipmapMode::Linear),
        3 => SamplingOptions::from(CubicResampler::mitchell()),
        4 => SamplingOptions::from(CubicResampler::catmull_rom()),
        5 => SamplingOptions::new(FilterMode::Nearest, MipmapMode::Nearest),
        6 => SamplingOptions::new(FilterMode::Linear, MipmapMode::Nearest),
        _ => SamplingOptions::new(FilterMode::Linear, MipmapMode::None),
    }
}

const BLEND_MODES: [BlendMode; 29] = [
    BlendMode::Clear,
    BlendMode::Src,
    BlendMode::Dst,
    BlendMode::SrcOver,
    BlendMode::DstOver,
    BlendMode::SrcIn,
    BlendMode::DstIn,
    BlendMode::SrcOut,
    BlendMode::DstOut,
    BlendMode::SrcATop,
    BlendMode::DstATop,
    BlendMode::Xor,
    BlendMode::Plus,
    BlendMode::Modulate,
    BlendMode::Screen,
    BlendMode::Overlay,
    BlendMode::Darken,
    BlendMode::Lighten,
    BlendMode::ColorDodge,
    BlendMode::ColorBurn,
    BlendMode::HardLight,
    BlendMode::SoftLight,
    BlendMode::Difference,
    BlendMode::Exclusion,
    BlendMode::Multiply,
    BlendMode::Hue,
    BlendMode::Saturation,
    BlendMode::Color,
    BlendMode::Luminosity,
];

pub fn blend_mode(v: u32) -> BlendMode {
    BLEND_MODES.get(v as usize).copied().unwrap_or(BlendMode::SrcOver)
}

/// Color type codes: 0 RGBA8888, 1 BGRA8888, 2 N32, 3 RGBA_F16, 4 RGBA1010102, 5 Alpha8, 6 Gray8, 7 RGB565, 8 RGBA_F32.
pub fn color_type(v: u32) -> ColorType {
    match v {
        0 => ColorType::RGBA8888,
        1 => ColorType::BGRA8888,
        3 => ColorType::RGBAF16,
        4 => ColorType::RGBA1010102,
        5 => ColorType::Alpha8,
        6 => ColorType::Gray8,
        7 => ColorType::RGB565,
        8 => ColorType::RGBAF32,
        _ => ColorType::N32,
    }
}

/// Alpha type codes: 0 Unknown, 1 Opaque, 2 Premul, 3 Unpremul.
pub fn alpha_type(v: u32) -> AlphaType {
    match v {
        1 => AlphaType::Opaque,
        3 => AlphaType::Unpremul,
        0 => AlphaType::Unknown,
        _ => AlphaType::Premul,
    }
}

/// Color space codes: 0 none (legacy), 1 sRGB, 2 linear sRGB, 3 Display P3, 4 Rec.2020, 5 Rec.2020 linear,
/// 6 Rec.2020 PQ, 7 Rec.2020 HLG.
pub fn color_space(v: u32) -> Option<ColorSpace> {
    use skia_safe::{named_primaries::CicpId as P, named_transfer_fn::CicpId as T};
    match v {
        0 => None,
        2 => Some(ColorSpace::new_srgb_linear()),
        3 => ColorSpace::new_cicp(P::SMPTE_EG_432_1, T::IEC61966_2_1),
        4 => ColorSpace::new_cicp(P::Rec2020, T::Rec2020_10bit),
        5 => ColorSpace::new_cicp(P::Rec2020, T::Linear),
        6 => ColorSpace::new_cicp(P::Rec2020, T::PQ),
        7 => ColorSpace::new_cicp(P::Rec2020, T::HLG),
        _ => Some(ColorSpace::new_srgb()),
    }
}

pub fn bytes_per_pixel(ct: ColorType) -> usize {
    ct.bytes_per_pixel()
}
