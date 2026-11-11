use crate::api::paint::paint_opt;
use crate::api::path::path_of;
use crate::api::picture::RecorderObj;
use crate::api::surface::SurfaceObj;
use crate::convert::{
    self, blend_mode, color, color4f, m44, matrix, matrix_opt, points, rect, rect_opt, rrect, sampling,
};
use crate::handles::{cloned, cloned_opt, get};
use crate::R;
use skia_safe::{
    canvas::{PointMode, SaveLayerRec, SrcRectConstraint},
    Canvas, ClipOp, Font, GlyphId, IRect, Image, Paint, Picture, Point, Shader, TextBlob,
};

/// What a canvas handle points at. Canvases are always owned by something else.
pub enum CanvasRef {
    Surface(u32),
    Recorder(u32),
    PdfPage(u32),
}

/// Runs `f` with the canvas behind handle `h`.
pub fn with_canvas<T>(h: u32, f: impl FnOnce(&Canvas) -> T) -> R<T> {
    let target = {
        let c = get::<CanvasRef>(h)?;
        let c = c.borrow();
        match &*c {
            CanvasRef::Surface(s) => (0, *s),
            CanvasRef::Recorder(r) => (1, *r),
            CanvasRef::PdfPage(d) => (2, *d),
        }
    };
    match target {
        (0, s) => {
            let s = get::<SurfaceObj>(s)?;
            let mut s = s.borrow_mut();
            Ok(f(s.surface.canvas()))
        }
        (1, r) => {
            let r = get::<RecorderObj>(r)?;
            let mut r = r.borrow_mut();
            let c = r.recorder.recording_canvas().ok_or("picture recorder is not recording")?;
            Ok(f(c))
        }
        _ => crate::api::misc::with_pdf_canvas(target.1, f),
    }
}

fn clip_op(v: u32) -> ClipOp {
    if v == 0 {
        ClipOp::Difference
    } else {
        ClipOp::Intersect
    }
}

// ---- state ----

pub fn canvas_save(c: u32) -> R<i32> {
    with_canvas(c, |cv| cv.save() as i32)
}

/// `bounds` = [] or [l,t,r,b]; `paint` 0 = none; `backdrop` image filter 0 = none.
pub fn canvas_save_layer(c: u32, bounds: &[f32], paint: u32, backdrop: u32) -> R<i32> {
    let b = rect_opt(bounds)?;
    let p = paint_opt(paint)?;
    let bd = cloned_opt::<skia_safe::ImageFilter>(backdrop)?;
    with_canvas(c, |cv| {
        let mut rec = SaveLayerRec::default();
        if let Some(b) = &b {
            rec = rec.bounds(b);
        }
        if let Some(p) = &p {
            rec = rec.paint(p);
        }
        if let Some(bd) = &bd {
            rec = rec.backdrop(bd);
        }
        cv.save_layer(&rec) as i32
    })
}

pub fn canvas_save_layer_alpha(c: u32, bounds: &[f32], alpha: u32) -> R<i32> {
    let b = rect_opt(bounds)?;
    with_canvas(c, |cv| cv.save_layer_alpha(b, alpha.min(255)) as i32)
}

pub fn canvas_restore(c: u32) -> R<()> {
    with_canvas(c, |cv| {
        cv.restore();
    })
}

pub fn canvas_restore_to_count(c: u32, count: i32) -> R<()> {
    with_canvas(c, |cv| {
        cv.restore_to_count(count as usize);
    })
}

pub fn canvas_save_count(c: u32) -> R<i32> {
    with_canvas(c, |cv| cv.save_count() as i32)
}

// ---- transforms ----

pub fn canvas_translate(c: u32, dx: f32, dy: f32) -> R<()> {
    with_canvas(c, |cv| {
        cv.translate((dx, dy));
    })
}

pub fn canvas_scale(c: u32, sx: f32, sy: f32) -> R<()> {
    with_canvas(c, |cv| {
        cv.scale((sx, sy));
    })
}

pub fn canvas_rotate(c: u32, degrees: f32, px: f32, py: f32) -> R<()> {
    with_canvas(c, |cv| {
        cv.rotate(degrees, Some(Point::new(px, py)));
    })
}

pub fn canvas_skew(c: u32, kx: f32, ky: f32) -> R<()> {
    with_canvas(c, |cv| {
        cv.skew((kx, ky));
    })
}

pub fn canvas_concat(c: u32, m: &[f32]) -> R<()> {
    let m = matrix(m)?;
    with_canvas(c, |cv| {
        cv.concat(&m);
    })
}

pub fn canvas_concat44(c: u32, m: &[f32]) -> R<()> {
    let m = m44(m)?;
    with_canvas(c, |cv| {
        cv.concat_44(&m);
    })
}

pub fn canvas_set_matrix(c: u32, m: &[f32]) -> R<()> {
    let m = m44(m)?;
    with_canvas(c, |cv| {
        cv.set_matrix(&m);
    })
}

pub fn canvas_reset_matrix(c: u32) -> R<()> {
    with_canvas(c, |cv| {
        cv.reset_matrix();
    })
}

/// Row-major 4x4.
pub fn canvas_local_to_device(c: u32) -> R<Vec<f32>> {
    with_canvas(c, |cv| convert::m44_to_vec(&cv.local_to_device()))
}

/// `[l, t, r, b]` of the device clip bounds.
pub fn canvas_device_clip_bounds(c: u32) -> R<Vec<f32>> {
    with_canvas(c, |cv| {
        let b = cv.device_clip_bounds().unwrap_or(IRect::new_empty());
        vec![b.left as f32, b.top as f32, b.right as f32, b.bottom as f32]
    })
}

/// `[width, height]` of the base layer.
pub fn canvas_size(c: u32) -> R<Vec<f32>> {
    with_canvas(c, |cv| {
        let s = cv.base_layer_size();
        vec![s.width as f32, s.height as f32]
    })
}

// ---- clips ----

pub fn canvas_clip_rect(c: u32, l: f32, t: f32, r: f32, b: f32, op: u32, aa: bool) -> R<()> {
    with_canvas(c, |cv| {
        cv.clip_rect(rect(l, t, r, b), clip_op(op), aa);
    })
}

pub fn canvas_clip_rrect(c: u32, rr: &[f32], op: u32, aa: bool) -> R<()> {
    let rr = rrect(rr)?;
    with_canvas(c, |cv| {
        cv.clip_rrect(rr, clip_op(op), aa);
    })
}

pub fn canvas_clip_path(c: u32, path: u32, op: u32, aa: bool) -> R<()> {
    let p = path_of(path)?;
    with_canvas(c, |cv| {
        cv.clip_path(&p, clip_op(op), aa);
    })
}

pub fn canvas_clip_shader(c: u32, shader: u32, op: u32) -> R<()> {
    let s = cloned::<Shader>(shader)?;
    with_canvas(c, |cv| {
        cv.clip_shader(s, clip_op(op));
    })
}

// ---- drawing ----

pub fn canvas_clear(c: u32, rgba: &[f32]) -> R<()> {
    let col = color4f(rgba)?;
    with_canvas(c, |cv| {
        cv.clear(col);
    })
}

pub fn canvas_draw_color(c: u32, rgba: &[f32], mode: u32) -> R<()> {
    let col = color4f(rgba)?;
    with_canvas(c, |cv| {
        cv.draw_color(col, blend_mode(mode));
    })
}

pub fn canvas_draw_paint(c: u32, paint: u32) -> R<()> {
    let p = cloned::<Paint>(paint)?;
    with_canvas(c, |cv| {
        cv.draw_paint(&p);
    })
}

pub fn canvas_draw_rect(c: u32, l: f32, t: f32, r: f32, b: f32, paint: u32) -> R<()> {
    let p = cloned::<Paint>(paint)?;
    with_canvas(c, |cv| {
        cv.draw_rect(rect(l, t, r, b), &p);
    })
}

pub fn canvas_draw_rrect(c: u32, rr: &[f32], paint: u32) -> R<()> {
    let rr = rrect(rr)?;
    let p = cloned::<Paint>(paint)?;
    with_canvas(c, |cv| {
        cv.draw_rrect(rr, &p);
    })
}

pub fn canvas_draw_drrect(c: u32, outer: &[f32], inner: &[f32], paint: u32) -> R<()> {
    let o = rrect(outer)?;
    let i = rrect(inner)?;
    let p = cloned::<Paint>(paint)?;
    with_canvas(c, |cv| {
        cv.draw_drrect(o, i, &p);
    })
}

pub fn canvas_draw_circle(c: u32, cx: f32, cy: f32, radius: f32, paint: u32) -> R<()> {
    let p = cloned::<Paint>(paint)?;
    with_canvas(c, |cv| {
        cv.draw_circle((cx, cy), radius, &p);
    })
}

pub fn canvas_draw_oval(c: u32, l: f32, t: f32, r: f32, b: f32, paint: u32) -> R<()> {
    let p = cloned::<Paint>(paint)?;
    with_canvas(c, |cv| {
        cv.draw_oval(rect(l, t, r, b), &p);
    })
}

pub fn canvas_draw_arc(
    c: u32,
    l: f32,
    t: f32,
    r: f32,
    b: f32,
    start: f32,
    sweep: f32,
    use_center: bool,
    paint: u32,
) -> R<()> {
    let p = cloned::<Paint>(paint)?;
    with_canvas(c, |cv| {
        cv.draw_arc(rect(l, t, r, b), start, sweep, use_center, &p);
    })
}

pub fn canvas_draw_line(c: u32, x0: f32, y0: f32, x1: f32, y1: f32, paint: u32) -> R<()> {
    let p = cloned::<Paint>(paint)?;
    with_canvas(c, |cv| {
        cv.draw_line((x0, y0), (x1, y1), &p);
    })
}

/// mode: 0 points, 1 lines, 2 polygon. `pts` = [x0, y0, x1, y1, ...].
pub fn canvas_draw_points(c: u32, mode: u32, pts: &[f32], paint: u32) -> R<()> {
    let p = cloned::<Paint>(paint)?;
    let pts = points(pts);
    let m = match mode {
        1 => PointMode::Lines,
        2 => PointMode::Polygon,
        _ => PointMode::Points,
    };
    with_canvas(c, |cv| {
        cv.draw_points(m, &pts, &p);
    })
}

pub fn canvas_draw_path(c: u32, path: u32, paint: u32) -> R<()> {
    let path = path_of(path)?;
    let p = cloned::<Paint>(paint)?;
    with_canvas(c, |cv| {
        cv.draw_path(&path, &p);
    })
}

pub fn canvas_draw_image(c: u32, image: u32, x: f32, y: f32, sampling_code: u32, paint: u32) -> R<()> {
    let img = cloned::<Image>(image)?;
    let p = paint_opt(paint)?;
    with_canvas(c, |cv| {
        cv.draw_image_with_sampling_options(&img, (x, y), sampling(sampling_code), p.as_ref());
    })
}

/// `src` = [] for the whole image. `strict`: use strict src-rect constraint.
pub fn canvas_draw_image_rect(
    c: u32,
    image: u32,
    src: &[f32],
    dst: &[f32],
    sampling_code: u32,
    paint: u32,
    strict: bool,
) -> R<()> {
    let img = cloned::<Image>(image)?;
    let src = rect_opt(src)?;
    let dst = rect_opt(dst)?.ok_or("dst rect required")?;
    let p = paint_opt(paint)?.unwrap_or_default();
    let constraint = if strict { SrcRectConstraint::Strict } else { SrcRectConstraint::Fast };
    with_canvas(c, |cv| {
        let src = src.as_ref().map(|r| (r, constraint));
        cv.draw_image_rect_with_sampling_options(&img, src, dst, sampling(sampling_code), &p);
    })
}

pub fn canvas_draw_image_nine(
    c: u32,
    image: u32,
    center: &[f32],
    dst: &[f32],
    filter_linear: bool,
    paint: u32,
) -> R<()> {
    let img = cloned::<Image>(image)?;
    let ce = rect_opt(center)?.ok_or("center rect required")?.round();
    let dst = rect_opt(dst)?.ok_or("dst rect required")?;
    let p = paint_opt(paint)?;
    let fm = if filter_linear { skia_safe::FilterMode::Linear } else { skia_safe::FilterMode::Nearest };
    with_canvas(c, |cv| {
        cv.draw_image_nine(&img, ce, dst, fm, p.as_ref());
    })
}

pub fn canvas_draw_str(c: u32, text: &str, x: f32, y: f32, font: u32, paint: u32) -> R<()> {
    let f = cloned::<Font>(font)?;
    let p = cloned::<Paint>(paint)?;
    with_canvas(c, |cv| {
        cv.draw_str(text, (x, y), &f, &p);
    })
}

pub fn canvas_draw_text_blob(c: u32, blob: u32, x: f32, y: f32, paint: u32) -> R<()> {
    let b = cloned::<TextBlob>(blob)?;
    let p = cloned::<Paint>(paint)?;
    with_canvas(c, |cv| {
        cv.draw_text_blob(&b, (x, y), &p);
    })
}

/// `glyphs` are glyph ids; `positions` = [x0, y0, ...] relative to `origin`.
pub fn canvas_draw_glyphs_at(
    c: u32,
    glyphs: &[u32],
    positions: &[f32],
    ox: f32,
    oy: f32,
    font: u32,
    paint: u32,
) -> R<()> {
    let f = cloned::<Font>(font)?;
    let p = cloned::<Paint>(paint)?;
    let g: Vec<GlyphId> = glyphs.iter().map(|g| *g as GlyphId).collect();
    let pos = points(positions);
    if pos.len() != g.len() {
        return Err("glyphs and positions must have the same length".into());
    }
    with_canvas(c, |cv| {
        cv.draw_glyphs_at(&g, pos.as_slice(), Point::new(ox, oy), &f, &p);
    })
}

pub fn canvas_draw_picture(c: u32, picture: u32, m: &[f32], paint: u32) -> R<()> {
    let pic = cloned::<Picture>(picture)?;
    let m = matrix_opt(m)?;
    let p = paint_opt(paint)?;
    with_canvas(c, |cv| {
        cv.draw_picture(&pic, m.as_ref(), p.as_ref());
    })
}

/// Draws an image with each of `xforms` ([scos, ssin, tx, ty] per sprite) and source rects `tex` ([l,t,r,b] per sprite).
pub fn canvas_draw_atlas(
    c: u32,
    atlas: u32,
    xforms: &[f32],
    tex: &[f32],
    colors: &[u32],
    mode: u32,
    sampling_code: u32,
    paint: u32,
) -> R<()> {
    let img = cloned::<Image>(atlas)?;
    let xf: Vec<skia_safe::RSXform> =
        xforms.chunks_exact(4).map(|v| skia_safe::RSXform::new(v[0], v[1], (v[2], v[3]))).collect();
    let tr: Vec<skia_safe::Rect> = tex.chunks_exact(4).map(|v| rect(v[0], v[1], v[2], v[3])).collect();
    let cols: Vec<skia_safe::Color> = colors.iter().map(|c| color(*c)).collect();
    let p = paint_opt(paint)?;
    with_canvas(c, |cv| {
        cv.draw_atlas(
            &img,
            &xf,
            &tr,
            if cols.is_empty() { None } else { Some(cols.as_slice()) },
            blend_mode(mode),
            sampling(sampling_code),
            None,
            p.as_ref(),
        );
    })
}

pub fn canvas_draw_vertices(
    c: u32,
    mode: u32,
    positions: &[f32],
    tex_coords: &[f32],
    colors: &[u32],
    indices: &[u32],
    blend: u32,
    paint: u32,
) -> R<()> {
    use skia_safe::vertices::VertexMode;
    let vm = match mode {
        1 => VertexMode::TriangleStrip,
        2 => VertexMode::TriangleFan,
        _ => VertexMode::Triangles,
    };
    let pos = points(positions);
    let tex = points(tex_coords);
    let cols: Vec<skia_safe::Color> = colors.iter().map(|c| color(*c)).collect();
    let idx: Vec<u16> = indices.iter().map(|i| *i as u16).collect();
    if (!tex.is_empty() && tex.len() != pos.len()) || (!cols.is_empty() && cols.len() != pos.len()) {
        return Err("texCoords and colors must match the number of positions".into());
    }
    let tex = if tex.is_empty() { pos.clone() } else { tex };
    let cols = if cols.is_empty() { vec![skia_safe::Color::BLACK; pos.len()] } else { cols };
    let v = skia_safe::Vertices::new_copy(vm, &pos, &tex, &cols, if idx.is_empty() { None } else { Some(&idx) });
    let p = cloned::<Paint>(paint)?;
    with_canvas(c, |cv| {
        cv.draw_vertices(&v, blend_mode(blend), &p);
    })
}
