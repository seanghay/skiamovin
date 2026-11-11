// Hand-drawn strokes: variable width with tapered ends, from points or along a path, drawn on over time.
import { getStroke } from 'perfect-freehand';
import type { Color } from '../core/color.ts';
import { Path } from '../core/skia.ts';
import { type Gradient, type NodeStyle, pathFromSVG, type SceneNode } from './nodes.ts';

export interface StrokeOptions {
  /** Width at full pressure, in pixels. Default 8. */
  size?: number;
  /** How much pressure (or speed, without pressure) thins the stroke, -1..1. Default 0.5. */
  thinning?: number;
  /** How much the outline is smoothed, 0..1. Default 0.5. */
  smoothing?: number;
  /** How much the line is straightened out, 0..1. Default 0.5. */
  streamline?: number;
  /** Tapered ends, as a length in pixels for both or `[start, end]`. Default 0 (round ends). */
  taper?: number | readonly [number, number];
  color?: Color | Gradient;
  /** Draws the stroke on, from 0 (nothing) to 1 (all of it), as if being drawn. */
  draw?: number;
}

type Point = readonly [number, number] | readonly [number, number, number];

/** Points along a path every couple of pixels. */
function sample(path: Path, spacing = 2): [number, number][] {
  const length = path.totalLength();
  const n = Math.max(2, Math.ceil(length / spacing));
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const v = path.posTanAt(i / n);
    if (v) out.push([v[0], v[1]]);
  }
  return out;
}

const sampled = new Map<string, [number, number][]>();

/** The first `fraction` of a polyline, by length, ending exactly at the cut. */
function partial(points: readonly Point[], fraction: number): Point[] {
  if (fraction >= 1) return [...points];
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
    seg.push(d);
    total += d;
  }
  let left = total * fraction;
  const out: Point[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const d = seg[i - 1]!;
    if (left >= d) {
      out.push(points[i]!);
      left -= d;
      continue;
    }
    const k = d > 0 ? left / d : 0;
    const a = points[i - 1]!,
      b = points[i]!;
    const p = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    if (a.length > 2 && b.length > 2) p.push(a[2]! + (b[2]! - a[2]!) * k);
    out.push(p as unknown as Point);
    break;
  }
  return out;
}

/**
 * A hand-drawn stroke, like a brush or pen in a drawing app: its width follows pressure (the third number of each
 * point) or drawing speed, and its ends can taper. Give it points, or a path or SVG path data to draw along.
 * Uses perfect-freehand (MIT).
 *
 * ```ts
 * stroke('M20 80 C80 0 160 160 240 60', { size: 14, taper: [40, 80], color: '#f472b6', draw: t })
 * ```
 */
export function stroke(input: readonly Point[] | Path | string, options: StrokeOptions & NodeStyle = {}): SceneNode {
  const {
    size = 8,
    thinning = 0.5,
    smoothing = 0.5,
    streamline = 0.5,
    taper = 0,
    color = '#000000',
    draw,
    ...style
  } = options;
  let points: readonly Point[];
  if (typeof input === 'string') {
    let s = sampled.get(input);
    if (!s) {
      s = sample(pathFromSVG(input));
      if (sampled.size > 200) sampled.delete(sampled.keys().next().value!);
      sampled.set(input, s);
    }
    points = s;
  } else if (input instanceof Path) points = sample(input);
  else points = input;
  const fraction = draw === undefined ? 1 : Math.min(1, Math.max(0, draw));
  const [startTaper, endTaper] = typeof taper === 'number' ? [taper, taper] : taper;
  const shown = fraction > 0 ? partial(points, fraction) : [];
  const outline = shown.length
    ? getStroke(
        shown.map((p) => [...p]),
        {
          size,
          thinning,
          smoothing,
          streamline,
          simulatePressure: !points.some((p) => p.length > 2),
          start: { taper: startTaper, cap: true },
          end: { taper: endTaper, cap: true },
          last: fraction >= 1,
        },
      )
    : [];
  // A smooth closed shape through the outline points, with quadratic curves between midpoints.
  const path = new Path();
  if (outline.length > 2) {
    const mid = (a: number[], b: number[]): [number, number] => [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2];
    path.moveTo(mid(outline[0]!, outline[1]!));
    for (let i = 1; i < outline.length; i++) {
      const p = outline[i]!,
        q = outline[(i + 1) % outline.length]!;
      path.quadTo([p[0]!, p[1]!], mid(p, q));
    }
    path.close();
  }
  let right = 0,
    bottom = 0;
  for (const p of points) {
    right = Math.max(right, p[0] + size);
    bottom = Math.max(bottom, p[1] + size);
  }
  return {
    type: 'path',
    path,
    fill: color,
    style: { size: { width: right, height: bottom }, ...style },
    children: [],
  };
}
