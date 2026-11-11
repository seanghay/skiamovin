//! SkParagraph bindings. Text ranges in this API are UTF-16 indices, as in JavaScript strings.
//! SkParagraph works in UTF-8, so each paragraph keeps a mapping between the two.

use crate::api::canvas::with_canvas;
use crate::api::shader::json_str;
use crate::handles::{cloned, cloned_opt, get, put};
use crate::R;
use skia_safe::{
    font_arguments::variation_position::Coordinate, font_arguments::VariationPosition, textlayout::*, Color,
    FontArguments, FontMgr, FourByteTag, Paint, Point,
};

// ---- FontCollection / TypefaceFontProvider ----

pub fn font_collection_new() -> u32 {
    put(FontCollection::new())
}

pub fn font_collection_set_default_font_manager(h: u32, font_mgr: u32, default_family: &str) -> R<()> {
    let m = cloned::<FontMgr>(font_mgr)?;
    let fc = get::<FontCollection>(h)?;
    let mut fc = fc.borrow_mut();
    if default_family.is_empty() {
        fc.set_default_font_manager(m, None);
    } else {
        fc.set_default_font_manager(m, default_family);
    }
    Ok(())
}

/// `provider` is a TypefaceFontProvider handle.
pub fn font_collection_set_asset_font_manager(h: u32, provider: u32) -> R<()> {
    let p = cloned::<TypefaceFontProvider>(provider)?;
    get::<FontCollection>(h)?.borrow_mut().set_asset_font_manager(Some(p.into()));
    Ok(())
}

pub fn font_collection_set_dynamic_font_manager(h: u32, provider: u32) -> R<()> {
    let p = cloned::<TypefaceFontProvider>(provider)?;
    get::<FontCollection>(h)?.borrow_mut().set_dynamic_font_manager(Some(p.into()));
    Ok(())
}

pub fn font_collection_enable_font_fallback(h: u32, enabled: bool) -> R<()> {
    let fc = get::<FontCollection>(h)?;
    let mut fc = fc.borrow_mut();
    if enabled {
        fc.enable_font_fallback();
    } else {
        fc.disable_font_fallback();
    }
    Ok(())
}

pub fn font_collection_clear_caches(h: u32) -> R<()> {
    get::<FontCollection>(h)?.borrow_mut().clear_caches();
    Ok(())
}

pub fn typeface_font_provider_new() -> u32 {
    put(TypefaceFontProvider::new())
}

/// `alias` empty = use the typeface's own family name.
pub fn typeface_font_provider_register(h: u32, typeface: u32, alias: &str) -> R<u32> {
    let t = cloned::<skia_safe::Typeface>(typeface)?;
    let p = get::<TypefaceFontProvider>(h)?;
    let mut p = p.borrow_mut();
    let n = if alias.is_empty() { p.register_typeface(t, None) } else { p.register_typeface(t, Some(alias)) };
    Ok(n as u32)
}

// ---- TextStyle ----

fn ts<T>(h: u32, f: impl FnOnce(&mut TextStyle) -> T) -> R<T> {
    let s = get::<TextStyle>(h)?;
    let mut s = s.borrow_mut();
    Ok(f(&mut s))
}

pub fn text_style_new() -> u32 {
    put(TextStyle::new())
}

pub fn text_style_copy(h: u32) -> R<u32> {
    Ok(put(cloned::<TextStyle>(h)?))
}

pub fn text_style_set_color(h: u32, argb: u32) -> R<()> {
    ts(h, |s| {
        s.set_color(Color::new(argb));
    })
}

pub fn text_style_set_foreground_paint(h: u32, paint: u32) -> R<()> {
    let p = cloned_opt::<Paint>(paint)?;
    ts(h, |s| match p {
        Some(p) => {
            s.set_foreground_paint(&p);
        }
        None => {
            s.clear_foreground_color();
        }
    })
}

pub fn text_style_set_background_paint(h: u32, paint: u32) -> R<()> {
    let p = cloned_opt::<Paint>(paint)?;
    ts(h, |s| match p {
        Some(p) => {
            s.set_background_paint(&p);
        }
        None => {
            s.clear_background_color();
        }
    })
}

/// Newline-separated family names (first = preferred).
pub fn text_style_set_font_families(h: u32, families: &str) -> R<()> {
    let fams: Vec<&str> = families.split('\n').filter(|s| !s.is_empty()).collect();
    ts(h, |s| {
        s.set_font_families(&fams);
    })
}

pub fn text_style_set_font_size(h: u32, size: f32) -> R<()> {
    ts(h, |s| {
        s.set_font_size(size);
    })
}

pub fn text_style_set_font_style(h: u32, weight: i32, width: i32, slant: u32) -> R<()> {
    ts(h, |s| {
        s.set_font_style(crate::api::font::font_style_of(weight, width, slant));
    })
}

/// `override_height`: when false, `height` is ignored (font metrics decide line height).
pub fn text_style_set_height(h: u32, height: f32, override_height: bool) -> R<()> {
    ts(h, |s| {
        s.set_height(height);
        s.set_height_override(override_height);
    })
}

pub fn text_style_set_half_leading(h: u32, v: bool) -> R<()> {
    ts(h, |s| {
        s.set_half_leading(v);
    })
}

pub fn text_style_set_letter_spacing(h: u32, v: f32) -> R<()> {
    ts(h, |s| {
        s.set_letter_spacing(v);
    })
}

pub fn text_style_set_word_spacing(h: u32, v: f32) -> R<()> {
    ts(h, |s| {
        s.set_word_spacing(v);
    })
}

/// decoration bits: 1 underline, 2 overline, 4 line-through. style: 0 solid, 1 double, 2 dotted, 3 dashed, 4 wavy.
pub fn text_style_set_decoration(h: u32, bits: u32, style: u32, argb: u32, thickness: f32) -> R<()> {
    ts(h, |s| {
        s.set_decoration_type(TextDecoration::from_bits_truncate(bits));
        s.set_decoration_style(match style {
            1 => TextDecorationStyle::Double,
            2 => TextDecorationStyle::Dotted,
            3 => TextDecorationStyle::Dashed,
            4 => TextDecorationStyle::Wavy,
            _ => TextDecorationStyle::Solid,
        });
        s.set_decoration_color(Color::new(argb));
        s.set_decoration_thickness_multiplier(thickness);
    })
}

/// One ARGB color per shadow in `colors`, and `[dx, dy, blur]` per shadow in `params`.
pub fn text_style_set_shadows(h: u32, colors: &[u32], params: &[f32]) -> R<()> {
    if params.len() != colors.len() * 3 {
        return Err("shadows: params must be [dx, dy, blur] per color".into());
    }
    ts(h, |s| {
        s.reset_shadows();
        for (i, c) in colors.iter().enumerate() {
            let p = &params[i * 3..i * 3 + 3];
            s.add_shadow(TextShadow::new(Color::new(*c), Point::new(p[0], p[1]), p[2] as f64));
        }
    })
}

/// OpenType features: packed tags (big-endian u32) and values.
pub fn text_style_set_font_features(h: u32, tags: &[u32], values: &[u32]) -> R<()> {
    ts(h, |s| {
        s.reset_font_features();
        for (t, v) in tags.iter().zip(values) {
            s.add_font_feature(crate::api::font::tag_to_string(FourByteTag::new(*t)), *v as i32);
        }
    })
}

/// Variable font axes: packed tags and values.
pub fn text_style_set_font_variations(h: u32, tags: &[u32], values: &[f32]) -> R<()> {
    let coords: Vec<Coordinate> =
        tags.iter().zip(values).map(|(t, v)| Coordinate { axis: FourByteTag::new(*t), value: *v }).collect();
    ts(h, |s| {
        if coords.is_empty() {
            s.set_font_arguments(None::<&FontArguments>);
        } else {
            let args = FontArguments::new().set_variation_design_position(VariationPosition { coordinates: &coords });
            s.set_font_arguments(&args);
        }
    })
}

pub fn text_style_set_locale(h: u32, locale: &str) -> R<()> {
    ts(h, |s| {
        s.set_locale(locale);
    })
}

pub fn text_style_set_baseline_shift(h: u32, v: f32) -> R<()> {
    ts(h, |s| {
        s.set_baseline_shift(v);
    })
}

// ---- ParagraphStyle ----

fn ps<T>(h: u32, f: impl FnOnce(&mut ParagraphStyle) -> T) -> R<T> {
    let s = get::<ParagraphStyle>(h)?;
    let mut s = s.borrow_mut();
    Ok(f(&mut s))
}

pub fn paragraph_style_new() -> u32 {
    put(ParagraphStyle::new())
}

pub fn paragraph_style_set_text_style(h: u32, text_style: u32) -> R<()> {
    let t = cloned::<TextStyle>(text_style)?;
    ps(h, |s| {
        s.set_text_style(&t);
    })
}

/// 0 left, 1 right, 2 center, 3 justify, 4 start, 5 end.
pub fn paragraph_style_set_text_align(h: u32, a: u32) -> R<()> {
    ps(h, |s| {
        s.set_text_align(match a {
            1 => TextAlign::Right,
            2 => TextAlign::Center,
            3 => TextAlign::Justify,
            4 => TextAlign::Start,
            5 => TextAlign::End,
            _ => TextAlign::Left,
        });
    })
}

/// 0 ltr, 1 rtl.
pub fn paragraph_style_set_text_direction(h: u32, d: u32) -> R<()> {
    ps(h, |s| {
        s.set_text_direction(if d == 1 { TextDirection::RTL } else { TextDirection::LTR });
    })
}

/// 0 = unlimited.
pub fn paragraph_style_set_max_lines(h: u32, n: u32) -> R<()> {
    ps(h, |s| {
        s.set_max_lines(if n == 0 { None } else { Some(n as usize) });
    })
}

pub fn paragraph_style_set_ellipsis(h: u32, e: &str) -> R<()> {
    ps(h, |s| {
        s.set_ellipsis(e);
    })
}

pub fn paragraph_style_set_height(h: u32, v: f32) -> R<()> {
    ps(h, |s| {
        s.set_height(v);
    })
}

/// bits: 1 disable first ascent, 2 disable last descent.
pub fn paragraph_style_set_text_height_behavior(h: u32, bits: u32) -> R<()> {
    ps(h, |s| {
        s.set_text_height_behavior(match bits {
            1 => TextHeightBehavior::DisableFirstAscent,
            2 => TextHeightBehavior::DisableLastDescent,
            3 => TextHeightBehavior::DisableAll,
            _ => TextHeightBehavior::All,
        });
    })
}

pub fn paragraph_style_set_replace_tab_characters(h: u32, v: bool) -> R<()> {
    ps(h, |s| {
        s.set_replace_tab_characters(v);
    })
}

pub fn paragraph_style_set_apply_rounding_hack(h: u32, v: bool) -> R<()> {
    ps(h, |s| {
        s.set_apply_rounding_hack(v);
    })
}

/// Strut: font families (newline-separated), size, height (0 = none), leading, force.
pub fn paragraph_style_set_strut(
    h: u32,
    enabled: bool,
    families: &str,
    font_size: f32,
    height: f32,
    leading: f32,
    force: bool,
) -> R<()> {
    let fams: Vec<&str> = families.split('\n').filter(|s| !s.is_empty()).collect();
    ps(h, |s| {
        let mut st = StrutStyle::new();
        st.set_strut_enabled(enabled);
        st.set_font_families(&fams);
        st.set_font_size(font_size);
        if height > 0.0 {
            st.set_height(height);
            st.set_height_override(true);
        }
        st.set_leading(leading);
        st.set_force_strut_height(force);
        s.set_strut_style(st);
    })
}

// ---- ParagraphBuilder ----

pub struct BuilderObj {
    builder: ParagraphBuilder,
    text: String,
}

pub fn paragraph_builder_new(style: u32, font_collection: u32) -> R<u32> {
    let s = cloned::<ParagraphStyle>(style)?;
    let fc = cloned::<FontCollection>(font_collection)?;
    Ok(put(BuilderObj { builder: ParagraphBuilder::new(&s, fc), text: String::new() }))
}

pub fn paragraph_builder_push_style(h: u32, text_style: u32) -> R<()> {
    let t = cloned::<TextStyle>(text_style)?;
    get::<BuilderObj>(h)?.borrow_mut().builder.push_style(&t);
    Ok(())
}

pub fn paragraph_builder_pop(h: u32) -> R<()> {
    get::<BuilderObj>(h)?.borrow_mut().builder.pop();
    Ok(())
}

pub fn paragraph_builder_add_text(h: u32, text: &str) -> R<()> {
    let b = get::<BuilderObj>(h)?;
    let mut b = b.borrow_mut();
    b.builder.add_text(text);
    b.text.push_str(text);
    Ok(())
}

/// alignment: 0 baseline, 1 above baseline, 2 below baseline, 3 top, 4 bottom, 5 middle. baseline: 0 alphabetic, 1 ideographic.
pub fn paragraph_builder_add_placeholder(
    h: u32,
    width: f32,
    height: f32,
    alignment: u32,
    baseline: u32,
    offset: f32,
) -> R<()> {
    let a = match alignment {
        1 => PlaceholderAlignment::AboveBaseline,
        2 => PlaceholderAlignment::BelowBaseline,
        3 => PlaceholderAlignment::Top,
        4 => PlaceholderAlignment::Bottom,
        5 => PlaceholderAlignment::Middle,
        _ => PlaceholderAlignment::Baseline,
    };
    let bl = if baseline == 1 { TextBaseline::Ideographic } else { TextBaseline::Alphabetic };
    let b = get::<BuilderObj>(h)?;
    let mut b = b.borrow_mut();
    b.builder.add_placeholder(&PlaceholderStyle::new(width, height, a, bl, offset));
    b.text.push('\u{FFFC}');
    Ok(())
}

pub fn paragraph_builder_build(h: u32) -> R<u32> {
    let b = get::<BuilderObj>(h)?;
    let mut b = b.borrow_mut();
    let p = b.builder.build();
    let text = std::mem::take(&mut b.text);
    Ok(put(ParagraphObj::new(p, text)))
}

pub fn paragraph_builder_reset(h: u32) -> R<()> {
    let b = get::<BuilderObj>(h)?;
    let mut b = b.borrow_mut();
    b.builder.reset();
    b.text.clear();
    Ok(())
}

// ---- Paragraph ----

#[allow(dead_code)]
pub struct ParagraphObj {
    pub paragraph: Paragraph,
    /// utf8 byte offset for each utf16 index (len = utf16_len + 1)
    utf16_to_utf8: Vec<usize>,
    /// utf16 index for each utf8 byte offset (len = utf8_len + 1)
    utf8_to_utf16: Vec<usize>,
    pub last_width: f32,
}

impl ParagraphObj {
    fn new(paragraph: Paragraph, text: String) -> Self {
        let mut u16_to_8 = Vec::with_capacity(text.len() + 1);
        let mut u8_to_16 = vec![0usize; text.len() + 1];
        let mut u16i = 0usize;
        for (byte_i, ch) in text.char_indices() {
            for k in 0..ch.len_utf8() {
                u8_to_16[byte_i + k] = u16i;
            }
            for _ in 0..ch.len_utf16() {
                u16_to_8.push(byte_i);
                u16i += 1;
            }
        }
        u16_to_8.push(text.len());
        u8_to_16[text.len()] = u16i;
        Self { paragraph, utf16_to_utf8: u16_to_8, utf8_to_utf16: u8_to_16, last_width: f32::NAN }
    }
    #[allow(dead_code)]
    fn u16_to_u8(&self, i: u32) -> usize {
        let i = (i as usize).min(self.utf16_to_utf8.len() - 1);
        self.utf16_to_utf8[i]
    }
    fn u8_to_u16(&self, i: usize) -> u32 {
        self.utf8_to_utf16[i.min(self.utf8_to_utf16.len() - 1)] as u32
    }
}

fn par<T>(h: u32, f: impl FnOnce(&mut ParagraphObj) -> T) -> R<T> {
    let p = get::<ParagraphObj>(h)?;
    let mut p = p.borrow_mut();
    Ok(f(&mut p))
}

pub fn paragraph_layout(h: u32, width: f32) -> R<()> {
    par(h, |p| {
        if p.last_width != width {
            p.paragraph.layout(width);
            p.last_width = width;
        }
    })
}

pub fn paragraph_paint(h: u32, canvas: u32, x: f32, y: f32) -> R<()> {
    let p = get::<ParagraphObj>(h)?;
    let p = p.borrow();
    with_canvas(canvas, |c| p.paragraph.paint(c, (x, y)))
}

/// `[height, maxWidth, minIntrinsicWidth, maxIntrinsicWidth, longestLine, alphabeticBaseline, ideographicBaseline, didExceedMaxLines, lineNumber]`.
pub fn paragraph_metrics(h: u32) -> R<Vec<f32>> {
    par(h, |p| {
        let g = &p.paragraph;
        vec![
            g.height(),
            g.max_width(),
            g.min_intrinsic_width(),
            g.max_intrinsic_width(),
            g.longest_line(),
            g.alphabetic_baseline(),
            g.ideographic_baseline(),
            if g.did_exceed_max_lines() { 1.0 } else { 0.0 },
            g.line_number() as f32,
        ]
    })
}

/// Per line: `[startIndex, endIndex, endExcludingWhitespace, endIncludingNewline, isHardBreak, ascent, descent, height, width, left, baseline, lineNumber]` (indices UTF-16).
pub fn paragraph_line_metrics(h: u32) -> R<Vec<f32>> {
    par(h, |p| {
        let mut out = vec![];
        for m in p.paragraph.get_line_metrics() {
            out.extend_from_slice(&[
                p.u8_to_u16(m.start_index) as f32,
                p.u8_to_u16(m.end_index) as f32,
                p.u8_to_u16(m.end_excluding_whitespaces) as f32,
                p.u8_to_u16(m.end_including_newline) as f32,
                if m.hard_break { 1.0 } else { 0.0 },
                m.ascent as f32,
                m.descent as f32,
                m.height as f32,
                m.width as f32,
                m.left as f32,
                m.baseline as f32,
                m.line_number as f32,
            ]);
        }
        out
    })
}

/// Boxes `[l, t, r, b, direction]` for a UTF-16 range. h_style: 0 tight, 1 max, 2 includeLineSpacingMiddle,
/// 3 includeLineSpacingTop, 4 includeLineSpacingBottom, 5 strut. w_style: 0 tight, 1 max.
pub fn paragraph_rects_for_range(h: u32, start: u32, end: u32, h_style: u32, w_style: u32) -> R<Vec<f32>> {
    par(h, |p| {
        let hs = match h_style {
            1 => RectHeightStyle::Max,
            2 => RectHeightStyle::IncludeLineSpacingMiddle,
            3 => RectHeightStyle::IncludeLineSpacingTop,
            4 => RectHeightStyle::IncludeLineSpacingBottom,
            5 => RectHeightStyle::Strut,
            _ => RectHeightStyle::Tight,
        };
        let ws = if w_style == 1 { RectWidthStyle::Max } else { RectWidthStyle::Tight };
        // SkParagraph's getRectsForRange takes UTF-16 indices.
        let boxes = p.paragraph.get_rects_for_range(start as usize..end as usize, hs, ws);
        boxes_to_vec(&boxes)
    })
}

pub fn paragraph_rects_for_placeholders(h: u32) -> R<Vec<f32>> {
    par(h, |p| boxes_to_vec(&p.paragraph.get_rects_for_placeholders()))
}

fn boxes_to_vec(b: &[TextBox]) -> Vec<f32> {
    b.iter()
        .flat_map(|t| {
            [
                t.rect.left,
                t.rect.top,
                t.rect.right,
                t.rect.bottom,
                if t.direct == TextDirection::RTL { 1.0 } else { 0.0 },
            ]
        })
        .collect()
}

/// `[position (UTF-16), affinity (0 upstream, 1 downstream)]`.
pub fn paragraph_glyph_position_at_coordinate(h: u32, x: f32, y: f32) -> R<Vec<i32>> {
    par(h, |p| {
        let r = p.paragraph.get_glyph_position_at_coordinate((x, y));
        vec![r.position, if r.affinity == Affinity::Downstream { 1 } else { 0 }]
    })
}

/// `[start, end]` (UTF-16) of the word at UTF-16 `offset`.
pub fn paragraph_word_boundary(h: u32, offset: u32) -> R<Vec<u32>> {
    par(h, |p| {
        let r = p.paragraph.get_word_boundary(offset);
        vec![r.start as u32, r.end as u32]
    })
}

/// Text outlines of line `line` as a path handle.
pub fn paragraph_get_path(h: u32, line: u32) -> R<u32> {
    par(h, |p| {
        let (_, path) = p.paragraph.get_path_at(line as usize);
        put(crate::api::path::PathObj { builder: skia_safe::PathBuilder::new_path(&path) })
    })
}

/// Glyph runs as JSON: `[{"line","font": <font handle>,"glyphs":[..],"positions":[x,y,..],"utf16Starts":[..],"origin":[x,y],"advanceX"}]`.
/// Positions are relative to the paragraph origin. Font handles are new objects owned by the caller.
pub fn paragraph_visit(h: u32) -> R<String> {
    let p = get::<ParagraphObj>(h)?;
    let mut p = p.borrow_mut();
    let mut runs: Vec<String> = vec![];
    let map8to16 = p.utf8_to_utf16.clone();
    p.paragraph.visit(|line, info| {
        if let Some(info) = info {
            let origin = info.origin();
            let font_h = put(info.font().clone());
            let glyphs: Vec<String> = info.glyphs().iter().map(|g| g.to_string()).collect();
            let positions: Vec<String> = info
                .positions()
                .iter()
                .flat_map(|pt| [(pt.x + origin.x).to_string(), (pt.y + origin.y).to_string()])
                .collect();
            let starts: Vec<String> = info.utf8_starts().iter().map(|s| map8to16[(*s as usize).min(map8to16.len() - 1)].to_string()).collect();
            runs.push(format!(
                "{{\"line\":{line},\"font\":{font_h},\"glyphs\":[{}],\"positions\":[{}],\"utf16Starts\":[{}],\"origin\":[{},{}],\"advanceX\":{}}}",
                glyphs.join(","),
                positions.join(","),
                starts.join(","),
                origin.x,
                origin.y,
                info.advance_x()
            ));
        }
    });
    Ok(format!("[{}]", runs.join(",")))
}

/// Fonts used, JSON `[{"start","end","family","size"}]` (UTF-16 ranges).
pub fn paragraph_fonts(h: u32) -> R<String> {
    par(h, |p| {
        let items: Vec<String> = p
            .paragraph
            .get_fonts()
            .iter()
            .map(|f| {
                format!(
                    "{{\"start\":{},\"end\":{},\"family\":{},\"size\":{}}}",
                    p.u8_to_u16(f.text_range.start),
                    p.u8_to_u16(f.text_range.end),
                    json_str(&f.font.typeface().family_name()),
                    f.font.size()
                )
            })
            .collect();
        format!("[{}]", items.join(","))
    })
}

/// Number of unresolved glyphs (missing from all fonts), or -1 if unknown.
pub fn paragraph_unresolved_glyphs(h: u32) -> R<i32> {
    par(h, |p| p.paragraph.unresolved_glyphs().map(|n| n as i32).unwrap_or(-1))
}
