// Film language for the 2D camera: standard shot sizes, camera moves, handheld shake and cutting between cameras.
import { Easing, type EasingFunction, noise } from './animation.ts';
import type { CameraState } from './explain.ts';

export type ShotSize = 'wide' | 'long' | 'full' | 'medium' | 'closeUp' | 'extremeCloseUp';

/** How much of the subject's height fits in the frame for each shot size, as a person would be framed. */
const VISIBLE: Record<ShotSize, number> = {
  wide: 4,
  long: 2,
  full: 1.15,
  medium: 0.6,
  closeUp: 0.3,
  extremeCloseUp: 0.12,
};

export interface ShotOptions {
  /**
   * Where the subject sits across the frame. `'left'` or `'right'` puts it on that third line, leaving look room on
   * the other side; default `'center'`.
   */
  place?: 'left' | 'center' | 'right';
  /** Space above the subject's top, as a fraction of the frame height, for full shots and closer. Default 0.06. */
  headroom?: number;
}

/**
 * Camera state for a standard shot of `subject` (a rectangle in content coordinates, framed like a standing person:
 * closer shots keep its top part). Use with `camera()`.
 *
 * ```ts
 * camera(shot(hero, 'closeUp', viewport, { place: 'left' }), viewport, [scene])
 * ```
 */
export function shot(
  subject: { x: number; y: number; width: number; height: number },
  size: ShotSize,
  viewport: { width: number; height: number },
  options: ShotOptions = {},
): CameraState {
  const { place = 'center', headroom = 0.06 } = options;
  const visible = subject.height * VISIBLE[size];
  const zoom = viewport.height / Math.max(1e-6, visible);
  const viewWidth = viewport.width / zoom;
  const offset = place === 'left' ? viewWidth / 6 : place === 'right' ? -viewWidth / 6 : 0;
  const x = subject.x + subject.width / 2 + offset;
  const y =
    size === 'wide' || size === 'long' ? subject.y + subject.height / 2 : subject.y - headroom * visible + visible / 2;
  return { x, y, zoom };
}

/**
 * The camera at `t` for a move through keyframes: pans, tilts, dollies and zooms are moves between states. Zoom
 * changes evenly in scale (a 1 to 4 zoom passes 2 halfway), which looks steady. Holds before the first and after the
 * last key.
 */
export function cameraMove(
  keys: readonly { time: number; camera: CameraState }[],
  t: number,
  easing: EasingFunction = Easing.inOutCubic,
): CameraState {
  if (keys.length === 0) throw new RangeError('cameraMove: no keys');
  if (t <= keys[0]!.time) return keys[0]!.camera;
  const last = keys[keys.length - 1]!;
  if (t >= last.time) return last.camera;
  let i = 0;
  while (keys[i + 1]!.time <= t) i++;
  const a = keys[i]!,
    b = keys[i + 1]!;
  const p = easing((t - a.time) / (b.time - a.time));
  const za = a.camera.zoom ?? 1,
    zb = b.camera.zoom ?? 1;
  return {
    x: a.camera.x + (b.camera.x - a.camera.x) * p,
    y: a.camera.y + (b.camera.y - a.camera.y) * p,
    zoom: za * (zb / za) ** p,
    rotate: (a.camera.rotate ?? 0) + ((b.camera.rotate ?? 0) - (a.camera.rotate ?? 0)) * p,
  };
}

/**
 * Adds the drift of a handheld camera: slow wandering plus a little faster shake, from seeded noise so every render
 * is the same. `amount` 1 is a steady operator; 3 is running.
 */
export function handheld(
  state: CameraState,
  t: number,
  options: { amount?: number; seed?: number | string } = {},
): CameraState {
  const { amount = 1, seed = 1 } = options;
  const zoom = state.zoom ?? 1;
  const wobble = (k: number) => noise(`${seed}:${k}`, t * 0.6) + 0.35 * noise(`${seed}:${k}:fast`, t * 2.3);
  return {
    ...state,
    x: state.x + (wobble(0) * 10 * amount) / zoom,
    y: state.y + (wobble(1) * 7 * amount) / zoom,
    rotate: (state.rotate ?? 0) + wobble(2) * 0.5 * amount,
  };
}

/**
 * Cuts between cameras over time, like an edit list over coverage of one scene: at `t`, the last cut that has
 * started picks the camera.
 */
export function edit<T>(cuts: readonly { time: number; camera: T }[], t: number): T {
  if (cuts.length === 0) throw new RangeError('edit: no cuts');
  let pick = cuts[0]!;
  for (const c of cuts) if (c.time <= t) pick = c;
  return pick.camera;
}
