//! Math typesetting with RaTeX (KaTeX-compatible, pure Rust) and the KaTeX fonts, drawn as Skia paths.
//! Each piece (glyph, rule or path) stays separate, so formulas can be drawn on and animated piece by piece.

use crate::api::path::PathObj;
use crate::handles::{get, put};
use crate::R;
use ratex_types::display_item::DisplayItem;
use ratex_types::path_command::PathCommand;
use skia_safe::PathBuilder;

/// Glyph outline of `ch` in KaTeX font `font`, in font units with y pointing down, and the font's units per em.
fn katex_glyph(font: &str, ch: char) -> Option<(skia_safe::Path, f32)> {
    let bytes = ratex_katex_fonts::ttf_bytes(&format!("KaTeX_{font}.ttf"))?;
    let face = ttf_parser::Face::parse(&bytes, 0).ok()?;
    let gid = face.glyph_index(ch)?;
    let mut out = Outline(PathBuilder::new());
    face.outline_glyph(gid, &mut out)?;
    Some((out.0.detach(), face.units_per_em() as f32))
}

struct Outline(PathBuilder);

impl ttf_parser::OutlineBuilder for Outline {
    fn move_to(&mut self, x: f32, y: f32) {
        self.0.move_to((x, -y));
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.0.line_to((x, -y));
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        self.0.quad_to((x1, -y1), (x, -y));
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        self.0.cubic_to((x1, -y1), (x2, -y2), (x, -y));
    }
    fn close(&mut self) {
        self.0.close();
    }
}

pub struct MathObj {
    width: f32,
    height: f32,
    depth: f32,
    /// Pieces in drawing order: outline (at font size, baseline at y = height) and ARGB color.
    pieces: Vec<(skia_safe::Path, u32)>,
}

fn argb(c: &ratex_types::color::Color) -> u32 {
    let ch = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u32;
    (ch(c.a) << 24) | (ch(c.r) << 16) | (ch(c.g) << 8) | ch(c.b)
}

/// Typesets LaTeX math at `font_size` pixels. `display` uses display style (large operators, stacked limits).
/// Returns a handle; the top of the formula is at y = 0.
pub fn math_layout(tex: &str, font_size: f32, display: bool) -> R<u32> {
    let ast = ratex_parser::parse(tex).map_err(|e| format!("math: {e}"))?;
    let mut options = ratex_layout::LayoutOptions::default();
    if display {
        options.style = ratex_types::math_style::MathStyle::Display;
    }
    let lbox = ratex_layout::layout(&ast, &options);
    ratex_layout::validate_layout(&lbox).map_err(|e| format!("math: {e}"))?;
    let list = ratex_layout::to_display_list(&lbox);
    let em = font_size;
    let top = list.height as f32 * em;
    let mut pieces = vec![];
    for item in &list.items {
        match item {
            DisplayItem::GlyphPath { x, y, scale, font, char_code, color } => {
                let Some(ch) = char::from_u32(*char_code) else { continue };
                let Some((path, upem)) = katex_glyph(font, ch) else { continue };
                let k = (*scale as f32) * em / upem.max(1.0);
                let m = skia_safe::Matrix::scale_translate((k, k), (*x as f32 * em, *y as f32 * em + top));
                pieces.push((path.make_transform(&m), argb(color)));
            }
            DisplayItem::Line { x, y, width, thickness, color, .. } => {
                let (x, y, w, t) = (*x as f32 * em, *y as f32 * em + top, *width as f32 * em, *thickness as f32 * em);
                let mut b = PathBuilder::new();
                b.add_rect(skia_safe::Rect::from_xywh(x, y - t / 2.0, w, t), None, None);
                pieces.push((b.detach(), argb(color)));
            }
            DisplayItem::Rect { x, y, width, height, color } => {
                let mut b = PathBuilder::new();
                b.add_rect(
                    skia_safe::Rect::from_xywh(
                        *x as f32 * em,
                        *y as f32 * em + top,
                        *width as f32 * em,
                        *height as f32 * em,
                    ),
                    None,
                    None,
                );
                pieces.push((b.detach(), argb(color)));
            }
            DisplayItem::Path { x, y, commands, color, .. } => {
                let (ox, oy) = (*x as f32 * em, *y as f32 * em + top);
                let p = |a: f64, b: f64| (ox + a as f32 * em, oy + b as f32 * em);
                let mut b = PathBuilder::new();
                for c in commands {
                    match c {
                        PathCommand::MoveTo { x, y } => {
                            b.move_to(p(*x, *y));
                        }
                        PathCommand::LineTo { x, y } => {
                            b.line_to(p(*x, *y));
                        }
                        PathCommand::CubicTo { x1, y1, x2, y2, x, y } => {
                            b.cubic_to(p(*x1, *y1), p(*x2, *y2), p(*x, *y));
                        }
                        PathCommand::QuadTo { x1, y1, x, y } => {
                            b.quad_to(p(*x1, *y1), p(*x, *y));
                        }
                        PathCommand::Close => {
                            b.close();
                        }
                    }
                }
                pieces.push((b.detach(), argb(color)));
            }
        }
    }
    Ok(put(MathObj { width: list.width as f32 * em, height: top, depth: list.depth as f32 * em, pieces }))
}

/// `[width, height above the baseline, depth below it, number of pieces]`, in pixels.
pub fn math_info(h: u32) -> R<Vec<f32>> {
    let m = get::<MathObj>(h)?;
    let m = m.borrow();
    Ok(vec![m.width, m.height, m.depth, m.pieces.len() as f32])
}

/// Outline of piece `i` as a new path.
pub fn math_piece(h: u32, i: u32) -> R<u32> {
    let m = get::<MathObj>(h)?;
    let m = m.borrow();
    let (path, _) = m.pieces.get(i as usize).ok_or("math: no such piece")?;
    Ok(put(PathObj { builder: PathBuilder::new_path(path) }))
}

/// ARGB color of every piece.
pub fn math_colors(h: u32) -> R<Vec<u32>> {
    Ok(get::<MathObj>(h)?.borrow().pieces.iter().map(|(_, c)| *c).collect())
}
