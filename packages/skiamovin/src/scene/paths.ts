// Morphing between paths and motion along a path.
import { type Path, PathMorph } from '../core/skia.ts';
import { pathFromSVG } from './nodes.ts';

const morphs = new Map<string, PathMorph>();
const pathIds = new WeakMap<Path, number>();
let nextPathId = 1;

function keyOf(p: string | Path): string {
  if (typeof p === 'string') return `s:${p}`;
  let id = pathIds.get(p);
  if (id === undefined) {
    id = nextPathId++;
    pathIds.set(p, id);
  }
  return `p:${id}`;
}

/**
 * The shape between `from` (t = 0) and `to` (t = 1). Contours are paired by size, given matching points and
 * lined up so the shape doesn't twist. The matching is done once per pair of paths and reused.
 */
export function morphPath(from: string | Path, to: string | Path, t: number): Path {
  const key = `${keyOf(from)}|${keyOf(to)}`;
  let m = morphs.get(key);
  if (!m) {
    const a = typeof from === 'string' ? pathFromSVG(from) : from;
    const b = typeof to === 'string' ? pathFromSVG(to) : to;
    m = new PathMorph(a, b);
    if (morphs.size > 200) {
      const oldest = morphs.keys().next().value!;
      morphs.get(oldest)?.delete();
      morphs.delete(oldest);
    }
    morphs.set(key, m);
  }
  return m.at(Math.min(1, Math.max(0, t)));
}

/**
 * Where a point `progress` (0..1) of the way along a path is, and which way it's heading in degrees. Use it to
 * move a node along a path: `transform: { translateX: p.x, translateY: p.y, rotate: p.angle }`.
 */
export function alongPath(p: string | Path, progress: number): { x: number; y: number; angle: number } {
  const path = typeof p === 'string' ? pathFromSVG(p) : p;
  const v = path.posTanAt(progress);
  if (!v) return { x: 0, y: 0, angle: 0 };
  return { x: v[0], y: v[1], angle: (Math.atan2(v[3], v[2]) * 180) / Math.PI };
}
