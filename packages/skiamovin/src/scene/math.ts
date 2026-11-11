// Math formulas, typeset in the Rust core with RaTeX (KaTeX-compatible) and drawn as paths.
import type { Color } from '../core/color.ts';
import { Path } from '../core/skia.ts';
import { N } from '../native/runtime.ts';
import { box, type NodeStyle, path, type SceneNode } from './nodes.ts';

interface Typeset {
  width: number;
  height: number;
  depth: number;
  pieces: { path: Path; color: number }[];
}

const cache = new Map<string, Typeset>();

/** Typesets LaTeX math once per formula, size and style. @internal */
export function typeset(tex: string, fontSize: number, display: boolean): Typeset {
  const key = `${display ? 'D' : 'T'}${fontSize}\u0000${tex}`;
  let t = cache.get(key);
  if (!t) {
    const h = N().math_layout(tex, fontSize, display);
    try {
      const [width, height, depth, count] = N().math_info(h);
      const colors = N().math_colors(h);
      const pieces = Array.from({ length: count! }, (_, i) => ({
        path: Path._wrap(N().math_piece(h, i)),
        color: colors[i]! >>> 0,
      }));
      t = { width: width!, height: height!, depth: depth!, pieces };
    } finally {
      N().object_delete(h);
    }
    if (cache.size > 300) {
      const [oldKey, old] = cache.entries().next().value!;
      for (const p of old.pieces) p.path.delete();
      cache.delete(oldKey);
    }
    cache.set(key, t);
  }
  return t;
}

export interface MathOptions {
  /** Pixels. Default 48. */
  fontSize?: number;
  /** Replaces the formula's color (colors set with `\color` are kept). */
  color?: Color;
  /** Display style: larger operators, limits above and below. Default true. */
  display?: boolean;
  /**
   * Draws the formula on, like Manim's `Write`: each piece's outline is traced, then filled, one after another.
   * 0 shows nothing, 1 shows the whole formula.
   */
  write?: number;
}

/**
 * A LaTeX math formula, such as `math('e^{i\\pi} + 1 = 0')`. Typeset in the Rust core, so it looks the same on
 * Node and the web, and drawn as paths, so it can be drawn on, recolored and morphed.
 */
export function math(tex: string, options: MathOptions & NodeStyle = {}): SceneNode {
  const { fontSize = 48, color, display = true, write, ...style } = options;
  const t = typeset(tex, fontSize, display);
  const n = t.pieces.length;
  // Manim's Write timing: pieces overlap with a lag of min(4/n, 0.2).
  const lag = n > 0 ? Math.min(4 / n, 0.2) : 0;
  const span = 1 + (n - 1) * lag;
  const black = 0xff000000;
  const pieces = t.pieces.map((piece, i) => {
    const fill =
      color !== undefined && piece.color === black
        ? color
        : `#${(piece.color & 0xffffff).toString(16).padStart(6, '0')}`;
    if (write === undefined || write >= 1) return path(piece.path, { position: 'absolute', inset: 0, fill });
    const p = Math.min(1, Math.max(0, write * span - i * lag));
    if (p <= 0) return null;
    // First half traces the outline, second half fades the fill in.
    const traced = Math.min(1, p * 2);
    const filled = Math.max(0, p * 2 - 1);
    return box({ position: 'absolute', inset: 0 }, [
      path(piece.path, {
        position: 'absolute',
        inset: 0,
        fill: null,
        stroke: fill,
        strokeWidth: Math.max(1, fontSize / 40),
        trim: { end: traced },
        opacity: 1 - filled * 0.6,
      }),
      filled > 0 ? path(piece.path, { position: 'absolute', inset: 0, fill, opacity: filled }) : null,
    ]);
  });
  return box({ size: { width: t.width, height: t.height + t.depth }, ...style }, pieces);
}
