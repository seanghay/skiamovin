// 2D physics: a world is simulated once (in Rust, with Rapier) and looked up by time, so any frame can be drawn
// on its own and every build gives the same result.
import { N } from '../native/runtime.ts';

type Vec2 = readonly [number, number];

export type BodyShape =
  | { kind: 'circle'; radius: number }
  | { kind: 'box'; width: number; height: number; radius?: number }
  | { kind: 'capsule'; height: number; radius: number }
  | { kind: 'polygon'; points: readonly number[] }
  | { kind: 'segment'; a: Vec2; b: Vec2 };

export interface BodyDef {
  /** A name to look the body up by. */
  id?: string;
  /** 'dynamic' (default) moves; 'fixed' never moves; 'kinematic' moves at its set velocity. */
  type?: 'dynamic' | 'fixed' | 'kinematic';
  shape: BodyShape;
  x: number;
  y: number;
  /** Degrees. */
  angle?: number;
  velocity?: Vec2;
  /** Degrees per second. */
  angularVelocity?: number;
  /** Bounciness, 0..1. Default 0.2. */
  restitution?: number;
  /** Default 0.5. */
  friction?: number;
  /** Default 1. */
  density?: number;
  linearDamping?: number;
  angularDamping?: number;
  /** Continuous collision detection, for fast small bodies. */
  ccd?: boolean;
  /** Detects contacts without pushing back. */
  sensor?: boolean;
}

export interface JointDef {
  kind: 'revolute' | 'fixed' | 'prismatic' | 'rope' | 'spring';
  /** Body index or id. */
  a: number | string;
  b: number | string;
  anchorA?: Vec2;
  anchorB?: Vec2;
  /** Rope maximum length or spring rest length. */
  length?: number;
  stiffness?: number;
  damping?: number;
  /** Prismatic axis. */
  axis?: Vec2;
}

export interface WorldDef {
  bodies: readonly BodyDef[];
  joints?: readonly JointDef[];
  /** Pixels per second². Default `[0, 980]`. */
  gravity?: Vec2;
  /** Seconds to simulate. Default 5. */
  duration?: number;
  /** Simulation steps per second. Default 120. */
  hz?: number;
}

export interface BodyState {
  x: number;
  y: number;
  /** Degrees. */
  angle: number;
}

export interface Contact {
  /** Seconds. */
  time: number;
  a: number;
  b: number;
  /** True when the bodies started touching, false when they stopped. */
  started: boolean;
}

/** A simulated world. Look bodies up by time with `body()` or `all()`. */
export class PhysicsWorld {
  readonly hz: number;
  readonly steps: number;
  readonly duration: number;
  readonly #frames: Float32Array;
  readonly #ids = new Map<string, number>();
  readonly count: number;
  readonly contacts: readonly Contact[];

  /** @internal */
  constructor(def: WorldDef) {
    const ids = new Map<string, number>();
    def.bodies.forEach((b, i) => {
      if (b.id) ids.set(b.id, i);
    });
    const index = (v: number | string) => {
      if (typeof v === 'number') return v;
      const i = ids.get(v);
      if (i === undefined) throw new RangeError(`physics: no body with id '${v}'`);
      return i;
    };
    const json = JSON.stringify({
      ...def,
      bodies: def.bodies.map(({ id: _id, ...b }) => b),
      joints: def.joints?.map((j) => ({ ...j, a: index(j.a), b: index(j.b) })),
    });
    const h = N().physics_simulate(json);
    try {
      const [hz, steps, count] = N().physics_info(h);
      this.hz = hz!;
      this.steps = steps!;
      this.count = count!;
      this.duration = this.steps / this.hz;
      this.#frames = Float32Array.from(N().physics_frames(h));
      const raw = N().physics_contacts(h);
      const contacts: Contact[] = [];
      for (let i = 0; i < raw.length; i += 4)
        contacts.push({ time: raw[i]! / hz, a: raw[i + 1]!, b: raw[i + 2]!, started: raw[i + 3] === 1 });
      this.contacts = contacts;
    } finally {
      N().object_delete(h);
    }
    for (const [k, v] of ids) this.#ids.set(k, v);
  }

  #index(body: number | string): number {
    const i = typeof body === 'number' ? body : this.#ids.get(body);
    if (i === undefined || i < 0 || i >= this.count) throw new RangeError(`physics: no body '${body}'`);
    return i;
  }

  /** Where a body is at `timestamp`, interpolated between steps. Holds its last state after the simulation ends. */
  body(body: number | string, timestamp: number): BodyState {
    const i = this.#index(body);
    const s = Math.min(this.steps, Math.max(0, timestamp * this.hz));
    const s0 = Math.floor(s),
      s1 = Math.min(this.steps, s0 + 1),
      f = s - s0;
    const base0 = (s0 * this.count + i) * 3,
      base1 = (s1 * this.count + i) * 3;
    const fr = this.#frames;
    let da = fr[base1 + 2]! - fr[base0 + 2]!;
    // Turn the short way between steps.
    if (da > Math.PI) da -= 2 * Math.PI;
    if (da < -Math.PI) da += 2 * Math.PI;
    return {
      x: fr[base0]! + (fr[base1]! - fr[base0]!) * f,
      y: fr[base0 + 1]! + (fr[base1 + 1]! - fr[base0 + 1]!) * f,
      angle: ((fr[base0 + 2]! + da * f) * 180) / Math.PI,
    };
  }

  /** Every body's state at `timestamp`, in the order they were defined. */
  all(timestamp: number): BodyState[] {
    return Array.from({ length: this.count }, (_, i) => this.body(i, timestamp));
  }

  /** Contacts that started up to `timestamp`, optionally for one body. */
  contactsUntil(timestamp: number, body?: number | string): Contact[] {
    const i = body === undefined ? null : this.#index(body);
    return this.contacts.filter((c) => c.started && c.time <= timestamp && (i === null || c.a === i || c.b === i));
  }
}

const worlds = new Map<string, PhysicsWorld>();

/**
 * Simulates a 2D world once and caches it, so calling it from `render` every frame is cheap. Lengths are pixels,
 * gravity points down by default.
 *
 * ```ts
 * const world = physics({ bodies: [
 *   { type: 'fixed', shape: { kind: 'box', width: 800, height: 20 }, x: 400, y: 590 },
 *   { id: 'ball', shape: { kind: 'circle', radius: 20 }, x: 400, y: 0, restitution: 0.7 },
 * ] });
 * const { x, y } = world.body('ball', ctx.timestamp);
 * ```
 */
export function physics(def: WorldDef): PhysicsWorld {
  const key = JSON.stringify(def);
  let w = worlds.get(key);
  if (!w) {
    w = new PhysicsWorld(def);
    if (worlds.size > 32) worlds.delete(worlds.keys().next().value!);
    worlds.set(key, w);
  }
  return w;
}
