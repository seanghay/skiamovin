// Animation helpers. All are pure functions of time, so frames can be rendered in any order.
import { Color as C, type Color, toColor4f } from '../core/color.ts';
import { ContourMeasureIter, Path } from '../core/skia.ts';
import { type SpringParams, springConstants, springSettlingTime, springState } from './physics.ts';

export type EasingFunction = (t: number) => number;

// Easing

function bezier(x1: number, y1: number, x2: number, y2: number): EasingFunction {
  const cx = 3 * x1,
    bx = 3 * (x2 - x1) - cx,
    ax = 1 - cx - bx;
  const cy = 3 * y1,
    by = 3 * (y2 - y1) - cy,
    ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-6) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0,
      hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

const inF = (f: EasingFunction): EasingFunction => f;
const outF =
  (f: EasingFunction): EasingFunction =>
  (t) =>
    1 - f(1 - t);
const inOutF =
  (f: EasingFunction): EasingFunction =>
  (t) =>
    t < 0.5 ? f(t * 2) / 2 : 1 - f((1 - t) * 2) / 2;

const quad: EasingFunction = (t) => t * t;
const cubic: EasingFunction = (t) => t * t * t;
const quart: EasingFunction = (t) => t ** 4;
const quint: EasingFunction = (t) => t ** 5;
const sine: EasingFunction = (t) => 1 - Math.cos((t * Math.PI) / 2);
const expo: EasingFunction = (t) => (t === 0 ? 0 : 2 ** (10 * t - 10));
const circ: EasingFunction = (t) => 1 - Math.sqrt(1 - t * t);
const back =
  (s = 1.70158): EasingFunction =>
  (t) =>
    t * t * ((s + 1) * t - s);
const elastic = (bounciness = 1): EasingFunction => {
  const p = bounciness * Math.PI;
  return (t) => 1 - Math.cos((t * Math.PI) / 2) ** 3 * Math.cos(t * p);
};
const bounceOut: EasingFunction = (t) => {
  const n = 7.5625,
    d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) {
    const u = t - 1.5 / d;
    return n * u * u + 0.75;
  }
  if (t < 2.5 / d) {
    const u = t - 2.25 / d;
    return n * u * u + 0.9375;
  }
  const u = t - 2.625 / d;
  return n * u * u + 0.984375;
};

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Manim's default rate function: an S-curve that starts and ends with zero speed. */
function smooth(t: number, inflection = 10): number {
  const error = sigmoid(-inflection / 2);
  return Math.min(1, Math.max(0, (sigmoid(inflection * (t - 0.5)) - error) / (1 - 2 * error)));
}

/** Straight lines between points, like CSS `linear()`. A point is a value, or `[value, at]` with `at` in 0..1. */
function piecewise(points: readonly (number | readonly [number, number])[]): EasingFunction {
  if (points.length < 2) throw new RangeError('Easing.piecewise: needs at least 2 points');
  const ys = points.map((p) => (typeof p === 'number' ? p : p[0]));
  const xs: (number | undefined)[] = points.map((p) => (typeof p === 'number' ? undefined : p[1]));
  xs[0] ??= 0;
  xs[xs.length - 1] ??= 1;
  // Points without a position are spread evenly between their neighbours, as in CSS.
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] !== undefined) continue;
    let j = i;
    while (xs[j] === undefined) j++;
    const a = xs[i - 1]!,
      b = xs[j]!;
    for (let k = i; k < j; k++) xs[k] = a + ((b - a) * (k - i + 1)) / (j - i + 1);
  }
  const x = xs as number[];
  return (t) => {
    if (t <= x[0]!) return ys[0]!;
    for (let i = 1; i < x.length; i++)
      if (t <= x[i]!) {
        const span = x[i]! - x[i - 1]!;
        return span > 0 ? ys[i - 1]! + ((ys[i]! - ys[i - 1]!) * (t - x[i - 1]!)) / span : ys[i]!;
      }
    return ys[ys.length - 1]!;
  };
}

/** An ease drawn as an SVG path from (0, 0) to (1, 1), sampled into a table the first time it's used. */
function customEase(d: string, samples = 512): EasingFunction {
  let xs: Float64Array | null = null,
    ys: Float64Array | null = null;
  const build = () => {
    const path = Path.fromSVG(d);
    if (!path) throw new SyntaxError(`Easing.custom: invalid path '${d}'`);
    const px: number[] = [],
      py: number[] = [];
    using it = new ContourMeasureIter(path, false);
    for (let m = it.next(); m; m = it.next()) {
      const len = m.length();
      for (let i = 0; i <= samples; i++) {
        const pt = m.getPosTan((len * i) / samples);
        if (pt) {
          px.push(pt[0]);
          py.push(pt[1]);
        }
      }
      m.delete();
    }
    path.delete();
    xs = Float64Array.from(px);
    ys = Float64Array.from(py);
  };
  return (t) => {
    if (!xs) build();
    const x = xs!,
      y = ys!;
    if (t <= x[0]!) return y[0]!;
    if (t >= x[x.length - 1]!) return y[y.length - 1]!;
    let lo = 0,
      hi = x.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (x[mid]! <= t) lo = mid;
      else hi = mid;
    }
    const span = x[hi]! - x[lo]!;
    return span > 0 ? y[lo]! + ((y[hi]! - y[lo]!) * (t - x[lo]!)) / span : y[hi]!;
  };
}

export const Easing = {
  linear: ((t) => t) as EasingFunction,
  /** Manim's S-curve (the default in Manim). */
  smooth: ((t) => smooth(t)) as EasingFunction,
  /** Goes to 1 at the midpoint and back to 0, smoothly. */
  thereAndBack: ((t) => smooth(t < 0.5 ? 2 * t : 2 * (1 - t))) as EasingFunction,
  /** Runs `ease` only between `a` and `b`, holding its start before and its end after. */
  squish(ease: EasingFunction, a: number, b: number): EasingFunction {
    return (t) => (t <= a ? ease(0) : t >= b ? ease(1) : ease((t - a) / (b - a)));
  },
  piecewise,
  custom: customEase,
  /**
   * A spring as an ease from 0 to 1, stretched over the tween's duration. Give the tween the spring's natural
   * length with `springSettlingTime(params)` to keep its feel.
   */
  spring(params: SpringParams): EasingFunction {
    const { omega, zeta } = springConstants(params);
    const settle = springSettlingTime(params);
    return (t) => (t >= 1 ? 1 : 1 + springState(t * settle, -1, 0, omega, zeta)[0]);
  },
  /** A jittery ease that still starts at 0 and ends at 1. Seeded, so it's the same every render. */
  irregular(seed: string | number, options: { points?: number; strength?: number } = {}): EasingFunction {
    const n = Math.max(2, options.points ?? 20);
    const strength = options.strength ?? 0.5;
    const pts = Array.from({ length: n + 1 }, (_, i) => {
      if (i === 0 || i === n) return i / n;
      return Math.min(1, Math.max(0, i / n + (random(`${seed}:${i}`) - 0.5) * (strength / n) * 2));
    });
    return piecewise(pts);
  },
  in: inF,
  out: outF,
  inOut: inOutF,
  quad,
  cubic,
  quart,
  quint,
  sine,
  expo,
  circ,
  back,
  elastic,
  bounce: ((t: number) => 1 - bounceOut(1 - t)) as EasingFunction,
  bezier,
  cubicBezier: bezier,
  steps(n: number): EasingFunction {
    return (t) => Math.min(1, Math.floor(t * n) / n);
  },
  ease: bezier(0.25, 0.1, 0.25, 1),
  inQuad: quad,
  outQuad: outF(quad),
  inOutQuad: inOutF(quad),
  inCubic: cubic,
  outCubic: outF(cubic),
  inOutCubic: inOutF(cubic),
  inQuart: quart,
  outQuart: outF(quart),
  inOutQuart: inOutF(quart),
  inQuint: quint,
  outQuint: outF(quint),
  inOutQuint: inOutF(quint),
  inSine: sine,
  outSine: outF(sine),
  inOutSine: inOutF(sine),
  inExpo: expo,
  outExpo: outF(expo),
  inOutExpo: inOutF(expo),
  inCirc: circ,
  outCirc: outF(circ),
  inOutCirc: inOutF(circ),
  inBack: back(),
  outBack: outF(back()),
  inOutBack: inOutF(back()),
  outBounce: bounceOut,
};

// Interpolation

export type Extrapolate = 'clamp' | 'extend' | 'identity';

export interface InterpolateOptions {
  easing?: EasingFunction | readonly EasingFunction[];
  extrapolateLeft?: Extrapolate;
  extrapolateRight?: Extrapolate;
}

export function interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  options: InterpolateOptions = {},
): number {
  const n = inputRange.length;
  if (n < 2 || n !== outputRange.length) throw new RangeError('interpolate: ranges must have the same length (≥ 2)');
  for (let i = 1; i < n; i++)
    if (!(inputRange[i]! > inputRange[i - 1]!))
      throw new RangeError('interpolate: inputRange must be strictly ascending');
  const { extrapolateLeft = 'clamp', extrapolateRight = 'clamp' } = options;
  if (input < inputRange[0]!) {
    if (extrapolateLeft === 'clamp') return outputRange[0]!;
    if (extrapolateLeft === 'identity') return input;
  }
  if (input > inputRange[n - 1]!) {
    if (extrapolateRight === 'clamp') return outputRange[n - 1]!;
    if (extrapolateRight === 'identity') return input;
  }
  let seg = 0;
  while (seg < n - 2 && input > inputRange[seg + 1]!) seg++;
  const a = inputRange[seg]!,
    b = inputRange[seg + 1]!;
  let t = (input - a) / (b - a);
  const e = options.easing;
  const ease = Array.isArray(e) ? e[seg] : (e as EasingFunction | undefined);
  if (ease && t >= 0 && t <= 1) t = ease(t);
  return outputRange[seg]! + (outputRange[seg + 1]! - outputRange[seg]!) * t;
}

// Colors

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToOklab([r, g, b]: number[]): [number, number, number] {
  const lr = toLinear(r!),
    lg = toLinear(g!),
    lb = toLinear(b!);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]: number[]): [number, number, number] {
  const l = (L! + 0.3963377774 * a! + 0.2158037573 * b!) ** 3;
  const m = (L! - 0.1055613458 * a! - 0.0638541728 * b!) ** 3;
  const s = (L! - 0.0894841775 * a! - 1.291485548 * b!) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clamp(toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    clamp(toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    clamp(toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  ];
}

export function mixColors(a: Color, b: Color, t: number, space: 'oklab' | 'srgb' | 'linear-srgb' = 'oklab'): number {
  const ca = toColor4f(a),
    cb = toColor4f(b);
  let rgb: number[];
  if (space === 'oklab') {
    const la = rgbToOklab(ca),
      lb = rgbToOklab(cb);
    rgb = oklabToRgb(la.map((v, i) => v + (lb[i]! - v) * t));
  } else if (space === 'linear-srgb') {
    rgb = [0, 1, 2].map((i) => toSrgb(toLinear(ca[i]!) + (toLinear(cb[i]!) - toLinear(ca[i]!)) * t));
  } else {
    rgb = [0, 1, 2].map((i) => ca[i]! + (cb[i]! - ca[i]!) * t);
  }
  const alpha = ca[3] + (cb[3] - ca[3]) * t;
  return C.argb(
    Math.round(alpha * 255),
    Math.round(rgb[0]! * 255),
    Math.round(rgb[1]! * 255),
    Math.round(rgb[2]! * 255),
  );
}

export function interpolateColor(
  input: number,
  inputRange: readonly number[],
  colors: readonly Color[],
  options: { space?: 'oklab' | 'srgb' | 'linear-srgb'; easing?: EasingFunction } = {},
): number {
  const n = inputRange.length;
  if (n !== colors.length || n < 2) throw new RangeError('interpolateColor: ranges must have the same length (≥ 2)');
  if (input <= inputRange[0]!) return mixColors(colors[0]!, colors[0]!, 0);
  if (input >= inputRange[n - 1]!) return mixColors(colors[n - 1]!, colors[n - 1]!, 0);
  let seg = 0;
  while (seg < n - 2 && input > inputRange[seg + 1]!) seg++;
  let t = (input - inputRange[seg]!) / (inputRange[seg + 1]! - inputRange[seg]!);
  if (options.easing) t = options.easing(t);
  return mixColors(colors[seg]!, colors[seg + 1]!, t, options.space ?? 'oklab');
}

// Springs

export interface SpringOptions {
  timestamp: number;
  from?: number;
  to?: number;
  delay?: number;
  mass?: number;
  stiffness?: number;
  damping?: number;
  overshootClamping?: boolean;
  /** Stretch the spring so it settles in exactly this many seconds. */
  duration?: number;
  /** Time of one oscillation in seconds, as in SwiftUI. Use with `bounce` instead of mass, stiffness and damping. */
  response?: number;
  /** 0 for no overshoot, up to 1 for a lot. Negative is sluggish. Use with `response`. */
  bounce?: number;
  /** Starting speed in value units per second. */
  velocity?: number;
}

/** Offset from the target of a spring released at rest from -1. Progress is 1 minus this value. */
function springX(t: number, mass: number, stiffness: number, damping: number): number {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  if (zeta === 1) return Math.exp(-w0 * t) * (1 + w0 * t);
  const s = Math.sqrt(zeta * zeta - 1);
  const r1 = -w0 * (zeta - s),
    r2 = -w0 * (zeta + s);
  return (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}

function settleTime(mass: number, stiffness: number, damping: number, threshold = 0.001): number {
  // Last time |x| exceeds the threshold, sampled at 1/600 s.
  const step = 1 / 600;
  let last = 0;
  for (let t = 0; t < 60; t += step) {
    if (Math.abs(springX(t, mass, stiffness, damping)) > threshold) last = t;
    else if (t - last > 1) break;
  }
  return last + step;
}

function paramsOf(o: Omit<SpringOptions, 'timestamp'>): {
  omega: number;
  zeta: number;
  mass: number;
  stiffness: number;
  damping: number;
} {
  if (o.response !== undefined) return springConstants({ response: o.response, bounce: o.bounce });
  return springConstants({ mass: o.mass ?? 1, stiffness: o.stiffness ?? 100, damping: o.damping ?? 10 });
}

/** Spring motion, computed directly from the timestamp. */
export function spring(options: SpringOptions): number {
  const { from = 0, to = 1, delay = 0, overshootClamping = false, velocity = 0 } = options;
  let t = options.timestamp - delay;
  if (t <= 0) return from;
  const c = paramsOf(options);
  if (options.duration !== undefined && options.duration > 0)
    t *= settleTime(c.mass, c.stiffness, c.damping) / options.duration;
  const [x] = springState(t, from - to, velocity, c.omega, c.zeta);
  let value = to + x;
  if (overshootClamping) value = from <= to ? Math.min(to, value) : Math.max(to, value);
  return value;
}

/** Speed of a spring at the timestamp, value units per second. */
spring.velocity = (options: SpringOptions): number => {
  const { from = 0, to = 1, delay = 0, velocity = 0 } = options;
  const t = options.timestamp - delay;
  if (t <= 0) return velocity;
  const c = paramsOf(options);
  let scale = 1;
  if (options.duration !== undefined && options.duration > 0)
    scale = settleTime(c.mass, c.stiffness, c.damping) / options.duration;
  return springState(t * scale, from - to, velocity, c.omega, c.zeta)[1] * scale;
};

/** Seconds until the spring comes to rest (|displacement| < 0.1%). */
spring.computeSettleTime = (options: Omit<SpringOptions, 'timestamp'> = {}): number => {
  const delay = options.delay ?? 0;
  if (options.duration) return options.duration + delay;
  const c = paramsOf(options);
  return settleTime(c.mass, c.stiffness, c.damping) + delay;
};

// Random numbers and noise

function hash32(seed: string | number): number {
  const s = String(seed);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Final bit mixing from MurmurHash3.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Deterministic pseudo-random number in [0, 1) for a seed. */
export function random(seed: string | number): number {
  return hash32(seed) / 4294967296;
}

const permCache = new Map<string, Uint8Array>();
function perm(seed: string | number): Uint8Array {
  const key = String(seed);
  let p = permCache.get(key);
  if (!p) {
    const base = new Uint8Array(256).map((_, i) => i);
    let s = hash32(key) || 1;
    for (let i = 255; i > 0; i--) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      const j = s % (i + 1);
      [base[i], base[j]] = [base[j]!, base[i]!];
    }
    p = new Uint8Array(512);
    for (let i = 0; i < 512; i++) p[i] = base[i & 255]!;
    permCache.set(key, p);
  }
  return p;
}

const G3 = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1],
];

/** Seeded 3D simplex noise in [-1, 1]. */
export function noise(seed: string | number, x: number, y = 0, z = 0): number {
  const p = perm(seed);
  const F3 = 1 / 3,
    G = 1 / 6;
  const s = (x + y + z) * F3;
  const i = Math.floor(x + s),
    j = Math.floor(y + s),
    k = Math.floor(z + s);
  const t = (i + j + k) * G;
  const x0 = x - (i - t),
    y0 = y - (j - t),
    z0 = z - (k - t);
  let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
  if (x0 >= y0) {
    if (y0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 1, 0];
    else if (x0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 0, 1];
    else [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 1, 0, 1];
  } else {
    if (y0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 0, 1, 1];
    else if (x0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 0, 1, 1];
    else [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 1, 1, 0];
  }
  const corners = [
    [x0, y0, z0, 0, 0, 0],
    [x0 - i1 + G, y0 - j1 + G, z0 - k1 + G, i1, j1, k1],
    [x0 - i2 + 2 * G, y0 - j2 + 2 * G, z0 - k2 + 2 * G, i2, j2, k2],
    [x0 - 1 + 3 * G, y0 - 1 + 3 * G, z0 - 1 + 3 * G, 1, 1, 1],
  ];
  const ii = i & 255,
    jj = j & 255,
    kk = k & 255;
  let n = 0;
  for (const [cx, cy, cz, oi, oj, ok] of corners as number[][]) {
    let tt = 0.6 - cx! * cx! - cy! * cy! - cz! * cz!;
    if (tt < 0) continue;
    const gi = p[ii + oi! + p[jj + oj! + p[kk + ok!]!]!]! % 12;
    const g = G3[gi]!;
    tt *= tt;
    n += tt * tt * (g[0]! * cx! + g[1]! * cy! + g[2]! * cz!);
  }
  return 32 * n;
}

// Stagger

export interface StaggerOptions {
  /** Where the wave starts: an index, or 'first' (default), 'last', 'center', 'edges' or 'random'. */
  from?: number | 'first' | 'last' | 'center' | 'edges' | 'random';
  /** Lay the items out as `[rows, columns]` and measure distance in 2D. */
  grid?: readonly [number, number];
  /** With a grid, measure distance along one axis only. */
  axis?: 'x' | 'y';
  /** Shapes how the value grows with distance. */
  ease?: EasingFunction;
  /** Added to every value. */
  start?: number;
  /** Seed for `from: 'random'`. */
  seed?: string | number;
  reversed?: boolean;
}

/** `(index, count) => value`, from `stagger()`. */
export type StaggerFunction = (index: number, count: number) => number;

/**
 * Spreads a value over items by their distance from a starting point, like anime.js's `stagger`. A number gives
 * that much per step of distance (`stagger(0.05)` for delays); a `[from, to]` range spreads values across it.
 */
export function stagger(value: number | readonly [number, number], options: StaggerOptions = {}): StaggerFunction {
  const { from = 'first', grid, axis, ease, start = 0, reversed = false } = options;
  const cache = new Map<number, { d: Float64Array; max: number }>();
  const distances = (count: number): { d: Float64Array; max: number } => {
    const hit = cache.get(count);
    if (hit) return hit;
    const d = new Float64Array(count);
    if (from === 'random') {
      const order = Array.from({ length: count }, (_, i) => i).sort(
        (a, b) => random(`${options.seed ?? 'stagger'}:${a}`) - random(`${options.seed ?? 'stagger'}:${b}`),
      );
      order.forEach((item, rank) => {
        d[item] = rank;
      });
    } else if (grid) {
      const [rows, cols] = grid;
      const fi = from === 'first' ? 0 : from === 'last' ? count - 1 : typeof from === 'number' ? from : -1;
      const fx = fi >= 0 ? fi % cols : (cols - 1) / 2;
      const fy = fi >= 0 ? Math.floor(fi / cols) : (rows - 1) / 2;
      for (let i = 0; i < count; i++) {
        const dx = fx - (i % cols),
          dy = fy - Math.floor(i / cols);
        d[i] = axis === 'x' ? Math.abs(dx) : axis === 'y' ? Math.abs(dy) : Math.hypot(dx, dy);
      }
      if (from === 'edges') {
        const max = Math.max(...d);
        for (let i = 0; i < count; i++) d[i] = max - d[i]!;
      }
    } else {
      const center = (count - 1) / 2;
      const f = from === 'first' ? 0 : from === 'last' ? count - 1 : typeof from === 'number' ? from : center;
      for (let i = 0; i < count; i++) d[i] = Math.abs(f - i);
      if (from === 'edges') for (let i = 0; i < count; i++) d[i] = center - d[i]!;
    }
    if (reversed) {
      const max = Math.max(...d);
      for (let i = 0; i < count; i++) d[i] = max - d[i]!;
    }
    let max = 0;
    for (const v of d) if (v > max) max = v;
    const entry = { d, max };
    cache.set(count, entry);
    return entry;
  };
  return (index, count) => {
    const { d, max } = distances(Math.max(1, count));
    const dist = d[Math.min(index, d.length - 1)]!;
    if (Array.isArray(value)) {
      const [a, b] = value as readonly [number, number];
      const p = max > 0 ? dist / max : 0;
      return start + a + (b - a) * (ease ? ease(p) : p);
    }
    const each = value as number;
    return start + (ease && max > 0 ? ease(dist / max) * max : dist) * each;
  };
}

// Keyframes and expressions

export interface KeyframeOptions {
  /** Position of each keyframe in 0..1. Defaults to evenly spaced. */
  times?: readonly number[];
  /** One ease for every segment, or one per segment. */
  easing?: EasingFunction | readonly EasingFunction[];
  /** Length of the whole animation, seconds. Default 1. */
  duration?: number;
  delay?: number;
}

/** The value at `timestamp` of an animation through several keyframes. */
export function keyframes(timestamp: number, values: readonly number[], options: KeyframeOptions = {}): number {
  const n = values.length;
  if (n === 0) throw new RangeError('keyframes: needs at least one value');
  if (n === 1) return values[0]!;
  const times = options.times ?? values.map((_, i) => i / (n - 1));
  if (times.length !== n) throw new RangeError(`keyframes: got ${times.length} times for ${n} values`);
  const duration = options.duration ?? 1;
  const t = (timestamp - (options.delay ?? 0)) / duration;
  return interpolate(t, times, values, { easing: options.easing });
}

/**
 * Smooth random motion around zero, like After Effects' `wiggle()`: `freq` wiggles per second, up to `amount`
 * either way. Seeded, so it's the same every render.
 */
export function wiggle(
  timestamp: number,
  freq: number,
  amount: number,
  options: { seed?: string | number; octaves?: number } = {},
): number {
  const octaves = Math.max(1, options.octaves ?? 1);
  let v = 0,
    a = 1,
    total = 0;
  for (let o = 0; o < octaves; o++) {
    v += noise(options.seed ?? 'wiggle', timestamp * freq * 2 ** o, o * 31.7) * a;
    total += a;
    a /= 2;
  }
  return (v / total) * amount;
}

/** Maps a time onto a loop of `duration` seconds: 'cycle' starts over, 'pingpong' plays back and forth. */
export function loopTime(timestamp: number, duration: number, mode: 'cycle' | 'pingpong' = 'cycle'): number {
  if (duration <= 0) return 0;
  const t = ((timestamp % duration) + duration) % duration;
  if (mode === 'cycle') return t;
  const cycle = Math.floor(timestamp / duration);
  return cycle % 2 === 0 ? t : duration - t;
}

// Timeline

type TweenValue = number | string | readonly number[];
type Values = Record<string, TweenValue>;

interface Repeat {
  repeat: number;
  yoyo: boolean;
  repeatDelay: number;
}

interface Tween extends Repeat {
  target: string;
  kind: 'to' | 'from' | 'fromTo' | 'set';
  from?: Values;
  to?: Values;
  start: number;
  duration: number;
  easing: EasingFunction;
}

export interface TweenOptions {
  /** Start time: seconds, a label, `'<'` (start of the previous tween), `'>'` (its end), with offsets such as `'<+0.3'`, `'>-25%'` or `'label+=1'`. */
  at?: number | string;
  duration?: number;
  easing?: EasingFunction;
  /** Delay between consecutive targets: seconds, a `stagger()` function, or stagger options with `each`. */
  stagger?: number | StaggerFunction | (StaggerOptions & { each: number });
  /** Extra times to play. -1 repeats forever. */
  repeat?: number;
  /** Play every other repeat backwards. */
  yoyo?: boolean;
  repeatDelay?: number;
}

export interface TimelineOptions {
  repeat?: number;
  yoyo?: boolean;
  repeatDelay?: number;
  /** Playback speed. 2 plays twice as fast. */
  timeScale?: number;
  /** Labels known from the start, such as named time events from `composition.meta.json`. */
  labels?: Record<string, number>;
}

const DEFAULTS: Record<string, number> = { opacity: 1, scale: 1, scaleX: 1, scaleY: 1 };

function lerpValue(a: TweenValue, b: TweenValue, t: number): TweenValue {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v: number, i: number) => v + ((b[i] as number) - v) * t);
  if (typeof a === 'string' || typeof b === 'string') return mixColors(a as Color, b as Color, t);
  return t < 1 ? a : b;
}

/** Total length of something that plays `duration` seconds with repeats. */
function repeatedLength(duration: number, r: Repeat): number {
  if (r.repeat < 0) return Infinity;
  return duration * (r.repeat + 1) + r.repeatDelay * r.repeat;
}

/** Progress (0..1) at local time `t` of something that plays `duration` seconds with repeats. */
function repeatedProgress(t: number, duration: number, r: Repeat): number {
  if (duration <= 0) return 1;
  const cycle = duration + r.repeatDelay;
  let i = Math.floor(t / cycle);
  let within = t - i * cycle;
  if (r.repeat >= 0 && i > r.repeat) {
    i = r.repeat;
    within = duration;
  }
  let p = Math.min(1, within / duration);
  if (r.yoyo && i % 2 === 1) p = 1 - p;
  return p;
}

/** A GSAP-style timeline, evaluated from the timestamp. Times are in seconds. */
export class Timeline {
  #tweens: Tween[] = [];
  /** Nested timelines with their own repeats or speed, evaluated on their own clock. */
  #children: { timeline: Timeline; offset: number }[] = [];
  #labels = new Map<string, number>();
  #lastStart = 0;
  #lastEnd = 0;
  #options: Required<Omit<TimelineOptions, 'labels'>>;

  constructor(options: TimelineOptions = {}) {
    this.#options = {
      repeat: options.repeat ?? 0,
      yoyo: options.yoyo ?? false,
      repeatDelay: options.repeatDelay ?? 0,
      timeScale: options.timeScale ?? 1,
    };
    for (const [name, at] of Object.entries(options.labels ?? {})) this.#labels.set(name, at);
  }

  #resolveAt(at: number | string | undefined, insertedDuration = 0): number {
    if (at === undefined) return this.#lastEnd;
    if (typeof at === 'number') return at;
    const m = /^([<>]|[A-Za-z_][\w-]*)?\s*(?:([+-])?=?\s*([\d.]+)\s*(%)?)?$/.exec(at.trim());
    if (!m) throw new SyntaxError(`Timeline: invalid position '${at}'`);
    const [, ref, sign, num, percent] = m;
    let base: number;
    if (ref === '>') base = this.#lastEnd;
    else if (ref === '<') base = this.#lastStart;
    else if (ref) {
      const l = this.#labels.get(ref);
      if (l === undefined) throw new Error(`Timeline: unknown label '${ref}'`);
      base = l;
    } else base = this.#lastEnd;
    if (!num) return base;
    // A bare number is an absolute time.
    if (!ref && !sign && !percent) return parseFloat(num);
    let off = parseFloat(num);
    // A percent after '<' or '>' is of the previous tween's length; otherwise of the tween being added.
    if (percent) off = (off / 100) * (ref === '<' || ref === '>' ? this.#lastEnd - this.#lastStart : insertedDuration);
    return base + (sign === '-' ? -off : off);
  }

  #add(
    kind: Tween['kind'],
    targets: string | readonly string[],
    from: Values | undefined,
    to: Values | undefined,
    opts: TweenOptions,
  ): this {
    const list = typeof targets === 'string' ? [targets] : targets;
    const duration = kind === 'set' ? 0 : (opts.duration ?? 0.5);
    const start = this.#resolveAt(opts.at, duration);
    const easing = opts.easing ?? Easing.outCubic;
    const rep: Repeat = { repeat: opts.repeat ?? 0, yoyo: opts.yoyo ?? false, repeatDelay: opts.repeatDelay ?? 0 };
    const st = opts.stagger;
    const delayOf: StaggerFunction =
      typeof st === 'function' ? st : typeof st === 'number' ? (i) => i * st : st ? stagger(st.each, st) : () => 0;
    let end = start;
    list.forEach((target, i) => {
      const s = start + delayOf(i, list.length);
      this.#tweens.push({ target, kind, from, to, start: s, duration, easing, ...rep });
      end = Math.max(end, s + repeatedLength(duration, rep));
    });
    this.#lastStart = start;
    this.#lastEnd = end;
    return this;
  }

  to(targets: string | readonly string[], values: Values, options: TweenOptions = {}): this {
    return this.#add('to', targets, undefined, values, options);
  }
  from(targets: string | readonly string[], values: Values, options: TweenOptions = {}): this {
    return this.#add('from', targets, values, undefined, options);
  }
  fromTo(targets: string | readonly string[], from: Values, to: Values, options: TweenOptions = {}): this {
    return this.#add('fromTo', targets, from, to, options);
  }
  set(targets: string | readonly string[], values: Values, options: { at?: number | string } = {}): this {
    const end = this.#lastEnd,
      start = this.#lastStart;
    this.#add('set', targets, undefined, values, { at: options.at ?? 0, duration: 0 });
    if (options.at === undefined) {
      this.#lastEnd = end;
      this.#lastStart = start;
    }
    return this;
  }
  /**
   * Animates through several values per property: `keyframes('box', { x: [0, 100, 50] }, { duration: 2 })`.
   * `times` places each keyframe in 0..1; `easing` is one ease or one per segment.
   */
  keyframes(
    targets: string | readonly string[],
    values: Record<string, readonly TweenValue[]>,
    options: Omit<TweenOptions, 'easing'> & {
      times?: readonly number[];
      easing?: EasingFunction | readonly EasingFunction[];
    } = {},
  ): this {
    const duration = options.duration ?? 1;
    const start = this.#resolveAt(options.at, duration);
    const list = typeof targets === 'string' ? [targets] : targets;
    let end = start;
    for (const [prop, frames] of Object.entries(values)) {
      const n = frames.length;
      if (n < 2) throw new RangeError(`Timeline.keyframes: '${prop}' needs at least 2 values`);
      const times = options.times ?? frames.map((_, i) => i / (n - 1));
      if (times.length !== n) throw new RangeError(`Timeline.keyframes: got ${times.length} times for ${n} values`);
      for (let k = 0; k < n - 1; k++) {
        const e = options.easing;
        const easing = Array.isArray(e)
          ? (e[k] ?? Easing.linear)
          : ((e as EasingFunction | undefined) ?? Easing.linear);
        this.#add(
          'fromTo',
          list,
          { [prop]: frames[k]! },
          { [prop]: frames[k + 1]! },
          {
            ...options,
            at: start + times[k]! * duration,
            duration: (times[k + 1]! - times[k]!) * duration,
            easing,
          },
        );
        end = Math.max(end, this.#lastEnd);
      }
    }
    this.#lastStart = start;
    this.#lastEnd = end;
    return this;
  }
  label(name: string, at?: number | string): this {
    this.#labels.set(name, this.#resolveAt(at));
    return this;
  }
  /** Adds another timeline's tweens at `at`, with its own repeats and speed baked in. */
  add(timeline: Timeline, at?: number | string): this {
    const offset = this.#resolveAt(at, timeline.totalDuration);
    if (timeline.#isPlain()) {
      for (const t of timeline.#tweens) this.#tweens.push({ ...t, start: t.start + offset });
      for (const c of timeline.#children) this.#children.push({ timeline: c.timeline, offset: c.offset + offset });
    } else {
      this.#children.push({ timeline, offset });
    }
    this.#lastStart = offset;
    this.#lastEnd = offset + timeline.totalDuration;
    return this;
  }
  #isPlain(): boolean {
    const o = this.#options;
    return o.repeat === 0 && o.timeScale === 1;
  }
  /** Length of one play, seconds. */
  get duration(): number {
    let d = this.#tweens.reduce((m, t) => Math.max(m, t.start + repeatedLength(t.duration, t)), 0);
    for (const c of this.#children) d = Math.max(d, c.offset + c.timeline.totalDuration);
    return d;
  }
  /** Length including the timeline's repeats and speed. Infinity when it repeats forever. */
  get totalDuration(): number {
    return repeatedLength(this.duration, this.#options) / this.#options.timeScale;
  }
  /** The time inside one play that `timestamp` maps to. */
  #localTime(timestamp: number): number {
    const o = this.#options;
    const d = this.duration;
    const t = timestamp * o.timeScale;
    if (o.repeat === 0) return t;
    return repeatedProgress(Math.max(0, t), d, o) * d;
  }

  /** Evaluates every target at `timestamp`. */
  getValues(timestamp: number): Record<string, Record<string, any>> {
    const t = this.#localTime(timestamp);
    const byTarget = new Map<string, Tween[]>();
    for (const tw of this.#tweens) {
      let a = byTarget.get(tw.target);
      if (!a) {
        a = [];
        byTarget.set(tw.target, a);
      }
      a.push(tw);
    }
    const out: Record<string, Record<string, any>> = {};
    for (const [target, tweens] of byTarget) {
      const props = new Set<string>();
      for (const tw of tweens) for (const k of Object.keys({ ...tw.from, ...tw.to })) props.add(k);
      const values: Record<string, TweenValue> = {};
      for (const prop of props)
        values[prop] = evalProp(
          tweens.filter((tw) => (tw.from && prop in tw.from) || (tw.to && prop in tw.to)),
          prop,
          t,
        );
      out[target] = values;
    }
    // Nested timelines take over the properties they animate once they've started.
    for (const c of this.#children) {
      if (t < c.offset) continue;
      for (const [target, values] of Object.entries(c.timeline.getValues(t - c.offset))) {
        out[target] = { ...out[target], ...values };
      }
    }
    return out;
  }

  /** Plays timelines together. Its length is the longest one. */
  static all(...timelines: Timeline[]): Timeline {
    return Timeline.#combine(
      timelines,
      timelines.map(() => 0),
    );
  }
  /** Plays timelines one after another. */
  static chain(...timelines: Timeline[]): Timeline {
    let t = 0;
    return Timeline.#combine(
      timelines,
      timelines.map((tl) => {
        const s = t;
        t += tl.totalDuration;
        return s;
      }),
    );
  }
  /** Starts each timeline `gap` seconds after the previous one starts. */
  static sequence(gap: number, ...timelines: Timeline[]): Timeline {
    return Timeline.#combine(
      timelines,
      timelines.map((_, i) => i * gap),
    );
  }
  /** Starts a timeline `seconds` later. */
  static delay(seconds: number, timeline: Timeline): Timeline {
    return Timeline.#combine([timeline], [seconds]);
  }
  static #combine(parts: readonly Timeline[], starts: readonly number[]): Timeline {
    const out = new Timeline();
    parts.forEach((p, i) => {
      out.add(p, starts[i]!);
    });
    return out;
  }

  /** The value of one property of one target at `timestamp`. */
  valueAt(target: string, prop: string, timestamp: number): TweenValue | undefined {
    return this.getValues(timestamp)[target]?.[prop];
  }
}

function evalProp(tweens: Tween[], prop: string, t: number): TweenValue {
  const sorted = [...tweens].sort((a, b) => a.start - b.start);
  let current: TweenValue = DEFAULTS[prop] ?? 0;
  // Resolve each tween's from/to by walking in start order.
  const resolved: { tween: Tween; from: TweenValue; to: TweenValue }[] = [];
  for (const tw of sorted) {
    let from: TweenValue, to: TweenValue;
    if (tw.kind === 'set') {
      from = to = tw.to![prop]!;
    } else if (tw.kind === 'to') {
      from = current;
      to = tw.to![prop]!;
    } else if (tw.kind === 'from') {
      from = tw.from![prop]!;
      to = current;
    } else {
      from = tw.from?.[prop] ?? current;
      to = tw.to?.[prop] ?? current;
    }
    resolved.push({ tween: tw, from, to });
    // A tween that ends on a backwards play leaves its start value.
    const r = tw.repeat;
    current = tw.yoyo && r > 0 && r % 2 === 1 ? from : to;
  }
  // Before the first tween, a leading `from`, `fromTo` or `set` gives the starting value, as in GSAP.
  const first = resolved[0];
  let value: TweenValue = DEFAULTS[prop] ?? 0;
  if (first) {
    const k = first.tween.kind;
    if (k === 'from' || k === 'fromTo' || k === 'set') value = k === 'set' ? first.to : first.from;
  }
  for (const r of resolved) {
    const tw = r.tween;
    if (t < tw.start) break;
    if (tw.duration <= 0) {
      value = r.to;
      continue;
    }
    const p = repeatedProgress(t - tw.start, tw.duration, tw);
    value = p >= 1 ? r.to : p <= 0 ? r.from : lerpValue(r.from, r.to, tw.easing(p));
  }
  return value;
}
