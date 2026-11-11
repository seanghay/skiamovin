// Simple 3D meshes (boxes, spheres, tori, extruded shapes and text) lit and drawn with Skia's drawVertices.
// Triangles are sorted back to front, which suits single objects and objects that don't cut through each other.
import earcut from 'earcut';
import { type Color, toColor4f } from '../core/color.ts';
import { BlendMode } from '../core/enums.ts';
import { ContourMeasureIter, Image, Paint, type Path } from '../core/skia.ts';
import { N } from '../native/runtime.ts';
import { currentScope, type NodeStyle, pathFromSVG, type SceneNode } from './nodes.ts';
import { type Camera3D, cameraTransform, multiply44, placement } from './space3d.ts';

export interface Mesh {
  /** x, y, z per vertex. */
  positions: Float32Array;
  /** Unit normal per vertex. */
  normals: Float32Array;
  /** Three vertex indices per triangle, wound counterclockwise when seen from outside. */
  indices: Uint32Array;
}

function build(positions: number[], normals: number[], indices: number[]): Mesh {
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
  };
}

/** Mesh builders. Sizes are in pixels; y points down and z toward the camera. */
export const meshes = {
  box(width: number, height: number, depth: number): Mesh {
    const [x, y, z] = [width / 2, height / 2, depth / 2];
    const faces: [number[], number[][]][] = [
      [
        [0, 0, 1],
        [
          [-x, -y, z],
          [x, -y, z],
          [x, y, z],
          [-x, y, z],
        ],
      ],
      [
        [0, 0, -1],
        [
          [x, -y, -z],
          [-x, -y, -z],
          [-x, y, -z],
          [x, y, -z],
        ],
      ],
      [
        [1, 0, 0],
        [
          [x, -y, z],
          [x, -y, -z],
          [x, y, -z],
          [x, y, z],
        ],
      ],
      [
        [-1, 0, 0],
        [
          [-x, -y, -z],
          [-x, -y, z],
          [-x, y, z],
          [-x, y, -z],
        ],
      ],
      [
        [0, -1, 0],
        [
          [-x, -y, -z],
          [x, -y, -z],
          [x, -y, z],
          [-x, -y, z],
        ],
      ],
      [
        [0, 1, 0],
        [
          [-x, y, z],
          [x, y, z],
          [x, y, -z],
          [-x, y, -z],
        ],
      ],
    ];
    const p: number[] = [],
      n: number[] = [],
      i: number[] = [];
    for (const [normal, quad] of faces) {
      const base = p.length / 3;
      for (const v of quad) {
        p.push(...v);
        n.push(...normal);
      }
      i.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    return build(p, n, i);
  },

  sphere(radius: number, segments = 32): Mesh {
    const rings = Math.max(4, Math.round(segments / 2));
    const p: number[] = [],
      n: number[] = [],
      i: number[] = [];
    for (let r = 0; r <= rings; r++) {
      const phi = (r / rings) * Math.PI;
      for (let s = 0; s <= segments; s++) {
        const theta = (s / segments) * Math.PI * 2;
        const v = [Math.sin(phi) * Math.cos(theta), -Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
        n.push(...v);
        p.push(v[0]! * radius, v[1]! * radius, v[2]! * radius);
      }
    }
    for (let r = 0; r < rings; r++)
      for (let s = 0; s < segments; s++) {
        const a = r * (segments + 1) + s,
          b = a + segments + 1;
        i.push(a, a + 1, b, a + 1, b + 1, b);
      }
    return build(p, n, i);
  },

  torus(radius: number, tube: number, segments = 48, sides = 20): Mesh {
    const p: number[] = [],
      n: number[] = [],
      i: number[] = [];
    for (let s = 0; s <= segments; s++) {
      const u = (s / segments) * Math.PI * 2;
      for (let k = 0; k <= sides; k++) {
        const v = (k / sides) * Math.PI * 2;
        const normal = [Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u)];
        n.push(...normal);
        p.push(
          (radius + tube * Math.cos(v)) * Math.cos(u),
          tube * Math.sin(v),
          (radius + tube * Math.cos(v)) * Math.sin(u),
        );
      }
    }
    for (let s = 0; s < segments; s++)
      for (let k = 0; k < sides; k++) {
        const a = s * (sides + 1) + k,
          b = a + sides + 1;
        i.push(a, b, a + 1, a + 1, b, b + 1);
      }
    return build(p, n, i);
  },

  /**
   * A flat shape given depth, like extruded text or a logo: a front and back face and sides. The shape is centered
   * on the origin. Curves are flattened every `step` pixels.
   */
  extrude(shape: Path | string, depth: number, step = 3): Mesh {
    const path = typeof shape === 'string' ? pathFromSVG(shape) : shape;
    const b = path.computeTightBounds();
    const [cx, cy] = [(b.left + b.right) / 2, (b.top + b.bottom) / 2];
    // Flatten each contour, then group holes with the outer contour that contains them.
    const contours: { pts: number[]; area: number }[] = [];
    const iter = new ContourMeasureIter(path, true);
    for (let c = iter.next(); c; c = iter.next()) {
      const len = c.length();
      const n = Math.max(3, Math.ceil(len / step));
      const pts: number[] = [];
      for (let k = 0; k < n; k++) {
        const v = c.getPosTan((k / n) * len);
        if (v) pts.push(v[0] - cx, v[1] - cy);
      }
      c.delete();
      let area = 0;
      for (let k = 0; k < pts.length; k += 2) {
        const j = (k + 2) % pts.length;
        area += pts[k]! * pts[j + 1]! - pts[j]! * pts[k + 1]!;
      }
      if (pts.length >= 6) contours.push({ pts, area: area / 2 });
    }
    iter.delete();
    const outerSign =
      Math.sign(contours.reduce((m, c) => (Math.abs(c.area) > Math.abs(m.area) ? c : m), { pts: [], area: 0 }).area) ||
      1;
    const outers = contours.filter((c) => Math.sign(c.area) === outerSign);
    const holes = contours.filter((c) => Math.sign(c.area) !== outerSign);
    const inside = (x: number, y: number, poly: number[]) => {
      let hit = false;
      for (let k = 0, j = poly.length - 2; k < poly.length; j = k, k += 2) {
        const [xi, yi, xj, yj] = [poly[k]!, poly[k + 1]!, poly[j]!, poly[j + 1]!];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    };
    const p: number[] = [],
      n: number[] = [],
      idx: number[] = [];
    const z = depth / 2;
    for (const outer of outers) {
      const mine = holes.filter((h) => inside(h.pts[0]!, h.pts[1]!, outer.pts));
      const flat = [...outer.pts, ...mine.flatMap((h) => h.pts)];
      const starts: number[] = [];
      let at = outer.pts.length / 2;
      for (const h of mine) {
        starts.push(at);
        at += h.pts.length / 2;
      }
      const tris = earcut(flat, starts);
      // Earcut's winding follows the input; orient each cap to face outward.
      for (const [side, nz] of [
        [z, 1],
        [-z, -1],
      ] as const) {
        const base = p.length / 3;
        for (let k = 0; k < flat.length; k += 2) {
          p.push(flat[k]!, flat[k + 1]!, side);
          n.push(0, 0, nz);
        }
        for (let k = 0; k < tris.length; k += 3) {
          const [a, bb, c] = [tris[k]!, tris[k + 1]!, tris[k + 2]!];
          const ax = flat[a * 2]!,
            ay = flat[a * 2 + 1]!;
          const cross = (flat[bb * 2]! - ax) * (flat[c * 2 + 1]! - ay) - (flat[bb * 2 + 1]! - ay) * (flat[c * 2]! - ax);
          // With y down, a front face (toward +z) reads clockwise on screen, which is a negative cross product.
          const flipIt = nz > 0 ? cross > 0 : cross < 0;
          idx.push(base + a, base + (flipIt ? c : bb), base + (flipIt ? bb : c));
        }
      }
      // Sides: one quad per edge, with the edge's outward normal.
      for (const ring of [outer, ...mine]) {
        const pts = ring.pts;
        const sign = Math.sign(ring.area) === outerSign ? 1 : -1;
        for (let k = 0; k < pts.length; k += 2) {
          const j = (k + 2) % pts.length;
          const [x0, y0, x1, y1] = [pts[k]!, pts[k + 1]!, pts[j]!, pts[j + 1]!];
          const len = Math.hypot(x1 - x0, y1 - y0) || 1;
          const nx = ((y1 - y0) / len) * outerSign * sign,
            ny = (-(x1 - x0) / len) * outerSign * sign;
          const base = p.length / 3;
          p.push(x0, y0, z, x1, y1, z, x1, y1, -z, x0, y0, -z);
          for (let q = 0; q < 4; q++) n.push(nx, ny, 0);
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
    return build(p, n, idx);
  },
};

export interface MeshObject {
  mesh: Mesh;
  color?: Color;
  x?: number;
  y?: number;
  z?: number;
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  scale?: number;
  /** Highlight strength, 0..1. Default 0.35. */
  shine?: number;
}

export interface Light {
  /** Direction the light comes from, in camera space (x right, y down, z toward the viewer). Default upper left front. */
  direction?: readonly [number, number, number];
  /** Light that reaches everywhere, 0..1. Default 0.35. */
  ambient?: number;
}

/**
 * Lit 3D objects seen through a perspective camera (the same camera as `space3d`):
 *
 * ```ts
 * meshScene({ width: 1920, height: 1080 }, { tilt: 20 }, [
 *   { mesh: meshes.torus(200, 70), color: '#38bdf8', rotateY: t * 60, rotateX: 30 },
 * ])
 * ```
 *
 * Each triangle is shaded from the light and drawn back to front; faces turned away are skipped.
 */
export function meshScene(
  viewport: { width: number; height: number },
  camera: Camera3D,
  objects: readonly MeshObject[],
  options: {
    light?: Light;
    /**
     * Uses a depth buffer instead of sorting, so objects that cut through each other look right. Drawn on the CPU
     * with 3×3 samples per pixel, so it's slower for large frames.
     */
    depth?: boolean;
  } & NodeStyle = {},
): SceneNode {
  const { light = {}, depth = false, ...style } = options;
  const { eye, project } = cameraTransform(viewport, camera);
  const [lx, ly, lz] = light.direction ?? [-0.45, -0.7, 0.55];
  const ll = Math.hypot(lx, ly, lz) || 1;
  const L = [lx / ll, ly / ll, lz / ll];
  const ambient = light.ambient ?? 0.35;

  const positions: [number, number][] = [];
  const colors: number[] = [];
  const order: { depth: number; at: number }[] = [];
  const inverse: number[] = [];
  for (const o of objects) {
    const m = multiply44(eye, placement(o));
    const { positions: P, normals: Nn, indices } = o.mesh;
    const count = P.length / 3;
    const cam = new Float32Array(count * 3);
    const nrm = new Float32Array(count * 3);
    for (let v = 0; v < count; v++) {
      const [x, y, z] = [P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!];
      for (let r = 0; r < 3; r++) {
        cam[v * 3 + r] = m[r * 4]! * x + m[r * 4 + 1]! * y + m[r * 4 + 2]! * z + m[r * 4 + 3]!;
        // Rotations and uniform scale only, so the same matrix turns normals; they're normalized below.
        nrm[v * 3 + r] = m[r * 4]! * Nn[v * 3]! + m[r * 4 + 1]! * Nn[v * 3 + 1]! + m[r * 4 + 2]! * Nn[v * 3 + 2]!;
      }
    }
    const [cr, cg, cb] = toColor4f(o.color ?? '#94a3b8');
    const shine = o.shine ?? 0.35;
    const shade = (v: number): number => {
      const nl = Math.hypot(nrm[v * 3]!, nrm[v * 3 + 1]!, nrm[v * 3 + 2]!) || 1;
      // Camera space looks down +z, so a normal toward the viewer has negative z; flip to match the light's frame.
      const nx = nrm[v * 3]! / nl,
        ny = nrm[v * 3 + 1]! / nl,
        nz = -nrm[v * 3 + 2]! / nl;
      const diffuse = Math.max(0, nx * L[0]! + ny * L[1]! + nz * L[2]!);
      // Blinn highlight with the viewer straight ahead.
      const hx = L[0]!,
        hy = L[1]!,
        hz = L[2]! + 1;
      const hl = Math.hypot(hx, hy, hz) || 1;
      const spec = shine * Math.max(0, (nx * hx + ny * hy + nz * hz) / hl) ** 40;
      const k = ambient + (1 - ambient) * diffuse;
      const ch = (c: number) => Math.round(Math.min(1, c * k + spec) * 255);
      return ((255 << 24) | (ch(cr) << 16) | (ch(cg) << 8) | ch(cb)) >>> 0;
    };
    const screen = (v: number): [number, number] | null => {
      const z = cam[v * 3 + 2]!;
      if (z < 1) return null;
      const x = project[0]! * cam[v * 3]! + project[2]! * z;
      const y = project[5]! * cam[v * 3 + 1]! + project[6]! * z;
      return [x / z, y / z];
    };
    const lit = new Map<number, number>();
    const proj = new Map<number, [number, number] | null>();
    for (let t = 0; t < indices.length; t += 3) {
      const tri = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
      const pts = tri.map((v) => {
        if (!proj.has(v)) proj.set(v, screen(v));
        return proj.get(v)!;
      });
      if (pts.some((q) => q === null)) continue;
      const [a, b, c] = pts as [number, number][];
      // Skip faces turned away: counterclockwise from outside appears clockwise on screen with y down.
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) >= 0) continue;
      const depth = (cam[tri[0]! * 3 + 2]! + cam[tri[1]! * 3 + 2]! + cam[tri[2]! * 3 + 2]!) / 3;
      order.push({ depth, at: positions.length });
      for (const v of tri) {
        if (!lit.has(v)) lit.set(v, shade(v));
        colors.push(lit.get(v)!);
      }
      positions.push(a, b, c);
      // 1 / z varies linearly across the screen, so it interpolates correctly; nearer is more negative.
      for (const v of tri) inverse.push(-1 / cam[v * 3 + 2]!);
    }
  }
  order.sort((p, q) => q.depth - p.depth || p.at - q.at);
  const pos: [number, number][] = [];
  const col: number[] = [];
  for (const o of order)
    for (let k = 0; k < 3; k++) {
      pos.push(positions[o.at + k]!);
      col.push(colors[o.at + k]!);
    }
  return {
    type: 'draw',
    fn: (canvas) => {
      if (depth) {
        const xyz = new Float32Array(positions.length * 3);
        positions.forEach((p, i) => {
          xyz[i * 3] = p[0];
          xyz[i * 3 + 1] = p[1];
          xyz[i * 3 + 2] = inverse[i]!;
        });
        const img = Image._fromHandle(
          N().raster3d_triangles(viewport.width, viewport.height, xyz, Uint32Array.from(colors), 3),
        );
        canvas.drawImage(img, [0, 0]);
        img.delete();
        return;
      }
      const paint = new Paint().setAntiAlias(true);
      // Vertex indices are 16-bit in Skia, so draw in batches of whole triangles without indices.
      const BATCH = 3 * 20000;
      for (let s = 0; s < pos.length; s += BATCH)
        canvas.drawVertices(0, pos.slice(s, s + BATCH), null, col.slice(s, s + BATCH), null, BlendMode.Dst, paint);
      paint.delete();
    },
    ctx: currentScope().ctx,
    style: { size: { width: viewport.width, height: viewport.height }, ...style },
    children: [],
  };
}
