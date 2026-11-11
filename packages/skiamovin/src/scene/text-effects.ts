// Animating text in pieces, and small text effects.
import { type EasingFunction, mixColors, random } from './animation.ts';
import type { SplitText, TextUnit, UnitStyle } from './nodes.ts';

const segmentCache = new Map<string, { starts: Uint32Array; texts: string[] }>();

/**
 * Where each character (grapheme cluster) or word of `text` starts, as UTF-16 offsets. Spaces belong to the
 * piece before them, so indexes count visible pieces only.
 * @internal
 */
export function segmentUnits(
  text: string,
  by: 'chars' | 'words',
  locale?: string,
): { starts: Uint32Array; texts: string[] } {
  const key = `${by}\u0000${locale ?? ''}\u0000${text}`;
  const hit = segmentCache.get(key);
  if (hit) return hit;
  const seg = new Intl.Segmenter(locale, { granularity: by === 'chars' ? 'grapheme' : 'word' });
  const starts: number[] = [];
  const texts: string[] = [];
  for (const s of seg.segment(text)) {
    if (
      /^\s+$/u.test(s.segment) ||
      (by === 'words' && !(s as { isWordLike?: boolean }).isWordLike && !/\S/u.test(s.segment))
    ) {
      if (texts.length) texts[texts.length - 1] += s.segment;
      continue;
    }
    starts.push(s.index);
    texts.push(s.segment);
  }
  if (!starts.length) {
    starts.push(0);
    texts.push(text);
  }
  const out = { starts: Uint32Array.from(starts), texts };
  if (segmentCache.size > 500) segmentCache.delete(segmentCache.keys().next().value!);
  segmentCache.set(key, out);
  return out;
}

/** Number of characters as people see them (grapheme clusters). Handy with `visibleGraphemes` for typewriters. */
export function graphemeCount(text: string, locale?: string): number {
  let n = 0;
  for (const _ of new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(text)) n++;
  return n;
}

export type RangeShape = 'square' | 'rampUp' | 'rampDown' | 'triangle' | 'round' | 'smooth';

export interface TextAnimatorOptions {
  by: 'chars' | 'words' | 'lines';
  /** Start of the selected range, 0..1 of the text. Default 0. */
  start?: number;
  /** End of the selected range, 0..1. Default 1. */
  end?: number;
  /** Moves the range. Animate it to sweep the effect across the text. */
  offset?: number;
  /** How strongly units are selected across the range. Default 'square'. */
  shape?: RangeShape;
  ease?: EasingFunction;
  /** Order in which units are selected. 'random' is seeded. */
  order?: 'forward' | 'reverse' | 'random';
  seed?: string | number;
  /** Scales the whole effect. Default 1. */
  amount?: number;
  /** The look of a fully selected unit. Unselected units look normal; partly selected ones are in between. */
  properties: UnitStyle;
}

/**
 * An After Effects-style text animator: properties applied to a range of characters, words or lines, with the
 * range moved over time. For example, letters that rise and fade in from left to right:
 *
 * ```ts
 * text('Hello', { split: textAnimator({ by: 'chars', shape: 'rampUp', end: 0.3, offset: t * 1.3 - 0.3,
 *   properties: { opacity: 0, y: 24 } }) })
 * ```
 */
export function textAnimator(options: TextAnimatorOptions): SplitText {
  const { start = 0, end = 1, offset = 0, shape = 'square', ease, order = 'forward', amount = 1, properties } = options;
  const s = Math.min(start, end) + offset,
    e = Math.max(start, end) + offset;
  const randomRanks = new Map<number, Int32Array>();
  const rank = (index: number, count: number) => {
    if (order === 'reverse') return count - 1 - index;
    if (order === 'random') {
      let ranks = randomRanks.get(count);
      if (!ranks) {
        const keys = Array.from({ length: count }, (_, i) => random(`${options.seed ?? 'textAnimator'}:${i}`));
        const sorted = keys.map((_, i) => i).sort((x, y) => keys[x]! - keys[y]!);
        ranks = new Int32Array(count);
        sorted.forEach((item, r) => {
          ranks![item] = r;
        });
        randomRanks.set(count, ranks);
      }
      return ranks[index]!;
    }
    return index;
  };
  const selection = (index: number, count: number): number => {
    const k = rank(index, count);
    const a = k / count,
      b = (k + 1) / count;
    const width = e - s;
    if (shape === 'square') {
      const overlap = Math.max(0, Math.min(b, e) - Math.max(a, s));
      return overlap / (b - a);
    }
    const u = (a + b) / 2;
    const r = width > 0 ? (u - s) / width : u < s ? 0 : 1;
    if (shape === 'rampUp') return Math.min(1, Math.max(0, r));
    if (shape === 'rampDown') return 1 - Math.min(1, Math.max(0, r));
    if (r < 0 || r > 1) return 0;
    if (shape === 'triangle') return 1 - Math.abs(2 * r - 1);
    if (shape === 'round') return Math.sqrt(Math.max(0, 1 - (2 * r - 1) ** 2));
    return 0.5 - 0.5 * Math.cos(2 * Math.PI * r);
  };
  return {
    by: options.by,
    style: (unit: TextUnit): UnitStyle => {
      let k = selection(unit.index, unit.count);
      if (ease) k = ease(k);
      k *= amount;
      if (k === 0) return {};
      const out: UnitStyle = {};
      if (properties.opacity !== undefined) out.opacity = 1 + (properties.opacity - 1) * k;
      if (properties.x !== undefined) out.x = properties.x * k;
      if (properties.y !== undefined) out.y = properties.y * k;
      if (properties.scale !== undefined) out.scale = 1 + (properties.scale - 1) * k;
      if (properties.rotate !== undefined) out.rotate = properties.rotate * k;
      if (properties.color !== undefined)
        out.color =
          unit.color !== undefined ? mixColors(unit.color, properties.color, Math.min(1, k)) : properties.color;
      return out;
    },
  };
}

const SCRAMBLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Reveals `text` from left to right while the rest shows random characters that change every frame. `progress`
 * is 0..1. Seeded by `seed` and the frame, so renders are repeatable.
 */
export function scramble(
  text: string,
  progress: number,
  options: { frame?: number; seed?: string | number; characters?: string; locale?: string } = {},
): string {
  const parts = [...new Intl.Segmenter(options.locale, { granularity: 'grapheme' }).segment(text)].map(
    (s) => s.segment,
  );
  const shown = Math.round(Math.min(1, Math.max(0, progress)) * parts.length);
  const chars = [...(options.characters ?? SCRAMBLE)];
  return parts
    .map((ch, i) => {
      if (i < shown || /^\s+$/u.test(ch)) return ch;
      const r = random(`${options.seed ?? 'scramble'}:${i}:${options.frame ?? 0}`);
      return chars[Math.floor(r * chars.length)]!;
    })
    .join('');
}

/**
 * Formats a number for counting animations. Use it with `fontFeatures: { tnum: 1 }` so digits keep the same
 * width and the number doesn't jitter.
 */
export function counter(
  value: number,
  options: { decimals?: number; locale?: string; prefix?: string; suffix?: string; grouping?: boolean } = {},
): string {
  const d = options.decimals ?? 0;
  const f = new Intl.NumberFormat(options.locale, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
    useGrouping: options.grouping ?? true,
  });
  return `${options.prefix ?? ''}${f.format(value)}${options.suffix ?? ''}`;
}
