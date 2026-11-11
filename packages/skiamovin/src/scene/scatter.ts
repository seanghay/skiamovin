// Placing copies (Blender's scattering and array modifiers) and pointing things at each other (its constraints).
import type { Path } from '../core/skia.ts';
import { random } from './animation.ts';
import { alongPath } from './paths.ts';

export interface ScatterPoint {
  x: number;
  y: number;
  index: number;
  /** Degrees: the path's direction for `path`, otherwise a seeded random angle. */
  angle: number;
  /** A seeded random number in [0, 1) for this copy, for varying size or color. */
  random: number;
}

export type ScatterOptions = { seed?: string | number } & (
  | {
      /** Random points in a rectangle, at least `spacing` pixels apart when possible. */
      area: { x?: number; y?: number; width: number; height: number };
      spacing?: number;
    }
  | {
      /** Evenly spaced along a path, from start to end. */
      path: Path | string;
    }
  | {
      /** A grid filling the rectangle, `columns` across. */
      grid: { x?: number; y?: number; width: number; height: number; columns: number };
    }
);

/**
 * Positions for `count` copies, the same for the same seed:
 *
 * ```ts
 * scatter(40, { area: { width: 1920, height: 1080 }, spacing: 80, seed: 'stars' }).map((p) =>
 *   box({ position: 'absolute', inset: { left: p.x, top: p.y }, size: 4 + p.random * 8, ... }))
 * ```
 */
export function scatter(count: number, options: ScatterOptions): ScatterPoint[] {
  const seed = options.seed ?? 1;
  const out: ScatterPoint[] = [];
  const n = Math.max(0, Math.floor(count));
  if ('path' in options) {
    for (let i = 0; i < n; i++) {
      const p = alongPath(options.path, n === 1 ? 0 : i / (n - 1));
      out.push({ x: p.x, y: p.y, angle: p.angle, index: i, random: random(`${seed}:r:${i}`) });
    }
    return out;
  }
  if ('grid' in options) {
    const { x = 0, y = 0, width, height, columns } = options.grid;
    const rows = Math.max(1, Math.ceil(n / columns));
    for (let i = 0; i < n; i++) {
      const c = i % columns,
        r = Math.floor(i / columns);
      out.push({
        x: x + ((c + 0.5) * width) / columns,
        y: y + ((r + 0.5) * height) / rows,
        angle: random(`${seed}:a:${i}`) * 360,
        index: i,
        random: random(`${seed}:r:${i}`),
      });
    }
    return out;
  }
  const { x = 0, y = 0, width, height } = options.area;
  const spacing = options.spacing ?? 0;
  // Best of several seeded candidates: the one farthest from the points so far, which spreads points evenly.
  for (let i = 0; i < n; i++) {
    let best = { x: 0, y: 0 },
      bestD = -1;
    for (let k = 0; k < (spacing > 0 ? 12 : 1); k++) {
      const c = { x: x + random(`${seed}:x:${i}:${k}`) * width, y: y + random(`${seed}:y:${i}:${k}`) * height };
      let d = Infinity;
      for (const p of out) d = Math.min(d, Math.hypot(p.x - c.x, p.y - c.y));
      if (d >= spacing) {
        best = c;
        break;
      }
      if (d > bestD) {
        bestD = d;
        best = c;
      }
    }
    out.push({ ...best, angle: random(`${seed}:a:${i}`) * 360, index: i, random: random(`${seed}:r:${i}`) });
  }
  return out;
}

/** The rotation in degrees that points something at `from` toward `to`, for `transform: { rotate }`. */
export function lookAt(from: readonly [number, number], to: readonly [number, number]): number {
  return (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
}
