// Finishing presets: soft shadows, time-of-day and lens looks, and title templates that look good as they are.
import type { Color } from '../core/color.ts';
import { Easing, spring } from './animation.ts';
import { adjust, channelMixer, curves, type Grade } from './grading.ts';
import { box, currentScope, type NodeStyle, type SceneNode, type Shadow, text } from './nodes.ts';

/**
 * A shadow like diffused light: a tight contact shadow plus a wide soft one, both growing with `elevation` (in
 * pixels, roughly how far the thing floats above the page).
 */
export function softShadow(elevation = 8, color: Color = 'rgba(15, 23, 42, 0.35)'): Shadow[] {
  const e = Math.max(0, elevation);
  return [
    { offset: [0, e * 0.12], blur: e * 0.3, color },
    { offset: [0, e * 0.6], blur: e * 2.2, spread: -e * 0.25, color },
  ];
}

/** Grades for a mood or a time of day, built from the regular grade descriptors. */
export const looks = Object.freeze({
  /** Late-afternoon sun: warm, soft contrast, lifted shadows. */
  goldenHour: (): Grade[] => [adjust({ warmth: 0.45, contrast: 0.08, shadows: 0.15, vibrance: 0.2 })],
  /** Just after sunset: cool and calm. */
  blueHour: (): Grade[] => [adjust({ warmth: -0.45, tint: 0.1, saturation: -0.1, highlights: -0.1 })],
  warm: (): Grade[] => [adjust({ warmth: 0.25 })],
  cool: (): Grade[] => [adjust({ warmth: -0.25 })],
  /** A polarizing filter: deeper skies and blues, less glare in the highlights. */
  polarizer: (): Grade[] => [
    channelMixer({ blue: [-0.08, 0, 1.08] }),
    adjust({ highlights: -0.25, vibrance: 0.25, contrast: 0.05 }),
  ],
  /** Faded film: lifted blacks, gentle S-curve, a little less color. */
  film: (): Grade[] => [
    curves({
      rgb: [
        [0, 0.06],
        [0.25, 0.22],
        [0.75, 0.8],
        [1, 0.96],
      ],
    }),
    adjust({ saturation: -0.12, warmth: 0.08 }),
  ],
  /** Strong contrast and color for product shots. */
  punchy: (): Grade[] => [adjust({ contrast: 0.2, vibrance: 0.35 })],
});

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

interface TitleOptions {
  /** Seconds since the title appeared. Default: the current time of the composition or sequence. */
  time?: number;
  /** Seconds until it leaves, for an exit animation. */
  out?: number;
  color?: Color;
  accent?: Color;
  fontFamily?: string;
}

const now = (time?: number) => time ?? currentScope().ctx.timestamp;

/** A centered title and subtitle that rise in and fade out. */
export function titleCard(title: string, subtitle?: string, options: TitleOptions & NodeStyle = {}): SceneNode {
  const { time, out, color = '#f8fafc', accent = '#94a3b8', fontFamily, ...style } = options;
  const t = now(time);
  const leave = out === undefined ? 1 : clamp01((out - t) / 0.4);
  const rise = (delay: number) => spring({ timestamp: t - delay, from: 30, to: 0, response: 0.6, bounce: 0 });
  const fade = (delay: number) => Easing.smooth(clamp01((t - delay) / 0.5)) * leave;
  return box({ flexDirection: 'column', alignItems: 'center', flexGrow: 1, gap: 18, ...style }, [
    text(title, {
      fontSize: 96,
      fontWeight: 'bold',
      letterSpacing: -1.5,
      color,
      fontFamily,
      textAlign: 'center',
      opacity: fade(0),
      transform: { translateY: rise(0) },
    }),
    subtitle
      ? text(subtitle, {
          fontSize: 38,
          color: accent,
          fontFamily,
          textAlign: 'center',
          opacity: fade(0.25),
          transform: { translateY: rise(0.25) },
        })
      : null,
  ]);
}

/** A lower third: a name and a role on a bar that slides in from the left. */
export function lowerThird(name: string, role?: string, options: TitleOptions & NodeStyle = {}): SceneNode {
  const { time, out, color = '#f8fafc', accent = '#38bdf8', fontFamily, ...style } = options;
  const t = now(time);
  const enter = spring({ timestamp: t, from: 0, to: 1, response: 0.55, bounce: 0 });
  const leave = out === undefined ? 1 : Easing.smooth(clamp01((out - t) / 0.35));
  const k = Math.min(enter, leave);
  return box(
    {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: 18,
      opacity: clamp01(k * 1.5),
      transform: { translateX: (1 - k) * -60 },
      ...style,
    },
    [
      box({ size: { width: 8 }, background: accent, borderRadius: 4, transform: { scale: [1, k] } }),
      box(
        {
          flexDirection: 'column',
          gap: 6,
          padding: [14, 26],
          background: 'rgba(15, 23, 42, 0.78)',
          borderRadius: 14,
          shadow: softShadow(16),
        },
        [
          text(name, { fontSize: 44, fontWeight: 'bold', color, fontFamily }),
          role ? text(role, { fontSize: 28, color: accent, fontFamily, opacity: clamp01((t - 0.2) / 0.4) }) : null,
        ],
      ),
    ],
  );
}

/**
 * Scrolling credits: `[role, name]` lines (a plain string is a heading) moving up at `speed` pixels per second.
 * Place it in a box with `overflow: 'hidden'`.
 */
export function credits(
  lines: readonly (string | readonly [string, string])[],
  options: Omit<TitleOptions, 'out'> & NodeStyle & { speed?: number; start?: number } = {},
): SceneNode {
  const { time, color = '#f8fafc', accent = '#94a3b8', fontFamily, speed = 80, start = 0, ...style } = options;
  const t = now(time);
  return box(
    { flexDirection: 'column', alignItems: 'center', gap: 14, transform: { translateY: start - t * speed }, ...style },
    [
      ...lines.map((l) =>
        typeof l === 'string'
          ? text(l, { fontSize: 40, fontWeight: 'bold', color, fontFamily, margin: { top: 36 } })
          : box({ flexDirection: 'row', gap: 24 }, [
              text(l[0], { fontSize: 28, color: accent, fontFamily, size: { width: 360 }, textAlign: 'right' }),
              text(l[1], { fontSize: 28, color, fontFamily, size: { width: 360 } }),
            ]),
      ),
    ],
  );
}
