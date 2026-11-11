// Path modifiers (Blender's modifier stack), frame holds and symmetry (Procreate), and clean shapes from rough input.
import { PaintStyle, StrokeJoin } from '../core/enums.ts';
import { Paint, Path, pathEffects } from '../core/skia.ts';
import { box, type Child, type SceneNode } from './nodes.ts';

/** One step of a modifier stack: takes a path and returns a new one. */
export type PathModifier = (path: Path) => Path;

function effect(path: Path, setup: (p: Paint) => void): Path {
  const paint = new Paint();
  try {
    setup(paint);
    return paint.getFillPath(path);
  } finally {
    paint.delete();
  }
}

/** Path modifiers to apply in order with `modify`. Each returns a new path. */
export const modifiers = {
  /** `count` copies, each moved by `x`, `y`, turned by `rotate` degrees and scaled by `scale` from the last. */
  repeat(count: number, step: { x?: number; y?: number; rotate?: number; scale?: number }): PathModifier {
    return (path) => {
      const out = new Path();
      let m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      const r = ((step.rotate ?? 0) * Math.PI) / 180,
        s = step.scale ?? 1;
      const one = [
        s * Math.cos(r),
        -s * Math.sin(r),
        step.x ?? 0,
        s * Math.sin(r),
        s * Math.cos(r),
        step.y ?? 0,
        0,
        0,
        1,
      ];
      for (let i = 0; i < count; i++) {
        out.addPath(path, m);
        m = [0, 1, 2].flatMap((row) =>
          [0, 1, 2].map((col) => [0, 1, 2].reduce((a, k) => a + one[row * 3 + k]! * m[k * 3 + col]!, 0)),
        );
      }
      return out;
    };
  },
  /** Adds a mirrored copy across the vertical line `x = at` (or horizontal `y = at` for axis 'y'). */
  mirror(axis: 'x' | 'y', at = 0): PathModifier {
    return (path) => {
      const out = path.copy();
      out.addPath(path, axis === 'x' ? [-1, 0, 2 * at, 0, 1, 0, 0, 0, 1] : [1, 0, 0, 0, -1, 2 * at, 0, 0, 1]);
      return out;
    };
  },
  /** Rounds every corner. */
  roundCorners(radius: number): PathModifier {
    return (path) =>
      effect(path, (p) => {
        const e = pathEffects.corner(radius);
        p.setPathEffect(e);
        e?.delete();
      });
  },
  /** Roughens the outline with seeded jitter every `segment` pixels, up to `amount` pixels. */
  noise(segment: number, amount: number, seed = 0): PathModifier {
    return (path) =>
      effect(path, (p) => {
        const e = pathEffects.discrete(segment, amount, seed);
        p.setPathEffect(e);
        e?.delete();
      });
  },
  /** Grows the shape outward by `distance` pixels, with round corners. */
  offset(distance: number): PathModifier {
    return (path) =>
      effect(path, (p) => {
        p.setStyle(PaintStyle.StrokeAndFill)
          .setStrokeWidth(distance * 2)
          .setStrokeJoin(StrokeJoin.Round);
      });
  },
  /** Bends the path into a wave across its bounds; `amount` is -1..1. */
  wave(amount: number): PathModifier {
    return (path) => {
      const b = path.computeTightBounds();
      return path.warp('wave', amount, [b.left, b.top, b.right, b.bottom], 2);
    };
  },
};

/** Applies modifiers in order, like a modifier stack. Intermediate paths are freed; you own the result. */
export function modify(path: Path | string, stack: readonly PathModifier[]): Path {
  let cur = typeof path === 'string' ? Path.fromSVG(path) : path.copy();
  if (!cur) throw new SyntaxError('modify: invalid SVG path data');
  for (const m of stack) {
    const next = m(cur);
    cur.delete();
    cur = next;
  }
  return cur;
}

/**
 * Time held for `every` frames, for the stepped look of hand-drawn animation ("on twos" is `every: 2`).
 */
export function hold(t: number, frameRate: number, every = 2): number {
  const step = every / frameRate;
  return Math.floor(t / step + 1e-9) * step;
}

/** `count` copies of a node turned around a center point, like radial symmetry in a drawing app. */
export function radial(count: number, center: readonly [number, number], make: (index: number) => Child): SceneNode[] {
  return Array.from({ length: count }, (_, i) =>
    box(
      {
        position: 'absolute',
        inset: { left: 0, top: 0 },
        size: { width: '100%', height: '100%' },
        transformOrigin: [center[0], center[1]],
        transform: { rotate: (i * 360) / count },
      },
      [make(i)],
    ),
  );
}

type Pt = readonly [number, number];

/** Ramer-Douglas-Peucker: keeps the points that matter for the shape. */
function simplify(points: readonly Pt[], tolerance: number): Pt[] {
  if (points.length < 3) return [...points];
  const [a, b] = [points[0]!, points[points.length - 1]!];
  let worst = 0,
    index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const d = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len;
    if (d > worst) {
      worst = d;
      index = i;
    }
  }
  if (worst <= tolerance) return [a, b];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}

/**
 * Turns a rough hand-drawn line into a clean shape, as drawing apps do when you hold the pen: a straight line, a
 * circle, or a polygon through its corners. Returns the kind found and SVG path data.
 */
export function cleanShape(points: readonly Pt[]): { kind: 'line' | 'circle' | 'polygon'; d: string } {
  if (points.length < 2) throw new RangeError('cleanShape: needs at least two points');
  const first = points[0]!,
    last = points[points.length - 1]!;
  let length = 0;
  for (let i = 1; i < points.length; i++)
    length += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  const closed = Math.hypot(last[0] - first[0], last[1] - first[1]) < length * 0.12;
  const fmt = (v: number) => Math.round(v * 100) / 100;
  if (!closed) {
    const corners = simplify(points, length * 0.04);
    if (corners.length <= 2)
      return { kind: 'line', d: `M${fmt(first[0])} ${fmt(first[1])} L${fmt(last[0])} ${fmt(last[1])}` };
    return { kind: 'polygon', d: `M${corners.map((p) => `${fmt(p[0])} ${fmt(p[1])}`).join(' L')}` };
  }
  // A circle when every point is about as far from the center as the others.
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  const radii = points.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
  const r = radii.reduce((s, v) => s + v, 0) / radii.length;
  const spread = Math.sqrt(radii.reduce((s, v) => s + (v - r) ** 2, 0) / radii.length);
  if (spread < r * 0.12)
    return {
      kind: 'circle',
      d: `M${fmt(cx - r)} ${fmt(cy)} A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx + r)} ${fmt(cy)} A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx - r)} ${fmt(cy)} Z`,
    };
  // A closed loop starts and ends at the same place, so split it at the point farthest from the start.
  let far = 0;
  points.forEach((p, i) => {
    if (
      Math.hypot(p[0] - first[0], p[1] - first[1]) > Math.hypot(points[far]![0] - first[0], points[far]![1] - first[1])
    )
      far = i;
  });
  const tol = length * 0.04;
  const corners = [
    ...simplify(points.slice(0, far + 1), tol).slice(0, -1),
    ...simplify([...points.slice(far), first], tol).slice(0, -1),
  ];
  return { kind: 'polygon', d: `M${corners.map((p) => `${fmt(p[0])} ${fmt(p[1])}`).join(' L')} Z` };
}
