// Physics-based motion in the style of Apple's interfaces: springs set by feel, momentum, rubber banding,
// snapping and simple dynamics. Everything is solved exactly from the timestamp, so any frame can be rendered
// on its own.

/** A spring set by feel, as in SwiftUI: `response` is the time in seconds of one oscillation, `bounce` is 0 for
 * no overshoot, up to 1 for a lot. Negative bounce is a sluggish, overdamped spring. */
export interface SpringFeel {
  response: number;
  bounce?: number;
}

/** A spring set by its physics. Mass defaults to 1. */
export interface SpringPhysics {
  mass?: number;
  stiffness: number;
  damping: number;
}

export type SpringParams = SpringFeel | SpringPhysics;

/** SwiftUI's presets. */
export const springs = Object.freeze({
  /** No bounce. SwiftUI's `.smooth`. */
  smooth: Object.freeze({ response: 0.5, bounce: 0 }),
  /** A little bounce. SwiftUI's `.snappy`. */
  snappy: Object.freeze({ response: 0.5, bounce: 0.15 }),
  /** Visible bounce. SwiftUI's `.bouncy`. */
  bouncy: Object.freeze({ response: 0.5, bounce: 0.3 }),
  /** Quick, for following a finger. SwiftUI's `.interactiveSpring`. */
  interactive: Object.freeze({ response: 0.15, bounce: 0.15 }),
  /** System-like motion with no bounce, SwiftUI's default animation. */
  system: Object.freeze({ response: 0.55, bounce: 0 }),
});

/** Natural frequency and damping ratio of a spring. */
export function springConstants(p: SpringParams): {
  omega: number;
  zeta: number;
  stiffness: number;
  damping: number;
  mass: number;
} {
  if ('response' in p) {
    // SwiftUI's conversion with mass 1: stiffness = (2π / response)², damping = 4π·ζ / response.
    const response = Math.max(1e-6, p.response);
    const bounce = p.bounce ?? 0;
    const zeta = bounce >= 0 ? 1 - Math.min(bounce, 1) : 1 / (1 + bounce);
    const omega = (2 * Math.PI) / response;
    return { omega, zeta, stiffness: omega * omega, damping: 2 * zeta * omega, mass: 1 };
  }
  const mass = p.mass ?? 1;
  const omega = Math.sqrt(p.stiffness / mass);
  const zeta = p.damping / (2 * Math.sqrt(p.stiffness * mass));
  return { omega, zeta, stiffness: p.stiffness, damping: p.damping, mass };
}

/**
 * Displacement from rest and velocity at time `t` of a damped spring that starts `x0` away from rest moving at
 * `v0`. Closed form for all three damping cases.
 */
export function springState(t: number, x0: number, v0: number, omega: number, zeta: number): [number, number] {
  if (t <= 0) return [x0, v0];
  if (zeta < 1 - 1e-9) {
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const a = x0,
      b = (v0 + zeta * omega * x0) / wd;
    const e = Math.exp(-zeta * omega * t),
      c = Math.cos(wd * t),
      s = Math.sin(wd * t);
    const x = e * (a * c + b * s);
    const v = e * ((b * wd - zeta * omega * a) * c - (a * wd + zeta * omega * b) * s);
    return [x, v];
  }
  if (zeta <= 1 + 1e-9) {
    const b = v0 + omega * x0;
    const e = Math.exp(-omega * t);
    return [(x0 + b * t) * e, (b - omega * (x0 + b * t)) * e];
  }
  const s = omega * Math.sqrt(zeta * zeta - 1);
  const r1 = -zeta * omega + s,
    r2 = -zeta * omega - s;
  const c2 = (v0 - r1 * x0) / (r2 - r1),
    c1 = x0 - c2;
  const e1 = Math.exp(r1 * t),
    e2 = Math.exp(r2 * t);
  return [c1 * e1 + c2 * e2, c1 * r1 * e1 + c2 * r2 * e2];
}

/**
 * Seconds until a spring released at rest from unit displacement stays within `epsilon` of rest. Uses the decay
 * envelope, so it's exact enough for timing and cheap.
 */
export function springSettlingTime(p: SpringParams, epsilon = 0.001): number {
  const { omega, zeta } = springConstants(p);
  if (zeta < 1) {
    // Envelope e^(-ζωt)·√(1 + (ζ/√(1-ζ²))²) bounds the motion.
    const amp = Math.sqrt(1 + (zeta * zeta) / Math.max(1e-12, 1 - zeta * zeta));
    return Math.max(0, Math.log(amp / epsilon) / (zeta * omega || 1e-9));
  }
  // Critically and overdamped springs decay with their slowest root; step forward to find the time.
  let t = 0;
  const step = 1 / 240;
  while (t < 60 && Math.abs(springState(t, 1, 0, omega, zeta)[0]) > epsilon) t += step;
  return t;
}

// Retargeting

export interface SpringTarget {
  /** When the target changes, in seconds. */
  at: number;
  to: number;
}

export interface SpringPathOptions {
  timestamp: number;
  from: number;
  /** Targets in time order. The spring heads for each one when its time comes. */
  targets: readonly SpringTarget[];
  spring?: SpringParams;
  /** Starting speed, value units per second. */
  velocity?: number;
  /**
   * 'add' (default) adds a new spring for each change, as UIKit does, so each one is independent of the others.
   * 'merge' restarts from the current position and speed, as SwiftUI does. They match when the spring doesn't
   * change.
   */
  mode?: 'add' | 'merge';
}

/** A value that springs toward a target that changes over time, without jumps. Returns `[value, velocity]`. */
export function springPath(options: SpringPathOptions): [number, number] {
  const { timestamp: t, from, targets, velocity = 0, mode = 'add' } = options;
  const { omega, zeta } = springConstants(options.spring ?? springs.smooth);
  if (!targets.length || t < targets[0]!.at) return [from, t < (targets[0]?.at ?? Infinity) ? 0 : velocity];
  if (mode === 'merge') {
    let x = from,
      v = velocity,
      last = targets[0]!;
    // Carry position and speed into each new target.
    for (let i = 0; i < targets.length; i++) {
      const cur = targets[i]!;
      const next = targets[i + 1];
      if (i > 0) {
        const [d, dv] = springState(cur.at - last.at, x - last.to, v, omega, zeta);
        x = last.to + d;
        v = dv;
      }
      last = cur;
      if (!next || t < next.at) break;
    }
    const [d, dv] = springState(t - last.at, x - last.to, v, omega, zeta);
    return [last.to + d, dv];
  }
  let value = 0,
    vel = 0,
    prev = from;
  for (let i = 0; i < targets.length; i++) {
    const k = targets[i]!;
    if (t < k.at) break;
    const [d, dv] = springState(t - k.at, prev - k.to, i === 0 ? velocity : 0, omega, zeta);
    value += d;
    vel += dv;
    prev = k.to;
  }
  return [prev + value, vel];
}

// Momentum

/** Deceleration rates of iOS scroll views, per millisecond. */
export const decelerationRates = Object.freeze({ normal: 0.998, fast: 0.99 });

export interface DecayOptions {
  timestamp: number;
  from: number;
  /** Speed at release, value units per second. */
  velocity: number;
  /** Fraction of speed kept each millisecond. Default 0.998, as in iOS scroll views. */
  rate?: number;
}

/** A value gliding to a stop after a fling, as iOS scroll views do. Returns `[value, velocity]`. */
export function decay(options: DecayOptions): [number, number] {
  const { timestamp: t, from, velocity: v0, rate = decelerationRates.normal } = options;
  if (t <= 0) return [from, v0];
  const k = 1000 * Math.log(rate);
  const f = rate ** (1000 * t);
  return [from + (v0 * (f - 1)) / k, v0 * f];
}

/** Where a fling stops. */
export function projectedEnd(from: number, velocity: number, rate: number = decelerationRates.normal): number {
  return from - velocity / (1000 * Math.log(rate));
}

/** Seconds until a fling slows below `minSpeed` (value units per second). */
export function decayDuration(velocity: number, rate: number = decelerationRates.normal, minSpeed = 1): number {
  const v = Math.abs(velocity);
  if (v <= minSpeed) return 0;
  return Math.log(minSpeed / v) / (1000 * Math.log(rate));
}

/**
 * How far content moves when dragged `offset` past an edge, as in iOS: it follows less and less, approaching
 * `limit`. The 0.55 constant is the widely used reverse-engineered value; Apple doesn't publish it.
 */
export function rubberBand(offset: number, limit: number, constant = 0.55): number {
  if (limit <= 0) return 0;
  const x = Math.abs(offset);
  return Math.sign(offset) * (1 - 1 / ((x * constant) / limit + 1)) * limit;
}

export interface FlingOptions {
  timestamp: number;
  from: number;
  velocity: number;
  rate?: number;
  /** Snap points, or a page size to snap to multiples of. */
  snap?: readonly number[] | number;
  /** Lower and upper limits. Past them, the value springs back. */
  bounds?: readonly [number, number];
  spring?: SpringParams;
}

function nearest(value: number, snap: readonly number[] | number): number {
  if (typeof snap === 'number') return Math.round(value / snap) * snap;
  let best = snap[0] ?? value;
  for (const s of snap) if (Math.abs(s - value) < Math.abs(best - value)) best = s;
  return best;
}

/**
 * A released fling. With `snap`, it springs to the snap point nearest to where the fling would stop, keeping its
 * release speed, like iOS paging. With `bounds`, it glides to a stop and springs back if it overshoots an edge.
 * Returns `[value, velocity]`.
 */
export function fling(options: FlingOptions): [number, number] {
  const { timestamp: t, from, velocity, rate = decelerationRates.normal, snap, bounds } = options;
  const params = options.spring ?? springs.smooth;
  const clampTo = (x: number) => (bounds ? Math.min(bounds[1], Math.max(bounds[0], x)) : x);
  if (snap !== undefined) {
    const target = clampTo(nearest(projectedEnd(from, velocity, rate), snap));
    return springPath({ timestamp: t, from, targets: [{ at: 0, to: target }], spring: params, velocity });
  }
  if (!bounds) return decay({ timestamp: t, from, velocity, rate });
  // Glide until an edge, then spring back to it with the speed it had.
  const [lo, hi] = bounds;
  if (from < lo || from > hi) {
    return springPath({ timestamp: t, from, targets: [{ at: 0, to: clampTo(from) }], spring: params, velocity });
  }
  const end = projectedEnd(from, velocity, rate);
  const edge = end > hi ? hi : end < lo ? lo : null;
  if (edge === null) return decay({ timestamp: t, from, velocity, rate });
  // Time when the glide reaches the edge: from + v0(f - 1)/k = edge, f = rate^(1000t).
  const k = 1000 * Math.log(rate);
  const f = 1 + ((edge - from) * k) / velocity;
  const hit = Math.log(f) / k;
  if (t < hit) return decay({ timestamp: t, from, velocity, rate });
  const vHit = velocity * f;
  const [d, dv] = springState(t - hit, 0, vHit, ...omegaZeta(params));
  return [edge + d, dv];
}

function omegaZeta(p: SpringParams): [number, number] {
  const c = springConstants(p);
  return [c.omega, c.zeta];
}

// Simple dynamics, with UIKit Dynamics' units: a gravity magnitude of 1 is 1000 points per second².

export interface FallOptions {
  timestamp: number;
  from: number;
  velocity?: number;
  /** Gravity magnitude. 1 is 1000 units per second², as in UIKit Dynamics. Default 1. */
  gravity?: number;
  /** Where it lands, if anywhere. */
  floor?: number;
  /** Fraction of speed kept on each bounce, 0..1. UIKit's `elasticity`. Default 0.5. */
  elasticity?: number;
}

/** A value falling under gravity and bouncing on a floor. Returns `[value, velocity]`. */
export function fall(options: FallOptions): [number, number] {
  const g = 1000 * (options.gravity ?? 1);
  const e = Math.min(1, Math.max(0, options.elasticity ?? 0.5));
  let t = options.timestamp;
  let x = options.from,
    v = options.velocity ?? 0;
  const floor = options.floor;
  if (t <= 0) return [x, v];
  if (floor === undefined || g <= 0) return [x + v * t + 0.5 * g * t * t, v + g * t];
  // Step from bounce to bounce exactly; stop once bounces become too small to see.
  for (let i = 0; i < 1000; i++) {
    // Time to reach the floor: x + v·τ + ½gτ² = floor.
    const disc = v * v + 2 * g * (floor - x);
    const tau = disc < 0 ? Infinity : (-v + Math.sqrt(disc)) / g;
    if (t < tau) return [x + v * t + 0.5 * g * t * t, v + g * t];
    t -= tau;
    const impact = v + g * tau;
    x = floor;
    v = -impact * e;
    if (Math.abs(v) < 1) return [floor, 0];
  }
  return [floor, 0];
}

/** Spring settings for a UIKit-style attachment: `frequency` in Hz and a damping ratio (1 is critical). */
export function attachmentSpring(frequency: number, damping = 1): SpringPhysics {
  const omega = 2 * Math.PI * frequency;
  return { mass: 1, stiffness: omega * omega, damping: 2 * damping * omega };
}

/** Spring settings for a UIKit-style snap behavior. `damping` 0..1 (1 settles without bouncing), default 0.5. */
export function snapSpring(damping = 0.5): SpringFeel {
  return { response: 0.4, bounce: (1 - Math.min(1, Math.max(0, damping))) * 0.6 };
}

// Scripted gestures

export interface GesturePoint {
  /** Seconds. */
  t: number;
  x: number;
  y: number;
}

/**
 * A scripted drag through points, for showing an app being used. `at(t)` gives the finger position between the
 * points; `releaseVelocity` is the speed at the last point, to hand to `fling` for each axis.
 */
export function gesture(points: readonly GesturePoint[]): {
  at(t: number): { x: number; y: number };
  readonly releaseVelocity: { x: number; y: number };
  readonly end: number;
} {
  if (points.length === 0) throw new RangeError('gesture: needs at least one point');
  const pts = [...points].sort((a, b) => a.t - b.t);
  const last = pts[pts.length - 1]!;
  const prev = pts[pts.length - 2];
  const dt = prev ? last.t - prev.t : 0;
  const releaseVelocity = prev && dt > 0 ? { x: (last.x - prev.x) / dt, y: (last.y - prev.y) / dt } : { x: 0, y: 0 };
  return {
    at(t: number) {
      if (t <= pts[0]!.t) return { x: pts[0]!.x, y: pts[0]!.y };
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!,
          b = pts[i]!;
        if (t <= b.t) {
          const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
          return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
        }
      }
      return { x: last.x, y: last.y };
    },
    releaseVelocity,
    end: last.t,
  };
}

// Ready-made motions

/** Familiar iOS motions, each a function of time since it started. */
export const motions = Object.freeze({
  /** A sheet sliding up from below `height`: returns its `translateY`. */
  sheetUp(timestamp: number, height: number): number {
    return springPath({ timestamp, from: height, targets: [{ at: 0, to: 0 }], spring: springs.system })[0];
  },
  /** A sheet sliding down out of view. */
  sheetDown(timestamp: number, height: number): number {
    return springPath({ timestamp, from: 0, targets: [{ at: 0, to: height }], spring: springs.smooth })[0];
  },
  /** A notification dropping in from above: returns its `translateY`, from `-height` to 0, with a small bounce. */
  notificationDrop(timestamp: number, height: number): number {
    return springPath({ timestamp, from: -height, targets: [{ at: 0, to: 0 }], spring: springs.snappy })[0];
  },
  /** A button pressed at `pressAt` and released at `releaseAt`: returns its scale. */
  press(timestamp: number, pressAt = 0, releaseAt = 0.15): number {
    return springPath({
      timestamp,
      from: 1,
      targets: [
        { at: pressAt, to: 0.94 },
        { at: releaseAt, to: 1 },
      ],
      spring: springs.interactive,
    })[0];
  },
  /** Something appearing with a pop: returns its scale, from 0 to 1. */
  pop(timestamp: number): number {
    return springPath({ timestamp, from: 0, targets: [{ at: 0, to: 1 }], spring: springs.bouncy })[0];
  },
});
