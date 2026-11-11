# Compositions and animation

`skiamovin/scene` is the high-level layer. A `Composition` describes **what the video looks like at any
timestamp**, and Skiamovin handles layout, media, audio and encoding.

```ts
import { Composition } from 'skiamovin/scene';

const composition = new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 10, // seconds
  render: (ctx) => {
    return /* a node tree */;
  },
});
```

As in Mediabunny, **times are in seconds**. `ctx.timestamp` is the current time and `ctx.duration` the total.
`ctx.frame` is there for the occasional effect that needs an integer step.

## The one rule: `render` is pure

`render(ctx)` must return the same tree for the same timestamp and props, with no side effects. That's what
lets Skiamovin:

- render frames **in any order**: seeking in `Player`, `CompositionSink.getImage(7.5)`,
- render **in parallel** across workers and GPUs,
- **retry** a frame after a GPU reset.

So:

| ❌ Don't | ✅ Do |
|---|---|
| `Math.random()` | `random('star-' + i)` |
| `Date.now()`, `performance.now()` | `ctx.timestamp` |
| `let x = 0; render() { x += 5 }` | `const x = ctx.timestamp * 150` |
| `await fetch()` inside `render` | an asset, or top-level `await` in the module |
| a physics simulation stepped per frame | `spring()` (analytic), or precompute it at module scope |

## Nodes

```ts
box(style, children); // container
text(content, style); // SkParagraph text
image(asset, style); // bitmap
video(input, style); // a Mediabunny Input, frame-synced
lottie(asset, style); // Skottie
svg(asset, style); // vector
shader(sksl, style); // runtime effect fill
draw(fn, style); // raw Skia canvas
audio(input, options); // sound, not drawn
```

Each takes layout properties ([Taffy](taffy.md)) and visual properties (`background`, `opacity`, `transform`,
`shadow`, `blur`, `borderRadius`, …). The full list is in the [scene reference](../api/scene.md#visual-style).

Children can be arrays, nested arrays, or `null`/`false`, so conditionals read naturally:

```ts
box({}, [title, ctx.timestamp > 1 && subtitle, items.map((item, i) => row(item, i))]);
```

### Components are just functions

```ts
function Card(label: string, value: string, timestamp: number, delay: number) {
  const t = spring({ timestamp, delay, damping: 12 });
  return box(
    {
      flexGrow: 1,
      padding: 32,
      borderRadius: 24,
      background: '#1e293b',
      opacity: t,
      transform: { translateY: (1 - t) * 60 },
      shadow: { offset: [0, 20], blur: 40, color: '#00000066' },
    },
    [text(label, { fontSize: 32, color: '#94a3b8' }), text(value, { fontSize: 96, fontWeight: 800, color: '#f8fafc' })],
  );
}

render: ({ timestamp }) =>
  box({ flexDirection: 'row', gap: 32, padding: 80 }, [
    Card('Revenue', '$4.2M', timestamp, 0),
    Card('Users', '182k', timestamp, 0.2),
    Card('NPS', '67', timestamp, 0.4),
  ]);
```

## Assets

Images, fonts, Lottie files and SVGs are **assets**. Like a Mediabunny `Input`, an asset is created from a
`Source` and loads lazily:

```ts
import { FilePathSource, UrlSource, BlobSource } from 'mediabunny';
import { ImageAsset, FontAsset, LottieAsset, SvgAsset } from 'skiamovin/scene';

const logo = new SvgAsset(new FilePathSource('./logo.svg'));
const hero = new ImageAsset(new UrlSource('https://example.com/hero.jpg'));
const inter = new FontAsset(new FilePathSource('./Inter-Variable.ttf'), { family: 'Inter' });
const confetti = new LottieAsset(new FilePathSource('./confetti.json'));
```

Define them at module scope and use them in `render`. Skiamovin loads whatever the first frame needs before
drawing it, and loads assets that appear later ahead of time. Fonts are the exception: list them in the
composition's `fonts` so `text` nodes can find them by family name.

Videos and audio aren't assets. They're plain Mediabunny `Input`s. See [Video input](video-input.md) and
[Audio](audio.md).

## Time: `sequence` and `series`

`sequence` shows content during a time range and gives it **local** time starting at 0:

```ts
render: (ctx) =>
  box({ size: { width: '100%', height: '100%' } }, [
    sequence({ start: 0, end: 3 }, (ctx) => Intro(ctx)),
    sequence({ start: 3, end: 8 }, (ctx) => Body(ctx)),
    sequence({ start: 2 }, (ctx) => LogoBug(ctx)), // no end: until the composition ends
  ]);
```

Inside a sequence, `ctx.timestamp` starts at 0 and `ctx.duration` is the sequence's length. Media nodes use
the same local time. A `video` in a sequence starting at 3 s begins playing (from its `trim.start`) at 3 s.

`series` places items end to end:

```ts
render: (ctx) =>
  series(ctx, [
    { duration: 3, render: Intro },
    { duration: 5, render: Body },
    { duration: 2, render: Outro },
  ]);
```

### Transitions

A negative `offset` overlaps an item with the one before it. During the overlap both render, later ones on top:

```ts
series(ctx, [
  { duration: 3, render: Intro },
  {
    duration: 5,
    offset: -0.5,
    render: (ctx) =>
      box({ opacity: interpolate(ctx.timestamp, [0, 0.5], [0, 1]), size: { width: '100%', height: '100%' } }, [
        Body(ctx),
      ]),
  },
]);
```

For shader transitions, render both scenes as `children` of a [`shader`](shaders.md#transitions) node during the
overlap.

## Animation helpers

### `interpolate`

Maps an input range to an output range. Clamped by default:

```ts
const x = interpolate(timestamp, [0, 1], [-200, 0], { easing: Easing.outCubic });
const opacity = interpolate(timestamp, [0, 0.3, 2.7, 3], [0, 1, 1, 0]); // fade in, hold, fade out
```

### `spring`

Physically based motion, computed analytically from `timestamp`:

```ts
const s = spring({ timestamp, stiffness: 120, damping: 14 });
const scale = interpolate(s, [0, 1], [0.6, 1]);
```

Delay it with `delay` (seconds), or make it settle in a fixed time with `duration`. To stagger a list:

```ts
items.map((item, i) => {
  const s = spring({ timestamp, delay: i * 0.12 });
  return row(item, { opacity: s, transform: { translateX: (1 - s) * 100 } });
});
```

### `Timeline`

For choreography with many properties, a GSAP-style timeline is often clearer than many `interpolate` calls. It's
still a pure function of the timestamp:

```ts
const timeline = new Timeline()
  .set('logo', { scale: 0.6, opacity: 0 })
  .to('logo', { scale: 1, opacity: 1 }, { at: 0, duration: 0.8, easing: Easing.back(1.4) })
  .from('tagline', { opacity: 0, y: 30 }, { at: '>-0.2', duration: 0.6, easing: Easing.outCubic })
  .label('exit', 4)
  .to(['logo', 'tagline'], { opacity: 0, y: -20 }, { at: 'exit', duration: 0.5, stagger: 0.12 });

const composition = new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: timeline.duration,
  render: ({ timestamp }) => {
    const v = timeline.getValues(timestamp);
    return box(
      {
        size: { width: '100%', height: '100%' },
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        gap: 24,
      },
      [
        svg(logo, { opacity: v.logo.opacity, transform: { scale: v.logo.scale, translateY: v.logo.y } }),
        text('Programmatic video', {
          fontSize: 48,
          opacity: v.tagline.opacity,
          transform: { translateY: v.tagline.y },
        }),
      ],
    );
  },
});
```

Positions (`at`): seconds, a label, `'>'` / `'<'` (end / start of the previous tween), with optional offsets:
`'>-0.2'`, `'<+0.15'`, `'exit+1'`.

`interpolate`, `spring` and timelines can all be mixed in the same render.

### `random` and `noise`

```ts
const stars = Array.from({ length: 200 }, (_, i) => ({
  x: random(`x${i}`) * 1920,
  y: random(`y${i}`) * 1080,
  r: 1 + random(`r${i}`) * 2,
}));
const wiggle = noise('camera', timestamp * 0.6) * 8;
```

## Props: data-driven video

Compositions take props, so one template renders many videos:

```ts
const lowerThird = new Composition<{ name: string; role: string; color: string }>({
  width: 1920, height: 1080, frameRate: 30, duration: 5,
  defaultProps: { name: 'Jane Doe', role: 'Engineer', color: '#6366f1' },
  render: ({ timestamp, props }) => /* ... */,
});

for (const person of people) {
  const render = await Render.init({
    composition: lowerThird,
    props: person,
    output: new Output({ format: new Mp4OutputFormat(), target: new FilePathTarget(`out/${person.id}.mp4`) }),
  });
  await render.execute();
}
```

`duration` can be a function of props, and it can be async, for example to match a voice-over:

```ts
const voiceover = new Input({ formats: ALL_FORMATS, source: new FilePathSource('./vo.m4a') });

new Composition({
  // ...
  duration: async () => (await voiceover.computeDuration()) + 1,
});
```

## Dropping to Skia

When nodes aren't enough, use `draw` to get a canvas clipped to the node's box:

```ts
const dot = new Paint().setAntiAlias(true).setColor('#a78bfa'); // module scope, not inside render

draw(
  (canvas, { width, height }, { timestamp }) => {
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2 + timestamp * 0.6;
      canvas.drawCircle([width / 2 + Math.cos(a) * 300, height / 2 + Math.sin(a) * 300], 6, dot);
    }
  },
  { size: { width: '100%', height: '100%' } },
);
```

## Getting output

| You want | Use |
|---|---|
| A video file | [`Render`](rendering.md), which works like Mediabunny's `Conversion` |
| A still or a few frames | [`CompositionSink`](rendering.md#stills-and-frames), which works like `CanvasSink` |
| The audio mix | `CompositionAudioSink`, which works like `AudioSampleSink` |
| A live preview | [`Player`](web.md#live-preview-with-player) (browser) |
