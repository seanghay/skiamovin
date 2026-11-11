// Keyframe curves with Bézier handles, reusable actions placed as strips (Blender's NLA), and shape keys.

export interface Key {
  time: number;
  value: number;
  /**
   * How the curve leaves and enters this key. `'auto'` (default) is smooth, `'clamped'` is smooth but never
   * overshoots, `'linear'` goes straight to the next key, `'constant'` holds until the next key, and `'free'` uses
   * the `in` and `out` handles.
   */
  handle?: 'auto' | 'clamped' | 'linear' | 'constant' | 'free';
  /** Handle offsets `[dt, dv]` from the key, for `'free'`. */
  in?: readonly [number, number];
  out?: readonly [number, number];
}

/** Handles for each key, as offsets in time and value. */
function handles(keys: readonly Key[]): { in: [number, number]; out: [number, number] }[] {
  return keys.map((k, i) => {
    const prev = keys[i - 1],
      next = keys[i + 1];
    const mode = k.handle ?? 'auto';
    if (mode === 'free')
      return { in: [...(k.in ?? [0, 0])] as [number, number], out: [...(k.out ?? [0, 0])] as [number, number] };
    let slope = 0;
    if (prev && next) slope = (next.value - prev.value) / (next.time - prev.time);
    // Clamped keys stay flat at a peak or valley, so the curve doesn't overshoot them.
    if (mode === 'clamped' && prev && next && (k.value - prev.value) * (next.value - k.value) <= 0) slope = 0;
    const before = prev ? (k.time - prev.time) / 3 : 0;
    const after = next ? (next.time - k.time) / 3 : 0;
    return { in: [-before, -slope * before], out: [after, slope * after] };
  });
}

/**
 * The value of a keyframe curve at `t`, like an animation curve in Blender or After Effects: cubic Bézier segments
 * between keys, shaped by each key's handles. Holds the first and last values outside the keys.
 */
export function curve(keys: readonly Key[], t: number): number {
  if (keys.length === 0) return 0;
  if (t <= keys[0]!.time) return keys[0]!.value;
  const last = keys[keys.length - 1]!;
  if (t >= last.time) return last.value;
  let i = 0;
  while (keys[i + 1]!.time <= t) i++;
  const a = keys[i]!,
    b = keys[i + 1]!;
  const mode = a.handle ?? 'auto';
  if (mode === 'constant') return a.value;
  if (mode === 'linear') return a.value + ((b.value - a.value) * (t - a.time)) / (b.time - a.time);
  const h = handles(keys);
  // Handles can't reach past the neighboring key, so time stays increasing along the segment.
  const span = b.time - a.time;
  const x1 = a.time + Math.min(Math.max(h[i]!.out[0], 0), span);
  const x2 = b.time + Math.max(Math.min(h[i + 1]!.in[0], 0), -span);
  const y1 = a.value + h[i]!.out[1],
    y2 = b.value + h[i + 1]!.in[1];
  const bez = (p0: number, p1: number, p2: number, p3: number, u: number) =>
    (1 - u) ** 3 * p0 + 3 * (1 - u) ** 2 * u * p1 + 3 * (1 - u) * u * u * p2 + u ** 3 * p3;
  let lo = 0,
    hi = 1;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (bez(a.time, x1, x2, b.time, mid) < t) lo = mid;
    else hi = mid;
  }
  return bez(a.value, y1, y2, b.value, (lo + hi) / 2);
}

/** A reusable animation: named values as a function of its own time, from 0 to `duration`. */
export interface Action {
  duration: number;
  values: (t: number) => Record<string, number>;
}

export interface Strip {
  action: Action;
  /** When the strip starts. */
  start: number;
  /** Times to play it. Default 1. */
  repeat?: number;
  /** Playback speed. Default 1. */
  speed?: number;
  /** Seconds to fade the strip in and out. */
  blendIn?: number;
  blendOut?: number;
  /** How much the strip counts, 0..1. Default 1. */
  influence?: number;
  /** `'replace'` (default) blends toward the strip's values; `'add'` adds them. */
  mode?: 'replace' | 'add';
}

/**
 * Values at `t` from actions placed as strips on a timeline, as Blender's NLA editor does. Later strips are on top:
 * each blends over what's below it by its influence and fades.
 */
export function strips(list: readonly Strip[], t: number, base: Record<string, number> = {}): Record<string, number> {
  const out = { ...base };
  for (const s of list) {
    const speed = s.speed ?? 1;
    const length = (s.action.duration * (s.repeat ?? 1)) / speed;
    const local = t - s.start;
    if (local < 0 || local > length) continue;
    let w = s.influence ?? 1;
    if (s.blendIn) w *= Math.min(1, local / s.blendIn);
    if (s.blendOut) w *= Math.min(1, (length - local) / s.blendOut);
    const at = local * speed;
    const inner = at >= s.action.duration * (s.repeat ?? 1) ? s.action.duration : at % s.action.duration;
    for (const [k, v] of Object.entries(s.action.values(inner))) {
      const below = out[k] ?? 0;
      out[k] = s.mode === 'add' ? below + v * w : below + (v - below) * w;
    }
  }
  return out;
}

/**
 * Shape keys: blends SVG path data between a base shape and named target shapes by weight. The targets must have
 * the same commands as the base, with different numbers.
 */
export function shapeKeys(
  base: string,
  keys: Readonly<Record<string, string>>,
  weights: Readonly<Record<string, number>>,
): string {
  const num = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
  const nums = (d: string) => Array.from(d.matchAll(num), (m) => Number(m[0]));
  const skeleton = (d: string) =>
    d
      .replace(num, '#')
      .replace(/[\s,]+/g, ' ')
      .trim();
  const values = nums(base);
  const out = values.slice();
  for (const [name, w] of Object.entries(weights)) {
    const d = keys[name];
    if (d === undefined) throw new RangeError(`shapeKeys: no key '${name}'`);
    if (skeleton(d) !== skeleton(base))
      throw new RangeError(`shapeKeys: '${name}' doesn't have the same commands as the base`);
    nums(d).forEach((v, i) => {
      out[i]! += (v - values[i]!) * w;
    });
  }
  let i = 0;
  return base.replace(num, () => String(Math.round(out[i++]! * 1000) / 1000));
}
