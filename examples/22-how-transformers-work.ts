// 22 — How a Transformer works: a 90-second explainer. Tokens, embeddings and positions, attention with a causal mask,
// multiple heads, the layer stack, and next-token prediction. Scene cuts land on the music's beats.
// Needs `examples/fetch-assets.sh` (Inter, JetBrains Mono, and a CC0 track by Kevin MacLeod).
import { FilePathSource } from 'mediabunny';
import type { Color } from 'skiamovin';
import {
  analyzeAudio,
  audio,
  axes,
  box,
  type Child,
  Composition,
  counter,
  Easing,
  FontAsset,
  interpolateColor,
  math,
  path,
  type RenderContext,
  random,
  series,
  span,
  spring,
  text,
} from 'skiamovin/scene';
import { asset, input } from './shared.ts';

const inter = new FontAsset(new FilePathSource(asset('Inter.ttf')), { family: 'Inter' });
const mono = new FontAsset(new FilePathSource(asset('JetBrainsMono.ttf')), { family: 'JetBrains Mono' });
const music = input('infinite-wonder.mp3');
const analysis = await analyzeAudio(music, { frameRate: 30 });

const W = 1920,
  H = 1080,
  DURATION = 90;

// One palette for the whole film.
const C = {
  bg: '#0a0e17',
  surface: '#111827',
  line: '#263244',
  text: '#e5e7eb',
  muted: '#8b98ad',
  q: '#7dd3fc',
  k: '#f0abfc',
  v: '#bef264',
  warm: '#fcd34d',
};
const SANS = 'Inter';
const MONO = 'JetBrains Mono';
// JetBrains Mono advances 0.6 em per character, so token pills can be laid out exactly without measuring.
const MONO_ADVANCE = 0.6;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number, a: number, b: number) => Easing.inOutCubic(clamp01((t - a) / (b - a)));
const rise = (t: number, at: number) => spring({ timestamp: t - at, from: 24, to: 0, response: 0.6, bounce: 0 });
const appear = (t: number, at: number, d = 0.5) => Easing.smooth(clamp01((t - at) / d));

// Layout shared by every scene: a chapter number, a heading and a caption.

function frame(ctx: RenderContext, chapter: number, heading: string, caption: string, body: Child): Child {
  const t = ctx.timestamp;
  const leave = clamp01((ctx.duration - t) / 0.4);
  return box({ size: { width: W, height: H } }, [
    box(
      {
        position: 'absolute',
        inset: { left: 120, top: 84 },
        flexDirection: 'column',
        gap: 14,
        opacity: appear(t, 0.1) * leave,
      },
      [
        text(`${String(chapter).padStart(2, '0')} / 06`, {
          fontFamily: MONO,
          fontSize: 22,
          color: C.muted,
          letterSpacing: 2,
        }),
        text(heading, {
          fontFamily: SANS,
          fontSize: 58,
          fontWeight: 650,
          letterSpacing: -1.2,
          color: C.text,
          transform: { translateY: rise(t, 0.1) },
        }),
      ],
    ),
    body,
    box(
      {
        position: 'absolute',
        inset: { left: 0, right: 0, bottom: 72 },
        justifyContent: 'center',
        opacity: appear(t, 0.8, 0.6) * leave,
      },
      [
        text(caption, {
          fontFamily: SANS,
          fontSize: 31,
          lineHeight: 1.4,
          color: '#c3cddc',
          textAlign: 'center',
          size: { width: 1460 },
        }),
      ],
    ),
  ]);
}

/** Token text, with the marker for a leading space dimmed. */
const tokenText = (s: string, size: number) =>
  text(s.startsWith('␣') ? [span('␣', { color: '#4b5870' }), s.slice(1)] : s, {
    fontFamily: MONO,
    fontSize: size,
    color: C.text,
  });

/** A token in a rounded pill, in monospace so its width is known. */
const PILL = { size: 34, padX: 18, padY: 12 };
const pillWidth = (s: string, size = PILL.size) => s.length * size * MONO_ADVANCE + PILL.padX * 2;
function pill(
  s: string,
  options: { size?: number; tint?: string; tintAmount?: number; border?: Color; opacity?: number } = {},
) {
  const size = options.size ?? PILL.size;
  return box(
    {
      size: { width: pillWidth(s, size) },
      padding: [PILL.padY, PILL.padX],
      borderRadius: 14,
      background: options.tint
        ? interpolateColor(options.tintAmount ?? 0, [0, 1], [C.surface, options.tint])
        : C.surface,
      border: 1.5,
      borderColor: options.border ?? C.line,
      opacity: options.opacity ?? 1,
      justifyContent: 'center',
    },
    [tokenText(s, size)],
  );
}

/** A grid of weights: rows attend to columns. Cells above the diagonal are masked when `causal`. */
function heatmap(
  weights: number[][],
  options: { cell: number; color: string; reveal: number; causal?: boolean; labels?: string[]; highlight?: number },
) {
  const { cell, color, reveal, causal = true, labels, highlight } = options;
  const n = weights.length;
  const gap = Math.max(2, cell * 0.08);
  const labelW = labels ? Math.max(...labels.map((l) => l.length)) * 20 * MONO_ADVANCE + 16 : 0;
  const cells: Child[] = [];
  weights.forEach((row, r) => {
    const max = Math.max(...row);
    const shown = clamp01(reveal * n - r);
    row.forEach((w, c) => {
      const masked = causal && c > r;
      cells.push(
        box({
          position: 'absolute',
          inset: { left: labelW + c * (cell + gap), top: r * (cell + gap) },
          size: { width: cell, height: cell },
          borderRadius: cell * 0.18,
          background: masked ? 'rgba(255,255,255,0.02)' : interpolateColor(w / max, [0, 1], [C.surface, color]),
          border: masked ? 1 : 0,
          borderColor: '#1a2333',
          opacity: shown,
        }),
      );
    });
    if (labels)
      cells.push(
        box(
          {
            position: 'absolute',
            inset: { left: 0, top: r * (cell + gap) },
            size: { width: labelW - 16, height: cell },
            justifyContent: 'flex-end',
            alignItems: 'center',
            opacity: shown,
          },
          [text(labels[r]!, { fontFamily: MONO, fontSize: 20, color: r === highlight ? C.warm : C.muted })],
        ),
      );
  });
  if (highlight !== undefined)
    cells.push(
      box({
        position: 'absolute',
        inset: { left: labelW - 6, top: highlight * (cell + gap) - 6 },
        size: { width: n * (cell + gap) - gap + 12, height: cell + 12 },
        borderRadius: cell * 0.25,
        border: 2.5,
        borderColor: C.warm,
        opacity: clamp01(reveal * n - n),
      }),
    );
  return box({ size: { width: labelW + n * (cell + gap) - gap, height: n * (cell + gap) - gap } }, cells);
}

const softmax = (xs: number[]) => {
  const m = Math.max(...xs);
  const e = xs.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
};

// Illustrative causal attention for the sentence below: each row looks only at itself and earlier words, mostly
// nearby, with "it" and "tired" pointing back to "animal".
const SENTENCE = ['The', 'animal', "didn't", 'cross', 'the', 'street', 'because', 'it', 'was', 'tired'];
const IT = 7;
const IT_WEIGHTS = [0.04, 0.46, 0.03, 0.05, 0.04, 0.22, 0.08, 0.08];
const ATTENTION = SENTENCE.map((_, r) => {
  if (r === IT) return [...IT_WEIGHTS, 0, 0];
  const scores = SENTENCE.map((_, c) => {
    if (c > r) return -Infinity;
    let s = -0.25 * (r - c) + 1.4 * random(`attn:${r}:${c}`);
    if (c === r) s += 0.35;
    if (r === 9 && (c === 1 || c === 7)) s += 2.4;
    return s;
  });
  return softmax(scores.map((s) => (Number.isFinite(s) ? s : -1e9))).map((w, c) => (c > r ? 0 : w));
});

// Scene cuts: planned lengths, nudged to the nearest beat so changes land with the music.
const PLAN = [7, 10, 12, 20, 10, 11, 14];
const CUTS = PLAN.reduce<number[]>((acc, d) => {
  const target = (acc[acc.length - 1] ?? 0) + d;
  const beat = analysis.beats.reduce((b, x) => (Math.abs(x - target) < Math.abs(b - target) ? x : b), target);
  acc.push(Math.abs(beat - target) < 0.4 ? beat : target);
  return acc;
}, []);
const LENGTHS = [...CUTS, DURATION].map((c, i) => c - (i === 0 ? 0 : CUTS[i - 1]!));

// Scenes

function title(ctx: RenderContext): Child {
  const t = ctx.timestamp;
  const leave = clamp01((ctx.duration - t) / 0.5);
  // A quiet motif behind the title: dots with arcs drawing between them, like attention between words.
  const dots = 9;
  const span = 1200;
  const x0 = (W - span) / 2;
  const y = 760;
  const arcs = [
    [7, 1, 0.9],
    [5, 2, 0.5],
    [8, 6, 0.6],
    [3, 0, 0.35],
    [6, 1, 0.45],
  ] as const;
  return box({ size: { width: W, height: H }, opacity: leave }, [
    ...arcs.map(([a, b, w], i) => {
      const xa = x0 + (a * span) / (dots - 1),
        xb = x0 + (b * span) / (dots - 1);
      const h = Math.abs(xa - xb) * 0.45;
      return path(`M${xa} ${y} Q${(xa + xb) / 2} ${y - h} ${xb} ${y}`, {
        position: 'absolute',
        inset: { left: 0, top: 0 },
        size: { width: W, height: H },
        stroke: i % 2 ? C.k : C.q,
        strokeWidth: 1.5 + w * 3,
        strokeCap: 'round',
        fill: null,
        opacity: 0.25 + w * 0.5,
        trim: { end: ease(t, 1.2 + i * 0.35, 2.6 + i * 0.35) },
      });
    }),
    ...Array.from({ length: dots }, (_, i) =>
      box({
        position: 'absolute',
        inset: { left: x0 + (i * span) / (dots - 1) - 7, top: y - 7 },
        size: { width: 14, height: 14 },
        borderRadius: 7,
        background: C.text,
        opacity: appear(t, 0.6 + i * 0.06) * 0.85,
      }),
    ),
    box(
      {
        position: 'absolute',
        inset: { left: 0, right: 0, top: 330 },
        flexDirection: 'column',
        alignItems: 'center',
        gap: 26,
      },
      [
        text('How a Transformer works', {
          fontFamily: SANS,
          fontSize: 108,
          fontWeight: 700,
          letterSpacing: -3,
          color: C.text,
          opacity: appear(t, 0.2, 0.7),
          transform: { translateY: rise(t, 0.2) },
        }),
        text('The architecture behind today’s language models', {
          fontFamily: SANS,
          fontSize: 38,
          color: C.muted,
          opacity: appear(t, 0.7, 0.7),
          transform: { translateY: rise(t, 0.7) },
        }),
      ],
    ),
  ]);
}

const TOKENS = ['The', '␣cat', '␣sat', '␣on', '␣the', '␣mat'];
const TOKEN_IDS = [464, 3797, 3332, 319, 262, 2603];

function tokens(ctx: RenderContext): Child {
  const t = ctx.timestamp;
  const split = ease(t, 1.6, 3.0);
  const gap = 4 + split * 26;
  return frame(
    ctx,
    1,
    'Text becomes tokens',
    'A tokenizer cuts text into pieces from a fixed vocabulary of 50,257 in GPT-2. A piece often carries its leading space (shown as ␣), and each piece is just a number to the model.',
    box(
      {
        position: 'absolute',
        inset: { left: 0, right: 0, top: 400 },
        flexDirection: 'row',
        justifyContent: 'center',
        gap,
      },
      [
        ...TOKENS.map((tok, i) =>
          box({ flexDirection: 'column', alignItems: 'center', gap: 22 }, [
            box(
              {
                size: { width: pillWidth(tok, 44) },
                padding: [16, PILL.padX],
                borderRadius: 16,
                background: interpolateColor(split, [0, 1], [C.bg, C.surface]),
                border: 1.5,
                borderColor: interpolateColor(split, [0, 1], [C.bg, C.line]),
                justifyContent: 'center',
                opacity: appear(t, 0.3 + i * 0.08),
              },
              [tokenText(tok, 44)],
            ),
            text(String(TOKEN_IDS[i]), {
              fontFamily: MONO,
              fontSize: 30,
              color: C.q,
              opacity: appear(t, 3.6 + i * 0.18),
              transform: { translateY: rise(t, 3.6 + i * 0.18) },
            }),
          ]),
        ),
      ],
    ),
  );
}

/** A fixed pseudo-random value in -1..1 for an embedding cell. */
const cellValue = (token: number, dim: number, salt: string) => random(`${salt}:${token}:${dim}`) * 2 - 1;
const diverging = (v: number) => interpolateColor(v, [-1, 0, 1], ['#3b82f6', '#1a2233', '#f59e0b']);

function embeddings(ctx: RenderContext): Child {
  const t = ctx.timestamp;
  const DIMS = 10;
  const CELL = 34;
  const add = ease(t, 6.4, 8.2);
  const ax = axes({
    x: [0, 6, 1],
    y: [-1.2, 1.2],
    width: 520,
    height: 300,
    color: '#3a475c',
    labels: false,
    draw: ease(t, 4.6, 5.6),
  });
  const freq = [0.5, 1.1, 2.3];
  return frame(
    ctx,
    2,
    'Each token becomes a vector',
    'Each ID looks up a learned vector: 768 numbers in GPT-2 small, ten shown here. Order matters too, so a position vector is added. The original Transformer used sine waves for positions; GPT-2 learns them.',
    box({ size: { width: W, height: H } }, [
      box({ position: 'absolute', inset: { left: 160, top: 290 }, flexDirection: 'row', gap: 36 }, [
        ...TOKENS.map((tok, ti) =>
          box({ flexDirection: 'column', alignItems: 'center', gap: 16 }, [
            pill(tok, { size: 26 }),
            box({ flexDirection: 'column', gap: 5 }, [
              ...Array.from({ length: DIMS }, (_, d) => {
                const token = cellValue(ti, d, 'tok');
                const pos = Math.sin((ti + 1) * freq[d % 3]! + d) * 0.6;
                return box({
                  size: { width: CELL * 1.6, height: CELL * 0.62 },
                  borderRadius: 5,
                  background: diverging(Math.max(-1, Math.min(1, token + pos * add))),
                  opacity: appear(t, 0.9 + ti * 0.12 + d * 0.06, 0.3),
                });
              }),
            ]),
          ]),
        ),
      ]),
      box(
        {
          position: 'absolute',
          inset: { left: 160, top: 690 },
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          opacity: appear(t, 2.2),
        },
        [
          text('−1', { fontFamily: MONO, fontSize: 20, color: C.muted }),
          ...[-1, -0.5, 0, 0.5, 1].map((v) =>
            box({ size: { width: 40, height: 18 }, borderRadius: 4, background: diverging(v) }),
          ),
          text('+1', { fontFamily: MONO, fontSize: 20, color: C.muted }),
        ],
      ),
      box(
        {
          position: 'absolute',
          inset: { left: 1240, top: 300 },
          flexDirection: 'column',
          gap: 18,
          opacity: appear(t, 4.4),
        },
        [
          text('Position signals', { fontFamily: SANS, fontSize: 28, fontWeight: 600, color: C.text }),
          ax.view(
            ...freq.map((f, i) =>
              ax.plot((x) => Math.sin(x * f * 1.3), {
                color: [C.q, C.k, C.v][i]!,
                strokeWidth: 3,
                draw: ease(t, 5.0 + i * 0.3, 6.2 + i * 0.3),
              }),
            ),
          ),
          text('+  added to every token’s vector', {
            fontFamily: MONO,
            fontSize: 22,
            color: C.muted,
            opacity: appear(t, 6.4),
          }),
        ],
      ),
    ]),
  );
}

function attention(ctx: RenderContext): Child {
  const t = ctx.timestamp;
  const size = 30;
  const gap = 16;
  const widths = SENTENCE.map((s) => pillWidth(s, size));
  const total = widths.reduce((a, b) => a + b, 0) + gap * (SENTENCE.length - 1);
  const lefts: number[] = [];
  widths.reduce(
    (x, w) => {
      lefts.push(x);
      return x + w + gap;
    },
    (W - total) / 2,
  );
  const centers = lefts.map((l, i) => l + widths[i]! / 2);
  const partB = t >= 9.5;
  const rowTop = 560;
  const fadeA = 1 - ease(t, 8.8, 9.6);

  if (!partB) {
    const max = Math.max(...IT_WEIGHTS);
    return frame(
      ctx,
      3,
      'Attention: each word looks back',
      'To make sense of “it”, the model weighs every earlier word and mixes in what they carry. Here most of the weight goes to “animal”. (Weights are illustrative.)',
      box({ size: { width: W, height: H }, opacity: fadeA }, [
        ...IT_WEIGHTS.map((w, j) => {
          if (j === IT) return null;
          const xa = centers[IT]!,
            xb = centers[j]!;
          const h = 40 + Math.abs(xa - xb) * 0.22;
          const draw = ease(t, 1.6 + (IT - j) * 0.12, 3.2 + (IT - j) * 0.12);
          return path(`M${xa} ${rowTop - 6} Q${(xa + xb) / 2} ${rowTop - 6 - h * 2} ${xb} ${rowTop - 6}`, {
            position: 'absolute',
            inset: { left: 0, top: 0 },
            size: { width: W, height: H },
            stroke: C.q,
            strokeWidth: 1.5 + 16 * w,
            strokeCap: 'round',
            fill: null,
            opacity: 0.2 + 0.8 * (w / max),
            trim: { end: draw },
          });
        }),
        ...[1, 5].map((j) => {
          const xa = centers[IT]!,
            xb = centers[j]!;
          const h = 40 + Math.abs(xa - xb) * 0.22;
          return box(
            {
              position: 'absolute',
              inset: { left: (xa + xb) / 2 - 60, top: rowTop - 6 - h - 66 },
              size: { width: 120 },
              justifyContent: 'center',
              opacity: appear(t, 3.6),
            },
            [text(`${Math.round(IT_WEIGHTS[j]! * 100)}%`, { fontFamily: MONO, fontSize: 28, color: C.q })],
          );
        }),
        ...SENTENCE.map((s, i) =>
          box({ position: 'absolute', inset: { left: lefts[i]!, top: rowTop }, opacity: appear(t, 0.2 + i * 0.05) }, [
            pill(s, {
              size,
              tint: i === IT ? C.warm : C.q,
              tintAmount:
                i === IT ? 0.18 * appear(t, 1.2) : i < IT ? (IT_WEIGHTS[i]! / max) * 0.45 * appear(t, 3.4) : 0,
              border: i === IT ? interpolateColor(appear(t, 1.2), [0, 1], [C.line, C.warm]) : C.line,
              opacity: i > IT ? 0.35 : 1,
            }),
          ]),
        ),
      ]),
    );
  }

  const tb = t - 9.5;
  const legend = [
    ['Q', 'Query', 'what this word is looking for', C.q],
    ['K', 'Key', 'what each word offers to match', C.k],
    ['V', 'Value', 'what each word passes on', C.v],
  ] as const;
  return frame(
    ctx,
    3,
    'How the weights are computed',
    'Each word makes a query, compares it with every key, and takes a weighted mix of the values. In a GPT a word can only look back, so everything above the diagonal is masked.',
    box({ size: { width: W, height: H } }, [
      box({ position: 'absolute', inset: { left: 160, top: 300 } }, [
        math('\\text{Attention}(Q,K,V) = \\text{softmax}\\left(\\frac{QK^{\\top}}{\\sqrt{d_k}}\\right)V', {
          fontSize: 44,
          color: C.text,
          write: ease(tb, 0.2, 2.6),
        }),
      ]),
      box({ position: 'absolute', inset: { left: 160, top: 500 }, flexDirection: 'column', gap: 30 }, [
        ...legend.map(([letter, name, desc, color], i) =>
          box(
            {
              flexDirection: 'row',
              alignItems: 'center',
              gap: 22,
              opacity: appear(tb, 2.4 + i * 0.4),
              transform: { translateY: rise(tb, 2.4 + i * 0.4) },
            },
            [
              box(
                {
                  size: { width: 52, height: 52 },
                  borderRadius: 12,
                  background: color,
                  justifyContent: 'center',
                  alignItems: 'center',
                },
                [text(letter, { fontFamily: MONO, fontSize: 28, fontWeight: 700, color: C.bg })],
              ),
              box({ flexDirection: 'column', gap: 4 }, [
                text(name, { fontFamily: SANS, fontSize: 30, fontWeight: 600, color: C.text }),
                text(desc, { fontFamily: SANS, fontSize: 24, color: C.muted }),
              ]),
            ],
          ),
        ),
        text('d_k = 64 in GPT-2 small; dividing by √d_k keeps the scores in a range softmax handles well.', {
          fontFamily: SANS,
          fontSize: 22,
          color: C.muted,
          size: { width: 640 },
          lineHeight: 1.4,
          opacity: appear(tb, 4.2),
        }),
      ]),
      box({ position: 'absolute', inset: { left: 1040, top: 270 } }, [
        heatmap(ATTENTION, {
          cell: 46,
          color: C.q,
          reveal: ease(tb, 3.0, 7.0) * (1 + 1 / SENTENCE.length),
          labels: SENTENCE,
          highlight: IT,
        }),
      ]),
    ]),
  );
}

/** Small illustrative patterns that individual heads are known to learn. */
const HEADS: { name: string; weights: (r: number, c: number) => number; color: string }[] = [
  { name: 'previous word', weights: (r, c) => (c === r - 1 || (r === 0 && c === 0) ? 1 : 0.05), color: C.q },
  { name: 'first token', weights: (_r, c) => (c === 0 ? 1 : 0.08), color: C.k },
  { name: 'same word', weights: (r, c) => (c === r ? 1 : 0.06), color: C.v },
  { name: 'broad context', weights: (r, c) => 0.6 + 0.4 * random(`broad:${r}:${c}`), color: C.warm },
];

function heads(ctx: RenderContext): Child {
  const t = ctx.timestamp;
  const n = TOKENS.length;
  // After the heads appear, step through the rows together: every word gets its own row of weights in each head.
  const sweep = t < 3.4 ? undefined : Math.floor((t - 3.4) * 1.2) % n;
  return frame(
    ctx,
    4,
    'Many heads, many patterns',
    'Attention runs in parallel “heads”, 12 per layer in GPT-2 small, each with its own Q, K and V. Heads learn different habits, like these, and their outputs are joined back together.',
    box(
      {
        position: 'absolute',
        inset: { left: 0, right: 0, top: 330 },
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 70,
      },
      [
        ...HEADS.map((h, i) => {
          const k = spring({ timestamp: t - 0.6 - i * 0.35, from: 0, to: 1, response: 0.55, bounce: 0.15 });
          const weights = Array.from({ length: n }, (_, r) => {
            const row = Array.from({ length: n }, (_, c) => (c > r ? 0 : h.weights(r, c)));
            const s = row.reduce((a, b) => a + b, 0);
            return row.map((v) => v / s);
          });
          return box(
            {
              flexDirection: 'column',
              alignItems: 'center',
              gap: 22,
              opacity: clamp01(k * 1.4),
              transform: { translateY: (1 - k) * 40 },
            },
            [
              heatmap(weights, { cell: 40, color: h.color, reveal: 1.2, highlight: sweep }),
              text(`Head ${i + 1}`, { fontFamily: MONO, fontSize: 22, color: C.muted }),
              text(h.name, { fontFamily: SANS, fontSize: 28, fontWeight: 600, color: C.text }),
            ],
          );
        }),
      ],
    ),
  );
}

/** The layer stack, laid out by hand: input, a repeated block with residual connections, and the output. */
function stack(t: number): Child[] {
  const X = 220,
    BW = 640,
    BH = 62;
  const at = (i: number) => appear(t, 0.4 + i * 0.35);
  const block = (y: number, label: string, i: number, accent?: string) =>
    box(
      {
        position: 'absolute',
        inset: { left: X, top: y },
        size: { width: BW, height: BH },
        borderRadius: 14,
        background: '#121a29',
        border: 1.5,
        borderColor: '#2e3b52',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 18,
        padding: { left: 22 },
        opacity: at(i),
        transform: { translateY: rise(t, 0.4 + i * 0.35) },
      },
      [
        accent ? box({ size: { width: 6, height: 30 }, borderRadius: 3, background: accent }) : null,
        text(label, {
          fontFamily: SANS,
          fontSize: 28,
          fontWeight: accent ? 600 : 400,
          color: accent ? C.text : C.muted,
        }),
      ],
    );
  const line = (d: string, i: number, color = '#56657d') =>
    path(d, {
      position: 'absolute',
      inset: { left: 0, top: 0 },
      size: { width: W, height: H },
      stroke: color,
      strokeWidth: 2.5,
      strokeCap: 'round',
      fill: null,
      trim: { end: ease(t, 0.6 + i * 0.35, 1.2 + i * 0.35) },
      arrow: { end: 10 },
    });
  const cx = X + BW / 2;
  // Rows, top to bottom; the repeated block sits in a dashed frame.
  const Y = { input: 250, attn: 372, norm1: 456, ff: 540, norm2: 624, out: 746 };
  const right = X + BW;
  return [
    block(Y.input, 'Token + position embeddings', 0),
    box({
      position: 'absolute',
      inset: { left: X - 26, top: Y.attn - 26 },
      size: { width: BW + 52, height: Y.norm2 + BH + 26 - (Y.attn - 26) },
      borderRadius: 22,
      border: 2,
      borderColor: '#2a3850',
      opacity: at(1),
    }),
    box({ position: 'absolute', inset: { left: X - 150, top: Y.attn + 128 }, opacity: at(5) }, [
      text('× 12', { fontFamily: MONO, fontSize: 40, fontWeight: 700, color: C.q }),
    ]),
    block(Y.attn, 'Masked multi-head attention', 1, C.q),
    block(Y.norm1, 'Add & layer norm', 2),
    block(Y.ff, 'Feed-forward network', 3, C.k),
    block(Y.norm2, 'Add & layer norm', 4),
    block(Y.out, 'Probabilities for the next token', 6, C.warm),
    line(`M${cx} ${Y.input + BH} L${cx} ${Y.attn - 4}`, 1),
    line(`M${cx} ${Y.attn + BH} L${cx} ${Y.norm1 - 4}`, 2),
    line(`M${cx} ${Y.norm1 + BH} L${cx} ${Y.ff - 4}`, 3),
    line(`M${cx} ${Y.ff + BH} L${cx} ${Y.norm2 - 4}`, 4),
    line(`M${cx} ${Y.norm2 + BH} L${cx} ${Y.out - 4}`, 6),
    // Residual connections: each sublayer's input is added back after it.
    line(
      `M${right} ${Y.attn - 12} C${right + 34} ${Y.attn - 12} ${right + 34} ${Y.norm1 + BH / 2} ${right + 4} ${Y.norm1 + BH / 2}`,
      5,
      C.v,
    ),
    line(
      `M${right} ${Y.norm1 + BH + 10} C${right + 34} ${Y.norm1 + BH + 10} ${right + 34} ${Y.norm2 + BH / 2} ${right + 4} ${Y.norm2 + BH / 2}`,
      5.4,
      C.v,
    ),
    box({ position: 'absolute', inset: { left: right + 46, top: Y.norm1 + 2 }, opacity: at(5.6) }, [
      text('residual', { fontFamily: MONO, fontSize: 20, color: C.v }),
    ]),
  ];
}

function layers(ctx: RenderContext): Child {
  const t = ctx.timestamp;
  const stats = [
    ['12', 'layers'],
    ['12', 'heads per layer'],
    ['768', 'numbers per token'],
    ['124M', 'parameters'],
  ];
  return frame(
    ctx,
    5,
    'Stacked into layers',
    'Attention moves information between words; the feed-forward network then works on each word on its own. Residual connections and normalization keep deep stacks trainable.',
    box({ size: { width: W, height: H } }, [
      ...stack(t),
      box({ position: 'absolute', inset: { left: 1180, top: 300 }, flexDirection: 'column', gap: 28 }, [
        text('GPT-2 small', { fontFamily: MONO, fontSize: 24, color: C.muted, opacity: appear(t, 5.8) }),
        ...stats.map(([n, label], i) =>
          box(
            {
              flexDirection: 'row',
              alignItems: 'center',
              gap: 18,
              opacity: appear(t, 6.2 + i * 0.3),
              transform: { translateY: rise(t, 6.2 + i * 0.3) },
            },
            [
              text(n!, {
                fontFamily: SANS,
                fontSize: 60,
                fontWeight: 700,
                letterSpacing: -1.5,
                color: C.text,
                size: { width: 180 },
              }),
              text(label!, { fontFamily: SANS, fontSize: 30, color: C.muted }),
            ],
          ),
        ),
      ]),
    ]),
  );
}

const STEPS = [
  {
    prefix: 'The cat sat on the',
    next: [
      ['mat', 0.41],
      ['floor', 0.16],
      ['couch', 0.11],
      ['bed', 0.07],
      ['edge', 0.05],
    ],
  },
  {
    prefix: 'The cat sat on the mat',
    next: [
      ['.', 0.38],
      [',', 0.17],
      ['and', 0.14],
      ['while', 0.05],
      ['in', 0.04],
    ],
  },
] as const;

function predict(ctx: RenderContext): Child {
  const t = ctx.timestamp;
  const STEP = ctx.duration / 2;
  const i = t < STEP ? 0 : 1;
  const local = t - i * STEP;
  const step = STEPS[i]!;
  const chosen: string = step.next[0]![0];
  const pick = ease(local, 4.2, 5.0);
  return frame(
    ctx,
    6,
    'Predicting the next token',
    'The last vector is scored against all 50,257 tokens, and softmax turns the scores into probabilities. One is picked, appended, and the whole model runs again: one token at a time. (Probabilities are illustrative.)',
    box({ size: { width: W, height: H } }, [
      box({ position: 'absolute', inset: { left: 160, top: 300 }, flexDirection: 'row', alignItems: 'center' }, [
        text(step.prefix, { fontFamily: SANS, fontSize: 64, fontWeight: 600, letterSpacing: -1, color: C.text }),
        // The chosen word takes no room until it is picked, so the cursor sits right after the text.
        pick > 0
          ? text(chosen === '.' || chosen === ',' ? chosen : ` ${chosen}`, {
              fontFamily: SANS,
              fontSize: 64,
              fontWeight: 600,
              color: C.warm,
              opacity: pick,
              transform: { translateY: (1 - pick) * 30 },
            })
          : null,
        pick < 1
          ? box({
              size: { width: 5, height: 60 },
              margin: { left: 10 },
              background: C.q,
              opacity: Math.floor(local * 2) % 2 ? 0.2 : 1,
            })
          : null,
      ]),
      box({ position: 'absolute', inset: { left: 160, top: 470 }, flexDirection: 'column', gap: 18 }, [
        ...step.next.map(([word, p], j) => {
          const grow = spring({ timestamp: local - 0.6 - j * 0.12, from: 0, to: 1, response: 0.6, bounce: 0 });
          const top = j === 0;
          return box({ flexDirection: 'row', alignItems: 'center', gap: 24, opacity: appear(local, 0.4 + j * 0.12) }, [
            text(word, {
              fontFamily: MONO,
              fontSize: 30,
              color: top ? C.warm : C.text,
              size: { width: 130 },
              textAlign: 'right',
            }),
            box({
              size: { width: 1100 * (p / 0.41) * grow, height: 40 },
              borderRadius: 8,
              background: top ? interpolateColor(pick, [0, 1], [C.q, C.warm]) : '#2b3a52',
            }),
            text(`${counter(p * 100 * grow, { decimals: 0 })}%`, {
              fontFamily: MONO,
              fontSize: 26,
              color: C.muted,
              fontFeatures: { tnum: 1 },
            }),
          ]);
        }),
      ]),
    ]),
  );
}

function outro(ctx: RenderContext): Child {
  const t = ctx.timestamp;
  const leave = clamp01((ctx.duration - t) / 1.2);
  return box({ size: { width: W, height: H }, justifyContent: 'center', alignItems: 'center', opacity: leave }, [
    box({ flexDirection: 'column', alignItems: 'center', gap: 20 }, [
      text('Attention Is All You Need', {
        fontFamily: SANS,
        fontSize: 92,
        fontWeight: 700,
        letterSpacing: -2.5,
        color: C.text,
        opacity: appear(t, 0.2, 0.8),
        transform: { translateY: rise(t, 0.2) },
      }),
      text('Vaswani et al., 2017: the paper that introduced the Transformer', {
        fontFamily: SANS,
        fontSize: 34,
        color: C.muted,
        opacity: appear(t, 0.9, 0.8),
      }),
      text('Music: “Infinite Wonder” by Kevin MacLeod (CC0)  ·  Made with Skiamovin', {
        fontFamily: MONO,
        fontSize: 20,
        color: '#5b6a82',
        margin: { top: 90 },
        opacity: appear(t, 1.8, 0.8),
      }),
    ]),
  ]);
}

const SCENES = [title, tokens, embeddings, attention, heads, layers, predict, outro];

export default new Composition({
  width: W,
  height: H,
  frameRate: 30,
  duration: DURATION,
  background: C.bg,
  fonts: [inter, mono],
  render: (ctx) => [
    audio(music, {
      role: 'music',
      volume: (t) => 0.9 * Math.min(1, t / 1.5, (DURATION - t) / 4),
    }),
    series(
      ctx,
      SCENES.map((render, i) => ({
        duration: LENGTHS[i]!,
        render,
        transition: i < SCENES.length - 1 ? { name: 'dissolve', duration: 0.6 } : undefined,
      })),
    ),
  ],
});
