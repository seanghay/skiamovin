# `skiamovin/scene`

```ts
import {
  Composition,
  CompositionModule,
  // nodes
  box,
  text,
  span,
  image,
  video,
  lottie,
  svg,
  shader,
  draw,
  audio,
  sequence,
  series,
  // assets
  ImageAsset,
  FontAsset,
  LottieAsset,
  SvgAsset,
  // animation
  interpolate,
  interpolateColor,
  spring,
  Easing,
  Timeline,
  random,
  noise,
  // paint helpers
  linearGradient,
  radialGradient,
  // output
  Render,
  CompositionSink,
  CompositionAudioSink,
  Player,
  // audio analysis
  analyzeAudio,
} from 'skiamovin/scene';
```

The high-level layer. A `Composition` is a **pure function from a timestamp to a tree of nodes**. Skiamovin lays
the tree out with Taffy, resolves media, draws with Skia, mixes audio, and encodes with Mediabunny.

Like Mediabunny, the scene layer measures **all times and durations in seconds**. Frame numbers are available
when you want them, but you never need them.

See the [scenes guide](../guides/scenes.md).

---

## `Composition`

```ts
class Composition<Props = {}> {
  constructor(options: CompositionOptions<Props>);

  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly defaultProps: Props;

  /** Resolves the duration in seconds for the given props. */
  computeDuration(props?: Partial<Props>): Promise<number>;
}

interface CompositionOptions<Props> {
  width: number;
  height: number;
  /** Frames per second. */
  frameRate: number;
  /** In seconds. A function lets the duration depend on props or media, e.g. `() => clip.computeDuration()`. */
  duration: number | ((props: Props) => number | Promise<number>);
  /** Fill color behind everything. Default transparent (black when encoded without alpha). */
  background?: Color;
  /** Working color space. Default 'srgb'. HDR spaces render into F16 surfaces. */
  colorSpace?: 'srgb' | 'display-p3' | 'rec2020-pq' | 'rec2020-hlg';
  /** Fonts available to `text` nodes, by family name. */
  fonts?: FontAsset[];
  /**
   * 'outlines' (default) draws text from glyph outlines, so it looks the same on every platform and moves
   * smoothly. 'native' uses the platform's glyph rasterizer.
   */
  textRendering?: 'outlines' | 'native';
  /** Named moments in seconds, such as `{ drop: 2.4 }`. Available as `ctx.events` and as `Timeline` labels. */
  events?: Record<string, number>;
  defaultProps?: Props;
  /** Must be pure and synchronous: the same timestamp and props always give the same tree. */
  render: (ctx: RenderContext<Props>) => Child;
}

interface RenderContext<Props> {
  /** Seconds since the start of the composition (or of the enclosing sequence). */
  timestamp: number;
  /** Duration in seconds of the composition (or of the enclosing sequence). */
  duration: number;
  /** `Math.round(timestamp * frameRate)`, for convenience. */
  frame: number;
  frameRate: number;
  width: number;
  height: number;
  props: Props;
  /** The composition's named events, in composition time. */
  events: Record<string, number>;
}
```

Keep events in a `composition.meta.json` next to the composition and pass them in, so a timeline editor can move
them without touching code:

```ts
import meta from './composition.meta.json' with { type: 'json' };
export const promo = new Composition({ ...options, events: meta.events });
```

`render` may be called in any order, in several workers, and more than once per timestamp. Derive everything
from `ctx`: no `Date.now()`, no `Math.random()` (use [`random`](#random-and-noise)), and no state carried
between calls.

## `CompositionModule`

```ts
class CompositionModule {
  constructor(url: string | URL, exportName?: string); // exportName defaults to 'default'
}
```

A reference to a composition by module, for [multi-worker rendering](#concurrency). Each worker imports the
module itself, because functions can't be sent between threads.

---

## Nodes

Every node takes a `NodeStyle`: the full [Taffy `Style`](taffy.md#style) plus the
[visual properties](#visual-style). Children may be nodes, arrays, `null`, `false` or `undefined` (the last
three are skipped).

### `box`

```ts
box(style?: NodeStyle, children?: Child[]): SceneNode
```

### `text` and `span`

```ts
text(content: string | (string | Span)[], style?: NodeStyle & TextProps): SceneNode
span(content: string, style: TextProps): Span

interface TextProps {
  fontFamily?: string | string[];
  fontSize?: number;
  fontWeight?: number | 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  fontVariations?: Record<string, number>;     // { wght: 650, opsz: 32 }
  fontFeatures?: Record<string, number>;       // { tnum: 1 }
  color?: Color | Shader;
  letterSpacing?: number;
  wordSpacing?: number;
  lineHeight?: number;                         // multiple of the font size
  textAlign?: 'left' | 'right' | 'center' | 'justify' | 'start' | 'end';
  textDecoration?: 'underline' | 'line-through' | 'overline' | 'none';
  textShadow?: Shadow | Shadow[];
  stroke?: { color: Color; width: number };
  maxLines?: number;
  ellipsis?: string;
  locale?: string;
  direction?: 'ltr' | 'rtl';
  /** Draw only the first N grapheme clusters. Use for typewriter effects, with `graphemeCount(text)`. */
  visibleGraphemes?: number;
  /** Animate the text in pieces. */
  split?: SplitText;
}

interface SplitText {
  by: 'chars' | 'words' | 'lines';
  style: (unit: TextUnit) => UnitStyle;
}
interface TextUnit { index: number; count: number; text: string; color?: Color }
interface UnitStyle { opacity?: number; x?: number; y?: number; scale?: number; rotate?: number; color?: Color }
```

With `split`, each piece gets its own opacity, offset, scale, rotation and color, and turns around its own
center. Characters are grapheme clusters (a letter and its marks move together, which matters for Khmer, Thai,
Hindi and Arabic). Words follow the locale's word breaks. Usually you'll build `split` with
[`textAnimator`](#textanimator), or write the style function yourself:

```ts
text('Hello world', { split: { by: 'words', style: ({ index }) => ({ y: index * 10 }) } })
```

Laid out with SkParagraph through a Taffy measure function, so text wraps to its box and gives the box an
intrinsic size. Families resolve against the composition's `fonts`, then the bundled fallback fonts.

### `path`

```ts
path(d: string | Path, style?: NodeStyle & PathStyle): SceneNode

interface PathStyle {
  fill?: Color | Gradient | null;   // default black without a stroke, none with one
  stroke?: Color | Gradient;
  strokeWidth?: number;             // default 1
  strokeCap?: 'butt' | 'round' | 'square';
  strokeJoin?: 'miter' | 'round' | 'bevel';
  /** Draw part of the path, as fractions of its total length. Animate `end` to draw it on. */
  trim?: { start?: number; end?: number; offset?: number };
  /** Arrowheads at the (trimmed) ends. `true` sizes them from the stroke width. */
  arrow?: { start?: boolean | number; end?: boolean | number };
}
```

The path's coordinates are in the node's own space, and the node's size defaults to the path's right and bottom
edges. Lengths for `trim` run across all contours together, so `trim: { end: 0.5 }` is half of the whole
drawing.

```ts
path('M10 80 C40 10 65 10 95 80', { stroke: '#38bdf8', strokeWidth: 4, trim: { end: progress }, arrow: { end: true } })
```

### `image`

```ts
image(asset: ImageAsset | Image, style?: NodeStyle & {
  fit?: Fit;
  objectPosition?: [x, y];
  sampling?: 'linear' | 'nearest' | 'mipmap' | 'cubic';
}): SceneNode

type Fit = 'fill' | 'contain' | 'cover' | 'none' | 'scale-down';
```

Without a size in the style, the node uses the image's intrinsic size. Animated GIF/WebP play in sync with the
composition clock.

### `video`

```ts
video(media: Input | InputVideoTrack, style?: NodeStyle & {
  fit?: Fit;
  /** Section of the source to play, in seconds. Like Mediabunny's Conversion `trim`. */
  trim?: { start?: number; end?: number };
  playbackRate?: number;     // default 1
  loop?: boolean;
  /** Audio volume, 0–1+. A function receives the node's local timestamp. */
  volume?: number | ((timestamp: number) => number);
  muted?: boolean;
}): SceneNode
```

Takes a Mediabunny `Input` (using its primary video and audio tracks) or a specific `InputVideoTrack`. The
node shows the source frame at `trim.start + timestamp × playbackRate`, where `timestamp` is local to the
enclosing sequence. Its audio joins the mix unless `muted`. See [Video input](../guides/video-input.md).

### `audio`

```ts
audio(media: Input | InputAudioTrack, options?: {
  trim?: { start?: number; end?: number };
  volume?: number | ((timestamp: number) => number);
  playbackRate?: number;     // resampled, so the pitch shifts
  loop?: boolean;
}): SceneNode
```

Not drawn. Starts with its enclosing sequence. See [Audio](../guides/audio.md).

### `lottie`

```ts
lottie(asset: LottieAsset, style?: NodeStyle & {
  fit?: Fit;
  /** Lottie time in seconds. Default: the node's local timestamp. */
  time?: number;
  /** Alternatively, 0–1 across the animation. */
  progress?: number;
  loop?: boolean;
  overrides?: {
    colors?: Record<string, Color>;
    texts?: Record<string, string | { text: string; size?: number }>;
    opacity?: Record<string, number>;
  };
}): SceneNode
```

### `svg`

```ts
svg(asset: SvgAsset, style?: NodeStyle & { fit?: Fit; attributes?: Record<string, Record<string, string>> }): SceneNode
```

`attributes` is keyed by element id: `{ logo: { fill: '#fff' } }`.

### `shader`

```ts
shader(effect: RuntimeEffect | string, style?: NodeStyle & {
  uniforms?: Record<string, number | number[]>;
  children?: Record<string, Shader | ImageAsset | SceneNode>;
}): SceneNode
```

Fills the node's box with an SkSL shader. These uniforms are filled in automatically if declared:

| Uniform | Value |
|---|---|
| `uniform float2 iResolution` | The node's size in pixels |
| `uniform float iTime` | Local timestamp, seconds |
| `uniform float iFrame` | Local frame |
| `uniform float iProgress` | 0–1 across the enclosing sequence |

A `SceneNode` child is rendered to an offscreen image first, so a shader can process a whole subtree.

### `draw`

```ts
draw(fn: (canvas: Canvas, size: { width: number; height: number }, ctx: RenderContext) => void, style?: NodeStyle): SceneNode
```

Direct access to the Skia canvas, translated and clipped to the node's box. `fn` must be pure.

### `sequence`

```ts
sequence(
  range: { start: number; end?: number },
  render: (ctx: RenderContext) => Child,
): SceneNode | null
```

Shows its content while the timestamp is in `[start, end)` (seconds; no `end` means until the composition
ends). `render` receives a context whose `timestamp` and `frame` are **local**, counted from `start`. Media inside
(video, audio, Lottie, shader `iTime`) uses local time.

### `series`

```ts
series(ctx: RenderContext, items: {
  duration: number;              // seconds
  /** Negative values overlap this item with the previous one. */
  offset?: number;
  render: (ctx: RenderContext) => Child;
}[]): SceneNode | null
```

Plays items one after another.

---

## Visual style

| Property | Type | Notes |
|---|---|---|
| `background` | `Color \| Shader \| Gradient` |  |
| `borderRadius` | `number \| [tl, tr, br, bl]` | Also clips children when `overflow` is `'hidden'` or `'clip'` |
| `borderColor` | `Color` | Width comes from the Taffy `border` |
| `opacity` | `number` | Applied as a group (save layer) when the node has children |
| `transform` | `Transform \| Transform[]` | Applied after layout, so it doesn't affect siblings |
| `transformOrigin` | `[x, y]` | Default `['50%', '50%']` |
| `shadow` | `Shadow \| Shadow[]` | `{ offset: [x, y], blur, spread?, color, inset? }` |
| `blur` | `number` | Gaussian blur sigma on the node's content |
| `backdropBlur` | `number` | Blurs what's behind the node |
| `filter` | `ImageFilter` | Any Skia image filter |
| `colorFilter` | `ColorFilter` |  |
| `blendMode` | `BlendMode` name, e.g. `'multiply'` |  |
| `zIndex` | `number` | Paint order among siblings |
| `mask` | `SceneNode` | Uses the mask's alpha |
| `cache` | `string` | Caches the rendered subtree as an image under this key |

```ts
type Transform = {
  translate?: [x, y];
  translateX?: number;
  translateY?: number;
  scale?: number | [sx, sy];
  rotate?: number; // degrees
  skew?: [kx, ky]; // degrees
  perspective?: number;
  rotateX?: number;
  rotateY?: number; // 3D, via M44
};
```

### `linearGradient` and `radialGradient`

```ts
linearGradient(angleDeg: number, stops: (Color | [Color, number])[]): Gradient
radialGradient(stops: (Color | [Color, number])[], options?: { center?: [x, y]; radius?: number | string }): Gradient
```

Resolved against the node's box at draw time. Dithered by default.

---

## Assets

Assets follow Mediabunny's model: you construct one from a Mediabunny **`Source`** (`FilePathSource`,
`UrlSource`, `BlobSource`, `BufferSource`, `StreamSource`). Construction is synchronous and cheap. Nothing is
read until the asset is needed, and then it's loaded once and cached.

```ts
import { FilePathSource, UrlSource } from 'mediabunny';

const logo = new ImageAsset(new FilePathSource('./logo.png'));
const inter = new FontAsset(new UrlSource('/fonts/Inter-Variable.ttf'), { family: 'Inter' });
```

| Class | Constructor | Async getters |
|---|---|---|
| `ImageAsset` | `(source)` | `getDimensions(): Promise<{ width, height }>`, `getImage(): Promise<Image>` |
| `FontAsset` | `(source, { family?, weight?, style? })` | `getTypeface(): Promise<Typeface>`, `getFamilyName(): Promise<string>` |
| `LottieAsset` | `(source, { resources?: Record<string, Source> })`: keys are the paths the file references | `getDuration()`, `getFrameRate()`, `getDimensions()` |
| `SvgAsset` | `(source)` | `getDimensions()` |

Every asset also has `load(): Promise<void>` to load ahead of time, and `dispose()`.

Video and audio aren't wrapped. Pass Mediabunny `Input`s straight to `video()` and `audio()`:

```ts
const clip = new Input({ formats: ALL_FORMATS, source: new FilePathSource('./clip.mp4') });
```

Renderers load every asset and input reachable from the first rendered frame before drawing it, and load
assets that appear later ahead of time.

### `analyzeAudio`

```ts
function analyzeAudio(
  media: Input | InputAudioTrack,
  options: {
    frameRate: number;
    bands?: number; // default 16
    minFrequency?: number; // Hz, default 40
    maxFrequency?: number; // Hz, default 16000
  },
): Promise<AudioAnalysis>;

interface AudioAnalysis {
  getRms(timestamp: number): number;
  getBands(timestamp: number): Float32Array; // `bands` values, 0–1, log-spaced
}
```

Precomputes loudness and spectrum so audio-reactive visuals can stay pure. Call it at module scope with
top-level `await`.

---

## Animation

### `interpolate`

```ts
interpolate(
  input: number,
  inputRange: number[],         // ascending
  outputRange: number[],        // same length
  options?: {
    easing?: EasingFunction | EasingFunction[];          // one, or one per segment
    extrapolateLeft?: 'clamp' | 'extend' | 'identity';   // default 'clamp'
    extrapolateRight?: 'clamp' | 'extend' | 'identity';  // default 'clamp'
  },
): number
```

### `interpolateColor`

```ts
interpolateColor(input: number, inputRange: number[], colors: Color[], options?: { space?: 'oklab' | 'srgb' | 'linear-srgb'; easing?: EasingFunction }): Color
```

Interpolates in OKLab by default.

### `spring`

```ts
spring(options: {
  timestamp: number;             // seconds
  from?: number;                 // default 0
  to?: number;                   // default 1
  delay?: number;                // seconds
  mass?: number;                 // default 1
  stiffness?: number;            // default 100
  damping?: number;              // default 10
  overshootClamping?: boolean;
  /** Stretch the spring so it settles in exactly this many seconds. */
  duration?: number;
}): number
```

Computed analytically from `timestamp`, with no simulation state, so it's deterministic in any order.
`spring.computeSettleTime(options)` returns the time to rest in seconds.

### `Easing`

`Easing.linear`, `Easing.in(fn)`, `Easing.out(fn)`, `Easing.inOut(fn)`, `Easing.quad`, `Easing.cubic`,
`Easing.quart`, `Easing.quint`, `Easing.sine`, `Easing.expo`, `Easing.circ`, `Easing.back(overshoot?)`,
`Easing.elastic(bounciness?)`, `Easing.bounce`, `Easing.bezier(x1, y1, x2, y2)` (also `cubicBezier`),
`Easing.steps(n)`. Shorthands: `Easing.outCubic`, `Easing.inOutQuad`, and so on.

| Ease | Description |
|---|---|
| `Easing.smooth` | Manim's default S-curve |
| `Easing.thereAndBack` | Goes to 1 at the midpoint and back to 0 |
| `Easing.squish(ease, a, b)` | Runs `ease` only between `a` and `b` |
| `Easing.piecewise(points)` | Straight lines between points, like CSS `linear()`: `piecewise([0, [0.8, 0.5], 1])` |
| `Easing.custom(svgPath)` | An ease drawn as a path from (0, 0) to (1, 1): `custom('M0,0 C0.5,0 0.5,1 1,1')` |
| `Easing.irregular(seed, { points?, strength? })` | A jittery ease, the same on every render |

### `stagger`

```ts
stagger(value: number | [from, to], options?: StaggerOptions): (index: number, count: number) => number

interface StaggerOptions {
  from?: number | 'first' | 'last' | 'center' | 'edges' | 'random';
  grid?: [rows, columns];
  axis?: 'x' | 'y';
  ease?: EasingFunction;
  start?: number;
  seed?: string | number;     // for from: 'random'
  reversed?: boolean;
}
```

Spreads a value over items by their distance from a starting point. A number gives that much per step
(`stagger(0.05)` for delays); a range spreads values across it (`stagger([0, 360])` for rotations). With a grid,
distance is measured in 2D.

```ts
items.map((item, i) => box({ opacity: interpolate(t - stagger(0.04, { from: 'center' })(i, items.length), [0, 0.4], [0, 1]) }))
```

### `keyframes`, `wiggle` and `loopTime`

```ts
keyframes(timestamp, values: number[], { times?, easing?, duration?, delay? }): number
wiggle(timestamp, freq, amount, { seed?, octaves? }): number      // smooth seeded randomness, like After Effects
loopTime(timestamp, duration, mode?: 'cycle' | 'pingpong'): number
```

### `Timeline`

A GSAP-style keyframe timeline, evaluated purely from the timestamp.

```ts
const timeline = new Timeline()
  .from('title', { opacity: 0, y: 40 }, { at: 0, duration: 0.6, easing: Easing.outCubic })
  .to('title', { scale: 1.1 }, { at: '>', duration: 0.3 })
  .from('subtitle', { opacity: 0 }, { at: '<+0.15', duration: 0.5 })
  .label('outro', 4)
  .to(['title', 'subtitle'], { opacity: 0 }, { at: 'outro', duration: 0.5, stagger: 0.1 });

timeline.duration; // seconds, end of the last tween
const v = timeline.getValues(timestamp); // { title: { opacity, y, scale }, subtitle: { opacity } }
```

| Method | Description |
|---|---|
| `to(target, values, options)` | Animate from the current value to `values` |
| `from(target, values, options)` | Animate from `values` to the current value |
| `fromTo(target, from, to, options)` |  |
| `set(target, values, { at? })` | Jump to values. At `at: 0` (the default), these are initial values |
| `keyframes(target, { x: [0, 100, 50] }, { duration, times?, easing? })` | Animate through several values |
| `label(name, at)` | Name a position |
| `add(timeline, at)` | Nest another timeline. One with its own repeats or speed keeps its own clock |
| `getValues(timestamp)` | Evaluate every target |
| `valueAt(target, prop, timestamp)` | Evaluate one property |
| `duration`, `totalDuration` | One play, and the length including the timeline's repeats and speed |
| `Timeline.all(...)`, `Timeline.chain(...)`, `Timeline.sequence(gap, ...)`, `Timeline.delay(seconds, tl)` | Combine timelines |

`new Timeline({ repeat?, yoyo?, repeatDelay?, timeScale?, labels? })`. `labels` are known from the start, for
example `labels: composition.events`.

Tween options: `{ at, duration, easing?, stagger?, repeat?, yoyo?, repeatDelay? }`, all times in seconds. `at`
takes a number, a label, `'>'` (end of the previous tween), `'<'` (its start), or an offset such as `'>-0.2'`,
`'<+0.15'`, `'<50%'` (half of the previous tween's length) or `'outro+1'`. `stagger` takes seconds, a `stagger()`
function, or stagger options with `each`. `repeat: -1` repeats forever. Values may be numbers, colors
(interpolated in OKLab) or `[x, y]` tuples. Targets with no tween yet evaluate to their `set` value, or to `0`
(`1` for `opacity` and `scale`).

### `morphPath` and `alongPath`

```ts
morphPath(from: string | Path, to: string | Path, t: number): Path
alongPath(path: string | Path, progress: number): { x: number; y: number; angle: number }
```

`morphPath` blends one shape into another. Contours are paired by size, given matching points by splitting the
longest curves, and closed contours are lined up at their best starting point so the shape doesn't twist. The
matching runs once per pair of paths and is reused. `alongPath` gives the position and heading (degrees) at a
fraction of a path's total length, for moving a node along it.

### `textAnimator`

```ts
textAnimator(options: {
  by: 'chars' | 'words' | 'lines';
  start?: number; end?: number; offset?: number;     // the selected range, 0..1 of the text
  shape?: 'square' | 'rampUp' | 'rampDown' | 'triangle' | 'round' | 'smooth';
  ease?: EasingFunction;
  order?: 'forward' | 'reverse' | 'random';
  seed?: string | number;
  amount?: number;
  properties: UnitStyle;                             // the look of a fully selected piece
}): SplitText
```

Like After Effects' text animators: `properties` apply to the pieces inside the range, partly to those at its
edges. Move the range with `offset` to sweep the effect across the text. For letters that rise and fade in
from left to right:

```ts
text('Hello', { split: textAnimator({ by: 'chars', shape: 'rampUp', end: 0.3, offset: t * 1.3 - 0.3,
  properties: { opacity: 0, y: 24 } }) })
```

### Text helpers

```ts
scramble(text, progress, { frame?, seed?, characters?, locale? }): string   // reveal with random characters
counter(value, { decimals?, locale?, prefix?, suffix?, grouping? }): string // use with fontFeatures: { tnum: 1 }
graphemeCount(text, locale?): number                                       // for visibleGraphemes
```

### `random` and `noise`

```ts
random(seed: string | number): number                                       // deterministic, [0, 1)
noise(seed: string | number, x: number, y?: number, z?: number): number      // simplex, [-1, 1]
```

---

## Rendering to a file: `Render`

`Render` is to compositions what Mediabunny's
[`Conversion`](https://mediabunny.dev/guide/converting-media-files) is to media files: initialize, check
validity, execute.

```ts
import { Output, Mp4OutputFormat, FilePathTarget, QUALITY_HIGH } from 'mediabunny';

const render = await Render.init({
  composition,
  output: new Output({ format: new Mp4OutputFormat(), target: new FilePathTarget('out.mp4') }),
});

render.onProgress = (progress) => console.log(`${Math.round(progress * 100)}%`);
await render.execute();
```

### `Render.init(options)`

```ts
interface RenderOptions<Props> {
  composition: Composition<Props> | CompositionModule;
  /** A fresh Mediabunny Output (not started, with no tracks). Render adds its tracks, starts and finalizes it. */
  output: Output;
  props?: Partial<Props>;
  video?: {
    /** Default: the first codec the output format supports that can be encoded here. */
    codec?: VideoCodec;
    bitrate?: number | Quality; // default QUALITY_HIGH
    keyFrameInterval?: number; // seconds, default 2
    bitrateMode?: 'variable' | 'constant';
    hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software';
    /** Output size. Defaults to the composition size. */
    width?: number;
    height?: number;
    fit?: 'fill' | 'contain' | 'cover';
    /** 'keep' encodes an alpha channel (VP9/AV1 in WebM, HEVC in MOV on macOS). Default 'discard'. */
    alpha?: 'keep' | 'discard';
    colorSpace?: 'srgb' | 'display-p3' | 'rec2020-pq' | 'rec2020-hlg';
  };
  audio?: {
    /** Skip audio entirely. */
    discard?: boolean;
    codec?: AudioCodec; // default: first encodable codec for the format
    bitrate?: number | Quality;
    sampleRate?: number; // default 48000
    numberOfChannels?: number; // default 2
    /** Write a silent track even when nothing is audible. Default false. */
    forceTrack?: boolean;
  };
  /** Render only a section, in seconds. */
  trim?: { start?: number; end?: number };
  gpu?: 'auto' | 'metal' | 'vulkan' | 'd3d12' | 'webgpu' | 'webgl2' | 'raster';
  /**
   * Number of workers. Node: worker threads, needs a CompositionModule when > 1 ('auto' picks 1 or 2).
   * Browser: Web Workers when `worker` is enabled ('auto' is 1).
   */
  concurrency?: number | 'auto';
  /**
   * Browser only. A function returning a Worker that runs `serveComposition()`; `true` for the built-in worker
   * (needs a CompositionModule); `false` to render on the calling thread.
   * Default: `true` for a CompositionModule, `false` for a Composition.
   */
  worker?: boolean | (() => Worker);
  /** Log per-stage timings (render, layout, media, paint, encode) when execution finishes. */
  profile?: boolean;
}
```

### Instance members

| Member | Description |
|---|---|
| `isValid: boolean` | `false` if the render can't run, for example when no video codec can be encoded for the output format |
| `discardedTracks: { type: 'video' \| 'audio'; reason: 'discarded_by_user' \| 'no_encodable_target_codec' \| 'nothing_audible' }[]` | Tracks that won't be written, and why |
| `utilizedBackend: 'metal' \| 'vulkan' \| 'd3d12' \| 'webgpu' \| 'webgl2' \| 'raster'` |  |
| `onProgress?: (progress: number) => unknown` | 0–1. Set it before `execute()` |
| `execute(): Promise<void>` | Renders, encodes and finalizes the output. Throws if `!isValid` |
| `cancel(): Promise<void>` | Stops workers and cancels the output |

### Concurrency

On Node, `concurrency > 1` splits the render into keyframe-aligned chunks. Each worker owns a GPU context and an
encoder, and the chunks' packets are joined without re-encoding. Pass a `CompositionModule`:

```ts
const render = await Render.init({
  composition: new CompositionModule(new URL('./promo.ts', import.meta.url)),
  output,
  concurrency: 'auto',
});
```

In the browser, the same chunking runs in Web Workers (see [Workers in the browser](#workers-in-the-browser)).
Audio is mixed on the calling thread while the workers render.

---

## Reading frames: `CompositionSink`

Pulls rendered frames out of a composition. Modeled on Mediabunny's
[`CanvasSink`](https://mediabunny.dev/guide/media-sinks#canvassink).

```ts
class CompositionSink {
  constructor(
    composition: Composition,
    options?: {
      props?: object;
      width?: number;
      height?: number;
      fit?: 'fill' | 'contain' | 'cover';
      /** Reuse this many images in rotation instead of allocating one per frame. Default 0 (no pooling). */
      poolSize?: number;
      gpu?: RenderOptions['gpu'];
    },
  );

  getImage(timestamp: number): Promise<WrappedImage | null>;
  images(startTimestamp?: number, endTimestamp?: number): AsyncGenerator<WrappedImage>;
  imagesAtTimestamps(timestamps: Iterable<number> | AsyncIterable<number>): AsyncGenerator<WrappedImage | null>;
}

interface WrappedImage {
  image: Image; // Skia image, texture-backed on GPU
  timestamp: number; // seconds
  duration: number; // seconds
}
```

`images()` steps at the composition's frame rate. Encode a still with the Skia API:

```ts
const sink = new CompositionSink(composition);
const { image } = (await sink.getImage(1.5))!;
await writeFile('thumb.png', image.encodeToData(EncodedImageFormat.PNG)!.asBytes());
```

## Reading audio: `CompositionAudioSink`

Pulls the mixed audio out of a composition as Mediabunny `AudioSample`s. Modeled on `AudioSampleSink`.

```ts
class CompositionAudioSink {
  constructor(composition: Composition, options?: { props?: object; sampleRate?: number; numberOfChannels?: number });
  getSample(timestamp: number): Promise<AudioSample | null>;
  samples(startTimestamp?: number, endTimestamp?: number): AsyncGenerator<AudioSample>;
}
```

---

## Live preview: `Player` (web)

```ts
const player = new Player(composition, {
  canvas: document.querySelector('canvas')!,
  props,
  loop: true,
  autoplay: false,
  audio: true, // play the mix through Web Audio
  playbackRate: 1,
  scale: 1, // render resolution multiplier, e.g. 0.5 for faster previews
  worker: () => new Worker(new URL('./promo.worker.ts', import.meta.url), { type: 'module' }),
  gpu: 'auto',
});

await player.ready; // first frame is on the canvas

await player.play();
player.pause();
await player.seek(3.2); // seconds
player.currentTime; // seconds
player.playing;
await player.computeDuration();
player.setProps({ title: 'New title' });

player.onTimeUpdate = (timestamp) => {};
player.onEnded = () => {};

player.dispose();
```

| Member | Description |
|---|---|
| `ready: Promise<void>` | Resolves when the first frame is shown; rejects if the composition or worker fails to load |
| `inWorker: boolean` | Whether frames are rendered in a worker |
| `backend: string` | GPU backend used for rendering, e.g. `'webgl2'` |

Frames are dropped, never delayed, if rendering falls behind. `Player` presents frames through a
`bitmaprenderer` context on the GPU path and a `2d` context on the raster path, so pass a canvas that has no
context yet. The first argument may also be a `CompositionModule`, which renders in the built-in worker by default.

---

## Workers in the browser

### `serveComposition(composition?)`

Call it at the top level of a worker module. The worker then serves `Player` previews and `Render` chunks for
that composition:

```ts
// promo.worker.ts
import { serveComposition } from 'skiamovin/scene';
import { promo } from './promo';

serveComposition(promo);
```

Pass the worker to `Player` and `Render` as a factory. Bundlers (Vite, webpack 5, Parcel, esbuild with plugins)
recognize `new Worker(new URL(..., import.meta.url))` and bundle the worker with its own copy of the library:

```ts
const worker = () => new Worker(new URL('./promo.worker.ts', import.meta.url), { type: 'module' });

const player = new Player(promo, { canvas, worker });
const render = await Render.init({ composition: promo, output, worker });
```

The page still imports the composition, for its size, frame rate and audio. Each worker loads its own copy of
the WebAssembly module and creates its own WebGL2 context. Props are sent to the worker with `postMessage`, so
they must be structured-cloneable: strings, numbers, plain objects, `Blob`s and `File`s work; Mediabunny
`Input`s and assets don't. Pass a `File` and open it inside the composition instead.

Without a bundler, use a `CompositionModule`. The built-in worker imports it by URL:

```ts
const player = new Player(new CompositionModule(new URL('./promo.js', import.meta.url), 'promo'), { canvas });
```

### `CompositionWorker`

The main-thread handle on such a worker, used internally by `Player` and `Render`. `new CompositionWorker(worker)`
wraps an existing `Worker`, and `CompositionWorker.forModule()` starts the built-in one.

---

## CLI

```sh
npx skiamovin render src/promo.ts out.mp4 --props '{"title":"Hi"}' --codec hevc --concurrency auto
npx skiamovin still src/promo.ts thumb.png --timestamp 1.5
npx skiamovin info                      # GPU and codec support on this machine
```

The module must export a `Composition` as `default`, or name one with `--export`.
