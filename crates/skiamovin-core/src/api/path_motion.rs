//! Path drawing, motion along paths and morphing between paths.
//!
//! Lengths are measured across all contours of a path as one, so `0.5` is halfway along the whole drawing.

use crate::api::path::{path_of, PathObj};
use crate::handles::{get, put};
use crate::R;
use skia_safe::{path::Verb, ContourMeasureIter, Path, PathBuilder, Point};

fn wrap(path: Path) -> u32 {
    put(PathObj { builder: PathBuilder::new_path(&path) })
}

fn contour_lengths(path: &Path) -> (Vec<skia_safe::ContourMeasure>, f32) {
    let measures: Vec<_> = ContourMeasureIter::new(path, false, None).collect();
    let total = measures.iter().map(|m| m.length()).sum();
    (measures, total)
}

/// The part of the path between `start` and `end` (fractions of its total length). `offset` shifts both and wraps
/// around, so a fixed-length piece can travel along the path.
pub fn path_trim(h: u32, start: f32, end: f32, offset: f32) -> R<u32> {
    let path = path_of(h)?;
    let (measures, total) = contour_lengths(&path);
    let mut out = PathBuilder::new();
    if total <= 0.0 {
        return Ok(wrap(out.detach()));
    }
    let (mut a, mut b) = (start.min(end), start.max(end));
    if offset != 0.0 {
        a += offset;
        b += offset;
        let shift = a.floor();
        a -= shift;
        b -= shift;
    }
    // A range past 1 wraps around to the beginning of the path.
    let mut ranges = vec![(a.clamp(0.0, 1.0) * total, b.min(1.0) * total)];
    if b > 1.0 {
        ranges.push((0.0, (b - 1.0).min(1.0) * total));
    }
    for (from, to) in ranges {
        let mut base = 0.0;
        for m in &measures {
            let len = m.length();
            let (s, e) = ((from - base).max(0.0), (to - base).min(len));
            if e > s {
                let _ = m.get_segment(s, e, &mut out, true);
            }
            base += len;
        }
    }
    Ok(wrap(out.detach()))
}

/// `[x, y, tangentX, tangentY]` at `fraction` of the path's total length, or empty for an empty path.
pub fn path_pos_tan_at(h: u32, fraction: f32) -> R<Vec<f32>> {
    let path = path_of(h)?;
    let (measures, total) = contour_lengths(&path);
    if total <= 0.0 {
        return Ok(vec![]);
    }
    let mut d = fraction.clamp(0.0, 1.0) * total;
    for m in &measures {
        let len = m.length();
        if d <= len || std::ptr::eq(m, measures.last().unwrap()) {
            return Ok(m.pos_tan(d.min(len)).map(|(p, t)| vec![p.x, p.y, t.x, t.y]).unwrap_or_default());
        }
        d -= len;
    }
    Ok(vec![])
}

/// Total length of all contours.
pub fn path_total_length(h: u32) -> R<f32> {
    Ok(contour_lengths(&path_of(h)?).1)
}

// ---- Morphing ----

/// One contour as cubic Béziers: `start` followed by three points per curve.
#[derive(Clone)]
struct Contour {
    start: Point,
    curves: Vec<[Point; 3]>,
    closed: bool,
}

impl Contour {
    fn point_at_start(p: Point) -> Self {
        Contour { start: p, curves: vec![[p, p, p]], closed: false }
    }
    fn anchors(&self) -> impl Iterator<Item = Point> + '_ {
        std::iter::once(self.start).chain(self.curves.iter().map(|c| c[2]))
    }
    fn bounds_size(&self) -> f32 {
        let (mut l, mut t, mut r, mut b) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
        for p in self.anchors() {
            l = l.min(p.x);
            t = t.min(p.y);
            r = r.max(p.x);
            b = b.max(p.y);
        }
        (r - l).max(0.0) * (b - t).max(0.0)
    }
    fn center(&self) -> Point {
        let n = self.curves.len() as f32 + 1.0;
        let sum = self.anchors().fold(Point::new(0.0, 0.0), |a, p| a + p);
        Point::new(sum.x / n, sum.y / n)
    }
    fn curve_length(prev: Point, c: &[Point; 3]) -> f32 {
        // Control polygon length is a cheap, stable stand-in for arc length when choosing what to split.
        (c[0] - prev).length() + (c[1] - c[0]).length() + (c[2] - c[1]).length()
    }
    /// Splits the longest curves at their midpoint until there are `n` curves.
    fn subdivide_to(&mut self, n: usize) {
        while self.curves.len() < n {
            let mut best = 0;
            let mut best_len = -1.0;
            let mut prev = self.start;
            for (i, c) in self.curves.iter().enumerate() {
                let l = Self::curve_length(prev, c);
                if l > best_len {
                    best_len = l;
                    best = i;
                }
                prev = c[2];
            }
            let p0 = if best == 0 { self.start } else { self.curves[best - 1][2] };
            let [p1, p2, p3] = self.curves[best];
            let mid = |a: Point, b: Point| Point::new((a.x + b.x) / 2.0, (a.y + b.y) / 2.0);
            let (a, b, c) = (mid(p0, p1), mid(p1, p2), mid(p2, p3));
            let (d, e) = (mid(a, b), mid(b, c));
            let f = mid(d, e);
            self.curves[best] = [a, d, f];
            self.curves.insert(best + 1, [e, c, p3]);
        }
    }
    /// For a closed contour, starts at curve `k` instead of curve 0.
    fn rotated(&self, k: usize) -> Self {
        let n = self.curves.len();
        let mut curves = Vec::with_capacity(n);
        for i in 0..n {
            curves.push(self.curves[(i + k) % n]);
        }
        let start = if k == 0 { self.start } else { self.curves[k - 1][2] };
        Contour { start, curves, closed: self.closed }
    }
    fn reversed(&self) -> Self {
        let pts: Vec<Point> = self.anchors().collect();
        let n = self.curves.len();
        let mut curves = Vec::with_capacity(n);
        for i in (0..n).rev() {
            let c = self.curves[i];
            curves.push([c[1], c[0], pts[i]]);
        }
        Contour { start: pts[n], curves, closed: self.closed }
    }
}

fn contours_of(path: &Path) -> Vec<Contour> {
    let mut out: Vec<Contour> = vec![];
    let mut iter = skia_safe::path::Iter::new(path, false);
    let mut current: Option<Contour> = None;
    let line = |a: Point, b: Point| [a + (b - a) * (1.0 / 3.0), a + (b - a) * (2.0 / 3.0), b];
    let quad = |a: Point, c: Point, b: Point| [a + (c - a) * (2.0 / 3.0), b + (c - b) * (2.0 / 3.0), b];
    while let Some((verb, pts)) = iter.next() {
        match verb {
            Verb::Move => {
                if let Some(c) = current.take() {
                    if !c.curves.is_empty() {
                        out.push(c);
                    }
                }
                current = Some(Contour { start: pts[0], curves: vec![], closed: false });
            }
            Verb::Line => current
                .get_or_insert(Contour { start: pts[0], curves: vec![], closed: false })
                .curves
                .push(line(pts[0], pts[1])),
            Verb::Quad => current
                .get_or_insert(Contour { start: pts[0], curves: vec![], closed: false })
                .curves
                .push(quad(pts[0], pts[1], pts[2])),
            Verb::Conic => {
                let w = iter.conic_weight().unwrap_or(1.0);
                let mut q = [Point::default(); 1 + 2 * 4];
                let n = Path::convert_conic_to_quads(pts[0], pts[1], pts[2], w, &mut q, 2).unwrap_or(0);
                let c = current.get_or_insert(Contour { start: pts[0], curves: vec![], closed: false });
                for i in 0..n {
                    c.curves.push(quad(q[2 * i], q[2 * i + 1], q[2 * i + 2]));
                }
            }
            Verb::Cubic => current
                .get_or_insert(Contour { start: pts[0], curves: vec![], closed: false })
                .curves
                .push([pts[1], pts[2], pts[3]]),
            Verb::Close => {
                if let Some(c) = current.as_mut() {
                    let last = c.curves.last().map(|k| k[2]).unwrap_or(c.start);
                    if (last - c.start).length() > 1e-4 {
                        c.curves.push(line(last, c.start));
                    }
                    c.closed = true;
                }
            }
            _ => {}
        }
    }
    if let Some(c) = current {
        if !c.curves.is_empty() {
            out.push(c);
        }
    }
    out
}

/// Sum of squared distances between matching anchors.
fn cost(a: &Contour, b: &Contour) -> f32 {
    a.anchors()
        .zip(b.anchors())
        .map(|(p, q)| {
            let d = p - q;
            d.x * d.x + d.y * d.y
        })
        .sum()
}

/// Rotates (and if better, reverses) closed contour `b` so its points line up with `a`'s, to keep the morph from
/// twisting.
fn best_alignment(a: &Contour, b: &Contour) -> Contour {
    if !(a.closed && b.closed) {
        return b.clone();
    }
    let mut best = b.clone();
    let mut best_cost = cost(a, b);
    for candidate in [b.clone(), b.reversed()] {
        for k in 0..candidate.curves.len() {
            let r = candidate.rotated(k);
            let c = cost(a, &r);
            if c < best_cost {
                best_cost = c;
                best = r;
            }
        }
    }
    best
}

pub struct MorphObj {
    pairs: Vec<(Contour, Contour)>,
}

/// Prepares a morph from path `a` to path `b`: pairs up contours by size, gives each pair the same number of curves
/// and lines up their starting points. Do this once; `path_morph_at` is then cheap for every frame.
pub fn path_morph_new(a: u32, b: u32) -> R<u32> {
    let mut ca = contours_of(&path_of(a)?);
    let mut cb = contours_of(&path_of(b)?);
    ca.sort_by(|x, y| y.bounds_size().total_cmp(&x.bounds_size()));
    cb.sort_by(|x, y| y.bounds_size().total_cmp(&x.bounds_size()));
    // A contour with no partner grows from (or shrinks to) a point at its own center.
    while ca.len() < cb.len() {
        ca.push(Contour::point_at_start(cb[ca.len()].center()));
    }
    while cb.len() < ca.len() {
        cb.push(Contour::point_at_start(ca[cb.len()].center()));
    }
    let mut pairs = Vec::with_capacity(ca.len());
    for (mut x, mut y) in ca.into_iter().zip(cb) {
        let n = x.curves.len().max(y.curves.len());
        x.subdivide_to(n);
        y.subdivide_to(n);
        if x.closed && !y.closed && y.curves.len() == 1 {
            y.closed = true;
        }
        if y.closed && !x.closed && x.curves.len() == 1 {
            x.closed = true;
        }
        let y = best_alignment(&x, &y);
        pairs.push((x, y));
    }
    Ok(put(MorphObj { pairs }))
}

/// The morph at `t` (0 = path a, 1 = path b) as a new path.
pub fn path_morph_at(h: u32, t: f32) -> R<u32> {
    let m = get::<MorphObj>(h)?;
    let m = m.borrow();
    let lerp = |p: Point, q: Point| p + (q - p) * t;
    let mut out = PathBuilder::new();
    for (a, b) in &m.pairs {
        out.move_to(lerp(a.start, b.start));
        for (ca, cb) in a.curves.iter().zip(&b.curves) {
            out.cubic_to(lerp(ca[0], cb[0]), lerp(ca[1], cb[1]), lerp(ca[2], cb[2]));
        }
        if a.closed && b.closed {
            out.close();
        }
    }
    Ok(wrap(out.detach()))
}
