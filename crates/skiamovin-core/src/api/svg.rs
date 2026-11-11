use crate::api::canvas::with_canvas;
use crate::handles::{cloned, get, put};
use crate::R;
use skia_safe::{svg::Dom, FontMgr, Size};

pub fn svg_dom_from_bytes(bytes: &[u8], font_mgr: u32) -> R<u32> {
    let fm = if font_mgr == 0 { FontMgr::new() } else { cloned::<FontMgr>(font_mgr)? };
    let dom = Dom::from_bytes(bytes, fm).map_err(|e| format!("could not parse SVG: {e:?}"))?;
    Ok(put(dom))
}

pub fn svg_dom_set_container_size(h: u32, width: f32, height: f32) -> R<()> {
    get::<Dom>(h)?.borrow_mut().set_container_size(Size::new(width, height));
    Ok(())
}

pub fn svg_dom_render(h: u32, canvas: u32) -> R<()> {
    let d = get::<Dom>(h)?;
    let d = d.borrow();
    with_canvas(canvas, |c| d.render(c))
}

/// `[width, height]` from the root's width/height (or viewBox), resolved against the container size.
pub fn svg_dom_intrinsic_size(h: u32) -> R<Vec<f32>> {
    let d = get::<Dom>(h)?;
    let d = d.borrow();
    let root = d.root();
    let s = root.intrinsic_size();
    let mut out = vec![s.width, s.height];
    if let Some(vb) = root.view_box() {
        out.extend_from_slice(&[vb.left, vb.top, vb.width(), vb.height()]);
    }
    Ok(out)
}
