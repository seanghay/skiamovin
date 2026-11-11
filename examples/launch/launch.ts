// Skiamovin — launch film (v2). 1080p60, hard cuts on a 120 BPM grid, raymarched hero object, scored to picture.
import { ALL_FORMATS, FilePathSource, Input } from 'mediabunny';
import { type ImageFilter, imageFilters, Shader, TileMode } from 'skiamovin';
import {
  audio,
  box,
  type Child,
  Composition,
  Easing,
  FontAsset,
  ImageAsset,
  image,
  interpolate,
  linearGradient,
  type RenderContext,
  radialGradient,
  random,
  sequence,
  series,
  shader,
  span,
  spring,
  text,
  video,
} from 'skiamovin/scene';
import { HERO } from './hero.ts';
import { BEAT, CUTS, DURATION } from './timing.ts';

// ---------------------------------------------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------------------------------------------

const SYS = '/System/Library/Fonts/';
const font = (path: string, family: string) => new FontAsset(new FilePathSource(path), { family });
const FONTS = [
  font(`${SYS}SFNS.ttf`, 'SF Pro'),
  font(`${SYS}SFNSMono.ttf`, 'SF Mono'),
  font(`${SYS}Supplemental/Khmer Sangam MN.ttf`, 'Khmer Sangam MN'),
  font(`${SYS}Hiragino Sans GB.ttc`, 'Hiragino Sans GB'),
  font(`${SYS}SFArabic.ttf`, 'SF Arabic'),
  font(`${SYS}Supplemental/Devanagari Sangam MN.ttc`, 'Devanagari Sangam MN'),
  font(`${SYS}AppleSDGothicNeo.ttc`, 'Apple SD Gothic Neo'),
];
const SCRIPTS = [
  'SF Pro',
  'Khmer Sangam MN',
  'Hiragino Sans GB',
  'SF Arabic',
  'Devanagari Sangam MN',
  'Apple SD Gothic Neo',
];

const here = (p: string) => new URL(p, import.meta.url).pathname;
const media = (p: string) => new Input({ formats: ALL_FORMATS, source: new FilePathSource(here(p)) });
const score = media('../assets/score.wav');
const GOOD = [
  '01-intro',
  '03-kinetic-type',
  '04-bar-chart',
  '05-shader-gallery',
  '07-audio-visualizer',
  '08-logo-reveal',
  '09-slideshow',
  '10-vertical-social',
];
const clips = Object.fromEntries(GOOD.map((s) => [s, media(`../output/${s}.mp4`)]));
const stills = GOOD.map((s) => new ImageAsset(new FilePathSource(here(`../assets/frames/${s}.jpg`))));

// ---------------------------------------------------------------------------------------------------------------
// Look
// ---------------------------------------------------------------------------------------------------------------

const W = 1920,
  H = 1080;
const full = { position: 'absolute' as const, inset: 0, size: { width: '100%' as const, height: '100%' as const } };
const center = {
  ...full,
  justifyContent: 'center' as const,
  alignItems: 'center' as const,
  flexDirection: 'column' as const,
};
const head = (size: number, weight = 600) => ({
  fontFamily: 'SF Pro',
  fontSize: size,
  fontWeight: weight,
  fontVariations: { opsz: 96 },
  letterSpacing: -size * 0.025,
});
const body = (size: number, weight = 500) => ({
  fontFamily: 'SF Pro',
  fontSize: size,
  fontWeight: weight,
  fontVariations: { opsz: Math.min(96, size) },
});
const GRAY = '#86868b',
  WHITE = '#f5f5f7';

/** Apple's signature reveal: fade + rise + de-blur. */
function reveal(t: number, at: number, dur = 0.7, dist = 30) {
  const k = interpolate(t, [at, at + dur], [0, 1], { easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
  return { opacity: k, blur: (1 - k) * 10, transform: { translateY: (1 - k) * dist } };
}
/** Slow camera push across a cut. */
const push = (ctx: RenderContext, from = 1, to = 1.06) => ({
  transform: { scale: interpolate(ctx.timestamp, [0, ctx.duration], [from, to]) },
});

const BRAND = ['#7c3aed', '#db2777', '#f97316'];
const brandFill = (w: number) =>
  Shader.linearGradient(
    [
      [0, 0],
      [w, 0],
    ],
    BRAND,
    null,
    TileMode.Clamp,
  )!;
const BRAND_1500 = brandFill(1500),
  BRAND_1100 = brandFill(1100);

const glows = new Map<string, ImageFilter>();
const _glow = (sigma: number, color: string) => {
  const k = `${Math.round(sigma)}|${color}`;
  if (Math.round(sigma) <= 0) return undefined;
  if (!glows.has(k)) glows.set(k, imageFilters.dropShadow([0, 0], [Math.round(sigma), Math.round(sigma)], color)!);
  return glows.get(k);
};

const heroNode = (
  u: { yaw: number; pitch: number; dist: number; sweep: number; glow: number; offset?: [number, number]; time: number },
  style: Record<string, unknown> = {},
) =>
  shader(HERO, {
    ...full,
    ...style,
    uniforms: {
      yaw: u.yaw,
      pitch: u.pitch,
      dist: u.dist,
      sweep: u.sweep,
      glow: u.glow,
      offset: u.offset ?? [0, 0],
      iTime: u.time,
    },
  });

const GRAIN = `uniform float2 iResolution; uniform float iFrame;
half4 main(float2 p) { float n = fract(sin(dot(p + iFrame * 17.0, float2(12.9898, 78.233))) * 43758.5453);
  return half4(half3(n), 1); }`;

const cut = (range: readonly [number, number], render: (ctx: RenderContext) => Child) =>
  sequence({ start: range[0], end: range[1] }, render);

// ---------------------------------------------------------------------------------------------------------------
// Cuts
// ---------------------------------------------------------------------------------------------------------------

/** 1 — The object emerges from darkness, macro, as a light sweeps across it. */
const revealCut = (ctx: RenderContext) => {
  const t = ctx.timestamp;
  const light = interpolate(t, [0, 2.5], [0, 1], { easing: Easing.outCubic });
  return box({ ...full, background: '#000' }, [
    heroNode(
      {
        yaw: interpolate(t, [0, 4], [1.1, 0.55]),
        pitch: interpolate(t, [0, 4], [0.45, 0.3]),
        dist: interpolate(t, [0, 4], [2.3, 2.7]),
        sweep: interpolate(t, [0.6, 3.6], [0.05, 0.95], { easing: Easing.inOutSine }),
        glow: 0.3 * light,
        offset: [-180, 60],
        time: t,
      },
      { opacity: light },
    ),
  ]);
};

/** 2 — "Introducing". */
const introducing = (ctx: RenderContext) =>
  box({ ...center, background: '#000' }, [
    text('Introducing', { ...head(84, 600), color: WHITE, ...reveal(ctx.timestamp, 0.1, 0.9) }),
  ]);

/** 3 — The drop: the object, centered, and its name. */
const hero = (ctx: RenderContext) => {
  const t = ctx.timestamp;
  const k = spring({ timestamp: t, damping: 18, stiffness: 90 });
  return box(
    { ...full, background: radialGradient(['#1b1730', '#000000'], { center: ['50%', '38%'], radius: 1000 }) },
    [
      box({ ...full, ...push(ctx, 1.0, 1.05) }, [
        heroNode({
          yaw: interpolate(t, [0, 4], [-0.55, 0.35]),
          pitch: 0.18,
          dist: 5.6 - 0.5 * k,
          sweep: interpolate(t, [0.2, 2.2], [0, 1]),
          glow: 0.9,
          offset: [0, -150],
          time: t + 4,
        }),
      ]),
      box(
        {
          position: 'absolute',
          inset: { left: 0, right: 0, bottom: 90 },
          alignItems: 'center',
          flexDirection: 'column',
          gap: 6,
        },
        [
          text('Skiamovin', { ...head(170, 700), color: BRAND_1500, ...reveal(t, 0.25, 1.0, 50) }),
          text('Programmatic video, at the speed of the GPU.', { ...body(40), color: WHITE, ...reveal(t, 0.9, 0.8) }),
        ],
      ),
    ],
  );
};

/** 4 — One word per beat. */
const WORDS: [string, string, string][] = [
  ['Skia.', '#000000', WHITE],
  ['Taffy.', '#7c3aed', WHITE],
  ['Mediabunny.', '#000000', WHITE],
  ['Metal.', '#f5f5f7', '#000000'],
  ['WebGL.', '#000000', WHITE],
  ['WebCodecs.', '#db2777', WHITE],
  ['TypeScript.', '#000000', WHITE],
  ['One API.', '#f97316', '#000000'],
];
const words = (ctx: RenderContext) =>
  series(
    ctx,
    WORDS.map(([w, bg, fg]) => ({
      duration: BEAT,
      render: ({ timestamp }) =>
        box({ ...center, background: bg }, [
          text(w, {
            ...head(200, 700),
            color: fg,
            transform: { scale: interpolate(timestamp, [0, BEAT], [1.0, 1.08]) },
            opacity: interpolate(timestamp, [0, 0.06], [0, 1]),
          }),
        ]),
    })),
  );

/** A MacBook drawn with boxes: lid, bezel, notch, screen and an aluminum base. */
function macbook(screen: Child, width: number) {
  const s = width / 1200;
  return box({ flexDirection: 'column', alignItems: 'center' }, [
    box(
      {
        size: { width: 1200 * s, height: 780 * s },
        borderRadius: 34 * s,
        background: '#0c0c0e',
        border: 2,
        borderColor: '#2c2c30',
        padding: 22 * s,
        shadow: { offset: [0, 40 * s], blur: 90 * s, color: 'rgba(0,0,0,0.7)' },
      },
      [
        box({ flexGrow: 1, borderRadius: 14 * s, overflow: 'hidden', background: '#000' }, [screen]),
        box({
          position: 'absolute',
          inset: { left: 600 * s - 70 * s, top: 0 },
          size: { width: 140 * s, height: 26 * s },
          borderRadius: [0, 0, 12 * s, 12 * s],
          background: '#0c0c0e',
        }),
      ],
    ),
    box(
      {
        size: { width: 1400 * s, height: 30 * s },
        borderRadius: [4 * s, 4 * s, 26 * s, 26 * s],
        background: linearGradient(180, ['#e6e6ea', '#a1a1a8', '#5b5b62']),
        alignItems: 'center',
      },
      [box({ size: { width: 210 * s, height: 10 * s }, borderRadius: [0, 0, 10 * s, 10 * s], background: '#8c8c93' })],
    ),
  ]);
}

/** 5 — The device. */
const device = (ctx: RenderContext) => {
  const t = ctx.timestamp;
  const up = spring({ timestamp: t - 0.15, damping: 20, stiffness: 70 });
  return box({ ...full, background: '#000', alignItems: 'center' }, [
    box(
      {
        position: 'absolute',
        inset: { left: 0, right: 0, top: 80 },
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
      },
      [
        text('Write it in TypeScript.', { ...head(76, 700), color: WHITE, ...reveal(t, 0.6) }),
        text('Render it on a server, or in a browser tab.', { ...body(38), color: GRAY, ...reveal(t, 1.0) }),
      ],
    ),
    box(
      {
        position: 'absolute',
        inset: { left: 0, right: 0, top: 300 },
        justifyContent: 'center',
        alignItems: 'center',
        transform: [
          { translateY: (1 - up) * 500 },
          { scale: interpolate(t, [0, ctx.duration], [0.96, 1.04]) },
          { perspective: 2400, rotateX: 10 * (1 - up) + 4 },
        ],
      },
      [macbook(video(clips['01-intro']!, { ...full, fit: 'contain', muted: true, trim: { start: 0.3 } }), 1150)],
    ),
  ]);
};

/** 6 — Code on the left, the result live on the right. */
const code = (ctx: RenderContext) => {
  const t = ctx.timestamp;
  const _kw = { color: '#ff7ab2' },
    fn = { color: '#67b7a4' },
    str = { color: '#fc6a5d' },
    num = { color: '#d9c97c' },
    pl = { color: WHITE };
  const lines = [
    [span('box', fn), span('({ ', pl), span('gap', pl), span(': ', pl), span('32', num), span(' }, [\n', pl)],
    [span('  circle', fn), span('(', pl), span("'#7c3aed'", str), span('),\n', pl)],
    [span('  circle', fn), span('(', pl), span("'#db2777'", str), span('),\n', pl)],
    [span('  circle', fn), span('(', pl), span("'#f97316'", str), span('),\n', pl)],
    [span('])', pl)],
  ];
  const flat = lines.flat();
  const lens = lines.map((l) => l.reduce((n, s) => n + s.text.length, 0));
  const total = lens.reduce((a, b) => a + b, 0);
  const typed = Math.floor(interpolate(t, [0.4, 2.6], [0, total]));
  let acc = 0;
  const lineDone = lens.map((n) => {
    acc += n;
    return typed >= acc;
  });
  const doneAt = (i: number) => {
    let c = 0;
    for (let k = 0; k <= i; k++) c += lens[k]!;
    return 0.4 + (2.2 * c) / total;
  };
  return box(
    {
      ...full,
      background: '#000',
      flexDirection: 'row',
      alignItems: 'center',
      padding: [0, 140],
      gap: 80,
      ...push(ctx, 1, 1.03),
    },
    [
      box(
        {
          flexGrow: 1,
          flexBasis: 0,
          padding: 44,
          borderRadius: 24,
          background: '#16161a',
          border: 1,
          borderColor: '#2c2c30',
          size: { height: 520 },
          justifyContent: 'center',
        },
        [text(flat, { fontFamily: 'SF Mono', fontSize: 40, lineHeight: 1.6, visibleGraphemes: typed })],
      ),
      box(
        {
          flexGrow: 1,
          flexBasis: 0,
          size: { height: 520 },
          borderRadius: 24,
          background: radialGradient(['#1d1a2e', '#0b0b0f']),
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'row',
          gap: 32,
        },
        BRAND.map((c, i) => {
          const s = lineDone[i + 1] ? spring({ timestamp: t - doneAt(i + 1), damping: 11, stiffness: 180 }) : 0;
          return box({
            size: { width: 150, height: 150 },
            borderRadius: 75,
            background: c,
            opacity: Math.min(1, s),
            transform: { scale: s },
            shadow: { offset: [0, 20], blur: 40, color: `${c}88` },
          });
        }),
      ),
      text('Code in. Video out.', {
        position: 'absolute',
        inset: { left: 0, right: 0, bottom: 110 },
        ...head(48, 600),
        color: GRAY,
        textAlign: 'center',
        ...reveal(t, 2.8, 0.6),
      }),
    ],
  );
};

/** 7 — Speed: frames streaming toward the camera, and the number. */
const speed = (ctx: RenderContext) => {
  const t = ctx.timestamp;
  const cards: Child[] = [];
  const COUNT = 36;
  for (let i = 0; i < COUNT; i++) {
    // Depth from far (1) to near (0), moving toward the camera.
    const z = (((random(`z${i}`) - t * 0.45) % 1) + 1) % 1;
    const depth = 0.15 + z * 3.2;
    const sx = (random(`x${i}`) - 0.5) * 2600,
      sy = (random(`y${i}`) - 0.5) * 1500;
    const scale = 1 / depth;
    const w = 480 * scale,
      hgt = 270 * scale;
    const x = W / 2 + sx * scale - w / 2,
      y = H / 2 + sy * scale - hgt / 2;
    if (w > 3000 || x > W || y > H || x + w < 0 || y + hgt < 0) continue;
    const alpha = interpolate(z, [0, 0.05, 0.75, 1], [0, 0.9, 0.9, 0]) * interpolate(t, [0, 0.4], [0, 1]);
    cards.push({
      z,
      node: image(stills[i % stills.length]!, {
        position: 'absolute',
        inset: { left: x, top: y },
        size: { width: w, height: hgt },
        fit: 'cover',
        borderRadius: 14 * scale,
        opacity: alpha,
      }),
    } as never);
  }
  const ordered = (cards as unknown as { z: number; node: Child }[]).sort((a, b) => b.z - a.z).map((c) => c.node);
  const n = Math.round(interpolate(t, [0.3, 2.0], [0, 120], { easing: Easing.outExpo }));
  return box({ ...full, background: '#000' }, [
    box({ ...full }, ordered),
    box({ ...full, background: radialGradient(['rgba(0,0,0,0.85)', 'rgba(0,0,0,0.2)'], { radius: 700 }) }),
    box({ ...center, gap: 0 }, [
      box({ flexDirection: 'row', alignItems: 'flex-end', gap: 16 }, [
        text(String(n), { ...head(300, 700), color: WHITE, fontFeatures: { tnum: 1 }, lineHeight: 1 }),
        text('fps', { ...head(110, 600), color: GRAY, margin: { bottom: 40 } }),
      ]),
      text('Rendered and encoded on Apple silicon.', { ...body(40), color: WHITE, ...reveal(t, 1.2) }),
    ]),
  ]);
};

/** 8 — One script per beat. */
const GREETINGS = ['Hello', 'សួស្តី', 'こんにちは', 'مرحبا', 'नमस्ते', '안녕하세요', '你好', 'Bonjour'];
const languages = (ctx: RenderContext) => {
  const t = ctx.timestamp;
  return box({ ...full, background: '#000' }, [
    series(
      ctx,
      GREETINGS.map((g) => ({
        duration: BEAT,
        render: ({ timestamp }) =>
          box({ ...center }, [
            text(g, {
              fontFamily: SCRIPTS,
              fontSize: 210,
              fontWeight: 600,
              color: BRAND_1100,
              transform: { scale: interpolate(timestamp, [0, BEAT], [1.04, 1.0]) },
              opacity: interpolate(timestamp, [0, 0.05], [0, 1]),
            }),
          ]),
      })),
    ),
    text('Every script, shaped right.', {
      position: 'absolute',
      inset: { left: 0, right: 0, bottom: 140 },
      ...head(52, 600),
      color: GRAY,
      textAlign: 'center',
      ...reveal(t, 0.4),
    }),
  ]);
};

/** 9 — Shaders: domain-warped noise in the brand colors. */
const WARP = `uniform float2 iResolution; uniform float iTime;
float h(float2 p) { return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }
float n(float2 p) { float2 i = floor(p), f = fract(p); f = f * f * (3 - 2 * f);
  return mix(mix(h(i), h(i + float2(1, 0)), f.x), mix(h(i + float2(0, 1)), h(i + float2(1, 1)), f.x), f.y); }
float fbm(float2 p) { float v = 0, a = 0.5; for (int i = 0; i < 6; i++) { v += a * n(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }
half4 main(float2 frag) {
  float2 p = frag / iResolution.y * 2.2;
  float t = iTime * 0.25;
  float2 q = float2(fbm(p + t), fbm(p + float2(5.2, 1.3) - t));
  float2 r = float2(fbm(p + 4 * q + float2(1.7, 9.2) + t * 0.6), fbm(p + 4 * q + float2(8.3, 2.8)));
  float f = fbm(p + 4 * r);
  float3 a = float3(0.486, 0.227, 0.929), b = float3(0.859, 0.153, 0.467), c = float3(0.976, 0.451, 0.086);
  float3 col = mix(float3(0.02, 0.01, 0.05), a, smoothstep(0.2, 0.6, f));
  col = mix(col, b, smoothstep(0.45, 0.8, length(q)));
  col = mix(col, c, smoothstep(0.6, 0.95, r.x) * 0.8);
  col *= 0.35 + 0.9 * f * f;
  return half4(half3(col), 1); }`;
const shaders = (ctx: RenderContext) => {
  const t = ctx.timestamp;
  return box({ ...full, background: '#000' }, [
    shader(WARP, { ...full, ...push(ctx, 1.08, 1.0) }),
    box({ ...center, gap: 12 }, [
      text('Shaders.', { ...head(170, 700), color: WHITE, ...reveal(t, 0.3, 0.8) }),
      text('Written in SkSL. Running on your GPU.', { ...body(42), color: 'rgba(245,245,247,0.8)', ...reveal(t, 0.8) }),
    ]),
  ]);
};

/** 10 — Made with Skiamovin: one cut per beat, flash on the downbeat. */
const montage = (ctx: RenderContext) =>
  box({ ...full, background: '#000' }, [
    series(
      ctx,
      GOOD.map((name) => ({
        duration: BEAT,
        render: ({ timestamp }) =>
          box({ ...full }, [
            video(clips[name]!, {
              ...full,
              fit: name.startsWith('10') ? 'contain' : 'cover',
              muted: true,
              trim: {
                start:
                  ({ '03-kinetic-type': 1.6, '08-logo-reveal': 3.2, '04-bar-chart': 4.0 } as Record<string, number>)[
                    name
                  ] ?? 2.0,
              },
              transform: { scale: interpolate(timestamp, [0, BEAT], [1.06, 1.0]) },
            }),
          ]),
      })),
    ),
    box({ ...full, background: '#ffffff', opacity: interpolate(ctx.timestamp, [0, 0.18], [0.85, 0]) }),
    text('Made with Skiamovin', {
      position: 'absolute',
      inset: { right: 60, bottom: 50 },
      ...body(28, 600),
      color: 'rgba(255,255,255,0.9)',
      textShadow: { offset: [0, 2], blur: 12, color: 'rgba(0,0,0,0.9)' },
    }),
  ]);

/** 12 — Lockup. */
const end = (ctx: RenderContext) => {
  const t = ctx.timestamp;
  const k = spring({ timestamp: t, damping: 20, stiffness: 80 });
  return box(
    {
      ...full,
      background: radialGradient(['#14121f', '#000000'], { center: ['50%', '40%'], radius: 900 }),
      opacity: interpolate(t, [ctx.duration - 1.2, ctx.duration], [1, 0]),
    },
    [
      heroNode({
        yaw: interpolate(t, [0, 6], [-0.35, 0.25]),
        pitch: 0.12,
        dist: 8.6 - 0.6 * k,
        sweep: interpolate(t, [0.3, 2.3], [0, 1]),
        glow: 0.8,
        offset: [0, -200],
        time: t + 10,
      }),
      box(
        {
          position: 'absolute',
          inset: { left: 0, right: 0, top: 560 },
          flexDirection: 'column',
          alignItems: 'center',
          gap: 22,
        },
        [
          text('Skiamovin', { ...head(130, 700), color: WHITE, ...reveal(t, 0.5, 0.9) }),
          box(
            {
              padding: [16, 38],
              borderRadius: 999,
              background: '#1c1c1e',
              border: 1,
              borderColor: '#3a3a3c',
              ...reveal(t, 1.3, 0.8),
            },
            [text('npm install skiamovin', { fontFamily: 'SF Mono', fontSize: 32, color: WHITE })],
          ),
          text('Available now.', { ...body(32), color: GRAY, ...reveal(t, 1.9, 0.8) }),
        ],
      ),
    ],
  );
};

// ---------------------------------------------------------------------------------------------------------------

export default new Composition({
  width: W,
  height: H,
  frameRate: 60,
  duration: DURATION,
  background: '#000000',
  fonts: FONTS,
  render: () =>
    box(full, [
      audio(score),
      cut(CUTS.reveal, revealCut),
      cut(CUTS.introducing, introducing),
      cut(CUTS.hero, hero),
      cut(CUTS.words, words),
      cut(CUTS.device, device),
      cut(CUTS.code, code),
      cut(CUTS.speed, speed),
      cut(CUTS.languages, languages),
      cut(CUTS.shaders, shaders),
      cut(CUTS.montage, montage),
      cut(CUTS.end, end),
      // Finishing: vignette and a whisper of grain over everything.
      box({
        ...full,
        background: radialGradient(['rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.45)'], { radius: '80%' }),
      }),
      shader(GRAIN, { ...full, opacity: 0.035, blendMode: 'overlay' }),
    ]),
});
