// Named states switched over time, with springs between them, like Motion's variants.
import type { Color } from '../core/color.ts';
import { mixColors } from './animation.ts';
import { type SpringParams, springConstants, springPath, springState, springs } from './physics.ts';

export interface StatesOptions<S extends string> {
  /** The look of each state: numbers (spring) and colors (blend). */
  variants: Record<S, Record<string, number | Color>>;
  /** Which state applies from each time on, in time order. The first one is the starting state. */
  changes: readonly { at: number; to: S }[];
  spring?: SpringParams;
}

/**
 * The values at `timestamp` of something that moves between named states:
 *
 * ```ts
 * const v = states(t, { variants: { hidden: { opacity: 0, y: 20 }, shown: { opacity: 1, y: 0 } },
 *   changes: [{ at: 0, to: 'hidden' }, { at: 0.5, to: 'shown' }] });
 * box({ opacity: v.opacity, transform: { translateY: v.y } })
 * ```
 *
 * Changing state while a spring is still moving carries on from where it is, without jumps.
 */
export function states<S extends string>(timestamp: number, options: StatesOptions<S>): Record<string, number | Color> {
  const { variants, changes, spring = springs.smooth } = options;
  if (!changes.length) return {};
  const keys = new Set<string>();
  for (const c of changes) for (const k of Object.keys(variants[c.to] ?? {})) keys.add(k);
  const { omega, zeta } = springConstants(spring);
  const out: Record<string, number | Color> = {};
  for (const k of keys) {
    const sample = changes.map((c) => variants[c.to]?.[k]).find((v) => v !== undefined);
    if (typeof sample === 'number') {
      const first = (variants[changes[0]!.to]?.[k] as number | undefined) ?? 0;
      const targets = changes.map((c) => ({ at: c.at, to: (variants[c.to]?.[k] as number | undefined) ?? first }));
      out[k] = springPath({ timestamp, from: first, targets, spring })[0];
    } else {
      // Colors blend from the previous state's color with the latest change's spring progress.
      let current: Color | undefined;
      let previous: Color | undefined;
      let since = 0;
      for (const c of changes) {
        if (c.at > timestamp) break;
        const v = variants[c.to]?.[k] as Color | undefined;
        if (v === undefined) continue;
        previous = current ?? v;
        current = v;
        since = c.at;
      }
      if (current === undefined) continue;
      const p = 1 + springState(timestamp - since, -1, 0, omega, zeta)[0];
      out[k] =
        previous === undefined || previous === current
          ? current
          : mixColors(previous, current, Math.min(1, Math.max(0, p)));
    }
  }
  return out;
}
