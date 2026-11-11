// "How a Transformer works": a 92-second explainer shot as one continuous camera move through a single world.
// The prompt breaks into tokens, the tokens drop their vectors, attention fires between words, the camera dives into
// RoPE's rotating dials, the scores become 3D heads and a stack of layers, and the prediction lands back in the prompt.
// All model facts are for Llama 3 8B; attention weights and probabilities are illustrative and say so on screen.
import { FilePathSource } from 'mediabunny';
import type { Color } from 'skiamovin';
import {
  alongPath,
  audio,
  backgrounds,
  box,
  type Child,
  Composition,
  type Cue,
  camera,
  cameraMove,
  captions,
  Easing,
  FontAsset,
  grain,
  interpolate,
  interpolateColor,
  math,
  path,
  random,
  space3d,
  span,
  spring,
  stroke,
  text,
  vignette,
} from 'skiamovin/scene';
import { asset, input } from '../shared.ts';
import { type Lang, STRINGS } from './strings.ts';

const sans = new FontAsset(new FilePathSource(asset('GoogleSans.ttf')), { family: 'Google Sans' });
const mono = new FontAsset(new FilePathSource(asset('JetBrainsMono.ttf')), { family: 'JetBrains Mono' });
const music = input('infinite-wonder.mp3');

const W = 1920,
  H = 1080,
  VIEW = { width: W, height: H };
const SANS = 'Google Sans',
  MONO = 'JetBrains Mono';
// JetBrains Mono advances 0.6 em per character, so token tiles can be laid out exactly without measuring text.
const ADV = 0.6;

const C = {
  bg: '#f5f6fa',
  text: '#0f172a',
  muted: '#5b6b82',
  dim: '#94a3b8',
  // Accents are deep enough to read on a light background.
  q: '#0891b2',
  k: '#db2777',
  v: '#4d7c0f',
  warm: '#d97706',
  surface: '#ffffff',
  line: 'rgba(15,23,42,0.12)',
  faint: 'rgba(15,23,42,0.04)',
  cell: '#e9edf3',
  dots: '#d3d9e4',
  shadow: 'rgba(15,23,42,0.10)',
};

// Timeline, in seconds. Each section is one stretch of the same continuous shot.
export const T = {
  hook: 0,
  tokens: 8,
  embed: 17,
  attend: 26,
  rope: 39,
  scores: 53,
  layers: 64,
  predict: 76,
  end: 87,
  total: 92,
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ramp = (t: number, a: number, b: number) => Easing.inOutCubic(clamp01((t - a) / (b - a)));
const fade = (t: number, a: number, d = 0.5) => Easing.smooth(clamp01((t - a) / d));
const window_ = (t: number, a: number, b: number, d = 0.5) => fade(t, a, d) * (1 - fade(t, b - d, d));
const pop = (t: number, at: number) => spring({ timestamp: t - at, from: 0, to: 1, response: 0.5, bounce: 0.25 });

const abs = (left: number, top: number) => ({ position: 'absolute' as const, inset: { left, top } });

// Tokens

interface Token {
  text: string;
  id: number;
}
// Llama 3 tokenizer output; '␣' marks a leading space.
const PROMPT: Token[] = [
  { text: 'The', id: 791 },
  { text: '␣cat', id: 8415 },
  { text: '␣sat', id: 7731 },
  { text: '␣on', id: 389 },
  { text: '␣the', id: 279 },
];
const SENTENCE: Token[] = [
  { text: 'The', id: 791 },
  { text: '␣animal', id: 10065 },
  { text: '␣didn', id: 3287 },
  { text: "'t", id: 956 },
  { text: '␣cross', id: 5425 },
  { text: '␣the', id: 279 },
  { text: '␣street', id: 8761 },
  { text: '␣because', id: 1606 },
  { text: '␣it', id: 433 },
  { text: '␣was', id: 574 },
  { text: '␣tired', id: 19781 },
];
const IT = 8;
// Illustrative weights for "it" over itself and the earlier tokens (they sum to 1).
const IT_WEIGHTS = [0.03, 0.44, 0.03, 0.02, 0.05, 0.04, 0.21, 0.09, 0.09];

/** Causal attention for the sentence: each token over itself and earlier ones, mostly nearby, "it" as above. */
const ATTENTION = SENTENCE.map((_, r) => {
  if (r === IT) return [...IT_WEIGHTS, 0, 0];
  const s = SENTENCE.map((_, c) => (c > r ? -Infinity : -0.3 * (r - c) + 1.3 * random(`att:${r}:${c}`)));
  if (r === 10) s[1]! += 2.2;
  const m = Math.max(...s.filter(Number.isFinite));
  const e = s.map((x) => (Number.isFinite(x) ? Math.exp(x - m) : 0));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / sum);
});

/** Lays out tiles in a row centered on `cx`, with each tile `pad` wide on each side and `gap` between. */
function rowLayout(tokens: Token[], size: number, pad: number, gap: number, cx: number) {
  const widths = tokens.map((t) => t.text.length * size * ADV + pad * 2);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (tokens.length - 1);
  let x = cx - total / 2;
  return widths.map((w) => {
    const left = x;
    x += w + gap;
    return { left, width: w, center: left + w / 2 };
  });
}

function tile(
  token: Token,
  o: { size: number; pad: number; split: number; glow?: number; tint?: Color; tintAmount?: number; opacity?: number },
) {
  const { size, pad, split, glow = 0, tint = C.q, tintAmount = 0, opacity = 1 } = o;
  const lead = token.text.startsWith('␣');
  return box(
    {
      size: { width: token.text.length * size * ADV + pad * 2, height: size * 1.25 + pad * 1.1 },
      padding: [pad * 0.55, pad],
      borderRadius: 10 + size * 0.12,
      background: interpolateColor(tintAmount, [0, 1], [`rgba(255,255,255,${split})`, tint]),
      border: 1.5,
      borderColor: interpolateColor(glow, [0, 1], [`rgba(15,23,42,${0.12 * split})`, tint]),
      shadow:
        glow > 0.01
          ? { color: tint, blur: 26 * glow }
          : split > 0
            ? { color: `rgba(15,23,42,${0.08 * split})`, offset: [0, 4], blur: 12 }
            : undefined,
      justifyContent: 'center',
      alignItems: 'center',
      opacity,
    },
    [
      text(lead ? [span('␣', { color: `rgba(100,116,139,${split})` }), token.text.slice(1)] : token.text, {
        fontFamily: MONO,
        fontSize: size,
        color: C.text,
        maxLines: 1,
      }),
    ],
  );
}

const diverging = (v: number) => interpolateColor(v, [-1, 0, 1], ['#2563eb', '#d3dae6', '#f59e0b']);

/** A column of colored cells: a slice of a token's 4,096-number vector. */
function vector(seed: string, cells: number, width: number, reveal: number, shimmer: number, t: number) {
  return box(
    { flexDirection: 'column', gap: 5 },
    Array.from({ length: cells }, (_, d) => {
      const base = random(`${seed}:${d}`) * 2 - 1;
      const v = Math.max(-1, Math.min(1, base + shimmer * 0.25 * Math.sin(t * 2 + d * 1.7 + base * 6)));
      const k = clamp01(reveal * cells - d);
      return box({
        size: { width, height: 15 },
        borderRadius: 4,
        background: diverging(v),
        opacity: k,
        transform: { translateY: (1 - Easing.outCubic(k)) * -30 },
      });
    }),
  );
}

/** A heat map of weights, rows over columns, with the causal mask shown as empty cells. */
function heatmap(weights: number[][], o: { cell: number; color: Color; reveal: number; highlight?: number }) {
  const { cell, color, reveal, highlight } = o;
  const n = weights.length;
  const gap = Math.max(2, cell * 0.1);
  const side = n * (cell + gap) - gap;
  const kids: Child[] = [];
  weights.forEach((row, r) => {
    const max = Math.max(...row);
    row.forEach((w, c) => {
      const order = (r * (r + 1)) / 2 + c;
      const shown = clamp01(reveal * ((n * (n + 1)) / 2) - order);
      const masked = c > r;
      kids.push(
        box({
          ...abs(c * (cell + gap), r * (cell + gap)),
          size: { width: cell, height: cell },
          borderRadius: cell * 0.2,
          background: masked ? C.faint : interpolateColor(w / max, [0, 1], [C.cell, color]),
          opacity: masked ? clamp01(reveal * 2 - 1) : shown,
          transform: masked ? undefined : { scale: 0.6 + 0.4 * Easing.outBack(shown) },
        }),
      );
    });
  });
  if (highlight !== undefined)
    kids.push(
      box({
        ...abs(-6, highlight * (cell + gap) - 6),
        size: { width: side + 12, height: cell + 12 },
        borderRadius: cell * 0.3,
        border: 2.5,
        borderColor: C.warm,
        shadow: { color: C.warm, blur: 18 },
        opacity: clamp01(reveal * 3 - 2),
      }),
    );
  return box({ size: { width: side, height: side } }, kids);
}

/** An arrow from (x0, y0) at `angle` degrees, `length` long. */
function arrow(x0: number, y0: number, angle: number, length: number, color: Color, width = 6, opacity = 1) {
  const a = (angle * Math.PI) / 180;
  return path(`M${x0} ${y0} L${x0 + Math.cos(a) * length} ${y0 - Math.sin(a) * length}`, {
    ...abs(0, 0),
    size: { width: 1, height: 1 },
    stroke: color,
    strokeWidth: width,
    strokeCap: 'round',
    fill: null,
    arrow: { end: width * 3.2 },
    opacity,
  });
}

function dial(cx: number, cy: number, r: number, opacity: number, ticks = 12) {
  return box({ ...abs(cx - r, cy - r), size: { width: r * 2, height: r * 2 }, opacity }, [
    box({
      ...abs(0, 0),
      size: { width: r * 2, height: r * 2 },
      borderRadius: r,
      border: 2,
      borderColor: C.line,
      background: C.surface,
      shadow: { color: C.shadow, offset: [0, 6], blur: 18 },
    }),
    ...Array.from({ length: ticks }, (_, i) =>
      box({
        ...abs(r - 1, 4),
        size: { width: 2, height: r * 0.12 },
        background: 'rgba(15,23,42,0.22)',
        transformOrigin: [1, r - 4],
        transform: { rotate: (i * 360) / ticks },
      }),
    ),
  ]);
}

// World layout: regions of one big plane the camera travels across.
const A = { x: 960, y: 540 }; // the prompt
const D = { x: 3700, y: 560 }; // the attention sentence
const E = { x: 3700, y: 1700 }; // RoPE dials
const F = { x: 3700, y: 2900 }; // scores

const SENT_SIZE = 40;
const SENT = rowLayout(SENTENCE, SENT_SIZE, 16, 14, D.x);

function cameraAt(t: number) {
  return cameraMove(
    [
      { time: 0, camera: { x: A.x, y: A.y + 30, zoom: 1.4 } },
      { time: 2.6, camera: { x: A.x + 120, y: A.y + 10, zoom: 1.2 } },
      { time: 5.2, camera: { x: A.x + 140, y: A.y + 10, zoom: 1.16 } },
      { time: 6.6, camera: { x: A.x, y: A.y + 60, zoom: 1.1 } },
      { time: T.tokens + 2, camera: { x: A.x, y: A.y, zoom: 1.05 } },
      { time: T.embed + 1.5, camera: { x: A.x, y: A.y + 230, zoom: 1.0 } },
      { time: T.attend - 0.5, camera: { x: A.x + 60, y: A.y + 250, zoom: 1.0 } },
      { time: T.attend + 1.5, camera: { x: D.x, y: D.y - 60, zoom: 0.92 } },
      { time: T.rope - 1, camera: { x: D.x, y: D.y - 60, zoom: 0.92 } },
      // Dive toward "it", then down to the dials below it.
      { time: T.rope + 0.8, camera: { x: SENT[IT]!.center, y: D.y + 20, zoom: 2.6 } },
      { time: T.rope + 2.0, camera: { x: E.x, y: E.y - 120, zoom: 0.95 } },
      { time: T.rope + 6, camera: { x: E.x, y: E.y + 150, zoom: 1.05 } },
      { time: T.scores - 0.5, camera: { x: E.x, y: E.y + 150, zoom: 1.05 } },
      { time: T.scores + 1.8, camera: { x: F.x, y: F.y, zoom: 1.0 } },
      { time: T.layers, camera: { x: F.x, y: F.y, zoom: 1.0 } },
      { time: T.predict - 1, camera: { x: F.x, y: F.y, zoom: 1.0 } },
      // A fast travel back to the prompt for the payoff.
      { time: T.predict + 1.2, camera: { x: A.x + 120, y: A.y + 120, zoom: 1.0 } },
      { time: T.predict + 5.6, camera: { x: A.x + 180, y: A.y + 110, zoom: 0.98 } },
      { time: T.predict + 10.2, camera: { x: A.x + 520, y: A.y + 90, zoom: 0.86 } },
      { time: T.end + 2, camera: { x: A.x + 520, y: A.y + 90, zoom: 0.84 } },
    ],
    t,
  );
}

// Sections, drawn in world coordinates. Each returns nothing when it isn't on screen.

// The model's guesses for the next token, bursting out of the cursor: bigger and closer means more likely. The same
// probabilities return at the end of the film.
// Word, probability, and the direction it flies (degrees, 0 = right), away from the prompt's text on the left.
const CANDIDATES: [string, number, number][] = [
  ['mat', 0.41, 4],
  ['floor', 0.16, 42],
  ['couch', 0.11, -40],
  ['bed', 0.07, 78],
  ['edge', 0.05, -76],
  ['roof', 0.03, 112],
  ['chair', 0.03, -110],
  ['rug', 0.02, 22],
  ['table', 0.02, -20],
  ['sofa', 0.02, 60],
];

function candidateCloud(t: number, cx: number, cy: number, size: number): Child[] {
  const out = ramp(t, 5.0, 5.7);
  if (t < 2.7 || out >= 1) return [];
  const kids: Child[] = [];
  CANDIDATES.forEach(([word, p, angle], i) => {
    const k = spring({ timestamp: t - 2.8 - i * 0.07, from: 0, to: 1, response: 0.55, bounce: 0.2 });
    if (k <= 0.001) return;
    // Spread around the right of the cursor, likelier words nearer; a slow drift keeps the cloud alive.
    const a = (angle * Math.PI) / 180;
    const r = (170 + 320 * (1 - Math.sqrt(p / 0.41))) * k * (1 - out);
    const drift = { x: 10 * Math.sin(t * 1.3 + i * 2.1), y: 8 * Math.cos(t * 1.1 + i * 1.7) };
    const x = cx + Math.cos(a) * r + drift.x * k,
      // Flatter than a circle, so the lowest guesses stay clear of the subtitles.
      y = cy - Math.sin(a) * r * 0.68 + drift.y * k;
    const fs = 22 + 30 * Math.sqrt(p / 0.41);
    const w = word.length * fs * ADV + 36;
    kids.push(
      path(`M${cx} ${cy} L${x} ${y}`, {
        ...abs(0, 0),
        size: { width: 1, height: 1 },
        stroke: C.q,
        strokeWidth: 1 + 3 * Math.sqrt(p / 0.41),
        strokeCap: 'round',
        fill: null,
        opacity: (0.15 + 0.5 * (p / 0.41)) * clamp01(k) * (1 - out),
      }),
      box(
        {
          ...abs(x - w / 2, y - fs * 0.8),
          size: { width: w },
          padding: [fs * 0.22, 14],
          borderRadius: 12,
          background: C.surface,
          border: 1.5,
          borderColor: C.line,
          shadow: { color: C.shadow, offset: [0, 6], blur: 16 },
          justifyContent: 'center',
          alignItems: 'center',
          gap: 2,
          flexDirection: 'column',
          opacity: clamp01(k * 1.4) * (1 - out),
          transform: { scale: (0.6 + 0.4 * k) * (1 - 0.5 * out) },
        },
        [
          text(word, { fontFamily: MONO, fontSize: fs, color: C.text, maxLines: 1 }),
          text(`${Math.round(p * 100)}%`, { fontFamily: MONO, fontSize: fs * 0.45, color: C.muted }),
        ],
      ),
    );
  });
  return kids;
}

function promptSection(t: number, s: (typeof STRINGS)[Lang]): Child {
  if (t > T.attend + 3 && t < T.predict - 0.5) return null;
  const size = 58;
  const typed = Math.floor(interpolate(t, [0.4, 2.6], [0, 18]));
  const split = ramp(t, T.tokens + 0.4, T.tokens + 2.0);
  const tiles = rowLayout(PROMPT, size, 18 * split, 22 * split, A.x);
  // The prompt's text, character by character, maps onto the tiles.
  let shown = typed;
  const predicting = t >= T.predict;
  const ids = (i: number) => fade(t, T.tokens + 2.6 + i * 0.25, 0.4) * (1 - fade(t, T.attend + 1.5, 0.6));
  const top = A.y - size * 0.7;
  const kids: Child[] = [];
  // The prompt box around the text before it splits.
  kids.push(
    box({
      ...abs(A.x - 560, top - 34),
      size: { width: 1120, height: size * 1.25 + 68 },
      borderRadius: 26,
      background: C.surface,
      border: 1.5,
      borderColor: C.line,
      shadow: { color: C.shadow, offset: [0, 10], blur: 30 },
      opacity: fade(t, 0.1, 0.5) * (1 - split) + (predicting ? 0 : 0),
    }),
  );
  PROMPT.forEach((tok, i) => {
    const visibleChars = Math.max(0, Math.min(tok.text.length, shown));
    shown -= tok.text.length;
    if (visibleChars <= 0 && split === 0) return;
    const l = tiles[i]!;
    const typedText = visibleChars < tok.text.length ? { ...tok, text: tok.text.slice(0, visibleChars) } : tok;
    kids.push(
      box({ ...abs(l.left, top) }, [
        tile(split > 0 ? tok : typedText, {
          size,
          pad: 18 * split,
          split,
          glow: predicting ? 0 : 0.35 * window_(t, T.tokens + 2, T.tokens + 6, 0.8),
        }),
      ]),
      box(
        { ...abs(l.left, top + size * 1.25 + 40), size: { width: l.width }, justifyContent: 'center', opacity: ids(i) },
        [
          text(String(tok.id), {
            fontFamily: MONO,
            fontSize: 34,
            color: C.q,
            transform: { translateY: (1 - ids(i)) * 16 },
          }),
        ],
      ),
      // Each token's vector, hanging below it.
      t > T.embed && t < T.attend + 3
        ? box(
            {
              ...abs(l.center - 34, top + size * 1.25 + 110),
              opacity: 1 - fade(t, T.attend + 0.6, 1.2),
            },
            [
              vector(
                `prompt:${i}`,
                14,
                68,
                ramp(t, T.embed + 0.3 + i * 0.25, T.embed + 1.6 + i * 0.25),
                fade(t, T.embed + 5, 1),
                t,
              ),
            ],
          )
        : null,
    );
  });
  // A blinking cursor after the typed text, and the model's guesses flickering where the next word goes.
  const endX = tiles[PROMPT.length - 1]!.left + tiles[PROMPT.length - 1]!.width;
  const typedX = tiles[0]!.left + Math.min(typed, 18) * size * ADV;
  const typingDone = t > 2.6;
  const appended = predicting ? appendedTiles(t, endX, size) : [];
  const cursorX = predicting ? (appended.length ? appended[appended.length - 1]!.right : endX) + 12 : typedX + 6;
  if (split < 0.05 || predicting) {
    kids.push(
      box({
        ...abs(cursorX, top + 6),
        size: { width: 5, height: size * 1.05 },
        background: C.q,
        opacity: (Math.floor(t * 2.2) % 2 ? 0.25 : 1) * (predicting ? 1 - fade(t, T.end - 0.5) : 1),
      }),
    );
  }
  if (typingDone && t < T.tokens) kids.push(...candidateCloud(t, typedX + 8, top + size * 0.62, size));
  if (predicting) {
    kids.push(...prediction(t, appendedSlot(endX, size), top, size, s));
    for (const a of appended)
      kids.push(
        box({ ...abs(a.left, top), transform: { scale: 0.85 + 0.15 * a.k }, opacity: clamp01(a.k * 1.5) }, [
          tile(a.token, { size, pad: 18, split: 1, glow: a.glow, tint: C.warm, tintAmount: 0.18 * a.glow }),
        ]),
      );
  }
  // The vocabulary note beside the tiles.
  kids.push(
    box(
      {
        ...abs(A.x - 300, top - 150),
        size: { width: 600 },
        justifyContent: 'center',
        opacity: window_(t, T.tokens + 4.2, T.embed + 0.5, 0.6),
      },
      [text(s.vocab, { fontFamily: SANS, fontSize: 30, color: C.muted, textAlign: 'center' })],
    ),
    box({ ...abs(A.x + 470, top + 330), opacity: window_(t, T.embed + 2.5, T.attend + 0.6, 0.6) }, [
      text(s.dims, { fontFamily: SANS, fontSize: 30, color: C.muted }),
    ]),
  );
  return box({ ...abs(0, 0) }, kids);
}

// What the model predicts, and the words that follow, one token at a time.
const PREDICTIONS = [{ word: 'mat', bars: [0.41, 0.16, 0.11, 0.07, 0.05], others: ['floor', 'couch', 'bed', 'edge'] }];
// The predicted token, then the next few, each joining the prompt as a tile.
const APPENDED: { text: string; at: number }[] = [
  { text: '␣mat', at: T.predict + 5.2 },
  { text: '␣and', at: T.predict + 6.9 },
  { text: '␣fell', at: T.predict + 7.8 },
  { text: '␣asleep', at: T.predict + 8.7 },
  { text: '.', at: T.predict + 9.6 },
];
const tileWidth = (s: string, size: number) => s.length * size * ADV + 36;
/** Where the first predicted tile goes. */
const appendedSlot = (endX: number, _size: number) => endX + 22;

function appendedTiles(t: number, endX: number, size: number) {
  const out: { token: Token; left: number; right: number; k: number; glow: number }[] = [];
  let x = endX + 22;
  for (const a of APPENDED) {
    if (t < a.at) break;
    const w = tileWidth(a.text, size);
    out.push({
      token: { text: a.text, id: 0 },
      left: x,
      right: x + w,
      k: pop(t, a.at),
      glow: 1 - fade(t, a.at + 0.3, 1.2),
    });
    x += w + 22;
  }
  return out;
}

function prediction(t: number, endX: number, top: number, size: number, s: (typeof STRINGS)[Lang]): Child[] {
  const p = PREDICTIONS[0]!;
  const local = t - T.predict;
  const words = [p.word, ...p.others];
  const pick = ramp(t, T.predict + 4.4, T.predict + 5.3);
  const kids: Child[] = [];
  const barsTop = top + 190;
  words.forEach((w, j) => {
    const grow = spring({ timestamp: local - 1.6 - j * 0.12, from: 0, to: 1, response: 0.6, bounce: 0 });
    const winner = j === 0;
    kids.push(
      box(
        {
          ...abs(A.x - 520, barsTop + j * 66),
          flexDirection: 'row',
          alignItems: 'center',
          gap: 22,
          opacity: fade(local, 1.4 + j * 0.1) * (1 - fade(t, T.end - 1, 0.8)) * (winner ? 1 : 1 - 0.6 * pick),
        },
        [
          text(w, {
            fontFamily: MONO,
            fontSize: 32,
            color: winner ? C.warm : C.text,
            size: { width: 130 },
            textAlign: 'right',
          }),
          box({
            size: { width: 900 * (p.bars[j]! / 0.41) * grow, height: 38 },
            borderRadius: 10,
            background: winner ? interpolateColor(pick, [0, 1], [C.q, C.warm]) : '#d5dce7',
            shadow: winner ? { color: C.warm, blur: 24 * pick } : undefined,
          }),
          text(`${Math.round(p.bars[j]! * 100 * grow)}%`, {
            fontFamily: MONO,
            fontSize: 26,
            color: C.muted,
            fontFeatures: { tnum: 1 },
          }),
        ],
      ),
    );
  });
  kids.push(
    box({ ...abs(A.x - 520, barsTop - 56), opacity: fade(local, 1.2) * (1 - fade(t, T.end - 1, 0.8)) }, [
      text(s.illustrative, { fontFamily: SANS, fontSize: 22, color: C.dim }),
    ]),
  );
  // The winner flies from its bar into the prompt, where it becomes a tile.
  const fly = ramp(t, T.predict + 4.4, T.predict + 5.4);
  if (fly > 0 && t < T.predict + 5.2) {
    const x = interpolate(fly, [0, 1], [A.x - 520 + 130 - 3 * 32 * ADV, endX + 18 + size * ADV]);
    const y = interpolate(fly, [0, 1], [barsTop, top + 4]);
    kids.push(
      box({ ...abs(x, y), transform: { scale: 1 + 0.25 * Math.sin(fly * Math.PI) } }, [
        text('mat', { fontFamily: MONO, fontSize: interpolate(fly, [0, 1], [32, size]), color: C.warm }),
      ]),
    );
  }
  return kids;
}

function attentionSection(t: number, s: (typeof STRINGS)[Lang]): Child {
  if (t < T.attend - 0.5 || t > T.scores + 2) return null;
  const top = D.y - SENT_SIZE * 0.7;
  const kids: Child[] = [];
  const itGlow = fade(t, T.attend + 3, 0.6);
  const beams = (i: number) => ramp(t, T.attend + 4.6 + (IT - i) * 0.18, T.attend + 6.0 + (IT - i) * 0.18);
  const web = ramp(t, T.attend + 9.2, T.attend + 11.5);
  const max = Math.max(...IT_WEIGHTS.slice(0, IT));
  const arcPath = (a: number, b: number) => {
    const xa = SENT[a]!.center,
      xb = SENT[b]!.center;
    const h = 50 + Math.abs(xa - xb) * 0.3;
    return `M${xa} ${top - 8} Q${(xa + xb) / 2} ${top - 8 - h * 2} ${xb} ${top - 8}`;
  };
  const fadeOut = 1 - fade(t, T.rope + 1.2, 0.8);
  // Every token's attention, faintly: the whole web.
  if (web > 0)
    for (let r = 1; r < SENTENCE.length; r++)
      for (let c = 0; c < r; c++) {
        if (r === IT) continue;
        const w = ATTENTION[r]![c]!;
        kids.push(
          path(arcPath(r, c), {
            ...abs(0, 0),
            size: { width: 1, height: 1 },
            stroke: C.k,
            strokeWidth: 1 + 6 * w,
            fill: null,
            opacity: 0.12 + 0.45 * w,
            trim: { end: clamp01(web * 1.6 - (r / SENTENCE.length) * 0.6) },
          }),
        );
      }
  // Beams from "it" to each earlier token, with light traveling along the strong ones.
  for (let j = 0; j < IT; j++) {
    const w = IT_WEIGHTS[j]!;
    const d = arcPath(IT, j);
    kids.push(
      path(d, {
        ...abs(0, 0),
        size: { width: 1, height: 1 },
        stroke: C.q,
        strokeWidth: 1.5 + 18 * w,
        strokeCap: 'round',
        fill: null,
        opacity: (0.2 + 0.8 * (w / max)) * fadeOut,
        trim: { end: beams(j) },
        shadow: w > 0.15 ? { color: C.q, blur: 16 } : undefined,
      }),
    );
    if (w > 0.15 && beams(j) >= 1)
      for (let k = 0; k < 3; k++) {
        const p = alongPath(d, ((t * 0.55 + k / 3) % 1) as number);
        kids.push(
          box({
            ...abs(p.x - 6, p.y - 6),
            size: { width: 12, height: 12 },
            borderRadius: 6,
            background: C.q,
            shadow: { color: C.q, blur: 14 },
            opacity: 0.9 * fadeOut,
          }),
        );
      }
    if (w > 0.15) {
      const xa = SENT[IT]!.center,
        xb = SENT[j]!.center;
      const h = 50 + Math.abs(xa - xb) * 0.3;
      kids.push(
        box(
          {
            ...abs((xa + xb) / 2 - 60, top - 8 - h - 62),
            size: { width: 120 },
            justifyContent: 'center',
            opacity: fade(t, T.attend + 6.4) * fadeOut,
          },
          [text(`${Math.round(w * 100)}%`, { fontFamily: MONO, fontSize: 30, color: C.q })],
        ),
      );
    }
  }
  SENTENCE.forEach((tok, i) => {
    const appear = pop(t, T.attend + 0.6 + i * 0.06);
    const toIt = i < IT ? (IT_WEIGHTS[i]! / max) * beams(i) : 0;
    kids.push(
      box(
        { ...abs(SENT[i]!.left, top), opacity: clamp01(appear * 1.3), transform: { translateY: (1 - appear) * 30 } },
        [
          tile(tok, {
            size: SENT_SIZE,
            pad: 16,
            split: 1,
            glow: i === IT ? itGlow : 0.6 * toIt * (1 - web * 0.5),
            tint: i === IT ? C.warm : C.q,
            tintAmount: i === IT ? 0.22 * itGlow : 0.35 * toIt * (1 - web * 0.5),
            opacity: i > IT ? 1 - 0.6 * itGlow * (1 - web) : 1,
          }),
        ],
      ),
      // A small vector under each token: they carry their meaning into attention.
      box({ ...abs(SENT[i]!.center - 20, top + 90), opacity: clamp01(appear) * 0.85 }, [
        vector(`sent:${i}`, 6, 40, 1, 0.6, t),
      ]),
    );
  });
  kids.push(
    box(
      {
        ...abs(SENT[IT]!.center - 120, top + 260),
        size: { width: 240 },
        justifyContent: 'center',
        opacity: window_(t, T.attend + 3.2, T.attend + 9, 0.5),
      },
      [text(s.whatIsIt, { fontFamily: SANS, fontSize: 30, color: C.warm, textAlign: 'center' })],
    ),
  );
  return box({ ...abs(0, 0) }, kids);
}

function ropeSection(t: number, s: (typeof STRINGS)[Lang]): Child {
  if (t < T.rope || t > T.scores + 2.5) return null;
  const local = t - T.rope;
  const kids: Child[] = [];
  const THETA = 24;
  const base = 20;
  // A dial under every token: the same arrow, turned by its position.
  const rowY = E.y - 380;
  SENTENCE.forEach((_, m) => {
    const cx = SENT[m]!.center;
    const on = fade(local, 1.1 + m * 0.08, 0.4) * (1 - fade(local, 4.4, 0.8));
    if (on <= 0) return;
    const turned = ramp(local, 1.6 + m * 0.1, 2.8 + m * 0.1);
    kids.push(
      dial(cx, rowY, 52, on),
      arrow(cx, rowY, base + m * THETA * turned, 44, m === IT ? C.warm : C.q, 4, on),
      box({ ...abs(cx - 40, rowY + 66), size: { width: 80 }, justifyContent: 'center', opacity: on }, [
        text(`m=${m}`, { fontFamily: MONO, fontSize: 20, color: C.muted }),
      ]),
    );
  });
  // The big dial: a query at position m and a key at position n keep the same angle when both move.
  const big = { x: E.x - 330, y: E.y + 200, r: 230 };
  const bigOn = fade(local, 4.6, 0.6) * (1 - fade(t, T.scores + 0.6, 0.8));
  if (bigOn > 0) {
    const shift = Math.round(interpolate(local, [8.2, 10.4], [0, 4]));
    const smooth = interpolate(local, [8.2, 10.4], [0, 4], { easing: Easing.inOutCubic });
    const m = 2 + smooth,
      n = 5 + smooth;
    const qa = base + 10 + m * THETA,
      ka = base - 40 + n * THETA;
    kids.push(dial(big.x, big.y, big.r, bigOn, 24));
    // The arc between them: the angle that sets their score.
    const a0 = (Math.min(qa, ka) * Math.PI) / 180,
      a1 = (Math.max(qa, ka) * Math.PI) / 180;
    const rr = 120;
    kids.push(
      path(
        `M${big.x + Math.cos(a0) * rr} ${big.y - Math.sin(a0) * rr} A${rr} ${rr} 0 0 0 ${big.x + Math.cos(a1) * rr} ${big.y - Math.sin(a1) * rr}`,
        {
          ...abs(0, 0),
          size: { width: 1, height: 1 },
          stroke: C.warm,
          strokeWidth: 4,
          fill: null,
          opacity: bigOn * fade(local, 6.2),
        },
      ),
      arrow(big.x, big.y, qa, 200, C.q, 9, bigOn * fade(local, 5.0)),
      arrow(big.x, big.y, ka, 200, C.k, 9, bigOn * fade(local, 5.6)),
      box(
        {
          ...abs(big.x + big.r + 40, big.y - 120),
          size: { width: 330 },
          flexDirection: 'column',
          gap: 18,
          opacity: bigOn * fade(local, 5.2),
        },
        [
          text([span('q ', { color: C.q }), span(`m = ${(2 + shift).toFixed(0)}`, { color: C.text })], {
            fontFamily: MONO,
            fontSize: 34,
          }),
          text([span('k ', { color: C.k }), span(`n = ${(5 + shift).toFixed(0)}`, { color: C.text })], {
            fontFamily: MONO,
            fontSize: 34,
          }),
          text([span('n − m = 3', { color: C.warm })], { fontFamily: MONO, fontSize: 34, opacity: fade(local, 6.4) }),
        ],
      ),
    );
    // Pairs of dimensions turn at different speeds.
    const speeds = [40, 13, 3];
    speeds.forEach((sp, i) => {
      const x = E.x + 330 + i * 175,
        y = E.y + 200;
      const on = bigOn * fade(local, 10.6 + i * 0.25, 0.5);
      if (on <= 0) return;
      const pos = interpolate(local, [11, 14], [0, 10]);
      kids.push(
        dial(x, y, 70, on),
        arrow(x, y, 90 - pos * sp, 58, [C.q, C.v, C.k][i]!, 5, on),
        box({ ...abs(x - 90, y + 86), size: { width: 180 }, justifyContent: 'center', opacity: on }, [
          text(s.pairs[i]!, { fontFamily: SANS, fontSize: 22, color: C.muted, textAlign: 'center' }),
        ]),
      );
    });
  }
  return box({ ...abs(0, 0) }, kids);
}

function scoresSection(t: number, s: (typeof STRINGS)[Lang]): Child {
  if (t < T.scores || t > T.layers + 1) return null;
  const local = t - T.scores;
  const out = 1 - fade(local, 5.6, 0.5);
  return box({ ...abs(0, 0), opacity: out }, [
    box({ ...abs(F.x - 820, F.y - 360), opacity: fade(local, 0.8) }, [
      math('q_m^{\\top} k_n = (R_{m\\theta}\\, q)^{\\top} (R_{n\\theta}\\, k) = q^{\\top} R_{(n-m)\\theta}\\, k', {
        fontSize: 44,
        color: C.text,
        write: ramp(local, 0.8, 3.0),
      }),
    ]),
    box({ ...abs(F.x - 820, F.y - 220), size: { width: 700 }, opacity: fade(local, 2.6) }, [
      text(s.scoreNote, { fontFamily: SANS, fontSize: 28, color: C.muted, lineHeight: 1.5 }),
    ]),
    box({ ...abs(F.x + 80, F.y - 330) }, [
      heatmap(ATTENTION, { cell: 52, color: C.q, reveal: ramp(local, 1.8, 5.2), highlight: IT }),
    ]),
  ]);
}

// 3D: heads and the layer stack, drawn over the world in screen space.

const HEADS: { color: Color; w: (r: number, c: number) => number }[] = [
  { color: C.q, w: (r, c) => ATTENTION[r]![c]! },
  { color: C.k, w: (r, c) => (c === r - 1 || (r === 0 && c === 0) ? 1 : 0.06) },
  { color: C.v, w: (_r, c) => (c === 0 ? 1 : 0.08) },
  { color: C.warm, w: (r, c) => 0.55 + 0.45 * random(`wide:${r}:${c}`) },
];

function headGrid(h: (typeof HEADS)[number], cell: number) {
  const weights = SENTENCE.map((_, r) => {
    const row = SENTENCE.map((_, c) => (c > r ? 0 : h.w(r, c)));
    const sum = row.reduce((a, b) => a + b, 0);
    return row.map((v) => v / sum);
  });
  const g = heatmap(weights, { cell, color: h.color, reveal: 1 });
  const side = (g.style.size as { width: number }).width;
  return box(
    {
      size: { width: side + 48, height: side + 48 },
      padding: 24,
      borderRadius: 26,
      background: 'rgba(255,255,255,0.94)',
      border: 1.5,
      borderColor: C.line,
    },
    [g],
  );
}

function threeD(t: number, s: (typeof STRINGS)[Lang]): Child {
  if (t < T.scores + 5.6 || t > T.predict + 0.6) return null;
  const local = t - T.scores;
  const inHeads = fade(local, 5.8, 0.5);
  const toLayers = ramp(t, T.layers, T.layers + 2.2);
  const out = 1 - fade(t, T.predict - 0.8, 0.9);
  const fan = ramp(local, 6.4, 8.6);
  const items = HEADS.map((h, i) => ({
    node: headGrid(h, 26),
    x: (i - 1.5) * 300 * fan * (1 - toLayers) - 330 * toLayers,
    y: -40 * (1 - toLayers) + 120 * toLayers,
    // The first head sits nearest, so it stays on top while the others fan out behind it.
    z: -i * (160 * fan + 1) * (1 - toLayers),
    rotateY: -28 * fan * (1 - toLayers),
    rotateX: 72 * toLayers,
    scale: 1 - 0.3 * toLayers,
  }));
  // The layer stack: thin glass slabs, with a pulse of light rising through them.
  const N = 12;
  const stackOn = fade(t, T.layers + 1.4, 0.8);
  const pulse = ((t - T.layers - 3) * 3.2) % (N + 4);
  const slabs = Array.from({ length: N }, (_, i) => {
    const glow = Math.max(0, 1 - Math.abs(pulse - i) / 1.5);
    return {
      node: box({
        size: { width: 560, height: 380 },
        borderRadius: 28,
        background: interpolateColor(glow, [0, 1], ['rgba(8,145,178,0.07)', 'rgba(8,145,178,0.32)']),
        border: 2,
        borderColor: interpolateColor(glow, [0, 1], ['rgba(8,145,178,0.28)', C.q]),
        opacity: stackOn * clamp01((t - T.layers - 1.6) * 4 - i * 0.35),
      }),
      x: -360,
      y: 200 - i * 38 * ramp(t, T.layers + 1.6, T.layers + 4),
      z: -260,
      rotateX: 66,
    };
  });
  const cam = { tilt: 8 + 14 * toLayers, pan: -4 + local * 0.35, fov: 40 };
  return box({ ...abs(0, 0), size: VIEW, opacity: inHeads * out }, [
    // Both layers fill the screen on top of each other, so they must not take part in the row layout.
    space3d(VIEW, cam, toLayers < 1 ? items : [], abs(0, 0)),
    t > T.layers + 1.2 ? space3d(VIEW, cam, slabs, abs(0, 0)) : null,
    box(
      { ...abs(120, 760), flexDirection: 'column', gap: 6, opacity: window_(t, T.scores + 8.4, T.layers + 0.8, 0.5) },
      [
        text(s.heads, { fontFamily: SANS, fontSize: 44, fontWeight: 700, color: C.text }),
        text(s.headsNote, { fontFamily: SANS, fontSize: 28, color: C.muted }),
      ],
    ),
    layerLegend(t, s),
  ]);
}

function layerLegend(t: number, s: (typeof STRINGS)[Lang]): Child {
  const on = window_(t, T.layers + 2.6, T.predict - 0.6, 0.6);
  if (on <= 0) return null;
  const parts: [string, Color][] = [
    [s.parts[0]!, C.muted],
    [s.parts[1]!, C.q],
    [s.parts[2]!, C.v],
    [s.parts[3]!, C.muted],
    [s.parts[4]!, C.k],
    [s.parts[5]!, C.v],
  ];
  return box({ ...abs(1180, 230), flexDirection: 'column', gap: 16, opacity: on }, [
    text('× 32', { fontFamily: MONO, fontSize: 72, fontWeight: 700, color: C.q, margin: { bottom: 12 } }),
    ...parts.map(([label, color], i) =>
      box(
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 16,
          opacity: fade(t, T.layers + 3 + i * 0.3),
          transform: { translateX: (1 - fade(t, T.layers + 3 + i * 0.3)) * 30 },
        },
        [
          box({ size: { width: 10, height: 34 }, borderRadius: 5, background: color }),
          text(label, { fontFamily: SANS, fontSize: 32, color: C.text }),
        ],
      ),
    ),
    text(s.model, {
      fontFamily: MONO,
      fontSize: 19,
      color: C.muted,
      margin: { top: 18 },
      opacity: fade(t, T.layers + 5.2),
    }),
  ]);
}

function titleCard(t: number, s: (typeof STRINGS)[Lang]): Child {
  const at = 5.5;
  const leave = 1 - ramp(t, 7.5, 8.3);
  if (t < at || leave <= 0) return null;
  const lift = (1 - leave) * -60;
  return box(
    {
      ...abs(0, 600),
      size: { width: W },
      flexDirection: 'column',
      alignItems: 'center',
      gap: 14,
      opacity: leave,
      transform: { translateY: lift },
    },
    [
      text('LLAMA 3 · ATTENTION · RoPE', {
        fontFamily: MONO,
        fontSize: 22,
        letterSpacing: 4,
        color: C.q,
        opacity: fade(t, at, 0.5),
        transform: { translateY: (1 - fade(t, at, 0.5)) * 14 },
      }),
      text(s.title, {
        fontFamily: SANS,
        fontSize: 84,
        fontWeight: 700,
        color: C.text,
        split: {
          by: 'words',
          style: (u) => {
            const k = spring({ timestamp: t - at - 0.2 - u.index * 0.09, from: 0, to: 1, response: 0.5, bounce: 0.15 });
            return { opacity: clamp01(k * 1.6), y: (1 - k) * 40 };
          },
        },
      }),
      stroke('M0 14 C140 2 300 22 440 10 S600 4 660 12', {
        size: 9,
        taper: [20, 80],
        color: C.warm,
        draw: ramp(t, at + 0.9, at + 1.7),
      }),
    ],
  );
}

function chapter(t: number, s: (typeof STRINGS)[Lang]): Child {
  const marks: [number, string][] = [
    [T.tokens + 0.6, s.chapters[0]!],
    [T.embed + 0.4, s.chapters[1]!],
    [T.attend + 1.6, s.chapters[2]!],
    [T.rope + 1.2, s.chapters[3]!],
    [T.scores + 0.4, s.chapters[4]!],
    [T.layers + 0.4, s.chapters[5]!],
    [T.predict + 1.2, s.chapters[6]!],
  ];
  const current = marks.findLast(([at]) => t >= at);
  if (!current) return null;
  const [at, label] = current;
  const on = window_(t, at, at + 3.6, 0.4);
  const index = marks.indexOf(current) + 1;
  return box(
    {
      ...abs(72, 64),
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      padding: [12, 22],
      borderRadius: 40,
      background: 'rgba(255,255,255,0.9)',
      border: 1.5,
      borderColor: C.line,
      shadow: { color: C.shadow, offset: [0, 4], blur: 14 },
      opacity: on,
      transform: { translateX: (1 - on) * -24 },
    },
    [
      text(String(index).padStart(2, '0'), { fontFamily: MONO, fontSize: 22, color: C.q }),
      text(label, { fontFamily: SANS, fontSize: 26, fontWeight: 600, color: C.text }),
    ],
  );
}

function endCard(t: number, s: (typeof STRINGS)[Lang]): Child {
  const on = fade(t, T.end, 1);
  if (on <= 0) return null;
  return box(
    {
      ...abs(0, 0),
      size: VIEW,
      background: `rgba(245,246,250,${0.94 * on})`,
      justifyContent: 'center',
      alignItems: 'center',
    },
    [
      box({ flexDirection: 'column', alignItems: 'center', gap: 18, opacity: on }, [
        text('Attention Is All You Need', {
          fontFamily: SANS,
          fontSize: 80,
          fontWeight: 700,
          color: C.text,
          transform: { translateY: (1 - on) * 24 },
        }),
        text(s.sources, { fontFamily: SANS, fontSize: 30, color: C.muted, textAlign: 'center' }),
        text(s.credits, { fontFamily: MONO, fontSize: 20, color: C.dim, margin: { top: 70 } }),
      ]),
    ],
  );
}

export function transformerFilm(lang: Lang): Composition {
  const s = STRINGS[lang];
  const cues: Cue[] = s.subtitles.map(([start, end, line]) => ({ start, end, text: line }));
  return new Composition({
    width: W,
    height: H,
    frameRate: 30,
    duration: T.total,
    background: C.bg,
    fonts: [sans, mono],
    motionBlur: { shutter: 180, samples: 4 },
    render: ({ timestamp: t }) => {
      const cam = cameraAt(t);
      const zoom = cam.zoom ?? 1;
      // The dotted floor moves at a third of the camera's speed, for depth.
      const par = { x: -(cam.x * 0.33) % 56, y: -(cam.y * 0.33) % 56 };
      return box({ size: VIEW, effects: [vignette({ amount: 0.12, softness: 0.8 }), grain({ amount: 0.02 })] }, [
        audio(music, { role: 'music', volume: (x) => 0.9 * Math.min(1, x / 2, (T.total - x) / 4) }),
        box(
          {
            ...abs(-112, -112),
            size: { width: W + 224, height: H + 224 },
            transform: [{ translate: [par.x, par.y] }, { scale: 1 + (zoom - 1) * 0.25 }],
          },
          [backgrounds.dots({ background: C.bg, color: C.dots, spacing: 56, size: 1.8, fade: 0.5 })],
        ),
        // A soft light that follows the action.
        box({
          ...abs(W / 2 - 900, H / 2 - 700),
          size: { width: 1800, height: 1400 },
          borderRadius: 900,
          background: 'rgba(255,255,255,0.75)',
          blur: 160,
        }),
        camera(cam, VIEW, [
          box({ size: { width: 6000, height: 4000 } }, [
            promptSection(t, s),
            attentionSection(t, s),
            ropeSection(t, s),
            scoresSection(t, s),
          ]),
        ]),
        threeD(t, s),
        titleCard(t, s),
        chapter(t, s),
        endCard(t, s),
        captions(cues, {
          preset: 'subtitle',
          fontFamily: SANS,
          fontSize: 38,
          maxWidth: 1500,
          position: 'absolute',
          inset: { left: 0, right: 0, bottom: 58 },
        }),
      ]);
    },
  });
}
