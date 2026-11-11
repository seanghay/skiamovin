// Animation helpers. All are pure functions of time, so frames can be rendered in any order.
import { Color as C, type Color, toColor4f } from '../core/color.ts';

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

export const Easing = {
  linear: ((t) => t) as EasingFunction,
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

/** Spring motion, computed directly from the timestamp. */
export function spring(options: SpringOptions): number {
  const { from = 0, to = 1, delay = 0, mass = 1, stiffness = 100, damping = 10, overshootClamping = false } = options;
  let t = options.timestamp - delay;
  if (t <= 0) return from;
  if (options.duration !== undefined && options.duration > 0)
    t *= settleTime(mass, stiffness, damping) / options.duration;
  let p = 1 - springX(t, mass, stiffness, damping);
  if (overshootClamping) p = Math.min(1, p);
  return from + (to - from) * p;
}

/** Seconds until the spring comes to rest (|displacement| < 0.1%). */
spring.computeSettleTime = (options: Omit<SpringOptions, 'timestamp'> = {}): number => {
  const { mass = 1, stiffness = 100, damping = 10, delay = 0 } = options;
  if (options.duration) return options.duration + delay;
  return settleTime(mass, stiffness, damping) + delay;
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

// Timeline

type TweenValue = number | string | readonly number[];
type Values = Record<string, TweenValue>;

interface Tween {
  target: string;
  kind: 'to' | 'from' | 'fromTo' | 'set';
  from?: Values;
  to?: Values;
  start: number;
  duration: number;
  easing: EasingFunction;
}

export interface TweenOptions {
  at?: number | string;
  duration?: number;
  easing?: EasingFunction;
  /** Offset between consecutive targets, seconds. */
  stagger?: number;
}

const DEFAULTS: Record<string, number> = { opacity: 1, scale: 1, scaleX: 1, scaleY: 1 };

function lerpValue(a: TweenValue, b: TweenValue, t: number): TweenValue {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v: number, i: number) => v + ((b[i] as number) - v) * t);
  if (typeof a === 'string' || typeof b === 'string') return mixColors(a as Color, b as Color, t);
  return t < 1 ? a : b;
}

/** A GSAP-style timeline, evaluated from the timestamp. Times are in seconds. */
export class Timeline {
  #tweens: Tween[] = [];
  #labels = new Map<string, number>();
  #lastStart = 0;
  #lastEnd = 0;

  #resolveAt(at: number | string | undefined): number {
    if (at === undefined) return this.#lastEnd;
    if (typeof at === 'number') return at;
    const m = /^([<>]|[A-Za-z_][\w-]*)?\s*([+-]=?\s*[\d.]+)?$/.exec(at.trim());
    if (!m) throw new SyntaxError(`Timeline: invalid position '${at}'`);
    let base: number;
    const ref = m[1];
    if (ref === '>') base = this.#lastEnd;
    else if (ref === '<') base = this.#lastStart;
    else if (ref) {
      const l = this.#labels.get(ref);
      if (l === undefined) throw new Error(`Timeline: unknown label '${ref}'`);
      base = l;
    } else base = this.#lastEnd;
    const off = m[2] ? parseFloat(m[2].replace('=', '').replace(/\s+/g, '')) : 0;
    return base + off;
  }

  #add(
    kind: Tween['kind'],
    targets: string | readonly string[],
    from: Values | undefined,
    to: Values | undefined,
    opts: TweenOptions,
  ): this {
    const list = typeof targets === 'string' ? [targets] : targets;
    const start = this.#resolveAt(opts.at);
    const duration = kind === 'set' ? 0 : (opts.duration ?? 0.5);
    const easing = opts.easing ?? Easing.outCubic;
    let end = start;
    list.forEach((target, i) => {
      const s = start + i * (opts.stagger ?? 0);
      this.#tweens.push({ target, kind, from, to, start: s, duration, easing });
      end = Math.max(end, s + duration);
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
  label(name: string, at?: number | string): this {
    this.#labels.set(name, this.#resolveAt(at));
    return this;
  }
  /** Nests another timeline at `at`. */
  add(timeline: Timeline, at?: number | string): this {
    const offset = this.#resolveAt(at);
    for (const t of timeline.#tweens) this.#tweens.push({ ...t, start: t.start + offset });
    this.#lastStart = offset;
    this.#lastEnd = offset + timeline.duration;
    return this;
  }
  /** End time of the last tween, seconds. */
  get duration(): number {
    return this.#tweens.reduce((m, t) => Math.max(m, t.start + t.duration), 0);
  }

  /** Evaluates every target at `timestamp`. */
  getValues(timestamp: number): Record<string, Record<string, any>> {
    const byTarget = new Map<string, Tween[]>();
    for (const t of this.#tweens) {
      let a = byTarget.get(t.target);
      if (!a) {
        a = [];
        byTarget.set(t.target, a);
      }
      a.push(t);
    }
    const out: Record<string, Record<string, any>> = {};
    for (const [target, tweens] of byTarget) {
      const props = new Set<string>();
      for (const t of tweens) for (const k of Object.keys({ ...t.from, ...t.to })) props.add(k);
      const values: Record<string, TweenValue> = {};
      for (const prop of props)
        values[prop] = evalProp(
          tweens.filter((t) => (t.from && prop in t.from) || (t.to && prop in t.to)),
          prop,
          timestamp,
        );
      out[target] = values;
    }
    return out;
  }
}

function evalProp(tweens: Tween[], prop: string, t: number): TweenValue {
  const sorted = [...tweens].sort((a, b) => a.start - b.start);
  let current: TweenValue = DEFAULTS[prop] ?? 0;
  // Resolve each tween's from/to by walking in start order.
  const resolved: {
    start: number;
    end: number;
    from: TweenValue;
    to: TweenValue;
    ease: EasingFunction;
    kind: Tween['kind'];
  }[] = [];
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
    resolved.push({ start: tw.start, end: tw.start + tw.duration, from, to, ease: tw.easing, kind: tw.kind });
    current = to;
  }
  // Before the first tween, a leading `from`, `fromTo` or `set` gives the starting value, as in GSAP.
  const first = resolved[0];
  let value: TweenValue = DEFAULTS[prop] ?? 0;
  if (first && (first.kind === 'from' || first.kind === 'fromTo' || first.kind === 'set'))
    value = first.kind === 'set' ? first.to : first.from;
  for (const r of resolved) {
    if (t < r.start) break;
    if (r.end <= r.start || t >= r.end) value = r.to;
    else value = lerpValue(r.from, r.to, r.ease((t - r.start) / (r.end - r.start)));
  }
  return value;
}
