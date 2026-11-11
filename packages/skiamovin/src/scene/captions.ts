// Captions: SRT and WebVTT files, or word timings from speech recognition, shown with ready-made styles.
import type { Color } from '../core/color.ts';
import { Easing, spring } from './animation.ts';
import { box, currentScope, type NodeStyle, type SceneNode, span, type TextProps, text } from './nodes.ts';

export interface CaptionWord {
  text: string;
  /** Seconds. */
  start: number;
  end: number;
}

export interface Cue {
  start: number;
  end: number;
  text: string;
  /** Word timings, when known. Without them, words are spread over the cue by length. */
  words?: CaptionWord[];
}

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function seconds(s: string): number {
  const m = TIME.exec(s);
  if (!m) return Number.NaN;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]!.padEnd(3, '0')) / 1000;
}

/**
 * Reads SRT or WebVTT captions. WebVTT word timings (`<00:00:01.200>word`, as karaoke-style files and many speech
 * recognition tools write them) are kept.
 */
export function parseCaptions(source: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = source
    .replace(/\r\n?/g, '\n')
    .replace(/^﻿/, '')
    .split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    const [a, b] = lines[at]!.split('-->');
    const start = seconds(a!),
      end = seconds(b!);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    const raw = lines.slice(at + 1).join('\n');
    const words: CaptionWord[] = [];
    let timed = false;
    let t = start;
    // Split on inline timestamps; each piece starts at the timestamp before it.
    for (const piece of raw.split(/(<(?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3}>)/)) {
      if (piece.startsWith('<') && TIME.test(piece)) {
        t = seconds(piece);
        timed = true;
        continue;
      }
      for (const w of strip(piece).split(/\s+/)) if (w) words.push({ text: w, start: t, end: end });
    }
    for (let i = 0; i < words.length - 1; i++)
      if (words[i + 1]!.start > words[i]!.start) words[i]!.end = words[i + 1]!.start;
    cues.push({ start, end, text: strip(raw).replace(/\s+/g, ' ').trim(), words: timed ? words : undefined });
  }
  return cues;
}

/** Removes tags such as `<b>`, `<i>`, `<c.red>` and `<v Speaker>`, and decodes basic entities. */
function strip(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

/**
 * Groups timed words (for example from Whisper) into cues: a new cue starts after `maxChars` characters,
 * `maxDuration` seconds, a pause of `gap` seconds, or the end of a sentence.
 */
export function cuesFromWords(
  words: readonly CaptionWord[],
  options: { maxChars?: number; maxDuration?: number; gap?: number } = {},
): Cue[] {
  const { maxChars = 32, maxDuration = 3, gap = 0.6 } = options;
  const cues: Cue[] = [];
  let cur: CaptionWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    cues.push({
      start: cur[0]!.start,
      end: cur[cur.length - 1]!.end,
      text: cur.map((w) => w.text).join(' '),
      words: cur,
    });
    cur = [];
  };
  for (const w of words) {
    const text = w.text.trim();
    if (!text) continue;
    const word = { ...w, text };
    if (cur.length) {
      const last = cur[cur.length - 1]!;
      const chars = cur.reduce((n, x) => n + x.text.length + 1, 0) + text.length;
      if (
        chars > maxChars ||
        word.end - cur[0]!.start > maxDuration ||
        word.start - last.end > gap ||
        /[.!?]$/.test(last.text)
      )
        flush();
    }
    cur.push(word);
  }
  flush();
  return cues;
}

/** Word timings for a cue, spread over it by length when the file has none. */
function timedWords(cue: Cue): CaptionWord[] {
  if (cue.words?.length) return cue.words;
  const parts = cue.text.split(/\s+/).filter(Boolean);
  const total = parts.reduce((n, w) => n + w.length + 1, 0) || 1;
  let t = cue.start;
  return parts.map((w) => {
    const d = ((cue.end - cue.start) * (w.length + 1)) / total;
    const word = { text: w, start: t, end: t + d };
    t += d;
    return word;
  });
}

export interface CaptionOptions {
  /**
   * - `'subtitle'` (default): the whole line on a dark rounded box, like film subtitles.
   * - `'karaoke'`: the whole line, with words lighting up as they're spoken.
   * - `'pop'`: words appear as they're spoken with a springy pop, the current one in the accent color.
   * - `'word'`: one large word at a time.
   */
  preset?: 'subtitle' | 'karaoke' | 'pop' | 'word';
  /** Seconds. Default: the current time of the composition or sequence. */
  time?: number;
  /** Moves every cue by this many seconds. */
  offset?: number;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: TextProps['fontWeight'];
  /** Text color. Default white. */
  color?: Color;
  /** Color of the spoken or current word. Default yellow. */
  accent?: Color;
  uppercase?: boolean;
  /** Maximum width of the text in pixels; longer lines wrap. */
  maxWidth?: number;
}

// Quick and lively, for words that come every few hundred milliseconds.
const POP = { response: 0.32, bounce: 0.35 };
const SHADOW = [{ color: 'rgba(0,0,0,0.55)', offset: [0, 3] as const, blur: 14 }];

/**
 * Captions for the current time, from cues or the text of an SRT or WebVTT file:
 *
 * ```ts
 * captions(srt, { preset: 'pop', position: 'absolute', inset: { left: 0, right: 0, bottom: 160 } })
 * ```
 *
 * The box centers its text; place it with the usual style options. With no cue at the current time it's empty.
 */
export function captions(source: readonly Cue[] | string, options: CaptionOptions & NodeStyle = {}): SceneNode {
  const {
    preset = 'subtitle',
    time,
    offset = 0,
    fontSize,
    fontFamily,
    fontWeight,
    color = '#ffffff',
    accent = '#facc15',
    uppercase = preset === 'pop' || preset === 'word',
    maxWidth,
    ...style
  } = options;
  const cues = typeof source === 'string' ? parsed(source) : source;
  const t = (time ?? currentScope().ctx.timestamp) - offset;
  const outer: NodeStyle = { flexDirection: 'column', alignItems: 'center', ...style };
  const cue = cues.find((c) => t >= c.start && t < c.end);
  if (!cue) return box(outer);
  const words = timedWords(cue);
  const up = (s: string) => (uppercase ? s.toUpperCase() : s);
  const base: TextProps = {
    fontSize: fontSize ?? (preset === 'word' ? 96 : preset === 'pop' ? 64 : 44),
    fontFamily,
    fontWeight: fontWeight ?? (preset === 'subtitle' ? undefined : 'bold'),
    color,
    textAlign: 'center',
    textShadow: preset === 'subtitle' ? undefined : SHADOW,
  };
  const width = maxWidth === undefined ? {} : { maxSize: { width: maxWidth } };
  const fade = Math.min(1, (t - cue.start) / 0.12, (cue.end - t) / 0.12);

  if (preset === 'subtitle') {
    return box(outer, [
      box(
        {
          background: 'rgba(0,0,0,0.62)',
          padding: [10, 22],
          borderRadius: 12,
          opacity: Easing.smooth(Math.max(0, fade)),
          ...width,
        },
        [text(up(cue.text), base)],
      ),
    ]);
  }

  const current = Math.max(
    0,
    words.findLastIndex((w) => w.start <= t),
  );

  if (preset === 'word') {
    const w = words[current]!;
    const s = spring({ timestamp: t - w.start, from: 0.6, to: 1, ...POP });
    return box(outer, [
      text(up(w.text), { ...base, color: accent, transform: { scale: s }, opacity: Math.min(1, (t - w.start) / 0.05) }),
    ]);
  }

  if (preset === 'karaoke') {
    const spans = words.flatMap((w, i) => {
      const word = span(up(w.text), { color: t >= w.start ? accent : color });
      return i < words.length - 1 ? [word, span(' ')] : [word];
    });
    return box(outer, [text(spans, { ...base, opacity: Math.max(0, fade), ...width })]);
  }

  // pop: each word springs in when it's spoken; the current one is in the accent color. Words are separate text
  // nodes in a wrapping row, so each one scales around its own center.
  const size = base.fontSize!;
  return box(outer, [
    box(
      {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: { width: size * 0.28, height: size * 0.1 },
        opacity: Math.min(1, Math.max(0, (cue.end - t) / 0.1)),
        ...width,
      },
      words.map((w, i) => {
        const k = t - w.start;
        return text(up(w.text), {
          ...base,
          color: i === current ? accent : color,
          opacity: k < 0 ? 0 : Math.min(1, k / 0.06),
          transform:
            k < 0
              ? undefined
              : [
                  { translateY: spring({ timestamp: k, from: size * 0.2, to: 0, ...POP }) },
                  { scale: spring({ timestamp: k, from: 0.5, to: 1, ...POP }) },
                ],
        });
      }),
    ),
  ]);
}

const parsedCache = new Map<string, Cue[]>();

function parsed(source: string): Cue[] {
  let c = parsedCache.get(source);
  if (!c) {
    c = parseCaptions(source);
    if (parsedCache.size > 16) parsedCache.delete(parsedCache.keys().next().value!);
    parsedCache.set(source, c);
  }
  return c;
}
