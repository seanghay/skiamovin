// The Skiamovin launch film: about a minute, cut to a 120 BPM track, built only from what the library does.
// Every shot is live: the code, the physics, the math, the 3D, the footage and the type are rendered, not pasted.
import { FilePathSource } from 'mediabunny';
import type { Color } from 'skiamovin';
import {
  adjust,
  audio,
  backgrounds,
  box,
  type Child,
  Composition,
  type Cue,
  captions,
  code,
  diagram,
  Easing,
  FontAsset,
  grain,
  ImageAsset,
  image,
  interpolate,
  linearGradient,
  looks,
  math,
  physics,
  type SceneNode,
  sdfScene,
  space3d,
  spring,
  springs,
  text,
  video,
  vignette,
} from 'skiamovin/scene';
import { asset, input } from '../shared.ts';

const font = (file: string, family: string) => new FontAsset(new FilePathSource(asset(file)), { family });
const FONTS = [
  font('Inter.ttf', 'Inter'),
  font('InstrumentSerif.ttf', 'Instrument Serif'),
  font('InstrumentSerif-Italic.ttf', 'Instrument Serif Italic'),
  font('JetBrainsMono.ttf', 'JetBrains Mono'),
  font('GoogleSans.ttf', 'Google Sans'),
];
const SANS = 'Inter',
  SERIF = 'Instrument Serif Italic',
  MONO = 'JetBrains Mono';

const music = input('arpent.mp3');
const footage = input('tears-of-steel.mp4');
const SUNSET = new ImageAsset(new FilePathSource(asset('the_sky_is_on_fire.jpg')));
const VENICE = new ImageAsset(new FilePathSource(asset('venice_sunset.jpg')));

const W = 1920,
  H = 1080,
  VIEW = { width: W, height: H };
// The film starts 21.046 s into the track: its beats then fall on every half second, and the hit after the track's
// quiet break lands at 11.0 s.
const MUSIC_START = 21.046;
const BAR = 2;
export const DURATION = 61;

const C = {
  bg: '#000000',
  text: '#f5f5f7',
  muted: '#86868b',
  violet: '#a78bfa',
  cyan: '#22d3ee',
  pink: '#f472b6',
  glass: 'rgba(255,255,255,0.06)',
  edge: 'rgba(255,255,255,0.14)',
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ramp = (t: number, a: number, b: number) => Easing.inOutCubic(clamp01((t - a) / (b - a)));
const fade = (t: number, a: number, d = 0.4) => Easing.smooth(clamp01((t - a) / d));
const rise = (t: number, at: number, by = 40) =>
  spring({ timestamp: t - at, from: by, to: 0, response: 0.55, bounce: 0 });
const abs = (left: number, top: number) => ({ position: 'absolute' as const, inset: { left, top } });
const full = { position: 'absolute' as const, inset: 0, size: { width: W, height: H } };

/** A headline that rises in word by word. */
function headline(
  words: string,
  t: number,
  at: number,
  o: { size: number; family?: string; weight?: number; color?: Color; spacing?: number },
) {
  return text(words, {
    fontFamily: o.family ?? SANS,
    fontSize: o.size,
    fontWeight: o.weight ?? 700,
    letterSpacing: o.spacing ?? -o.size * 0.035,
    color: o.color ?? C.text,
    split: {
      by: 'words',
      style: (u) => {
        const k = spring({ timestamp: t - at - u.index * 0.08, from: 0, to: 1, response: 0.5, bounce: 0 });
        return { opacity: clamp01(k * 1.6), y: (1 - k) * o.size * 0.45 };
      },
    },
  });
}

/** A frosted glass panel. */
function glass(children: Child[], style: Parameters<typeof box>[0] = {}) {
  return box(
    {
      background: 'rgba(22,22,28,0.72)',
      border: 1.5,
      borderColor: C.edge,
      borderRadius: 28,
      shadow: [
        { color: 'rgba(0,0,0,0.6)', offset: [0, 40], blur: 80 },
        { color: 'rgba(167,139,250,0.10)', blur: 60 },
      ],
      overflow: 'hidden',
      ...style,
    },
    children,
  );
}

/** A window with traffic lights and a title, like an editor or a browser. */
function window_(title: string, content: Child, size: { width: number; height: number }) {
  return glass(
    [
      box({ flexDirection: 'row', alignItems: 'center', gap: 10, padding: [18, 22], borderColor: C.edge }, [
        ...['#ff5f57', '#febc2e', '#28c840'].map((c) =>
          box({ size: { width: 14, height: 14 }, borderRadius: 7, background: c }),
        ),
        text(title, { fontFamily: MONO, fontSize: 18, color: C.muted, margin: { left: 14 } }),
      ]),
      box({ flexGrow: 1, padding: [6, 26, 26, 26] }, [content]),
    ],
    { size, flexDirection: 'column' },
  );
}

// Shots. Each takes the time since it started.

const TYPING = [
  'export default new Composition({',
  'export default new Composition({\n  width: 1920, height: 1080, frameRate: 60,',
  'export default new Composition({\n  width: 1920, height: 1080, frameRate: 60,\n  render: ({ timestamp }) =>',
  "export default new Composition({\n  width: 1920, height: 1080, frameRate: 60,\n  render: ({ timestamp }) =>\n    text('Hello', { fontSize: 160 }),",
  "export default new Composition({\n  width: 1920, height: 1080, frameRate: 60,\n  render: ({ timestamp }) =>\n    text('Hello', { fontSize: 160 }),\n});",
];

function editorAt(local: number) {
  const step = Math.min(TYPING.length - 1, Math.max(0, Math.floor(local / 0.5)));
  const p = clamp01((local - step * 0.5) / 0.35);
  return code(TYPING[step]!, {
    from: step > 0 ? TYPING[step - 1] : undefined,
    progress: step > 0 ? p : 1,
    language: 'ts',
    theme: 'github-dark-default',
    fontFamily: MONO,
    fontSize: 30,
    background: 'transparent',
    padding: 0,
  });
}

function coldOpen(t: number): Child {
  // 0 to 10: the editor types in 3D, the line lands, frames stream out of it, then the music drops away.
  const editor = window_('promo.ts', editorAt(t - 0.4), { width: 1320, height: 440 });
  const pull = ramp(t, 3, 7);
  const out = 1 - fade(t, 9.6, 0.35);
  const kids: Child[] = [
    // A soft light behind the editor.
    box({
      ...abs(W / 2 - 800, H / 2 - 450),
      size: { width: 1600, height: 900 },
      borderRadius: 800,
      background: 'rgba(124,58,237,0.16)',
      blur: 160,
      opacity: out,
    }),
    space3d(
      VIEW,
      { tilt: 6 - 4 * pull, pan: -3 + 5 * ramp(t, 0, 6), focus: 1484 + 600 * pull, aperture: 18 * pull },
      [{ node: editor, z: 120 - 1020 * pull, rotateY: 6 - 6 * ramp(t, 0, 3) }],
      { ...full, opacity: out * (1 - 0.9 * fade(t, 3.1, 0.7)) },
    ),
  ];
  // The statement, over the receding editor.
  if (t > 3.2)
    kids.push(
      box(
        {
          ...full,
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          opacity: out * (1 - fade(t, 6.9, 0.4)),
        },
        [
          headline('Every frame', t, 3.4, { size: 150, family: SERIF, weight: 400, spacing: -2 }),
          headline('is a function of time.', t, 4.6, { size: 110, weight: 700 }),
        ],
      ),
    );
  // Frames streaming toward the camera.
  if (t > 6.8 && t < 10.2) {
    const local = t - 6.8;
    const items = Array.from({ length: 36 }, (_, i) => {
      const lane = (i * 7) % 6,
        row = Math.floor(i / 6);
      const z = -3600 + ((local * 1600 + i * 190) % 4000);
      const hue = [C.violet, C.cyan, C.pink, '#facc15', '#34d399', '#60a5fa'][(i * 5) % 6]!;
      return {
        node: box(
          {
            size: { width: 320, height: 180 },
            borderRadius: 14,
            background: linearGradient(120 + i * 17, [hue, '#0b0b12']),
            border: 1,
            borderColor: 'rgba(255,255,255,0.18)',
            padding: 16,
            justifyContent: 'flex-end',
          },
          [
            text(String(i * 7 + 1).padStart(4, '0'), {
              fontFamily: MONO,
              fontSize: 22,
              color: 'rgba(255,255,255,0.85)',
            }),
          ],
        ),
        x: (lane - 2.5) * 380,
        y: (row - 2.5) * 220,
        z,
      };
    });
    kids.push(space3d(VIEW, { fov: 50 }, items, { ...full, opacity: fade(local, 0, 0.3) * out }));
  }
  // The break: a quiet word before the hit.
  if (t > 10.05)
    kids.push(
      box(
        {
          ...full,
          justifyContent: 'center',
          alignItems: 'center',
          opacity: fade(t, 10.15, 0.3) * (1 - fade(t, 10.85, 0.12)),
        },
        [text('Introducing', { fontFamily: SANS, fontSize: 40, fontWeight: 500, color: C.muted, letterSpacing: 1 })],
      ),
    );
  return box(full, kids);
}

function hero(t: number): Child {
  // 11 to 17: the name slams in on the hit, over an aurora; then the tagline.
  const flash = Math.max(0, 1 - t / 0.25);
  const glow = fade(t, 0, 0.6);
  const out = 1 - fade(t, 5.5, 0.5);
  return box(full, [
    box({ ...full, opacity: 0.85 * glow * out }, [
      backgrounds.aurora({ base: '#000000', colors: ['#7c3aed', '#06b6d4'], speed: 0.9 }),
    ]),
    box(
      {
        ...full,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        opacity: out,
        transform: { scale: 1 + 0.04 * ramp(t, 0, 6) },
      },
      [
        text('Skiamovin', {
          fontFamily: SANS,
          fontSize: 230,
          fontWeight: 800,
          letterSpacing: -9,
          color: C.text,
          textShadow: { color: 'rgba(167,139,250,0.55)', blur: 60 },
          split: {
            by: 'chars',
            style: (u) => {
              const k = spring({ timestamp: t - u.index * 0.035, from: 0, to: 1, response: 0.42, bounce: 0.18 });
              return { opacity: clamp01(k * 2), scale: 1.8 - 0.8 * k, y: (1 - k) * -40 };
            },
          },
        }),
        headline('Video, written in code.', t, 2.0, {
          size: 64,
          family: SERIF,
          weight: 400,
          spacing: 0,
          color: '#d4d4d8',
        }),
      ],
    ),
    flash > 0 ? box({ ...full, background: `rgba(255,255,255,${0.9 * flash})` }) : null,
  ]);
}

const PRODUCT = [
  { title: 'Hello', accent: '#a78bfa', bars: [0.4, 0.7, 0.55] },
  { title: 'Hello, world', accent: '#22d3ee', bars: [0.8, 0.5, 0.9] },
  { title: 'Ship it.', accent: '#f472b6', bars: [0.6, 0.95, 0.75] },
];
const productCode = (i: number) => `box({ class: 'flex flex-col gap-6 p-12' }, [
  text('${PRODUCT[i]!.title}', { fontSize: 96 }),
  bars([${PRODUCT[i]!.bars.join(', ')}], '${PRODUCT[i]!.accent}'),
])`;

function preview(t: number, i: number, k: number) {
  const p = PRODUCT[i]!;
  return box(
    { size: { width: 760, height: 460 }, padding: 48, flexDirection: 'column', gap: 34, background: '#0c0c12' },
    [
      text(p.title, { fontFamily: SANS, fontSize: 84, fontWeight: 800, letterSpacing: -3, color: C.text, opacity: k }),
      box(
        { flexDirection: 'row', alignItems: 'flex-end', gap: 22, size: { height: 200 } },
        p.bars.map((b, j) =>
          box({
            size: {
              width: 150,
              height: 200 * b * spring({ timestamp: t - j * 0.08, from: 0.2, to: 1, ...springs.snappy }),
            },
            borderRadius: 16,
            background: linearGradient(90, [p.accent, '#1e1b4b']),
          }),
        ),
      ),
    ],
  );
}

function product(t: number): Child {
  // 17 to 23: editor and live preview side by side; the code changes on the bar and the preview follows.
  const i = Math.min(2, Math.floor(t / 2));
  const local = t - i * 2;
  const morph = i === 0 ? 1 : ramp(local, 0, 0.6);
  const editor = window_(
    'card.ts',
    code(productCode(i), {
      from: i > 0 ? productCode(i - 1) : undefined,
      progress: morph,
      language: 'ts',
      fontFamily: MONO,
      fontSize: 27,
      background: 'transparent',
      padding: 0,
    }),
    { width: 820, height: 420 },
  );
  const view = window_('Preview · 60 fps', preview(local, i, fade(local, 0.3)), { width: 820, height: 560 });
  const k = spring({ timestamp: t, from: 0, to: 1, response: 0.8, bounce: 0 });
  return box(full, [
    space3d(
      VIEW,
      { pan: -6 + 8 * ramp(t, 0, 6), tilt: 6 },
      [
        { node: editor, x: -470, z: -260 * (1 - k) - 120, rotateY: 16 },
        { node: view, x: 470, z: -260 * (1 - k) - 60, rotateY: -16 },
      ],
      full,
    ),
    box({ ...abs(0, 70), size: { width: W }, flexDirection: 'row', justifyContent: 'center', gap: 22 }, [
      headline('Write TypeScript.', t, 0.3, { size: 60, weight: 700 }),
      headline('Watch it render.', t, 1.4, { size: 60, family: SERIF, weight: 400, spacing: 0, color: '#c4b5fd' }),
    ]),
  ]);
}

// The feature montage: one feature per bar, each a live demo with a big word.

function featureFrame(label: string, sub: string, t: number, demo: Child): Child {
  const out = 1 - fade(t, 1.82, 0.18);
  return box({ ...full, opacity: out }, [
    box({ ...full, transform: { scale: 1 + 0.035 * t } }, [demo]),
    // A soft shade behind the label so it reads over any demo.
    box({
      ...abs(0, H - 380),
      size: { width: W, height: 380 },
      background: linearGradient(180, ['rgba(0,0,0,0)', 'rgba(0,0,0,0.85)']),
    }),
    box({ ...abs(110, H - 290), flexDirection: 'column', gap: 6 }, [
      headline(label, t, 0.05, { size: 132, weight: 800 }),
      text(sub, {
        fontFamily: SANS,
        fontSize: 32,
        color: '#a1a1aa',
        opacity: fade(t, 0.35),
        transform: { translateY: rise(t, 0.35, 16) },
      }),
    ]),
  ]);
}

function layoutDemo(t: number): SceneNode {
  const cards = [
    ['Revenue', '$84.2k', C.violet],
    ['Users', '12,804', C.cyan],
    ['Uptime', '99.98%', '#34d399'],
  ] as const;
  return box({ ...full, background: '#07070b', justifyContent: 'center', alignItems: 'center' }, [
    box({ flexDirection: 'row', gap: 28, transform: { translateY: -90 } }, [
      ...cards.map(([name, value, color], i) => {
        const k = spring({ timestamp: t - 0.1 - i * 0.12, from: 0, to: 1, ...springs.bouncy });
        return box(
          {
            size: { width: 400, height: 260 },
            padding: 36,
            borderRadius: 28,
            background: '#111118',
            border: 1.5,
            borderColor: 'rgba(255,255,255,0.1)',
            flexDirection: 'column',
            justifyContent: 'space-between',
            opacity: clamp01(k * 1.5),
            transform: [{ translateY: (1 - k) * 160 }, { scale: 0.85 + 0.15 * k }],
          },
          [
            text(name, { fontFamily: SANS, fontSize: 30, color: '#a1a1aa' }),
            text(value, { fontFamily: SANS, fontSize: 74, fontWeight: 800, letterSpacing: -2, color: C.text }),
            box({ size: { width: 120 * k + 40, height: 8 }, borderRadius: 4, background: color }),
          ],
        );
      }),
    ]),
  ]);
}

const WORLD = physics({
  duration: 3,
  gravity: [0, 2600],
  bodies: [
    { type: 'fixed', shape: { kind: 'box', width: 2400, height: 40 }, x: 960, y: 700 },
    ...[...'PHYSICS'].map((_, i) => ({
      shape: { kind: 'box' as const, width: 150, height: 170, radius: 22 },
      x: 420 + i * 180,
      y: -120 - i * 70,
      angle: (i % 2 ? 1 : -1) * 8,
      restitution: 0.35,
    })),
  ],
});

function physicsDemo(t: number): SceneNode {
  return box({ ...full, background: '#07070b' }, [
    ...[...'PHYSICS'].map((ch, i) => {
      const b = WORLD.body(i + 1, t + 0.35);
      return box(
        {
          ...abs(b.x - 75, b.y - 85),
          size: { width: 150, height: 170 },
          borderRadius: 22,
          background: [C.violet, C.cyan, C.pink, '#facc15', '#34d399', '#60a5fa', '#fb923c'][i]!,
          justifyContent: 'center',
          alignItems: 'center',
          transform: { rotate: b.angle },
        },
        [text(ch, { fontFamily: SANS, fontSize: 110, fontWeight: 900, color: '#0b0b12' })],
      );
    }),
  ]);
}

function mathDemo(t: number): SceneNode {
  return box({ ...full, background: '#07070b', justifyContent: 'center', alignItems: 'center' }, [
    box({ transform: { translateY: -110 } }, [
      math('\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}', {
        fontSize: 110,
        color: C.text,
        write: ramp(t, 0.05, 1.3),
      }),
    ]),
  ]);
}

const FILM_CUES: Cue[] = [{ start: 0.2, end: 2, text: 'Every frame, rendered by code.' }];

function filmDemo(t: number): SceneNode {
  return box({ ...full, background: '#000' }, [
    // Only the skyline at the start of the clip, looped, whatever the composition's time.
    video(footage, {
      ...full,
      fit: 'cover',
      muted: true,
      trim: { start: 0.5, end: 2.3 },
      loop: true,
      grade: looks.film(),
    }),
    box({ ...abs(0, 0), size: { width: W, height: 110 }, background: '#000' }),
    box({ ...abs(0, H - 110), size: { width: W, height: 110 }, background: '#000' }),
    captions(FILM_CUES, {
      time: t,
      preset: 'pop',
      fontFamily: SANS,
      fontSize: 58,
      accent: '#facc15',
      position: 'absolute',
      inset: { left: 0, right: 0, top: 520 },
    }),
  ]);
}

function colorDemo(t: number): SceneNode {
  // Before and after: the graded image is revealed by a wipe.
  const wipe = interpolate(t, [0.15, 1.5], [0.08, 0.92], { easing: Easing.inOutCubic });
  return box({ ...full, background: '#000' }, [
    image(SUNSET, { ...full, fit: 'cover', grade: adjust({ saturation: -0.85, contrast: -0.1 }) }),
    box({ ...abs(0, 0), size: { width: W * wipe, height: H }, overflow: 'hidden' }, [
      image(SUNSET, { ...abs(0, 0), size: { width: W, height: H }, fit: 'cover', grade: looks.punchy() }),
    ]),
    box({
      ...abs(W * wipe - 2, 0),
      size: { width: 4, height: H },
      background: '#ffffff',
      shadow: { color: 'rgba(0,0,0,0.5)', blur: 20 },
    }),
  ]);
}

function threeDDemo(t: number): SceneNode {
  return sdfScene(
    VIEW,
    { tilt: 14, pan: -20 + t * 14, distance: 1500, target: [0, 20, 0] },
    [
      { shape: { kind: 'floor' }, y: 170, color: '#26262f' },
      { shape: { kind: 'sphere', radius: 120 }, x: -360, y: 50, color: '#a78bfa' },
      {
        shape: { kind: 'box', width: 210, height: 210, depth: 210, radius: 28 },
        y: 65,
        rotateY: 30 + t * 40,
        color: '#22d3ee',
      },
      { shape: { kind: 'torus', radius: 120, tube: 44 }, x: 370, y: 20, rotateX: 70 + t * 30, color: '#f472b6' },
    ],
    { background: '#07070b', fog: 5200, ...full },
  );
}

function diagramDemo(t: number): SceneNode {
  return box({ ...full, background: '#07070b', justifyContent: 'center', alignItems: 'center' }, [
    box({ transform: { translateY: -110 } }, [
      diagram(
        'flowchart LR\n  A[Script] --> B[Scenes] --> C{Review}\n  C -->|ok| D[Render] --> E[(Publish)]\n  C -->|edit| B',
        {
          fontSize: 54,
          fontFamily: SANS,
          theme: 'dark',
          draw: ramp(t, 0.05, 1.5),
        },
      ),
    ]),
  ]);
}

const CODE_A = 'const total = items\n  .map((i) => i.price)\n  .reduce((a, b) => a + b, 0);';
const CODE_B = 'const total = sum(items, (i) => i.price);';

function codeDemo(t: number): SceneNode {
  return box({ ...full, background: '#07070b', justifyContent: 'center', alignItems: 'center' }, [
    box({ transform: { translateY: -110 } }, [
      code(CODE_B, { from: CODE_A, progress: ramp(t, 0.4, 1.4), language: 'ts', fontFamily: MONO, fontSize: 52 }),
    ]),
  ]);
}

const HELLO = ['Hello', 'សួស្តី', 'مرحبا', 'नमस्ते', 'สวัสดี', 'Γειά σου', 'Привет', 'שלום'];

function languagesDemo(t: number): SceneNode {
  const i = Math.min(HELLO.length - 1, Math.floor(t / 0.25));
  const k = spring({ timestamp: t - i * 0.25, from: 0, to: 1, response: 0.3, bounce: 0.2 });
  return box({ ...full, background: '#07070b', justifyContent: 'center', alignItems: 'center' }, [
    text(HELLO[i]!, {
      fontFamily: 'Google Sans',
      fontSize: 220,
      fontWeight: 700,
      color: C.text,
      transform: [{ translateY: -110 }, { scale: 0.9 + 0.1 * k }],
      opacity: clamp01(k * 2),
    }),
  ]);
}

const FEATURES: { label: string; sub: string; demo: (t: number) => SceneNode }[] = [
  { label: 'Layout.', sub: 'Flexbox, grid and Tailwind classes.', demo: layoutDemo },
  { label: 'Physics.', sub: 'Rapier, simulated once and replayed exactly.', demo: physicsDemo },
  { label: 'Math.', sub: 'LaTeX, typeset in Rust and written on.', demo: mathDemo },
  { label: 'Film.', sub: 'Real footage, graded and captioned.', demo: filmDemo },
  { label: 'Color.', sub: 'Grades, LUTs and looks, live.', demo: colorDemo },
  { label: '3D.', sub: 'Ray-marched scenes and lit meshes.', demo: threeDDemo },
  { label: 'Diagrams.', sub: 'Mermaid, drawn on stroke by stroke.', demo: diagramDemo },
  { label: 'Code.', sub: 'Highlighted, and it animates between versions.', demo: codeDemo },
  { label: 'Every language.', sub: 'Shaped right, in every script.', demo: languagesDemo },
];

function montage(t: number): Child {
  // 23 to 41: one feature per bar.
  const i = Math.min(FEATURES.length - 1, Math.floor(t / BAR));
  const f = FEATURES[i]!;
  return featureFrame(f.label, f.sub, t - i * BAR, f.demo(t - i * BAR));
}

function wall(t: number): Child {
  // 41 to 47: every demo at once, live, on a wall the camera pulls back from.
  const pull = ramp(t, 0, 3.4);
  const scale = 0.25;
  const items = FEATURES.map((f, i) => {
    const col = i % 3,
      row = Math.floor(i / 3);
    return {
      node: box(
        {
          size: { width: W * scale, height: H * scale },
          borderRadius: 18,
          overflow: 'hidden',
          border: 1.5,
          borderColor: 'rgba(255,255,255,0.14)',
        },
        [
          box({ ...abs(0, 0), size: { width: W, height: H }, transformOrigin: [0, 0], transform: { scale } }, [
            f.demo(1.6 + ((t * 0.6) % 0.4)),
          ]),
        ],
      ),
      x: (col - 1) * (W * scale + 40),
      y: (row - 1) * (H * scale + 40) + 130,
      z: 0,
    };
  });
  const out = 1 - fade(t, 5.6, 0.4);
  return box({ ...full, opacity: out }, [
    space3d(
      VIEW,
      { distance: interpolate(pull, [0, 1], [820, 1600]), tilt: 8 - 8 * pull, pan: -10 + 10 * pull },
      items,
      full,
    ),
    box(
      {
        ...abs(0, 80),
        size: { width: W },
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        opacity: fade(t, 2.2, 0.5),
      },
      [
        headline('One library.', t, 2.2, { size: 88, weight: 800 }),
        text('Everything you just saw is live code.', {
          fontFamily: SERIF,
          fontSize: 44,
          color: '#d4d4d8',
          opacity: fade(t, 2.9),
        }),
      ],
    ),
  ]);
}

const INSPECT = `$ npx skiamovin inspect promo.ts
{
  "width": 1920,
  "height": 1080,
  "frameRate": 60,
  "duration": 61,
  "tree": [
    { "type": "box", "style": { "class": "flex" },
      "children": [
        { "type": "text", "text": "Skiamovin" }`;

function agents(t: number): Child {
  // 47 to 53: one API for people and for agents.
  const lines = INSPECT.split('\n');
  const shown = Math.floor(interpolate(t, [1.0, 3.0], [1, lines.length]));
  const term = window_(
    'zsh',
    text(lines.slice(0, shown).join('\n'), { fontFamily: MONO, fontSize: 24, color: '#d4d4d8', lineHeight: 1.45 }),
    { width: 860, height: 520 },
  );
  const k = spring({ timestamp: t, from: 0, to: 1, response: 0.7, bounce: 0 });
  const out = 1 - fade(t, 5.6, 0.4);
  return box({ ...full, opacity: out }, [
    box(
      { ...abs(140, 0), size: { width: 760, height: H }, flexDirection: 'column', justifyContent: 'center', gap: 18 },
      [
        headline('Built for humans.', t, 0.2, { size: 84, weight: 800 }),
        headline('And for AI agents.', t, 1.0, { size: 84, family: SERIF, weight: 400, spacing: 0, color: '#c4b5fd' }),
        text(
          'Plain TypeScript, JSON inspection, contact sheets and a command line, so agents can write, check and render videos on their own.',
          {
            fontFamily: SANS,
            fontSize: 30,
            lineHeight: 1.45,
            color: '#a1a1aa',
            size: { width: 700 },
            margin: { top: 18 },
            opacity: fade(t, 1.8, 0.6),
          },
        ),
      ],
    ),
    space3d(VIEW, { pan: 4 }, [{ node: term, x: 450, z: -200 * (1 - k), rotateY: -14 }], full),
  ]);
}

function lockup(t: number): Child {
  // 53 to 61: name, install line, and credits.
  const k = spring({ timestamp: t, from: 0, to: 1, response: 0.7, bounce: 0 });
  return box(full, [
    box({ ...full, opacity: 0.5 * fade(t, 0, 1.2) }, [
      image(VENICE, { ...full, fit: 'cover', blur: 40, grade: looks.blueHour() }),
    ]),
    box({ ...full, background: 'rgba(0,0,0,0.55)' }),
    box({ ...full, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 26 }, [
      text('Skiamovin', {
        fontFamily: SANS,
        fontSize: 170,
        fontWeight: 800,
        letterSpacing: -6,
        color: C.text,
        opacity: clamp01(k * 1.5),
        transform: { scale: 0.92 + 0.08 * k },
        textShadow: { color: 'rgba(167,139,250,0.45)', blur: 50 },
      }),
      box(
        {
          padding: [18, 30],
          borderRadius: 40,
          background: 'rgba(255,255,255,0.08)',
          border: 1.5,
          borderColor: 'rgba(255,255,255,0.18)',
          opacity: fade(t, 0.8),
          transform: { translateY: rise(t, 0.8, 20) },
        },
        [text('npm install skiamovin', { fontFamily: MONO, fontSize: 34, color: C.text })],
      ),
      text('Open source. MIT licensed.', { fontFamily: SERIF, fontSize: 40, color: '#d4d4d8', opacity: fade(t, 1.6) }),
      text('github.com/seanghay/skiamovin', { fontFamily: MONO, fontSize: 26, color: C.muted, opacity: fade(t, 2.2) }),
    ]),
    box({ ...abs(0, H - 70), size: { width: W }, justifyContent: 'center', opacity: fade(t, 3, 0.8) }, [
      text(
        'Music: “Arpent” by Kevin MacLeod (CC0) · Footage: “Tears of Steel” © Blender Foundation, mango.blender.org (CC BY 3.0) · Photos: Poly Haven (CC0)',
        { fontFamily: SANS, fontSize: 17, color: '#52525b' },
      ),
    ]),
    box({ ...full, background: `rgba(0,0,0,${fade(t, DURATION - 53 - 1.2, 1.2)})` }),
  ]);
}

const SHOTS: [number, number, (t: number) => Child][] = [
  [0, 11, coldOpen],
  [11, 17, hero],
  [17, 23, product],
  [23, 41, montage],
  [41, 47, wall],
  [47, 53, agents],
  [53, DURATION, lockup],
];

export default new Composition({
  width: W,
  height: H,
  frameRate: 30,
  duration: DURATION,
  background: C.bg,
  fonts: FONTS,
  motionBlur: { shutter: 180, samples: 4 },
  render: ({ timestamp: t }) => {
    const shot = SHOTS.find(([a, b]) => t >= a && t < b);
    return box({ size: VIEW, effects: [vignette({ amount: 0.3, softness: 0.75 }), grain({ amount: 0.03 })] }, [
      audio(music, {
        role: 'music',
        trim: { start: MUSIC_START },
        volume: (x) => Math.min(1, x / 0.6, (DURATION - x) / 3),
      }),
      shot ? shot[2](t - shot[0]) : null,
    ]);
  },
});
