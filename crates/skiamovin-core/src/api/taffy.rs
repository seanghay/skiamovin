//! Taffy layout bindings. Styles arrive as JSON using CSS-like values (see docs/api/taffy.md).
//! Node ids are small u32s mapped to Taffy `NodeId`s per tree.

use crate::api::textlayout::ParagraphObj;
use crate::handles::{get, put};
use crate::{MeasureCallback, R};
use serde_json::Value;
use std::collections::HashMap;
use taffy::prelude::*;
use taffy::style::{
    GridTemplateArea, GridTemplateAreas, GridTemplateComponent, GridTemplateRepetition, MaxTrackSizingFunction,
    MinTrackSizingFunction, RepetitionCount,
};
use taffy::{geometry::MinMax, BoxSizing, Overflow, Point as TPoint};

#[derive(Clone, Copy, Debug)]
pub enum NodeCtx {
    /// Measured by the host (JavaScript) callback.
    Js,
    /// Measured in Rust with an SkParagraph handle.
    Paragraph(u32),
    /// Fixed intrinsic size (images, videos): (width, height).
    Intrinsic(f32, f32),
}

pub struct TreeObj {
    tree: TaffyTree<NodeCtx>,
    ids: Vec<Option<NodeId>>, // index = our id
    rev: HashMap<NodeId, u32>,
    free: Vec<u32>,
}

impl TreeObj {
    fn node(&self, id: u32) -> R<NodeId> {
        self.ids.get(id as usize).copied().flatten().ok_or_else(|| format!("invalid layout node {id}"))
    }
    fn alloc(&mut self, n: NodeId) -> u32 {
        let id = if let Some(id) = self.free.pop() {
            self.ids[id as usize] = Some(n);
            id
        } else {
            self.ids.push(Some(n));
            (self.ids.len() - 1) as u32
        };
        self.rev.insert(n, id);
        id
    }
    fn id_of(&self, n: NodeId) -> u32 {
        self.rev.get(&n).copied().unwrap_or(0)
    }
    fn release(&mut self, id: u32) {
        if let Some(Some(n)) = self.ids.get(id as usize).copied() {
            self.rev.remove(&n);
            self.ids[id as usize] = None;
            self.free.push(id);
        }
    }
}

fn tree<T>(h: u32, f: impl FnOnce(&mut TreeObj) -> R<T>) -> R<T> {
    let t = get::<TreeObj>(h)?;
    let mut t = t.borrow_mut();
    f(&mut t)
}

fn terr(e: taffy::TaffyError) -> String {
    format!("layout error: {e}")
}

pub fn taffy_tree_new() -> u32 {
    let mut tree = TaffyTree::new();
    tree.enable_rounding();
    // id 0 is reserved for "none"
    put(TreeObj { tree, ids: vec![None], rev: HashMap::new(), free: vec![] })
}

pub fn taffy_enable_rounding(h: u32, enabled: bool) -> R<()> {
    tree(h, |t| {
        if enabled {
            t.tree.enable_rounding()
        } else {
            t.tree.disable_rounding()
        }
        Ok(())
    })
}

pub fn taffy_new_leaf(h: u32, style: &str) -> R<u32> {
    let s = parse_style(style)?;
    tree(h, |t| {
        let n = t.tree.new_leaf(s).map_err(terr)?;
        Ok(t.alloc(n))
    })
}

/// kind: 0 none, 1 JS-measured, 2 paragraph handle `value`, 3 intrinsic size (w, h).
pub fn taffy_set_node_context(h: u32, node: u32, kind: u32, value: u32, w: f32, hgt: f32) -> R<()> {
    let ctx = match kind {
        1 => Some(NodeCtx::Js),
        2 => Some(NodeCtx::Paragraph(value)),
        3 => Some(NodeCtx::Intrinsic(w, hgt)),
        _ => None,
    };
    tree(h, |t| {
        let n = t.node(node)?;
        t.tree.set_node_context(n, ctx).map_err(terr)
    })
}

pub fn taffy_new_with_children(h: u32, style: &str, children: &[u32]) -> R<u32> {
    let s = parse_style(style)?;
    tree(h, |t| {
        let kids: Vec<NodeId> = children.iter().map(|c| t.node(*c)).collect::<R<_>>()?;
        let n = t.tree.new_with_children(s, &kids).map_err(terr)?;
        Ok(t.alloc(n))
    })
}

pub fn taffy_add_child(h: u32, parent: u32, child: u32) -> R<()> {
    tree(h, |t| {
        let (p, c) = (t.node(parent)?, t.node(child)?);
        t.tree.add_child(p, c).map_err(terr)
    })
}

pub fn taffy_insert_child_at_index(h: u32, parent: u32, index: u32, child: u32) -> R<()> {
    tree(h, |t| {
        let (p, c) = (t.node(parent)?, t.node(child)?);
        t.tree.insert_child_at_index(p, index as usize, c).map_err(terr)
    })
}

pub fn taffy_set_children(h: u32, parent: u32, children: &[u32]) -> R<()> {
    tree(h, |t| {
        let p = t.node(parent)?;
        let kids: Vec<NodeId> = children.iter().map(|c| t.node(*c)).collect::<R<_>>()?;
        t.tree.set_children(p, &kids).map_err(terr)
    })
}

pub fn taffy_remove_child(h: u32, parent: u32, child: u32) -> R<()> {
    tree(h, |t| {
        let (p, c) = (t.node(parent)?, t.node(child)?);
        t.tree.remove_child(p, c).map(|_| ()).map_err(terr)
    })
}

pub fn taffy_remove_child_at_index(h: u32, parent: u32, index: u32) -> R<u32> {
    tree(h, |t| {
        let p = t.node(parent)?;
        let c = t.tree.remove_child_at_index(p, index as usize).map_err(terr)?;
        Ok(t.id_of(c))
    })
}

pub fn taffy_replace_child_at_index(h: u32, parent: u32, index: u32, child: u32) -> R<u32> {
    tree(h, |t| {
        let (p, c) = (t.node(parent)?, t.node(child)?);
        let old = t.tree.replace_child_at_index(p, index as usize, c).map_err(terr)?;
        Ok(t.id_of(old))
    })
}

pub fn taffy_children(h: u32, parent: u32) -> R<Vec<u32>> {
    tree(h, |t| {
        let p = t.node(parent)?;
        Ok(t.tree.children(p).map_err(terr)?.into_iter().map(|c| t.id_of(c)).collect())
    })
}

pub fn taffy_child_count(h: u32, parent: u32) -> R<u32> {
    tree(h, |t| {
        let p = t.node(parent)?;
        Ok(t.tree.child_count(p) as u32)
    })
}

/// Parent id, or 0.
pub fn taffy_parent(h: u32, child: u32) -> R<u32> {
    tree(h, |t| {
        let c = t.node(child)?;
        Ok(t.tree.parent(c).map(|p| t.id_of(p)).unwrap_or(0))
    })
}

/// Removes a node (not its descendants).
pub fn taffy_remove(h: u32, node: u32) -> R<()> {
    tree(h, |t| {
        let n = t.node(node)?;
        t.tree.remove(n).map_err(terr)?;
        t.release(node);
        Ok(())
    })
}

pub fn taffy_clear(h: u32) -> R<()> {
    tree(h, |t| {
        t.tree.clear();
        t.ids = vec![None];
        t.rev.clear();
        t.free.clear();
        Ok(())
    })
}

pub fn taffy_set_style(h: u32, node: u32, style: &str) -> R<()> {
    let s = parse_style(style)?;
    tree(h, |t| {
        let n = t.node(node)?;
        t.tree.set_style(n, s).map_err(terr)
    })
}

pub fn taffy_mark_dirty(h: u32, node: u32) -> R<()> {
    tree(h, |t| {
        let n = t.node(node)?;
        t.tree.mark_dirty(n).map_err(terr)
    })
}

pub fn taffy_dirty(h: u32, node: u32) -> R<bool> {
    tree(h, |t| {
        let n = t.node(node)?;
        t.tree.dirty(n).map_err(terr)
    })
}

/// Available space: a number, or -1 = min-content, -2 = max-content. Leaves with JS contexts measure as 0x0;
/// use the measure variant to measure them.
pub fn taffy_compute_layout(h: u32, node: u32, avail_w: f32, avail_h: f32) -> R<()> {
    compute_layout_impl(h, node, avail_w, avail_h, None)
}

/// `[order, x, y, width, height, contentWidth, contentHeight, scrollbarWidth, scrollbarHeight,
///   borderL, borderR, borderT, borderB, paddingL, paddingR, paddingT, paddingB, marginL, marginR, marginT, marginB]`.
pub fn taffy_layout(h: u32, node: u32) -> R<Vec<f32>> {
    tree(h, |t| {
        let n = t.node(node)?;
        let l = t.tree.layout(n).map_err(terr)?;
        let (x, y) = (l.location.x, l.location.y);
        Ok(vec![
            l.order as f32,
            x,
            y,
            l.size.width,
            l.size.height,
            l.scrollable_overflow_rect.right,
            l.scrollable_overflow_rect.bottom,
            l.scrollbar_size.width,
            l.scrollbar_size.height,
            l.border.left,
            l.border.right,
            l.border.top,
            l.border.bottom,
            l.padding.left,
            l.padding.right,
            l.padding.top,
            l.padding.bottom,
            l.margin.left,
            l.margin.right,
            l.margin.top,
            l.margin.bottom,
        ])
    })
}

/// Layouts of every node in the subtree, depth-first: `[id, x, y, width, height]` per node, with x and y
/// relative to the root's parent. One call instead of one per node.
pub fn taffy_layout_tree(h: u32, root: u32) -> R<Vec<f32>> {
    tree(h, |t| {
        let mut out = vec![];
        let r = t.node(root)?;
        fn walk(t: &TreeObj, n: NodeId, ox: f32, oy: f32, out: &mut Vec<f32>) -> R<()> {
            let l = t.tree.layout(n).map_err(terr)?;
            let (lx, ly) = (l.location.x, l.location.y);
            let (x, y) = (ox + lx, oy + ly);
            out.extend_from_slice(&[t.id_of(n) as f32, x, y, l.size.width, l.size.height]);
            for c in t.tree.children(n).map_err(terr)? {
                walk(t, c, x, y, out)?;
            }
            Ok(())
        }
        walk(t, r, 0.0, 0.0, &mut out)?;
        Ok(out)
    })
}

pub fn taffy_print_tree(h: u32, node: u32) -> R<String> {
    tree(h, |t| {
        let n = t.node(node)?;
        // Taffy's print_tree writes to stdout, so build the text here.
        let mut s = String::new();
        fn walk(t: &TreeObj, n: NodeId, depth: usize, s: &mut String) {
            let l = t.tree.layout(n).unwrap();
            let (x, y) = (l.location.x, l.location.y);
            s.push_str(&format!(
                "{}#{} [x: {} y: {} w: {} h: {}]\n",
                "  ".repeat(depth),
                t.id_of(n),
                x,
                y,
                l.size.width,
                l.size.height
            ));
            for c in t.tree.children(n).unwrap_or_default() {
                walk(t, c, depth + 1, s);
            }
        }
        walk(t, n, 0, &mut s);
        Ok(s)
    })
}

fn avail(v: f32) -> AvailableSpace {
    if v == -1.0 {
        AvailableSpace::MinContent
    } else if v == -2.0 || v.is_infinite() {
        AvailableSpace::MaxContent
    } else {
        AvailableSpace::Definite(v)
    }
}

fn avail_code(a: AvailableSpace) -> f32 {
    match a {
        AvailableSpace::Definite(v) => v,
        AvailableSpace::MinContent => -1.0,
        AvailableSpace::MaxContent => -2.0,
    }
}

pub fn measure_paragraph(ph: u32, known: Size<Option<f32>>, available: Size<AvailableSpace>) -> Size<f32> {
    let Ok(p) = get::<ParagraphObj>(ph) else { return Size::ZERO };
    let mut p = p.borrow_mut();
    // Ensure intrinsic widths are computed.
    if p.last_width.is_nan() {
        p.paragraph.layout(f32::INFINITY);
        p.last_width = f32::INFINITY;
    }
    let max_i = p.paragraph.max_intrinsic_width();
    let min_i = p.paragraph.min_intrinsic_width();
    let width = known.width.unwrap_or_else(|| match available.width {
        AvailableSpace::MinContent => min_i,
        AvailableSpace::MaxContent => max_i,
        AvailableSpace::Definite(w) => max_i.min(w).max(min_i.min(w)),
    });
    let w = width.ceil();
    if p.last_width != w {
        p.paragraph.layout(w);
        p.last_width = w;
    }
    Size { width: w, height: known.height.unwrap_or(p.paragraph.height()) }
}

pub(crate) fn compute_layout_impl(h: u32, node: u32, aw: f32, ah: f32, mut cb: Option<&mut MeasureCallback>) -> R<()> {
    let t = get::<TreeObj>(h)?;
    let mut t = t.borrow_mut();
    let root = t.node(node)?;
    let space = Size { width: avail(aw), height: avail(ah) };
    run_layout(&mut t, root, space, &mut cb)?;

    Ok(())
}

fn run_layout(
    t: &mut TreeObj,
    root: NodeId,
    space: Size<AvailableSpace>,
    cb: &mut Option<&mut MeasureCallback>,
) -> R<()> {
    let rev = t.rev.clone();
    t.tree
        .compute_layout_with_measure(root, space, |inputs, nid, ctx, style| {
            let ctx = ctx.map(|c| *c);
            taffy::compute_leaf_layout(
                inputs,
                style,
                |_, _| 0.0,
                |known, available| match ctx {
                    Some(NodeCtx::Paragraph(ph)) => measure_paragraph(ph, known, available),
                    Some(NodeCtx::Intrinsic(w, hh)) => match (known.width, known.height) {
                        (Some(kw), Some(kh)) => Size { width: kw, height: kh },
                        (Some(kw), None) if w > 0.0 => Size { width: kw, height: kw * hh / w },
                        (None, Some(kh)) if hh > 0.0 => Size { width: kh * w / hh, height: kh },
                        _ => Size { width: w, height: hh },
                    },
                    Some(NodeCtx::Js) => match cb.as_mut() {
                        Some(f) => {
                            let id = rev.get(&nid).copied().unwrap_or(0);
                            let (w, hh) = f(
                                id,
                                known.width.unwrap_or(f32::NAN),
                                known.height.unwrap_or(f32::NAN),
                                avail_code(available.width),
                                avail_code(available.height),
                            );
                            Size { width: w, height: hh }
                        }
                        None => Size::ZERO,
                    },
                    None => Size::ZERO,
                },
            )
        })
        .map_err(terr)
}

// ---------------------------------------------------------------------------------------------------------------
// Style parsing
// ---------------------------------------------------------------------------------------------------------------

/// Taffy's default is CSS `position: static`; Skiamovin (like Yoga/React Native) makes every node `relative`,
/// so each box is the containing block for its absolutely positioned children.
fn base_style() -> Style {
    Style { position: Position::Relative, ..Style::default() }
}

fn parse_style(json: &str) -> R<Style> {
    if json.is_empty() {
        return Ok(base_style());
    }
    let v: Value = serde_json::from_str(json).map_err(|e| format!("invalid style JSON: {e}"))?;
    let obj = v.as_object().ok_or("style must be an object")?;
    let mut s = base_style();
    for (k, v) in obj {
        if v.is_null() {
            continue;
        }
        apply(&mut s, k, v).map_err(|e| format!("style.{k}: {e}"))?;
    }
    Ok(s)
}

fn apply(s: &mut Style, k: &str, v: &Value) -> R<()> {
    match k {
        "display" => {
            s.display = match str_of(v)? {
                "flex" => Display::Flex,
                "grid" => Display::Grid,
                "block" => Display::Block,
                "none" => Display::None,
                o => return Err(format!("unknown display '{o}'")),
            }
        }
        "boxSizing" => {
            s.box_sizing = match str_of(v)? {
                "content-box" => BoxSizing::ContentBox,
                _ => BoxSizing::BorderBox,
            }
        }
        "position" => {
            s.position = match str_of(v)? {
                "absolute" => Position::Absolute,
                "static" => Position::Static,
                "fixed" => Position::Fixed,
                _ => Position::Relative,
            }
        }
        "inset" => s.inset = rect_lpa(v)?,
        "size" => s.size = size_dim(v)?,
        "minSize" => s.min_size = size_lpa(v)?,
        "maxSize" => s.max_size = size_lpa(v)?,
        "aspectRatio" => s.aspect_ratio = v.as_f64().map(|f| f as f32),
        // Unspecified sides of an object margin are 0 (as in CSS); unspecified insets stay `auto`.
        "margin" => s.margin = rect_of(v, lpa, LengthPercentageAuto::length(0.0))?,
        "padding" => s.padding = rect_lp(v)?,
        "border" => s.border = rect_lp(v)?,
        "overflow" => {
            let parse = |x: &Value| -> R<Overflow> {
                Ok(match str_of(x)? {
                    "clip" => Overflow::Clip,
                    "hidden" => Overflow::Hidden,
                    "scroll" => Overflow::Scroll,
                    _ => Overflow::Visible,
                })
            };
            s.overflow = if let Some(o) = v.as_object() {
                TPoint {
                    x: o.get("x").map(parse).transpose()?.unwrap_or(Overflow::Visible),
                    y: o.get("y").map(parse).transpose()?.unwrap_or(Overflow::Visible),
                }
            } else {
                let o = parse(v)?;
                TPoint { x: o, y: o }
            }
        }
        "scrollbarWidth" => s.scrollbar_width = num(v)?,
        "alignItems" => s.align_items = align_items(str_of(v)?)?,
        "alignSelf" => s.align_self = Some(align_items(str_of(v)?)?),
        "justifyItems" => s.justify_items = align_items(str_of(v)?)?,
        "justifySelf" => s.justify_self = Some(align_items(str_of(v)?)?),
        "alignContent" => s.align_content = align_content(str_of(v)?)?,
        "justifyContent" => s.justify_content = align_content(str_of(v)?)?,
        "gap" => s.gap = size_lp(v)?,
        "rowGap" => s.gap.height = lp(v)?,
        "columnGap" => s.gap.width = lp(v)?,
        "flexDirection" => {
            s.flex_direction = match str_of(v)? {
                "column" => FlexDirection::Column,
                "row-reverse" => FlexDirection::RowReverse,
                "column-reverse" => FlexDirection::ColumnReverse,
                _ => FlexDirection::Row,
            }
        }
        "flexWrap" => {
            s.flex_wrap = match str_of(v)? {
                "wrap" => FlexWrap::Wrap,
                "wrap-reverse" => FlexWrap::WrapReverse,
                _ => FlexWrap::NoWrap,
            }
        }
        "flexBasis" => s.flex_basis = dim(v)?,
        "flexGrow" => s.flex_grow = num(v)?,
        "flexShrink" => s.flex_shrink = num(v)?,
        "gridTemplateColumns" => s.grid_template_columns = track_list(v)?,
        "gridTemplateRows" => s.grid_template_rows = track_list(v)?,
        "gridAutoColumns" => s.grid_auto_columns = auto_tracks(v)?,
        "gridAutoRows" => s.grid_auto_rows = auto_tracks(v)?,
        "gridAutoFlow" => {
            s.grid_auto_flow = match str_of(v)? {
                "column" => GridAutoFlow::Column,
                "row dense" | "dense" => GridAutoFlow::RowDense,
                "column dense" => GridAutoFlow::ColumnDense,
                _ => GridAutoFlow::Row,
            }
        }
        "gridRow" => s.grid_row = grid_line(v)?,
        "gridColumn" => s.grid_column = grid_line(v)?,
        "gridTemplateAreas" => s.grid_template_areas = Some(template_areas(v)?),
        "gridArea" => {
            let name = str_of(v)?.to_string();
            s.grid_row = Line {
                start: GridPlacement::NamedLine(format!("{name}-start"), 0),
                end: GridPlacement::NamedLine(format!("{name}-end"), 0),
            };
            s.grid_column = Line {
                start: GridPlacement::NamedLine(format!("{name}-start"), 0),
                end: GridPlacement::NamedLine(format!("{name}-end"), 0),
            };
        }
        "textAlign" => {
            s.text_align = match str_of(v)? {
                "legacy-left" => taffy::TextAlign::LegacyLeft,
                "legacy-right" => taffy::TextAlign::LegacyRight,
                "legacy-center" => taffy::TextAlign::LegacyCenter,
                _ => taffy::TextAlign::Auto,
            }
        }
        // Unknown keys are ignored so the scene layer can pass visual props in the same object.
        _ => {}
    }
    Ok(())
}

fn str_of(v: &Value) -> R<&str> {
    v.as_str().ok_or_else(|| format!("expected a string, got {v}"))
}

fn num(v: &Value) -> R<f32> {
    if let Some(f) = v.as_f64() {
        return Ok(f as f32);
    }
    let s = str_of(v)?;
    s.trim_end_matches("px").trim().parse::<f32>().map_err(|_| format!("expected a number, got '{s}'"))
}

enum Unit {
    Px(f32),
    Pct(f32),
    Auto,
    Kw(&'static str),
}

fn unit(v: &Value) -> R<Unit> {
    if let Some(f) = v.as_f64() {
        return Ok(Unit::Px(f as f32));
    }
    let s = str_of(v)?.trim();
    Ok(match s {
        "auto" => Unit::Auto,
        "min-content" => Unit::Kw("min-content"),
        "max-content" => Unit::Kw("max-content"),
        "fit-content" => Unit::Kw("fit-content"),
        "stretch" => Unit::Kw("stretch"),
        _ if s.ends_with('%') => {
            Unit::Pct(s[..s.len() - 1].trim().parse::<f32>().map_err(|_| format!("bad percentage '{s}'"))? / 100.0)
        }
        _ => Unit::Px(
            s.trim_end_matches("px")
                .trim()
                .parse::<f32>()
                .map_err(|_| format!("bad length '{s}' (calc() is not supported)"))?,
        ),
    })
}

fn dim(v: &Value) -> R<Dimension> {
    Ok(match unit(v)? {
        Unit::Px(p) => Dimension::length(p),
        Unit::Pct(p) => Dimension::percent(p),
        Unit::Auto => Dimension::auto(),
        Unit::Kw("min-content") => Dimension::min_content(),
        Unit::Kw("max-content") => Dimension::max_content(),
        Unit::Kw("fit-content") => Dimension::fit_content(),
        Unit::Kw(_) => Dimension::stretch(),
    })
}

fn lp(v: &Value) -> R<LengthPercentage> {
    Ok(match unit(v)? {
        Unit::Px(p) => LengthPercentage::length(p),
        Unit::Pct(p) => LengthPercentage::percent(p),
        _ => return Err("expected a length or percentage".into()),
    })
}

fn lpa(v: &Value) -> R<LengthPercentageAuto> {
    Ok(match unit(v)? {
        Unit::Px(p) => LengthPercentageAuto::length(p),
        Unit::Pct(p) => LengthPercentageAuto::percent(p),
        Unit::Auto => LengthPercentageAuto::auto(),
        Unit::Kw(k) => return Err(format!("'{k}' is not allowed here")),
    })
}

fn size_of<T: Clone>(v: &Value, f: impl Fn(&Value) -> R<T>, default: T) -> R<Size<T>> {
    if let Some(o) = v.as_object() {
        Ok(Size {
            width: o.get("width").filter(|x| !x.is_null()).map(&f).transpose()?.unwrap_or(default.clone()),
            height: o.get("height").filter(|x| !x.is_null()).map(&f).transpose()?.unwrap_or(default),
        })
    } else {
        let x = f(v)?;
        Ok(Size { width: x.clone(), height: x })
    }
}

fn size_dim(v: &Value) -> R<Size<Dimension>> {
    size_of(v, dim, Dimension::auto())
}
fn size_lpa(v: &Value) -> R<Size<LengthPercentageAuto>> {
    size_of(v, lpa, LengthPercentageAuto::auto())
}
fn size_lp(v: &Value) -> R<Size<LengthPercentage>> {
    size_of(v, lp, LengthPercentage::length(0.0))
}

/// Accepts a single value, `{left,right,top,bottom}`, or a CSS-style array `[all]`, `[v, h]`, `[t, r, b, l]`.
fn rect_of<T: Clone>(v: &Value, f: impl Fn(&Value) -> R<T>, default: T) -> R<taffy::Rect<T>> {
    if let Some(o) = v.as_object() {
        let g = |k: &str| -> R<T> {
            o.get(k).filter(|x| !x.is_null()).map(&f).transpose().map(|x| x.unwrap_or(default.clone()))
        };
        return Ok(taffy::Rect { left: g("left")?, right: g("right")?, top: g("top")?, bottom: g("bottom")? });
    }
    if let Some(a) = v.as_array() {
        let p: Vec<T> = a.iter().map(&f).collect::<R<_>>()?;
        return Ok(match p.len() {
            1 => taffy::Rect { left: p[0].clone(), right: p[0].clone(), top: p[0].clone(), bottom: p[0].clone() },
            2 => taffy::Rect { top: p[0].clone(), bottom: p[0].clone(), left: p[1].clone(), right: p[1].clone() },
            3 => taffy::Rect { top: p[0].clone(), left: p[1].clone(), right: p[1].clone(), bottom: p[2].clone() },
            4 => taffy::Rect { top: p[0].clone(), right: p[1].clone(), bottom: p[2].clone(), left: p[3].clone() },
            n => return Err(format!("expected 1-4 values, got {n}")),
        });
    }
    let x = f(v)?;
    Ok(taffy::Rect { left: x.clone(), right: x.clone(), top: x.clone(), bottom: x })
}

fn rect_lpa(v: &Value) -> R<taffy::Rect<LengthPercentageAuto>> {
    rect_of(v, lpa, LengthPercentageAuto::auto())
}
fn rect_lp(v: &Value) -> R<taffy::Rect<LengthPercentage>> {
    rect_of(v, lp, LengthPercentage::length(0.0))
}

fn align_items(s: &str) -> R<AlignItems> {
    Ok(match s {
        "start" => AlignItems::START,
        "end" => AlignItems::END,
        "flex-start" => AlignItems::FLEX_START,
        "flex-end" => AlignItems::FLEX_END,
        "center" => AlignItems::CENTER,
        "baseline" => AlignItems::BASELINE,
        "stretch" => AlignItems::STRETCH,
        o => return Err(format!("unknown alignment '{o}'")),
    })
}

fn align_content(s: &str) -> R<AlignContent> {
    Ok(match s {
        "start" => AlignContent::START,
        "end" => AlignContent::END,
        "flex-start" => AlignContent::FLEX_START,
        "flex-end" => AlignContent::FLEX_END,
        "center" => AlignContent::CENTER,
        "stretch" => AlignContent::STRETCH,
        "space-between" => AlignContent::SPACE_BETWEEN,
        "space-evenly" => AlignContent::SPACE_EVENLY,
        "space-around" => AlignContent::SPACE_AROUND,
        o => return Err(format!("unknown alignment '{o}'")),
    })
}

// ---- grid ----

/// Splits on whitespace at paren depth 0.
fn split_top(s: &str, sep: char) -> Vec<String> {
    let mut out = vec![];
    let mut depth = 0;
    let mut cur = String::new();
    for ch in s.chars() {
        match ch {
            '(' => {
                depth += 1;
                cur.push(ch)
            }
            ')' => {
                depth -= 1;
                cur.push(ch)
            }
            c if depth == 0 && (c == sep || (sep == ' ' && c.is_whitespace())) => {
                if !cur.trim().is_empty() {
                    out.push(cur.trim().to_string());
                }
                cur.clear();
            }
            c => cur.push(c),
        }
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    out
}

fn min_track(s: &str) -> R<MinTrackSizingFunction> {
    Ok(match s {
        "auto" => MinTrackSizingFunction::auto(),
        "min-content" => MinTrackSizingFunction::min_content(),
        "max-content" => MinTrackSizingFunction::max_content(),
        _ if s.ends_with('%') => MinTrackSizingFunction::percent(pct(s)?),
        _ => MinTrackSizingFunction::length(px(s)?),
    })
}

fn max_track(s: &str) -> R<MaxTrackSizingFunction> {
    Ok(match s {
        "auto" => MaxTrackSizingFunction::auto(),
        "min-content" => MaxTrackSizingFunction::min_content(),
        "max-content" => MaxTrackSizingFunction::max_content(),
        _ if s.ends_with("fr") => {
            MaxTrackSizingFunction::fr(s[..s.len() - 2].trim().parse::<f32>().map_err(|_| format!("bad fr '{s}'"))?)
        }
        _ if s.ends_with('%') => MaxTrackSizingFunction::percent(pct(s)?),
        _ => MaxTrackSizingFunction::length(px(s)?),
    })
}

fn pct(s: &str) -> R<f32> {
    Ok(s[..s.len() - 1].trim().parse::<f32>().map_err(|_| format!("bad percentage '{s}'"))? / 100.0)
}
fn px(s: &str) -> R<f32> {
    s.trim_end_matches("px").trim().parse::<f32>().map_err(|_| format!("bad track size '{s}'"))
}

fn track(s: &str) -> R<TrackSizingFunction> {
    let s = s.trim();
    if let Some(inner) = s.strip_prefix("minmax(").and_then(|r| r.strip_suffix(')')) {
        let parts = split_top(inner, ',');
        if parts.len() != 2 {
            return Err(format!("bad minmax '{s}'"));
        }
        return Ok(MinMax { min: min_track(&parts[0])?, max: max_track(&parts[1])? });
    }
    if let Some(inner) = s.strip_prefix("fit-content(").and_then(|r| r.strip_suffix(')')) {
        let a = if inner.trim().ends_with('%') {
            LengthPercentage::percent(pct(inner.trim())?)
        } else {
            LengthPercentage::length(px(inner)?)
        };
        return Ok(taffy::style_helpers::fit_content(a));
    }
    if let Some(n) = s.strip_suffix("fr") {
        let f = n.trim().parse::<f32>().map_err(|_| format!("bad fr '{s}'"))?;
        return Ok(MinMax { min: MinTrackSizingFunction::auto(), max: MaxTrackSizingFunction::fr(f) });
    }
    let max = max_track(s)?;
    let min = min_track(s)?;
    Ok(MinMax { min, max })
}

fn track_value(v: &Value) -> R<Vec<String>> {
    if let Some(f) = v.as_f64() {
        return Ok(vec![format!("{f}px")]);
    }
    Ok(split_top(str_of(v)?, ' '))
}

fn track_list(v: &Value) -> R<Vec<GridTemplateComponent<String>>> {
    let items: Vec<Value> = match v {
        Value::Array(a) => a.clone(),
        other => vec![other.clone()],
    };
    let mut out = vec![];
    for item in &items {
        for tok in track_value(item)? {
            if let Some(inner) = tok.strip_prefix("repeat(").and_then(|r| r.strip_suffix(')')) {
                let parts = split_top(inner, ',');
                if parts.len() != 2 {
                    return Err(format!("bad repeat '{tok}'"));
                }
                let count = match parts[0].as_str() {
                    "auto-fill" => RepetitionCount::AutoFill,
                    "auto-fit" => RepetitionCount::AutoFit,
                    n => RepetitionCount::Count(n.parse::<u16>().map_err(|_| format!("bad repeat count '{n}'"))?),
                };
                let tracks: Vec<TrackSizingFunction> =
                    split_top(&parts[1], ' ').iter().map(|t| track(t)).collect::<R<_>>()?;
                out.push(GridTemplateComponent::Repeat(GridTemplateRepetition { count, tracks, line_names: vec![] }));
            } else {
                out.push(GridTemplateComponent::Single(track(&tok)?));
            }
        }
    }
    Ok(out)
}

fn auto_tracks(v: &Value) -> R<Vec<TrackSizingFunction>> {
    let items: Vec<Value> = match v {
        Value::Array(a) => a.clone(),
        other => vec![other.clone()],
    };
    let mut out = vec![];
    for item in &items {
        for tok in track_value(item)? {
            out.push(track(&tok)?);
        }
    }
    Ok(out)
}

fn placement(s: &str) -> R<GridPlacement<String>> {
    let s = s.trim();
    if s == "auto" {
        return Ok(GridPlacement::Auto);
    }
    if let Some(n) = s.strip_prefix("span") {
        let n = n.trim();
        if let Ok(k) = n.parse::<u16>() {
            return Ok(GridPlacement::Span(k));
        }
        return Ok(GridPlacement::NamedSpan(n.to_string(), 1));
    }
    if let Ok(i) = s.parse::<i16>() {
        return Ok(GridPlacement::Line(i.into()));
    }
    Ok(GridPlacement::NamedLine(s.to_string(), 0))
}

fn placement_v(v: &Value) -> R<GridPlacement<String>> {
    if let Some(i) = v.as_i64() {
        return Ok(GridPlacement::Line((i as i16).into()));
    }
    placement(str_of(v)?)
}

fn grid_line(v: &Value) -> R<Line<GridPlacement<String>>> {
    if let Some(o) = v.as_object() {
        return Ok(Line {
            start: o.get("start").map(placement_v).transpose()?.unwrap_or(GridPlacement::Auto),
            end: o.get("end").map(placement_v).transpose()?.unwrap_or(GridPlacement::Auto),
        });
    }
    if let Some(i) = v.as_i64() {
        return Ok(Line { start: GridPlacement::Line((i as i16).into()), end: GridPlacement::Auto });
    }
    let s = str_of(v)?;
    let parts: Vec<&str> = s.split('/').collect();
    Ok(match parts.len() {
        1 => Line { start: placement(parts[0])?, end: GridPlacement::Auto },
        _ => Line { start: placement(parts[0])?, end: placement(parts[1])? },
    })
}

fn template_areas(v: &Value) -> R<GridTemplateAreas<String>> {
    let rows: Vec<Vec<String>> = v
        .as_array()
        .ok_or("expected an array of row strings")?
        .iter()
        .map(|r| str_of(r).map(|s| s.split_whitespace().map(String::from).collect()))
        .collect::<R<_>>()?;
    let row_count = rows.len() as u16;
    let column_count = rows.first().map(|r| r.len()).unwrap_or(0) as u16;
    let mut names: Vec<String> = vec![];
    for r in &rows {
        for n in r {
            if n != "." && !names.contains(n) {
                names.push(n.clone());
            }
        }
    }
    let mut areas = vec![];
    for name in names {
        let (mut rs, mut re, mut cs, mut ce) = (u16::MAX, 0u16, u16::MAX, 0u16);
        for (ri, r) in rows.iter().enumerate() {
            for (ci, n) in r.iter().enumerate() {
                if *n == name {
                    rs = rs.min(ri as u16 + 1);
                    re = re.max(ri as u16 + 2);
                    cs = cs.min(ci as u16 + 1);
                    ce = ce.max(ci as u16 + 2);
                }
            }
        }
        areas.push(GridTemplateArea { name, row_start: rs, row_end: re, column_start: cs, column_end: ce });
    }
    Ok(GridTemplateAreas { areas, row_count, column_count })
}
