// Color grading: LUTs, adjustments, curves and grading controls. Each function returns a plain description that
// the renderer turns into a Skia color filter, so grades can be animated and LUT files load before drawing.
import { type Color, toColor4f } from '../core/color.ts';
import { type ColorFilter, colorFilters, RuntimeEffect } from '../core/skia.ts';
import type { LutAsset } from './assets.ts';

type RGB = number | readonly [number, number, number];

interface Base {
  /** 0 keeps the original, 1 (default) applies the grade fully. */
  strength?: number;
}

export type Grade =
  | ({ kind: 'lut'; asset: LutAsset; interpolation?: 'tetrahedral' | 'trilinear' } & Base)
  | ({ kind: 'adjust' } & AdjustOptions & Base)
  | ({ kind: 'curves' } & CurvesOptions & Base)
  | ({ kind: 'levels' } & LevelsOptions & Base)
  | ({ kind: 'wheels'; lift?: RGB; gamma?: RGB; gain?: RGB; offset?: RGB } & Base)
  | ({ kind: 'cdl'; slope?: RGB; offset?: RGB; power?: RGB; saturation?: number } & Base)
  | ({ kind: 'gradientMap'; stops: readonly (Color | readonly [Color, number])[] } & Base)
  | ({
      kind: 'mixer';
      red?: readonly [number, number, number];
      green?: readonly [number, number, number];
      blue?: readonly [number, number, number];
    } & Base)
  | ({ kind: 'posterize'; levels: number } & Base)
  | ({ kind: 'threshold'; level: number } & Base)
  | ({ kind: 'blend'; from: Grade | readonly Grade[]; to: Grade | readonly Grade[]; t: number } & Base);

export interface AdjustOptions {
  /** In stops: 1 doubles the light. */
  exposure?: number;
  /** -1..1 */
  brightness?: number;
  /** -1..1 */
  contrast?: number;
  /** -1 (gray) .. 1 */
  saturation?: number;
  /** Raises the saturation of muted colors more than strong ones. -1..1 */
  vibrance?: number;
  /** Cooler (-1) to warmer (1). */
  warmth?: number;
  /** Green (-1) to magenta (1). */
  tint?: number;
  /** Darkens (-1) or brightens (1) the bright parts. */
  highlights?: number;
  /** Darkens (-1) or brightens (1) the dark parts. */
  shadows?: number;
  /** Lifts the blacks for a faded film look. 0..1 */
  fade?: number;
}

export interface CurvesOptions {
  /** Control points `[input, output]` in 0..1, applied to all channels after the per-channel curves. */
  rgb?: readonly (readonly [number, number])[];
  red?: readonly (readonly [number, number])[];
  green?: readonly (readonly [number, number])[];
  blue?: readonly (readonly [number, number])[];
}

export interface LevelsOptions {
  inBlack?: number;
  inWhite?: number;
  gamma?: number;
  outBlack?: number;
  outWhite?: number;
}

/** Applies a LUT (`.cube`, Hald or square LUT image). Tetrahedral interpolation by default, as the `.cube` spec recommends. */
export function lut(asset: LutAsset, options: Base & { interpolation?: 'tetrahedral' | 'trilinear' } = {}): Grade {
  return { kind: 'lut', asset, ...options };
}
/** Photo-editor style adjustments. */
export function adjust(options: AdjustOptions & Base): Grade {
  return { kind: 'adjust', ...options };
}
/** Tone curves from control points. */
export function curves(options: CurvesOptions & Base): Grade {
  return { kind: 'curves', ...options };
}
/** Input and output levels with a gamma in between. */
export function levels(options: LevelsOptions & Base): Grade {
  return { kind: 'levels', ...options };
}
/** Lift, gamma, gain and offset, as numbers or `[r, g, b]`. */
export function gradeWheels(options: { lift?: RGB; gamma?: RGB; gain?: RGB; offset?: RGB } & Base): Grade {
  return { kind: 'wheels', ...options };
}
/** An ASC CDL grade: `(in · slope + offset) ^ power`, then saturation. */
export function cdl(options: { slope?: RGB; offset?: RGB; power?: RGB; saturation?: number } & Base): Grade {
  return { kind: 'cdl', ...options };
}
/** Colors the image by brightness, from the first stop (dark) to the last (bright). Two stops make a duotone. */
export function gradientMap(stops: readonly (Color | readonly [Color, number])[], options: Base = {}): Grade {
  return { kind: 'gradientMap', stops, ...options };
}
/** Each output channel as a mix of the input channels. */
export function channelMixer(
  options: {
    red?: readonly [number, number, number];
    green?: readonly [number, number, number];
    blue?: readonly [number, number, number];
  } & Base,
): Grade {
  return { kind: 'mixer', ...options };
}
export function posterize(levels: number, options: Base = {}): Grade {
  return { kind: 'posterize', levels, ...options };
}
/** Black below `level` brightness, white above. */
export function threshold(level: number, options: Base = {}): Grade {
  return { kind: 'threshold', level, ...options };
}
/** Blends two looks: `t` 0 is `from`, 1 is `to`. Animate `t` to change the look across a scene. */
export function blendGrades(from: Grade | readonly Grade[], to: Grade | readonly Grade[], t: number): Grade {
  return { kind: 'blend', from, to, t };
}

// ---- Turning grades into color filters ----

const SRGB = `
  float3 toLin(float3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, float3(2.4)), step(0.04045, c)); }
  float3 toSrgb(float3 c) { return mix(c * 12.92, 1.055 * pow(c, float3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
  float luma(float3 c) { return dot(c, float3(0.2126, 0.7152, 0.0722)); }
`;

const effects = new Map<string, RuntimeEffect>();
function effect(name: string, sksl: string): RuntimeEffect {
  let e = effects.get(name);
  if (!e) {
    e = RuntimeEffect.makeForColorFilter(sksl);
    effects.set(name, e);
  }
  return e;
}

const STRENGTH = `uniform colorFilter f; uniform half s;
  half4 main(half4 c) { return mix(c, f.eval(c), s); }`;
const MIX = `uniform colorFilter a; uniform colorFilter b; uniform half t;
  half4 main(half4 c) { return mix(a.eval(c), b.eval(c), t); }`;

const ADJUST = `${SRGB}
  uniform float exposure, brightness, contrast, saturation, vibrance, warmth, tint, highlights, shadows, fade;
  half4 main(half4 c) {
    if (c.a == 0) return c;
    float3 v = float3(unpremul(c).rgb);
    float3 lin = toLin(v) * exp2(exposure);
    lin *= float3(1 + 0.2 * warmth, 1 - 0.2 * tint, 1 - 0.2 * warmth);
    v = toSrgb(clamp(lin, 0, 1));
    v += brightness * 0.5;
    v = (v - 0.5) * (1 + contrast) + 0.5;
    float y = luma(clamp(v, 0, 1));
    v += shadows * 0.5 * (1 - y) * (1 - y) * (1 - y);
    v += highlights * 0.5 * y * y * y;
    y = luma(clamp(v, 0, 1));
    float sat = max(v.r, max(v.g, v.b)) - min(v.r, min(v.g, v.b));
    v = mix(float3(y), v, 1 + saturation + vibrance * (1 - clamp(sat, 0, 1)));
    v = mix(v, 0.12 + v * 0.8, fade);
    return half4(half3(clamp(v, 0, 1)) * c.a, c.a);
  }`;

const WHEELS = `
  uniform float3 lift, gamma, gain, offset;
  half4 main(half4 c) {
    if (c.a == 0) return c;
    float3 v = float3(unpremul(c).rgb);
    v = gain * (v + lift * (1 - v));
    v = pow(max(v, 0), 1 / max(gamma, float3(0.001))) + offset;
    return half4(half3(clamp(v, 0, 1)) * c.a, c.a);
  }`;

const CDL = `${SRGB}
  uniform float3 slope, offset, power; uniform float sat;
  half4 main(half4 c) {
    if (c.a == 0) return c;
    float3 v = float3(unpremul(c).rgb);
    v = pow(clamp(v * slope + offset, 0, 1), power);
    float y = luma(v);
    v = clamp(y + sat * (v - y), 0, 1);
    return half4(half3(v) * c.a, c.a);
  }`;

const GRADIENT_MAP = `${SRGB}
  uniform float4 colors[8]; uniform float positions[8]; uniform int count;
  half4 main(half4 c) {
    if (c.a == 0) return c;
    float y = luma(float3(unpremul(c).rgb));
    float4 res = colors[0];
    for (int i = 1; i < 8; i++) {
      if (i >= count) break;
      float a = positions[i - 1], b = positions[i];
      if (y >= a) res = b > a ? mix(colors[i - 1], colors[i], clamp((y - a) / (b - a), 0, 1)) : colors[i];
    }
    return half4(half3(res.rgb) * c.a, c.a);
  }`;

const THRESHOLD = `${SRGB}
  uniform float level;
  half4 main(half4 c) {
    if (c.a == 0) return c;
    float y = luma(float3(unpremul(c).rgb));
    return half4(half3(step(level, y)) * c.a, c.a);
  }`;

const LUT = `
  uniform shader lut; uniform float N; uniform float cols; uniform float3 dmin; uniform float3 dscale; uniform int tetra;
  float3 fetch(float r, float g, float b) {
    float bx = mod(b, cols), by = floor(b / cols);
    return float3(lut.eval(float2(r + bx * N + 0.5, g + by * N + 0.5)).rgb);
  }
  half4 main(half4 c) {
    if (c.a == 0) return c;
    float3 v = clamp((float3(unpremul(c).rgb) - dmin) * dscale, 0, 1) * (N - 1);
    float3 i0 = floor(v), f = v - i0, i1 = min(i0 + 1, N - 1);
    float3 o;
    if (tetra == 0) {
      float3 c00 = mix(fetch(i0.r, i0.g, i0.b), fetch(i1.r, i0.g, i0.b), f.r);
      float3 c10 = mix(fetch(i0.r, i1.g, i0.b), fetch(i1.r, i1.g, i0.b), f.r);
      float3 c01 = mix(fetch(i0.r, i0.g, i1.b), fetch(i1.r, i0.g, i1.b), f.r);
      float3 c11 = mix(fetch(i0.r, i1.g, i1.b), fetch(i1.r, i1.g, i1.b), f.r);
      o = mix(mix(c00, c10, f.g), mix(c01, c11, f.g), f.b);
    } else {
      float3 c000 = fetch(i0.r, i0.g, i0.b), c111 = fetch(i1.r, i1.g, i1.b);
      if (f.r > f.g) {
        if (f.g > f.b) o = (1 - f.r) * c000 + (f.r - f.g) * fetch(i1.r, i0.g, i0.b) + (f.g - f.b) * fetch(i1.r, i1.g, i0.b) + f.b * c111;
        else if (f.r > f.b) o = (1 - f.r) * c000 + (f.r - f.b) * fetch(i1.r, i0.g, i0.b) + (f.b - f.g) * fetch(i1.r, i0.g, i1.b) + f.g * c111;
        else o = (1 - f.b) * c000 + (f.b - f.r) * fetch(i0.r, i0.g, i1.b) + (f.r - f.g) * fetch(i1.r, i0.g, i1.b) + f.g * c111;
      } else {
        if (f.b > f.g) o = (1 - f.b) * c000 + (f.b - f.g) * fetch(i0.r, i0.g, i1.b) + (f.g - f.r) * fetch(i0.r, i1.g, i1.b) + f.r * c111;
        else if (f.b > f.r) o = (1 - f.g) * c000 + (f.g - f.b) * fetch(i0.r, i1.g, i0.b) + (f.b - f.r) * fetch(i0.r, i1.g, i1.b) + f.r * c111;
        else o = (1 - f.g) * c000 + (f.g - f.r) * fetch(i0.r, i1.g, i0.b) + (f.r - f.b) * fetch(i1.r, i1.g, i0.b) + f.b * c111;
      }
    }
    return half4(half3(clamp(o, 0, 1)) * c.a, c.a);
  }`;

const rgb = (v: RGB | undefined, d: number): [number, number, number] =>
  v === undefined ? [d, d, d] : typeof v === 'number' ? [v, v, v] : [v[0], v[1], v[2]];

/** Monotone cubic interpolation through points, sampled into a 256-entry table (Fritsch–Carlson). */
function curveTable(points: readonly (readonly [number, number])[] | undefined): Uint8Array | null {
  if (!points || points.length === 0) return null;
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  if (pts[0]![0] > 0) pts.unshift([0, pts[0]![1]]);
  if (pts[pts.length - 1]![0] < 1) pts.push([1, pts[pts.length - 1]![1]]);
  const n = pts.length;
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  const d = xs.slice(0, -1).map((x, i) => (ys[i + 1]! - ys[i]!) / Math.max(1e-9, xs[i + 1]! - x));
  const m = new Array<number>(n);
  m[0] = d[0]!;
  m[n - 1] = d[n - 2]!;
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d[i]!,
      b = m[i + 1]! / d[i]!;
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * d[i]!;
      m[i + 1] = t * b * d[i]!;
    }
  }
  const out = new Uint8Array(256);
  let seg = 0;
  for (let k = 0; k < 256; k++) {
    const x = k / 255;
    while (seg < n - 2 && x > xs[seg + 1]!) seg++;
    const x0 = xs[seg]!,
      x1 = xs[seg + 1]!;
    const hh = x1 - x0 || 1;
    const t = Math.min(1, Math.max(0, (x - x0) / hh));
    const t2 = t * t,
      t3 = t2 * t;
    const y =
      (2 * t3 - 3 * t2 + 1) * ys[seg]! +
      (t3 - 2 * t2 + t) * hh * m[seg]! +
      (-2 * t3 + 3 * t2) * ys[seg + 1]! +
      (t3 - t2) * hh * m[seg + 1]!;
    out[k] = Math.round(Math.min(1, Math.max(0, y)) * 255);
  }
  return out;
}

function withStrength(f: ColorFilter, strength: number | undefined): ColorFilter {
  const s = strength ?? 1;
  if (s >= 1) return f;
  return effect('strength', STRENGTH).makeColorFilter({ s: Math.max(0, s) }, { f });
}

function one(g: Grade): ColorFilter | null {
  switch (g.kind) {
    case 'lut': {
      const loaded = g.asset._loaded();
      if (!loaded) return null;
      const f = effect('lut', LUT).makeColorFilter(
        {
          N: loaded.size,
          cols: loaded.cols,
          dmin: loaded.domainMin,
          dscale: loaded.domainScale,
          tetra: g.interpolation === 'trilinear' ? 0 : 1,
        },
        { lut: loaded.shader },
      );
      return withStrength(f, g.strength);
    }
    case 'adjust': {
      const f = effect('adjust', ADJUST).makeColorFilter({
        exposure: g.exposure ?? 0,
        brightness: g.brightness ?? 0,
        contrast: g.contrast ?? 0,
        saturation: g.saturation ?? 0,
        vibrance: g.vibrance ?? 0,
        warmth: g.warmth ?? 0,
        tint: g.tint ?? 0,
        highlights: g.highlights ?? 0,
        shadows: g.shadows ?? 0,
        fade: g.fade ?? 0,
      });
      return withStrength(f, g.strength);
    }
    case 'curves': {
      const all = curveTable(g.rgb);
      const chan = (c: readonly (readonly [number, number])[] | undefined) => {
        const t = curveTable(c);
        if (!t && !all) return null;
        const out = new Uint8Array(256);
        for (let i = 0; i < 256; i++) out[i] = all ? all[t ? t[i]! : i]! : t![i]!;
        return out;
      };
      const f = colorFilters.table(null, chan(g.red), chan(g.green), chan(g.blue));
      return f ? withStrength(f, g.strength) : null;
    }
    case 'levels': {
      const { inBlack = 0, inWhite = 1, gamma = 1, outBlack = 0, outWhite = 1 } = g;
      const t = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        const x = Math.min(1, Math.max(0, (i / 255 - inBlack) / Math.max(1e-6, inWhite - inBlack)));
        t[i] = Math.round((outBlack + (outWhite - outBlack) * x ** (1 / Math.max(1e-3, gamma))) * 255);
      }
      const f = colorFilters.table(null, t, t, t);
      return f ? withStrength(f, g.strength) : null;
    }
    case 'wheels': {
      const f = effect('wheels', WHEELS).makeColorFilter({
        lift: rgb(g.lift, 0),
        gamma: rgb(g.gamma, 1),
        gain: rgb(g.gain, 1),
        offset: rgb(g.offset, 0),
      });
      return withStrength(f, g.strength);
    }
    case 'cdl': {
      const f = effect('cdl', CDL).makeColorFilter({
        slope: rgb(g.slope, 1),
        offset: rgb(g.offset, 0),
        power: rgb(g.power, 1),
        sat: g.saturation ?? 1,
      });
      return withStrength(f, g.strength);
    }
    case 'gradientMap': {
      const stops = g.stops.slice(0, 8);
      const colors = new Array<number>(32).fill(0);
      const positions = new Array<number>(8).fill(1);
      stops.forEach((st, i) => {
        const [c, p] = Array.isArray(st)
          ? (st as readonly [Color, number])
          : [st as Color, stops.length > 1 ? i / (stops.length - 1) : 0];
        const v = toColor4f(c);
        colors.splice(i * 4, 4, v[0], v[1], v[2], v[3]);
        positions[i] = p;
      });
      const f = effect('gradientMap', GRADIENT_MAP).makeColorFilter({ colors, positions, count: stops.length });
      return withStrength(f, g.strength);
    }
    case 'mixer': {
      const [r, gg, b] = [g.red ?? [1, 0, 0], g.green ?? [0, 1, 0], g.blue ?? [0, 0, 1]];
      const f = colorFilters.matrix([...r, 0, 0, ...gg, 0, 0, ...b, 0, 0, 0, 0, 0, 1, 0]);
      return withStrength(f, g.strength);
    }
    case 'posterize': {
      const n = Math.max(2, Math.round(g.levels));
      const t = new Uint8Array(256);
      for (let i = 0; i < 256; i++) t[i] = Math.round((Math.round((i / 255) * (n - 1)) / (n - 1)) * 255);
      const f = colorFilters.table(null, t, t, t);
      return f ? withStrength(f, g.strength) : null;
    }
    case 'threshold':
      return withStrength(effect('threshold', THRESHOLD).makeColorFilter({ level: g.level }), g.strength);
    case 'blend': {
      const a = resolveGrades(g.from),
        b = resolveGrades(g.to);
      const identity = colorFilters.matrix([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
      const f = effect('mix', MIX).makeColorFilter(
        { t: Math.min(1, Math.max(0, g.t)) },
        { a: a ?? identity, b: b ?? identity },
      );
      return withStrength(f, g.strength);
    }
  }
}

/** Turns grades into one color filter, applied in order. Returns null when there's nothing to apply. @internal */
export function resolveGrades(grades: Grade | readonly Grade[] | undefined): ColorFilter | null {
  if (!grades) return null;
  const list = Array.isArray(grades) ? grades : [grades as Grade];
  let out: ColorFilter | null = null;
  for (const g of list) {
    if ((g.strength ?? 1) <= 0) continue;
    const f = one(g);
    if (!f) continue;
    out = out ? (colorFilters.compose(f, out) ?? f) : f;
  }
  return out;
}

/** LUT assets referenced by grades, for loading before drawing. @internal */
export function lutAssetsOf(grades: Grade | readonly Grade[] | undefined, out: LutAsset[] = []): LutAsset[] {
  if (!grades) return out;
  for (const g of Array.isArray(grades) ? grades : [grades as Grade]) {
    if (g.kind === 'lut') out.push(g.asset);
    else if (g.kind === 'blend') {
      lutAssetsOf(g.from, out);
      lutAssetsOf(g.to, out);
    }
  }
  return out;
}

// ---- LUT files ----

export interface ParsedLut {
  /** Points per side of the cube. */
  size: number;
  /** RGB values, red changing fastest, `size³ × 3` numbers. */
  data: Float32Array;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  title?: string;
}

/** Parses a `.cube` file (Adobe/Resolve format). 1D LUTs are expanded to a 3D cube. */
export function parseCube(text: string): ParsedLut {
  let size3 = 0,
    size1 = 0;
  let title: string | undefined;
  let dmin: [number, number, number] = [0, 0, 0];
  let dmax: [number, number, number] = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [key, ...rest] = line.split(/\s+/);
    switch (key) {
      case 'TITLE':
        title = line.slice(5).trim().replace(/^"|"$/g, '');
        continue;
      case 'LUT_3D_SIZE':
        size3 = parseInt(rest[0]!, 10);
        continue;
      case 'LUT_1D_SIZE':
        size1 = parseInt(rest[0]!, 10);
        continue;
      case 'DOMAIN_MIN':
        dmin = rest.slice(0, 3).map(Number) as [number, number, number];
        continue;
      case 'DOMAIN_MAX':
        dmax = rest.slice(0, 3).map(Number) as [number, number, number];
        continue;
      case 'LUT_1D_INPUT_RANGE':
      case 'LUT_3D_INPUT_RANGE':
        dmin = [Number(rest[0]), Number(rest[0]), Number(rest[0])];
        dmax = [Number(rest[1]), Number(rest[1]), Number(rest[1])];
        continue;
    }
    if (/^[-+.\d]/.test(key!)) {
      const nums = line.split(/\s+/).map(Number);
      if (nums.length >= 3 && nums.every((v) => Number.isFinite(v))) values.push(nums[0]!, nums[1]!, nums[2]!);
    }
    // Unknown keywords (from other tools) are ignored.
  }
  if (size1 && size3) throw new SyntaxError('parseCube: files with both a 1D and a 3D table are not supported');
  if (size3) {
    if (size3 < 2 || size3 > 256) throw new RangeError(`parseCube: LUT_3D_SIZE ${size3} is out of range`);
    if (values.length !== size3 ** 3 * 3)
      throw new SyntaxError(`parseCube: expected ${size3 ** 3} entries, got ${values.length / 3}`);
    return { size: size3, data: Float32Array.from(values), domainMin: dmin, domainMax: dmax, title };
  }
  if (size1) {
    if (values.length !== size1 * 3)
      throw new SyntaxError(`parseCube: expected ${size1} entries, got ${values.length / 3}`);
    // Expand the per-channel curve into a 33³ cube.
    const n = 33;
    const data = new Float32Array(n * n * n * 3);
    const sample = (ch: number, x: number) => {
      const p = x * (size1 - 1);
      const i = Math.min(size1 - 2, Math.floor(p));
      const f = p - i;
      return values[i * 3 + ch]! * (1 - f) + values[(i + 1) * 3 + ch]! * f;
    };
    for (let b = 0; b < n; b++)
      for (let g = 0; g < n; g++)
        for (let r = 0; r < n; r++) {
          const k = (r + n * g + n * n * b) * 3;
          data[k] = sample(0, r / (n - 1));
          data[k + 1] = sample(1, g / (n - 1));
          data[k + 2] = sample(2, b / (n - 1));
        }
    return { size: n, data, domainMin: dmin, domainMax: dmax, title };
  }
  throw new SyntaxError('parseCube: no LUT_3D_SIZE or LUT_1D_SIZE found');
}
