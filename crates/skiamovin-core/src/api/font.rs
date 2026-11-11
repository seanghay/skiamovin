use crate::api::shader::json_str;
use crate::handles::{cloned, cloned_opt, get, put};
use crate::R;
use skia_safe::{
    font::Edging, font_arguments::variation_position::Coordinate, font_arguments::VariationPosition, font_style, Data,
    Font, FontArguments, FontHinting, FontMgr, FontStyle, FourByteTag, Paint, TextBlob, Typeface,
};

/// The platform font manager (CoreText on macOS, FreeType/fontconfig on Linux, DirectWrite on Windows,
/// an empty/custom manager on the web).
pub fn font_mgr_default() -> u32 {
    put(FontMgr::new())
}

pub fn font_mgr_count_families(h: u32) -> R<u32> {
    Ok(get::<FontMgr>(h)?.borrow().count_families() as u32)
}

/// Newline-separated family names.
pub fn font_mgr_family_names(h: u32) -> R<String> {
    Ok(get::<FontMgr>(h)?.borrow().family_names().collect::<Vec<_>>().join("\n"))
}

pub fn font_mgr_new_from_data(h: u32, bytes: &[u8], index: u32) -> R<u32> {
    let m = cloned::<FontMgr>(h)?;
    let tf = m.new_from_data(Data::new_copy(bytes), index).ok_or("could not load font data")?;
    Ok(put(tf))
}

/// slant: 0 upright, 1 italic, 2 oblique. Returns 0 when no match.
pub fn font_mgr_match_family_style(h: u32, family: &str, weight: i32, width: i32, slant: u32) -> R<u32> {
    let m = cloned::<FontMgr>(h)?;
    let style = font_style_of(weight, width, slant);
    Ok(m.match_family_style(family, style).map(put).unwrap_or(0))
}

/// Falls back to the platform default when `family` is empty or missing. Returns 0 when nothing is available.
pub fn font_mgr_legacy_make_typeface(h: u32, family: &str, weight: i32, width: i32, slant: u32) -> R<u32> {
    let m = cloned::<FontMgr>(h)?;
    let fam = if family.is_empty() { None } else { Some(family) };
    Ok(m.legacy_make_typeface(fam, font_style_of(weight, width, slant)).map(put).unwrap_or(0))
}

pub fn font_style_of(weight: i32, width: i32, slant: u32) -> FontStyle {
    FontStyle::new(
        font_style::Weight::from(weight),
        font_style::Width::from(width),
        match slant {
            1 => font_style::Slant::Italic,
            2 => font_style::Slant::Oblique,
            _ => font_style::Slant::Upright,
        },
    )
}

pub fn typeface_family_name(h: u32) -> R<String> {
    Ok(get::<Typeface>(h)?.borrow().family_name())
}

/// `[weight, width, slant]`.
pub fn typeface_style(h: u32) -> R<Vec<i32>> {
    let s = get::<Typeface>(h)?.borrow().font_style();
    Ok(vec![*s.weight(), *s.width(), s.slant() as i32])
}

/// Variation axes JSON: `[{"tag","min","def","max"}]`.
pub fn typeface_variation_axes(h: u32) -> R<String> {
    let t = get::<Typeface>(h)?;
    let axes = t.borrow().variation_design_parameters().unwrap_or_default();
    let items: Vec<String> = axes
        .iter()
        .map(|a| {
            format!(
                "{{\"tag\":{},\"min\":{},\"def\":{},\"max\":{}}}",
                json_str(&tag_to_string(a.tag)),
                a.min,
                a.def,
                a.max
            )
        })
        .collect();
    Ok(format!("[{}]", items.join(",")))
}

/// Clone with variation coordinates. `tags` are 4-char tags packed as u32 (big-endian), `values` parallel.
pub fn typeface_make_variation(h: u32, tags: &[u32], values: &[f32]) -> R<u32> {
    let t = cloned::<Typeface>(h)?;
    let coords: Vec<Coordinate> =
        tags.iter().zip(values).map(|(t, v)| Coordinate { axis: FourByteTag::new(*t), value: *v }).collect();
    let args = FontArguments::new().set_variation_design_position(VariationPosition { coordinates: &coords });
    let c = t.clone_with_arguments(&args).ok_or("typeface does not support variations")?;
    Ok(put(c))
}

pub fn tag_to_string(t: FourByteTag) -> String {
    let v: u32 = *t;
    String::from_utf8_lossy(&v.to_be_bytes()).into_owned()
}

// ---- Font ----

fn with<T>(h: u32, f: impl FnOnce(&mut Font) -> T) -> R<T> {
    let p = get::<Font>(h)?;
    let mut p = p.borrow_mut();
    Ok(f(&mut p))
}

/// `typeface` 0 = default typeface.
pub fn font_new(typeface: u32, size: f32) -> R<u32> {
    let tf = match cloned_opt::<Typeface>(typeface)? {
        Some(t) => t,
        None => FontMgr::new()
            .legacy_make_typeface(None, FontStyle::normal())
            .ok_or("no default typeface available; load a font")?,
    };
    Ok(put(Font::from_typeface(tf, size)))
}

pub fn font_set_size(h: u32, size: f32) -> R<()> {
    with(h, |f| {
        f.set_size(size);
    })
}

pub fn font_get_size(h: u32) -> R<f32> {
    with(h, |f| f.size())
}

pub fn font_set_typeface(h: u32, typeface: u32) -> R<()> {
    let t = cloned::<Typeface>(typeface)?;
    with(h, |f| {
        f.set_typeface(t);
    })
}

/// 0 alias, 1 antialias, 2 subpixel antialias.
pub fn font_set_edging(h: u32, e: u32) -> R<()> {
    with(h, |f| {
        f.set_edging(match e {
            0 => Edging::Alias,
            2 => Edging::SubpixelAntiAlias,
            _ => Edging::AntiAlias,
        });
    })
}

pub fn font_set_subpixel(h: u32, v: bool) -> R<()> {
    with(h, |f| {
        f.set_subpixel(v);
    })
}

/// 0 none, 1 slight, 2 normal, 3 full.
pub fn font_set_hinting(h: u32, v: u32) -> R<()> {
    with(h, |f| {
        f.set_hinting(match v {
            0 => FontHinting::None,
            1 => FontHinting::Slight,
            3 => FontHinting::Full,
            _ => FontHinting::Normal,
        });
    })
}

pub fn font_set_embolden(h: u32, v: bool) -> R<()> {
    with(h, |f| {
        f.set_embolden(v);
    })
}

pub fn font_set_scale_x(h: u32, v: f32) -> R<()> {
    with(h, |f| {
        f.set_scale_x(v);
    })
}

pub fn font_set_skew_x(h: u32, v: f32) -> R<()> {
    with(h, |f| {
        f.set_skew_x(v);
    })
}

/// `[advance, left, top, right, bottom]`.
pub fn font_measure_str(h: u32, text: &str, paint: u32) -> R<Vec<f32>> {
    let p = cloned_opt::<Paint>(paint)?;
    with(h, |f| {
        let (adv, b) = f.measure_str(text, p.as_ref());
        vec![adv, b.left, b.top, b.right, b.bottom]
    })
}

/// `[ascent, descent, leading, top, bottom, avgCharWidth, maxCharWidth, xHeight, capHeight, underlineThickness, underlinePosition]`.
pub fn font_metrics(h: u32) -> R<Vec<f32>> {
    with(h, |f| {
        let (_, m) = f.metrics();
        vec![
            m.ascent,
            m.descent,
            m.leading,
            m.top,
            m.bottom,
            m.avg_char_width,
            m.max_char_width,
            m.x_height,
            m.cap_height,
            m.underline_thickness().unwrap_or(0.0),
            m.underline_position().unwrap_or(0.0),
        ]
    })
}

pub fn font_get_glyphs(h: u32, text: &str) -> R<Vec<u32>> {
    with(h, |f| f.str_to_glyphs_vec(text).into_iter().map(|g| g as u32).collect())
}

pub fn font_get_widths(h: u32, glyphs: &[u32]) -> R<Vec<f32>> {
    let g: Vec<u16> = glyphs.iter().map(|g| *g as u16).collect();
    with(h, |f| {
        let mut w = vec![0.0f32; g.len()];
        f.get_widths(&g, &mut w);
        w
    })
}

/// Outline of a glyph as a path handle (0 if the glyph has no outline).
pub fn font_get_path(h: u32, glyph: u32) -> R<u32> {
    let p = with(h, |f| f.get_path(glyph as u16))?;
    Ok(p.map(|p| put(crate::api::path::PathObj { builder: skia_safe::PathBuilder::new_path(&p) })).unwrap_or(0))
}

// ---- TextBlob ----

pub fn text_blob_from_str(text: &str, font: u32) -> R<u32> {
    let f = cloned::<Font>(font)?;
    TextBlob::from_str(text, &f).map(put).ok_or_else(|| "empty text blob".into())
}

pub fn text_blob_from_pos_glyphs(glyphs: &[u32], positions: &[f32], font: u32) -> R<u32> {
    let f = cloned::<Font>(font)?;
    let g: Vec<u16> = glyphs.iter().map(|g| *g as u16).collect();
    let pos = crate::convert::points(positions);
    TextBlob::from_pos_text(g.as_slice(), &pos, &f).map(put).ok_or_else(|| "empty text blob".into())
}

pub fn text_blob_bounds(h: u32) -> R<Vec<f32>> {
    let b = *get::<TextBlob>(h)?.borrow().bounds();
    Ok(vec![b.left, b.top, b.right, b.bottom])
}
