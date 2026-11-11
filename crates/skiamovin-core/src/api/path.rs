use crate::convert::{matrix, points, rect, rrect};
use crate::handles::{get, put};
use crate::R;
use skia_safe::{
    path_builder::ArcSize, ContourMeasure, ContourMeasureIter, Path, PathBuilder, PathDirection, PathFillType, PathOp,
};

/// JS paths are mutable builders; drawing snapshots them.
pub struct PathObj {
    pub builder: PathBuilder,
}

pub fn path_of(h: u32) -> R<Path> {
    Ok(get::<PathObj>(h)?.borrow().builder.snapshot())
}

fn with<T>(h: u32, f: impl FnOnce(&mut PathBuilder) -> T) -> R<T> {
    let p = get::<PathObj>(h)?;
    let mut p = p.borrow_mut();
    Ok(f(&mut p.builder))
}

fn wrap(path: Path) -> u32 {
    put(PathObj { builder: PathBuilder::new_path(&path) })
}

fn dir(ccw: bool) -> PathDirection {
    if ccw {
        PathDirection::CCW
    } else {
        PathDirection::CW
    }
}

pub fn path_new() -> u32 {
    put(PathObj { builder: PathBuilder::new() })
}

pub fn path_copy(h: u32) -> R<u32> {
    Ok(wrap(path_of(h)?))
}

pub fn path_from_svg(d: &str) -> R<u32> {
    let p = Path::from_svg(d).ok_or("invalid SVG path data")?;
    Ok(wrap(p))
}

pub fn path_to_svg(h: u32) -> R<String> {
    Ok(path_of(h)?.to_svg())
}

pub fn path_reset(h: u32) -> R<()> {
    with(h, |b| {
        b.reset();
    })
}

pub fn path_move_to(h: u32, x: f32, y: f32) -> R<()> {
    with(h, |b| {
        b.move_to((x, y));
    })
}

pub fn path_line_to(h: u32, x: f32, y: f32) -> R<()> {
    with(h, |b| {
        b.line_to((x, y));
    })
}

pub fn path_quad_to(h: u32, x1: f32, y1: f32, x2: f32, y2: f32) -> R<()> {
    with(h, |b| {
        b.quad_to((x1, y1), (x2, y2));
    })
}

pub fn path_conic_to(h: u32, x1: f32, y1: f32, x2: f32, y2: f32, w: f32) -> R<()> {
    with(h, |b| {
        b.conic_to((x1, y1), (x2, y2), w);
    })
}

pub fn path_cubic_to(h: u32, x1: f32, y1: f32, x2: f32, y2: f32, x3: f32, y3: f32) -> R<()> {
    with(h, |b| {
        b.cubic_to((x1, y1), (x2, y2), (x3, y3));
    })
}

pub fn path_r_move_to(h: u32, dx: f32, dy: f32) -> R<()> {
    with(h, |b| {
        b.r_move_to((dx, dy));
    })
}

pub fn path_r_line_to(h: u32, dx: f32, dy: f32) -> R<()> {
    with(h, |b| {
        b.r_line_to((dx, dy));
    })
}

/// Arc inside `oval`, appended (connected with a line unless `force_move_to`).
pub fn path_arc_to_oval(h: u32, l: f32, t: f32, r: f32, b: f32, start: f32, sweep: f32, force_move_to: bool) -> R<()> {
    with(h, |pb| {
        pb.arc_to(rect(l, t, r, b), start, sweep, force_move_to);
    })
}

/// Tangent arc (like canvas 2D `arcTo`).
pub fn path_arc_to_tangent(h: u32, x1: f32, y1: f32, x2: f32, y2: f32, radius: f32) -> R<()> {
    with(h, |pb| {
        pb.arc_to_tangent((x1, y1), (x2, y2), radius);
    })
}

/// SVG-style elliptical arc.
pub fn path_arc_to_radius(h: u32, rx: f32, ry: f32, x_rotation: f32, large: bool, ccw: bool, x: f32, y: f32) -> R<()> {
    with(h, |pb| {
        pb.arc_to_radius((rx, ry), x_rotation, if large { ArcSize::Large } else { ArcSize::Small }, dir(ccw), (x, y));
    })
}

pub fn path_close(h: u32) -> R<()> {
    with(h, |b| {
        b.close();
    })
}

pub fn path_add_rect(h: u32, l: f32, t: f32, r: f32, b: f32, ccw: bool) -> R<()> {
    with(h, |pb| {
        pb.add_rect(rect(l, t, r, b), dir(ccw), None);
    })
}

pub fn path_add_rrect(h: u32, rr: &[f32], ccw: bool) -> R<()> {
    let rr = rrect(rr)?;
    with(h, |pb| {
        pb.add_rrect(rr, dir(ccw), None);
    })
}

pub fn path_add_oval(h: u32, l: f32, t: f32, r: f32, b: f32, ccw: bool) -> R<()> {
    with(h, |pb| {
        pb.add_oval(rect(l, t, r, b), dir(ccw), None);
    })
}

pub fn path_add_circle(h: u32, cx: f32, cy: f32, radius: f32, ccw: bool) -> R<()> {
    with(h, |pb| {
        pb.add_circle((cx, cy), radius, dir(ccw));
    })
}

pub fn path_add_arc(h: u32, l: f32, t: f32, r: f32, b: f32, start: f32, sweep: f32) -> R<()> {
    with(h, |pb| {
        pb.add_arc(rect(l, t, r, b), start, sweep);
    })
}

pub fn path_add_poly(h: u32, pts: &[f32], close: bool) -> R<()> {
    let pts = points(pts);
    with(h, |pb| {
        pb.add_polygon(&pts, close);
    })
}

/// Appends `other`, transformed by `m` ([] = identity).
pub fn path_add_path(h: u32, other: u32, m: &[f32]) -> R<()> {
    let o = path_of(other)?;
    let m = matrix(m)?;
    with(h, |pb| {
        pb.add_path_with_transform(&o, &m, None);
    })
}

/// 0 winding, 1 even-odd, 2 inverse winding, 3 inverse even-odd.
pub fn path_set_fill_type(h: u32, ft: u32) -> R<()> {
    with(h, |pb| {
        pb.set_fill_type(match ft {
            1 => PathFillType::EvenOdd,
            2 => PathFillType::InverseWinding,
            3 => PathFillType::InverseEvenOdd,
            _ => PathFillType::Winding,
        });
    })
}

pub fn path_transform(h: u32, m: &[f32]) -> R<()> {
    let m = matrix(m)?;
    with(h, |pb| {
        pb.transform(&m);
    })
}

pub fn path_offset(h: u32, dx: f32, dy: f32) -> R<()> {
    with(h, |pb| {
        pb.offset((dx, dy));
    })
}

/// `[l, t, r, b]`.
pub fn path_bounds(h: u32) -> R<Vec<f32>> {
    let b = *path_of(h)?.bounds();
    Ok(vec![b.left, b.top, b.right, b.bottom])
}

pub fn path_tight_bounds(h: u32) -> R<Vec<f32>> {
    let b = path_of(h)?.compute_tight_bounds();
    Ok(vec![b.left, b.top, b.right, b.bottom])
}

pub fn path_contains(h: u32, x: f32, y: f32) -> R<bool> {
    Ok(path_of(h)?.contains((x, y)))
}

pub fn path_is_empty(h: u32) -> R<bool> {
    with(h, |pb| pb.is_empty())
}

pub fn path_count_points(h: u32) -> R<u32> {
    with(h, |pb| pb.count_points() as u32)
}

/// `[x, y, ...]`.
pub fn path_points(h: u32) -> R<Vec<f32>> {
    with(h, |pb| pb.points().iter().flat_map(|p| [p.x, p.y]).collect())
}

/// Verb codes (0 move, 1 line, 2 quad, 3 conic, 4 cubic, 5 close).
pub fn path_verbs(h: u32) -> R<Vec<u32>> {
    with(h, |pb| pb.verbs().iter().map(|v| *v as u32).collect())
}

pub fn path_is_interpolatable(a: u32, b: u32) -> R<bool> {
    Ok(path_of(a)?.is_interpolatable(&path_of(b)?))
}

/// Interpolates between `a` (weight 1) and `b` (weight 0), as in Skia: result = a*weight + b*(1-weight).
pub fn path_interpolate(a: u32, b: u32, weight: f32) -> R<u32> {
    let r = path_of(a)?.interpolate(&path_of(b)?, weight).ok_or("paths are not interpolatable")?;
    Ok(wrap(r))
}

/// Boolean ops: 0 difference, 1 intersect, 2 union, 3 xor, 4 reverse difference.
pub fn path_op(a: u32, b: u32, op: u32) -> R<u32> {
    let op = match op {
        1 => PathOp::Intersect,
        2 => PathOp::Union,
        3 => PathOp::XOR,
        4 => PathOp::ReverseDifference,
        _ => PathOp::Difference,
    };
    let r = skia_safe::op(&path_of(a)?, &path_of(b)?, op).ok_or("path op failed")?;
    Ok(wrap(r))
}

pub fn path_simplify(h: u32) -> R<u32> {
    let r = skia_safe::simplify(&path_of(h)?).ok_or("simplify failed")?;
    Ok(wrap(r))
}

pub fn path_make_transform(h: u32, m: &[f32]) -> R<u32> {
    let m = matrix(m)?;
    Ok(wrap(path_of(h)?.make_transform(&m)))
}

// ---- contour measure ----

pub struct ContourIterObj {
    iter: ContourMeasureIter,
}

pub fn contour_measure_iter_new(path: u32, force_closed: bool, res_scale: f32) -> R<u32> {
    let p = path_of(path)?;
    Ok(put(ContourIterObj { iter: ContourMeasureIter::new(&p, force_closed, res_scale) }))
}

/// Next contour as a handle, or 0 when done.
pub fn contour_measure_iter_next(h: u32) -> R<u32> {
    let it = get::<ContourIterObj>(h)?;
    let next = it.borrow_mut().iter.next();
    Ok(next.map(put).unwrap_or(0))
}

pub fn contour_measure_length(h: u32) -> R<f32> {
    Ok(get::<ContourMeasure>(h)?.borrow().length())
}

pub fn contour_measure_is_closed(h: u32) -> R<bool> {
    Ok(get::<ContourMeasure>(h)?.borrow().is_closed())
}

/// `[x, y, tx, ty]`, or [] if `distance` is invalid.
pub fn contour_measure_pos_tan(h: u32, distance: f32) -> R<Vec<f32>> {
    Ok(match get::<ContourMeasure>(h)?.borrow().pos_tan(distance) {
        Some((p, t)) => vec![p.x, p.y, t.x, t.y],
        None => vec![],
    })
}

pub fn contour_measure_segment(h: u32, start: f32, stop: f32, start_with_move_to: bool) -> R<u32> {
    let m = get::<ContourMeasure>(h)?;
    let mut b = PathBuilder::new();
    let _ = m.borrow().get_segment(start, stop, &mut b, start_with_move_to);
    Ok(put(PathObj { builder: b }))
}
