// Ray-marched 3D scenes in SkSL: shapes as signed distance functions, soft shadows, ambient occlusion and fog,
// with the same camera and units as `space3d` and `meshScene`. The program depends only on the kinds of shapes, so
// moving things changes uniforms, not the shader.
import { type Color, toColor4f } from '../core/color.ts';
import { type NodeStyle, type SceneNode, shader } from './nodes.ts';
import { type Camera3D, cameraTransform, placement } from './space3d.ts';

export type SdfShape =
  | { kind: 'sphere'; radius: number }
  | { kind: 'box'; width: number; height: number; depth: number; radius?: number }
  | { kind: 'torus'; radius: number; tube: number }
  | { kind: 'capsule'; height: number; radius: number }
  /** An endless floor at the object's `y`. */
  | { kind: 'floor' };

export interface SdfObject {
  shape: SdfShape;
  color?: Color;
  x?: number;
  y?: number;
  z?: number;
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
}

export interface SdfOptions {
  /** Light direction in world space (y down), pointing from the scene toward the light. Default upper left front. */
  light?: readonly [number, number, number];
  /** Background and fog color. Default transparent with no fog. */
  background?: Color;
  /** Distance at which fog fully hides things, in pixels. Default none. */
  fog?: number;
  /** Blends shapes into each other over this many pixels (a smooth union). Default 0. */
  blend?: number;
}

const DIST: Record<SdfShape['kind'], string> = {
  sphere: 'length(q) - s.x',
  box: 'sdBox(q, s)',
  torus: 'length(float2(length(q.xz) - s.x, q.y)) - s.y',
  capsule: 'sdCapsule(q, s)',
  floor: '-q.y',
};

function program(objects: readonly SdfObject[], fog: boolean): string {
  const decl = objects
    .map((_, i) => `uniform float3 p${i}; uniform float3x3 r${i}; uniform float4 s${i}; uniform float3 c${i};`)
    .join('\n');
  const scene = objects
    .map((o, i) => {
      const q = `r${i} * (p - p${i})`;
      return `  { float3 q = ${q}; float4 s = s${i}; float d = ${DIST[o.shape.kind]}; mixIn(best, col, d, c${i}); }`;
    })
    .join('\n');
  return `
uniform float2 iResolution;
uniform float3 camPos; uniform float3x3 camRot; uniform float focal;
uniform float3 lightDir; uniform float4 bg; uniform float fogDist; uniform float k;
${decl}

float sdBox(float3 q, float4 s) {
  float3 d = abs(q) - s.xyz * 0.5 + s.w;
  return length(max(d, 0)) + min(max(d.x, max(d.y, d.z)), 0) - s.w;
}
float sdCapsule(float3 q, float4 s) {
  q.y -= clamp(q.y, -s.x * 0.5, s.x * 0.5);
  return length(q) - s.y;
}
void mixIn(inout float best, inout float3 col, float d, float3 c) {
  if (k > 0) {
    float h = clamp(0.5 + 0.5 * (d - best) / k, 0, 1);
    best = mix(d, best, h) - k * h * (1 - h);
    col = mix(c, col, h);
  } else if (d < best) { best = d; col = c; }
}
float map(float3 p, out float3 col) {
  float best = 1e9; col = float3(0);
${scene}
  return best;
}
float dist(float3 p) { float3 c; return map(p, c); }
float3 normalAt(float3 p) {
  float2 e = float2(0.5, 0);
  return normalize(float3(dist(p + e.xyy) - dist(p - e.xyy), dist(p + e.yxy) - dist(p - e.yxy), dist(p + e.yyx) - dist(p - e.yyx)));
}
float softShadow(float3 o, float3 d) {
  float res = 1, t = 2;
  for (int i = 0; i < 48; i++) {
    float h = dist(o + d * t);
    res = min(res, 10 * h / t);
    t += clamp(h, 2, 60);
    if (res < 0.01 || t > 4000) break;
  }
  return clamp(res, 0, 1);
}
float occlusion(float3 p, float3 n) {
  float o = 0, w = 1;
  for (int i = 1; i <= 5; i++) { float h = 6.0 * float(i); o += (h - dist(p + n * h)) * w; w *= 0.6; }
  return clamp(1 - o / 30, 0, 1);
}
half4 main(float2 fragCoord) {
  float3 rd = normalize(camRot * float3(fragCoord - iResolution * 0.5, focal));
  float t = 0; float3 col = float3(0); bool hit = false;
  for (int i = 0; i < 160; i++) {
    float3 c; float d = map(camPos + rd * t, c);
    if (d < 0.05 * (1 + t * 0.002)) { hit = true; col = c; break; }
    t += d;
    if (t > 20000) break;
  }
  if (!hit) return half4(bg);
  float3 p = camPos + rd * t;
  float3 n = normalAt(p);
  float3 l = normalize(lightDir);
  float diff = max(dot(n, l), 0) * softShadow(p + n * 1.5, l);
  float ao = occlusion(p, n);
  float sky = 0.55 + 0.45 * -n.y;
  float spec = pow(max(dot(n, normalize(l - rd)), 0), 48) * diff;
  float3 lit = col * (0.25 * sky * ao + 0.85 * diff) + 0.35 * spec;
  ${fog ? 'lit = mix(lit, bg.rgb / max(bg.a, 0.0001), clamp(t / fogDist, 0, 1));' : ''}
  return half4(half3(clamp(lit, 0, 1)), 1);
}`;
}

const programs = new Map<string, string>();

/**
 * A ray-marched 3D scene, drawn as a shader the size of `viewport`:
 *
 * ```ts
 * sdfScene({ width: 1920, height: 1080 }, { tilt: 20, pan: t * 15 }, [
 *   { shape: { kind: 'floor' }, y: 120, color: '#e2e8f0' },
 *   { shape: { kind: 'torus', radius: 140, tube: 45 }, color: '#f472b6', rotateX: t * 40 },
 * ], { blend: 20 })
 * ```
 *
 * Lit with soft shadows and ambient occlusion. Units and the camera match `meshScene`.
 */
export function sdfScene(
  viewport: { width: number; height: number },
  camera: Camera3D,
  objects: readonly SdfObject[],
  options: SdfOptions & NodeStyle = {},
): SceneNode {
  const { light = [-0.5, -0.8, 0.6], background, fog, blend = 0, ...style } = options;
  const key = `${objects.map((o) => o.shape.kind).join(',')}|${fog !== undefined}`;
  let sksl = programs.get(key);
  if (!sksl) {
    sksl = program(objects, fog !== undefined);
    programs.set(key, sksl);
  }
  const { eye } = cameraTransform(viewport, camera);
  // Camera to world: the transpose of the rotation part, and the camera sits at -Rᵀ·t.
  const R = [eye[0]!, eye[1]!, eye[2]!, eye[4]!, eye[5]!, eye[6]!, eye[8]!, eye[9]!, eye[10]!];
  const tr = [eye[3]!, eye[7]!, eye[11]!];
  const camPos = [0, 1, 2].map((c) => -(R[c]! * tr[0]! + R[3 + c]! * tr[1]! + R[6 + c]! * tr[2]!));
  const focal = viewport.height / 2 / Math.tan(((camera.fov ?? 40) * Math.PI) / 360);
  // SkSL matrices are column-major: a column-major Rᵀ is R's rows in order.
  const uniforms: Record<string, number | readonly number[]> = {
    camPos,
    camRot: R,
    focal,
    lightDir: [...light],
    bg: background === undefined ? [0, 0, 0, 0] : premul(toColor4f(background)),
    fogDist: fog ?? 1,
    k: blend,
  };
  objects.forEach((o, i) => {
    const m = placement({ ...o, scale: 1 });
    uniforms[`p${i}`] = [m[3]!, m[7]!, m[11]!];
    // World to object is the inverse rotation; column-major storage of Rᵀ is R's rows.
    uniforms[`r${i}`] = [m[0]!, m[1]!, m[2]!, m[4]!, m[5]!, m[6]!, m[8]!, m[9]!, m[10]!];
    const s = o.shape;
    uniforms[`s${i}`] =
      s.kind === 'sphere'
        ? [s.radius, 0, 0, 0]
        : s.kind === 'box'
          ? [s.width, s.height, s.depth, s.radius ?? 0]
          : s.kind === 'torus'
            ? [s.radius, s.tube, 0, 0]
            : s.kind === 'capsule'
              ? [s.height, s.radius, 0, 0]
              : [0, 0, 0, 0];
    const [r, g, b] = toColor4f(o.color ?? '#cbd5e1');
    uniforms[`c${i}`] = [r, g, b];
  });
  return shader(sksl, { uniforms, size: { width: viewport.width, height: viewport.height }, ...style });
}

function premul([r, g, b, a]: [number, number, number, number]): number[] {
  return [r * a, g * a, b * a, a];
}
