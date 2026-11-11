use crate::convert::{blend_mode, color};
use crate::handles::{cloned, cloned_opt, get, put};
use crate::R;
use skia_safe::{paint, Blender, Color4f, ColorFilter, ImageFilter, MaskFilter, Paint, PathEffect, Shader};

pub fn paint_opt(h: u32) -> R<Option<Paint>> {
    cloned_opt::<Paint>(h)
}

fn with<T>(h: u32, f: impl FnOnce(&mut Paint) -> T) -> R<T> {
    let p = get::<Paint>(h)?;
    let mut p = p.borrow_mut();
    Ok(f(&mut p))
}

pub fn paint_new() -> u32 {
    put(Paint::default())
}

pub fn paint_copy(h: u32) -> R<u32> {
    Ok(put(cloned::<Paint>(h)?))
}

pub fn paint_reset(h: u32) -> R<()> {
    with(h, |p| *p = Paint::default())
}

pub fn paint_set_color(h: u32, argb: u32) -> R<()> {
    with(h, |p| {
        p.set_color(color(argb));
    })
}

pub fn paint_set_color4f(h: u32, r: f32, g: f32, b: f32, a: f32, color_space_code: u32) -> R<()> {
    let cs = crate::convert::color_space(color_space_code);
    with(h, |p| {
        p.set_color4f(Color4f::new(r, g, b, a), cs.as_ref());
    })
}

/// `[r, g, b, a]`.
pub fn paint_get_color4f(h: u32) -> R<Vec<f32>> {
    with(h, |p| {
        let c = p.color4f();
        vec![c.r, c.g, c.b, c.a]
    })
}

pub fn paint_set_alphaf(h: u32, a: f32) -> R<()> {
    with(h, |p| {
        p.set_alpha_f(a);
    })
}

pub fn paint_get_alphaf(h: u32) -> R<f32> {
    with(h, |p| p.alpha_f())
}

pub fn paint_set_anti_alias(h: u32, aa: bool) -> R<()> {
    with(h, |p| {
        p.set_anti_alias(aa);
    })
}

pub fn paint_set_dither(h: u32, d: bool) -> R<()> {
    with(h, |p| {
        p.set_dither(d);
    })
}

/// 0 fill, 1 stroke, 2 stroke-and-fill.
pub fn paint_set_style(h: u32, style: u32) -> R<()> {
    with(h, |p| {
        p.set_style(match style {
            1 => paint::Style::Stroke,
            2 => paint::Style::StrokeAndFill,
            _ => paint::Style::Fill,
        });
    })
}

pub fn paint_set_stroke_width(h: u32, w: f32) -> R<()> {
    with(h, |p| {
        p.set_stroke_width(w);
    })
}

pub fn paint_get_stroke_width(h: u32) -> R<f32> {
    with(h, |p| p.stroke_width())
}

/// 0 butt, 1 round, 2 square.
pub fn paint_set_stroke_cap(h: u32, cap: u32) -> R<()> {
    with(h, |p| {
        p.set_stroke_cap(match cap {
            1 => paint::Cap::Round,
            2 => paint::Cap::Square,
            _ => paint::Cap::Butt,
        });
    })
}

/// 0 miter, 1 round, 2 bevel.
pub fn paint_set_stroke_join(h: u32, join: u32) -> R<()> {
    with(h, |p| {
        p.set_stroke_join(match join {
            1 => paint::Join::Round,
            2 => paint::Join::Bevel,
            _ => paint::Join::Miter,
        });
    })
}

pub fn paint_set_stroke_miter(h: u32, limit: f32) -> R<()> {
    with(h, |p| {
        p.set_stroke_miter(limit);
    })
}

pub fn paint_set_shader(h: u32, shader: u32) -> R<()> {
    let s = cloned_opt::<Shader>(shader)?;
    with(h, |p| {
        p.set_shader(s);
    })
}

pub fn paint_set_color_filter(h: u32, f: u32) -> R<()> {
    let f = cloned_opt::<ColorFilter>(f)?;
    with(h, |p| {
        p.set_color_filter(f);
    })
}

pub fn paint_set_image_filter(h: u32, f: u32) -> R<()> {
    let f = cloned_opt::<ImageFilter>(f)?;
    with(h, |p| {
        p.set_image_filter(f);
    })
}

pub fn paint_set_mask_filter(h: u32, f: u32) -> R<()> {
    let f = cloned_opt::<MaskFilter>(f)?;
    with(h, |p| {
        p.set_mask_filter(f);
    })
}

pub fn paint_set_path_effect(h: u32, e: u32) -> R<()> {
    let e = cloned_opt::<PathEffect>(e)?;
    with(h, |p| {
        p.set_path_effect(e);
    })
}

pub fn paint_set_blend_mode(h: u32, mode: u32) -> R<()> {
    with(h, |p| {
        p.set_blend_mode(blend_mode(mode));
    })
}

pub fn paint_set_blender(h: u32, b: u32) -> R<()> {
    let b = cloned_opt::<Blender>(b)?;
    with(h, |p| {
        p.set_blender(b);
    })
}

/// Returns the fill path for this paint applied to `path` (stroke → outline), as a new path handle.
pub fn paint_get_fill_path(h: u32, path: u32, res_scale: f32) -> R<u32> {
    let src = crate::api::path::path_of(path)?;
    let p = cloned::<Paint>(h)?;
    let mut b = skia_safe::PathBuilder::new();
    if !skia_safe::path_utils::fill_path_with_paint(
        &src,
        &p,
        &mut b,
        None,
        skia_safe::Matrix::scale((res_scale, res_scale)),
    ) {
        return Err("getFillPath failed".into());
    }
    Ok(put(crate::api::path::PathObj { builder: b }))
}
