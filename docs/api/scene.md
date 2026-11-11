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
  /**
   * Motion blur from a film camera's shutter. `shutter` is the angle in degrees (180 is the usual film look, 360
   * blurs across the whole frame). Each frame averages `samples` moments (default 8) centered on the frame's time,
   * in linear light, so it takes that many times longer to render. Still things stay sharp.
   */
  motionBlur?: { shutter: number; samples?: number };
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
  dash?: number[];                  // dash and gap lengths, like SVG's stroke-dasharray
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

### `math`

```ts
math(tex: string, options?: { fontSize?, color?, display?, write? } & NodeStyle): SceneNode
```

A LaTeX formula, typeset in the Rust core with RaTeX (KaTeX-compatible: fractions, roots, sums, integrals,
matrices, `\color`, `\text` and more) using the KaTeX fonts. Glyph outlines are read straight from the font
files, so formulas are pixel-identical on Node and the web. Each glyph and rule is its own path, so `write`
(0 to 1) draws the formula on like Manim's `Write`: each piece's outline is traced, then filled, with Manim's lag.
The node's size is the formula's size.

```ts
math('\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}', { fontSize: 64, color: '#fff', write: progress })
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

### `transition`

```ts
transition(name: string, progress: number, from: Child, to: Child, options?: { params?, textures? } & NodeStyle): SceneNode
listTransitions(): Promise<TransitionInfo[]>   // name, description, author, license, tags, textures, params
```

Blends between two scenes with a shader from [gl-transitions](https://gl-transitions.com) (all 214, tested to
compile and render). `progress` 0 shows `from` and 1 shows `to`. Names are PascalCase, such as `'CrossZoom'`;
`listTransitions()` lists them with their parameters. The basic film transitions also have plain names:
`'dissolve'` (a cross-fade), `'fade'` (through black, or the `color` param) and `'wipe'`. Two transitions (`LumaWipe`, `DisplacementMap`) also need
an image passed in `textures`. Most transitions are MIT-licensed; each one's license and author are in its info.
In a `series`, set `transition` on an item to blend into the next one, centered on the cut:

```ts
series(ctx, [
  { duration: 3, render: intro, transition: { name: 'Dreamy', duration: 0.8 } },
  { duration: 4, render: features },
])
```

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

## Utility classes

Every node builder takes a `class` string of Tailwind-style utilities, using Tailwind CSS's default theme
(colors, spacing, type scale, radii, shadows and blurs, generated from Tailwind 4.3.5). Keys set directly in the
style win over classes. Unknown classes throw an error that names them.

```ts
box({ class: 'flex flex-col gap-6 p-10 rounded-3xl bg-slate-900/80 border border-slate-700 shadow-2xl' }, [
  text('Revenue grew 42%', { class: 'text-4xl font-bold tracking-tight text-white' }),
])
```

Supported: `flex`/`grid`/`block`/`hidden`, `absolute`/`relative`, flex direction, wrap, grow and shrink,
`items-*`, `justify-*`, `content-*`, `self-*`, `gap-*`, `basis-*`, `grid-cols-*`, `col-span-*`, `w-*`, `h-*`,
`size-*`, `min-*`/`max-*`, `aspect-*`, `p*-*`, `m*-*` (with negatives), `inset-*` and sides, `z-*`, `opacity-*`,
`text-{size}` (with its line height), `text-{color}`, `text-{align}`, `font-{weight}`, `tracking-*`,
`leading-*`, `italic`, `underline`, `line-through`, `bg-{color}` (with `/opacity`), `bg-linear-to-*` with
`from-*`/`via-*`/`to-*`, `rounded*`, `border*`, `shadow-*`, `blur-*`, `backdrop-blur-*`, `mix-blend-*`,
`scale-*`, `rotate-*`, `translate-*`, `origin-*` and arbitrary values such as `w-[123px]` or `bg-[#ff8800]`.
Text classes apply to text nodes. `tw(classes)` returns the style object, and `tailwindTheme` the tokens.

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
  onsets: { time: number; strength: number }[]; // sudden changes, such as drum hits
  tempo: number; // beats per minute, 0 when there's no steady beat
  beats: number[]; // beat times in seconds
}
```

Precomputes loudness, spectrum, onsets and beats so audio-reactive visuals can stay pure. Call it at module scope
with top-level `await`. Onsets come from spectral flux; the tempo from the autocorrelation of onset strength, with a
gentle preference for 120 BPM to settle half and double tempo; beats are placed where onsets line up best. It
assumes a steady tempo.

| Function | What it does |
|---|---|
| `pulse(times, t, decay?)` | Jumps to 1 at each time in `times` (beats, onset times, note starts) and fades over `decay` seconds (default 0.2). Use it for scale or glow on the beat |
| `beatAt(beats, t)` | `{ index, progress }`: which beat `t` is in and how far through it |
| `detectRhythm(samples, sampleRate)` | The same onset, tempo and beat detection for mono samples you already have |
| `parseMidi(bytes)` | Reads a Standard MIDI File into `notes` (`time` and `duration` in seconds, `pitch`, `velocity` 0–1, `channel`, `track`), `tempos`, `trackNames` and `duration`, following tempo changes |

```ts
const song = parseMidi(await readFile('song.mid'));
const kicks = song.notes.filter((n) => n.pitch === 36).map((n) => n.time);
// in render: scale by 1 + 0.2 * pulse(kicks, timestamp)
```

---

## Effects, glass and backgrounds

`effects` on any node applies finishing effects to it and everything inside it, in order:

```ts
box({ effects: [glow({ radius: 24 }), vignette(), grain()] }, [...])
```

| Effect | Description |
|---|---|
| `grain({ amount?, size?, seed?, animated? })` | Film grain, strongest in the midtones, new every frame unless `animated: false`. Seeded, so renders repeat |
| `glow({ radius?, intensity?, threshold? })` | A soft glow around the bright parts |
| `vignette({ amount?, softness?, color? })` | Darker corners |
| `chromaticAberration({ amount? })` | Color fringes toward the edges, in pixels |
| `halftone({ size?, angle? })`, `pixelate({ size? })`, `sharpen({ amount? })` |  |

`glass: true` (or `glass: { blur?, refraction?, edge?, highlight?, dispersion?, tint? }`) turns a node into
frosted glass made from what's behind it, inside its rounded shape: blurred, bent near the edges like a thick
lens, tinted, and lit along the rim.

```ts
box({ size: { width: 560, height: 260 }, borderRadius: 40, glass: true }, [text('Hello', { color: '#fff' })])
```

Outer shadows only show outside a node's shape, as in CSS, so translucent and glass cards don't darken
themselves.

`backgrounds.mesh(colors?)`, `backgrounds.aurora()`, `backgrounds.noise()`, `backgrounds.dots()` and
`backgrounds.grid()` are animated, full-size backgrounds with good defaults. Each takes colors, a speed and
node style.

## Compositing

| Feature | Description |
|---|---|
| `mask`, `maskMode` | Any node can mask another. `maskMode` is `'alpha'` (default), `'luminance'`, `'alpha-inverted'` or `'luminance-inverted'` |
| `clipTo(base, ...layers)` | A clipping mask: layers draw only where `base` is, as in Photoshop. `clipTo(text('SALE'), image(photo))` |
| `adjustmentLayer({ grade?, effects?, blur? }, style?)` | Grades or filters everything beneath it, inside its box (full size by default) |
| `isolate: true` | Draws a node and its children as their own group, so blend modes inside only mix with each other |
| `layerStyle` | Photoshop-style styles that follow the content's shape (text, paths, transparent images): `dropShadow`, `outerGlow`, `innerGlow`, `stroke`, `colorOverlay`, `gradientOverlay` |
| `warp` (text) | Bends text: `{ style: 'arc' \| 'arch' \| 'bulge' \| 'flag' \| 'wave' \| 'rise', bend }`, with `bend` from -1 to 1. `Path.warp()` does the same for any path |

```ts
text('SUMMER', {
  fontSize: 120,
  layerStyle: {
    gradientOverlay: { gradient: linearGradient(180, ['#fde68a', '#f97316']) },
    stroke: { color: '#1e1b4b', width: 4 },
    dropShadow: { offset: [0, 10], blur: 20 },
  },
})
```

## Color grading

Set `grade` on any node to grade it and everything inside it. Grades apply in order, and each takes a `strength`
from 0 to 1 that can be animated.

```ts
const film = new LutAsset(new UrlSource('/luts/film.cube'));

box({ grade: [lut(film, { strength: 0.8 }), adjust({ contrast: 0.15, vibrance: 0.2, fade: 0.1 })] }, [...])
```

| Function | Description |
|---|---|
| `lut(asset, { interpolation?, strength? })` | A 3D LUT. Tetrahedral interpolation by default (the method the `.cube` spec recommends); output matches ffmpeg's `lut3d` within 2/255 |
| `adjust({ exposure, brightness, contrast, saturation, vibrance, warmth, tint, highlights, shadows, fade })` | Photo-editor adjustments. Exposure is in stops and applied in linear light |
| `curves({ rgb, red, green, blue })` | Tone curves through `[input, output]` points, smoothed without overshoot |
| `levels({ inBlack, inWhite, gamma, outBlack, outWhite })` | Input and output levels |
| `gradeWheels({ lift, gamma, gain, offset })` | Grading wheels, as numbers or `[r, g, b]` |
| `cdl({ slope, offset, power, saturation })` | An ASC CDL grade |
| `gradientMap(stops)` | Colors by brightness; two stops make a duotone |
| `channelMixer({ red, green, blue })`, `posterize(levels)`, `threshold(level)` |  |
| `blendGrades(from, to, t)` | Blends two looks, for changing the grade across a scene |

`LutAsset(source, { layout? })` loads `.cube` files (3D, or 1D expanded to 3D, with `DOMAIN_MIN`/`DOMAIN_MAX`
and Resolve's input ranges) and LUT images: square grids of slices (such as 512×512 with 64 slices), horizontal
strips and Hald images (`layout: 'hald'`). `parseCube(text)` exposes the parser. Grades work on unpremultiplied
color, and LUTs are stored as half floats so 8-bit banding doesn't creep in.

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

### `scatter` and `lookAt`

```ts
scatter(40, { area: { width: 1920, height: 1080 }, spacing: 80, seed: 'stars' }).map((p) =>
  box({ position: 'absolute', inset: { left: p.x, top: p.y }, size: { width: 4, height: 4 }, opacity: p.random }),
);
```

`scatter(count, options)` returns seeded positions for copies, as Blender's scattering and array modifiers do:
random points in an `area` (at least `spacing` apart when possible), evenly along a `path`, or on a `grid` with
`columns`. Each point has `x`, `y`, `index`, `angle` (the path's direction, or a random angle) and a seeded
`random` number for varying copies. `lookAt(from, to)` is the rotation in degrees that points from one point to
another.

### `stroke`

```ts
stroke('M20 200 C120 20 220 260 320 120', { size: 16, taper: [40, 90], color: '#1e293b', draw: t });
stroke(points, { size: 12 }); // [x, y] or [x, y, pressure] points
```

A hand-drawn stroke, like a brush in a drawing app, from [perfect-freehand](https://github.com/steveruizok/perfect-freehand)
(MIT). Its width follows pressure (the third number of each point) or, without pressure, drawing speed, and its
ends can taper. Give it points, a `Path` or SVG path data to draw along. `draw` reveals it from 0 to 1 as if being
drawn. Options: `size` (default 8), `thinning`, `smoothing`, `streamline` (0.5 each), `taper` (pixels, or
`[start, end]`) and `color`.

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

### Motion that follows layout

| Feature | Description |
|---|---|
| `layoutId` (style) | When the node's layout box changes, it springs from where it was to where layout puts it, instead of jumping. Two nodes with the same `layoutId` in different sequences move into each other across the cut. `layoutTransition` sets the spring (default `springs.smooth`) |
| `states(timestamp, { variants, changes, spring? })` | Named states switched at given times, with springs between them (colors blend). Like Motion's variants |
| `sequence({ start, end, exit })` | Keeps content for `exit` seconds after `end`, with `ctx.exit` rising from 0 to 1, for exit animations |
| `sequence({ ..., time })` | Maps time inside a sequence, for speed ramps, freezes and reverse |
| `video(media, { speed })` | A speed curve for ramps (`(t) => ...`); the source position is its integral. Audio from such a clip is muted |
| `composition.withSize(w, h)` | The same composition laid out again at another size, for 16:9, 9:16 and 1:1 versions |

Layout animation is a pure function of time: the renderer computes layout for earlier frames when it needs
them (and reuses them when rendering in order), so any frame renders the same in any order or worker.

```ts
render: (ctx) => box({ class: 'flex flex-row', justifyContent: ctx.timestamp < 1 ? 'flex-start' : 'flex-end' }, [
  box({ class: 'size-10 bg-white rounded-lg', layoutId: 'dot' }),
])
```

### Physics-based motion

Springs, momentum and simple dynamics in the style of Apple's interfaces. All are solved exactly from the
timestamp.

```ts
spring({ timestamp, from?, to?, delay?, response?, bounce?, velocity?, mass?, stiffness?, damping?, duration? }): number
spring.velocity(options): number
springs.smooth | springs.snappy | springs.bouncy | springs.interactive | springs.system   // { response, bounce }
springConstants({ response, bounce } | { mass?, stiffness, damping }): { omega, zeta, stiffness, damping, mass }
springSettlingTime(params, epsilon?): number
Easing.spring(params): EasingFunction
```

`response` and `bounce` use SwiftUI's formula: stiffness = (2π / response)², damping ratio = 1 − bounce, mass 1.
`springs.*` are SwiftUI's presets: `spring({ timestamp, ...springs.snappy })`.

| Function | Description |
|---|---|
| `springPath({ timestamp, from, targets: [{ at, to }], spring?, velocity?, mode? })` | A value whose target changes over time, without jumps. `mode: 'add'` (default) adds a spring per change, like UIKit; `'merge'` carries position and speed, like SwiftUI. Returns `[value, velocity]` |
| `decay({ timestamp, from, velocity, rate? })` | Glides to a stop like an iOS scroll view (`rate` 0.998 per ms, or `decelerationRates.fast`) |
| `projectedEnd(from, velocity, rate?)`, `decayDuration(velocity, rate?, minSpeed?)` | Where and when a fling stops |
| `rubberBand(offset, limit, constant?)` | Resistance past an edge, with iOS's commonly used 0.55 constant (reverse engineered; Apple doesn't publish it) |
| `fling({ timestamp, from, velocity, snap?, bounds?, spring? })` | A released fling that snaps to the nearest page or point, or glides and springs back from an edge |
| `fall({ timestamp, from, velocity?, gravity?, floor?, elasticity? })` | Gravity in UIKit Dynamics units (1 = 1000 per second²), bouncing on a floor |
| `attachmentSpring(frequency, damping?)`, `snapSpring(damping?)` | Spring settings matching UIKit's attachment and snap behaviors |
| `gesture(points)` | A scripted drag through `{ t, x, y }` points, with the release speed to pass to `fling` |
| `motions.sheetUp`, `sheetDown`, `notificationDrop`, `press`, `pop` | Familiar iOS motions as functions of time |

Collisions between bodies come with the physics engine (see the [roadmap](../roadmap.md)).

### 2D physics: `physics`

```ts
const world = physics({
  bodies: [
    { type: 'fixed', shape: { kind: 'box', width: 1920, height: 40 }, x: 960, y: 1060 },
    { id: 'ball', shape: { kind: 'circle', radius: 40 }, x: 960, y: 0, restitution: 0.7 },
  ],
  duration: 6,
});
const { x, y, angle } = world.body('ball', ctx.timestamp);
```

Rigid bodies (`circle`, `box` with optional rounded corners, `capsule`, convex `polygon`, `segment`), joints
(`revolute`, `fixed`, `prismatic`, `rope`, `spring`), gravity, bounciness, friction, density, damping, sensors and
continuous collision detection. Lengths are pixels and angles degrees.

The world is simulated once with Rapier in the Rust core and cached by its description, so calling `physics()`
from `render` every frame is cheap, and frames look positions up by time (`body`, `all`). `world.contacts` and
`contactsUntil(t, body?)` list when bodies started and stopped touching. Rapier runs in its deterministic mode, and
a test checks the Node and WebAssembly builds give exactly the same positions.

### Type as shapes and variable fonts

```ts
textPaths('Hello', {
  fontSize: 160,
  each: (g) => path(g.path, { stroke: '#fff', fill: null, trim: { end: t * 2 - g.index * 0.1 } }),
});
variableText('Breathe', (u) => ({ wght: 550 + 350 * Math.sin(t * 3 - u.index * 0.5) }), { fontSize: 120 });
fitText('HEADLINE', { width: 1600, range: [30, 150], fontSize: 200 });
```

| Function | What it does |
|---|---|
| `textPaths(text, { by?, width?, each?, ...textProps })` | Text as vector shapes, one per character (`'chars'`, the default), word, line or `'all'`. `each(glyph)` turns a piece into nodes; it gets `path`, `text`, `index`, `count`, `center` and `color`. Pieces are shaped and placed exactly like a text node, so you can outline, draw on, distort, fill with a shader or morph them |
| `variableText(text, axes, options)` | Text whose variable font axes change per character (or word with `by: 'words'`). Each character is shaped with its own values, so wider or bolder letters push the others along |
| `fitText(text, { width, axis?, range, ...textProps })` | Sets a variable font axis (`wdth` by default) so the text fills `width` exactly, staying within `range` |
| `fontAxes(fontAsset)` | The font's axes with their `min`, `def` and `max`, once it has loaded (composition fonts load before the first frame) |

### `captions`

```ts
const srt = await readFile('talk.srt', 'utf8');
captions(srt, { preset: 'pop', position: 'absolute', inset: { left: 80, right: 80, bottom: 200 } });
```

Captions for the current time, from the text of an SRT or WebVTT file or from a list of cues. The box centers its
text and is empty when no cue is showing.

| Preset | What it shows |
|---|---|
| `'subtitle'` (default) | The whole line on a dark rounded box, like film subtitles |
| `'karaoke'` | The whole line, with words lighting up in the accent color as they're spoken |
| `'pop'` | Words appear as they're spoken with a quick spring, the current one in the accent color |
| `'word'` | One large word at a time |

Options: `time` (default: the current time of the composition or sequence), `offset` in seconds, `fontSize`,
`fontFamily`, `fontWeight`, `color`, `accent`, `uppercase` (on for `pop` and `word`) and `maxWidth`.

| Function | What it does |
|---|---|
| `parseCaptions(text)` | Reads SRT or WebVTT into cues. Tags are removed, and WebVTT word timings (`<00:00:01.200>word`) are kept |
| `cuesFromWords(words, { maxChars?, maxDuration?, gap? })` | Groups timed words, such as speech recognition output, into cues. A cue ends after 32 characters, 3 seconds, a 0.6 second pause or the end of a sentence |

Without word timings, words are spread over their cue by length.

### `code`

```ts
code(after, {
  from: before,
  progress: interpolate(t, [1, 2], [0, 1]),
  language: 'rust',
  highlight: [[3, 5]],
  lineNumbers: true,
});
```

A code block highlighted by [Shiki](https://shiki.style) (MIT) with VS Code grammars and themes. With `from` and
`progress`, it changes from one version of the code to the next, as in Motion Canvas: removed tokens fade out,
kept tokens move to their new places, and added tokens fade in, while the block resizes.

| Option | What it does |
|---|---|
| `language` | Any language Shiki knows. Default `'ts'` |
| `theme` | Any Shiki theme. Default `'github-dark-default'` |
| `fontSize`, `fontFamily`, `lineHeight`, `tabSize` | Default 28 pixels, the composition's first font, 1.5 and 2. Use a monospace font |
| `from`, `progress` | The previous version, and how far along the change is (0 to 1) |
| `highlight` | Lines to bring forward, as numbers or `[first, last]` ranges. The others are dimmed |
| `lineNumbers` | Shows line numbers |

Without a background or padding of its own, the block sits on a rounded card in the theme's background color.
Shiki and each language load the first time they are used. It uses Shiki's JavaScript regex engine, so it needs no
WebAssembly of its own and works the same on Node and the web.

### `diagram`

```ts
diagram('flowchart LR\n  A[Idea] --> B{Good?}\n  B -->|yes| C(Video)', {
  fontSize: 28,
  draw: interpolate(t, [0, 2], [0, 1]),
  styles: { C: { transform: { scale: 1.1 } } },
});
```

A Mermaid diagram. [Pele](https://github.com/obsidianmd/pele) (MIT) lays it out: flowcharts, sequence, class,
state, ER, pie, Gantt, mind maps and the other types Pele supports. Labels are measured with the composition's
fonts, the same way text nodes are drawn, so they fit their boxes. The result is drawn with path and text nodes,
not as an image.

| Option | What it does |
|---|---|
| `theme` | `'dark'` (default), `'light'`, or your own colors (`background`, `foreground`, `line`, `surface`, `border`, `accent`, `series` and more), plus `radius` and `lineWidth`. `diagramThemes` holds the two built-in themes |
| `fontSize` | Base text size in pixels. Default 20 |
| `fontFamily`, `monoFamily` | Fonts for labels and for code. Default: the composition's first font |
| `draw` | 0 to 1. Nodes appear in order, and each edge is traced from the node it leaves to the node it enters |
| `styles` | Styles by id, such as `{ B: { opacity: 0.3 } }`. Node ids are the Mermaid ids; edges use the ids Pele gives them |

Pele is loaded the first time a diagram is drawn, so it costs nothing when unused. Each diagram is laid out once
per renderer and reused, and the Node and WebAssembly builds draw it the same way.

### Film camera: `shot`, `cameraMove`, `handheld` and `edit`

```ts
const view = { width: 1920, height: 1080 };
const wide = shot(stage, 'wide', view);
const close = shot(hero, 'closeUp', view, { place: 'left' });
const cam = handheld(cameraMove([{ time: 0, camera: wide }, { time: 3, camera: close }], t), t);
camera(cam, view, [scene]);
```

| Function | What it does |
|---|---|
| `shot(subject, size, viewport, { place?, headroom? })` | Camera state for a standard shot of a rectangle framed like a standing person: `'wide'`, `'long'`, `'full'`, `'medium'`, `'closeUp'` or `'extremeCloseUp'`. Closer shots keep the top (the face). `place: 'left'` or `'right'` puts the subject on that third line, leaving look room |
| `cameraMove(keys, t, easing?)` | The camera during a move through `{ time, camera }` keys: pan, tilt, dolly and zoom. Eases in and out by default, and zooms evenly in scale |
| `handheld(state, t, { amount?, seed? })` | Adds a handheld camera's slow drift and small shake from seeded noise. 1 is a steady operator, 3 is running |
| `edit(cuts, t)` | Picks a camera from `{ time, camera }` cuts, like an edit list over several cameras on one scene |

### Graphs, camera and reveals

```ts
const ax = axes({ x: [-3, 3, 1], y: [-1, 9, 2], width: 900, height: 600, draw: t });
ax.view(ax.plot((x) => x * x, { color: '#38bdf8', draw: t - 0.5 }), ax.dot(2, 4));
```

| Function | What it does |
|---|---|
| `axes({ x, y, width, height, color?, ticks?, labels?, draw? })` | Number axes like Manim's `Axes`. Ranges are `[min, max, step?]`; ticks and labels follow the step. `toPoint(x, y)` maps graph coordinates to pixels |
| `ax.view(...children)` | The axes with plots and dots on top, in a box the size of the plotting area |
| `ax.plot(fn, { color?, strokeWidth?, samples?, domain?, draw? })` | The graph of a function, drawn on with `draw` |
| `ax.dot`, `ax.line`, `ax.vectorField` | A point, a line (optionally dashed) and a field of arrows, in graph coordinates |
| `numberLine({ range, width, labels?, draw? })` | Axes with only an x axis |
| `camera({ x, y, zoom?, rotate? }, viewport, children)` | Looks at the children through a camera that pans, zooms and rotates. Animate the state to move it |
| `fitCamera(rect, viewport, margin?)` | Camera state that frames a rectangle |
| `fadeIn(node, p, { shift? })`, `indicate(node, p, { scale?, color? })`, `create(node, p)` | Manim's reveal animations as functions of progress. `create` traces paths, types text and fades in the rest |

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
    /**
     * Normalize the mix to this integrated loudness (LUFS, ITU-R BS.1770 / EBU R128), such as −14 for YouTube or
     * −23 for broadcast. The mix is measured first, then one gain is applied, lowered if needed so sample peaks stay
     * at or below −1 dBFS.
     */
    loudness?: number;
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

`deliveryPresets` holds settings for common destinations, to spread into the options:
`Render.init({ composition, output, ...deliveryPresets.youtube })`. `youtube` and `broadcast` are 1920×1080,
`instagram` and `tiktok` are 1080×1920; all use H.264 and AAC at 48 kHz, normalized to −14 LUFS (−23 for
`broadcast`). `LoudnessMeter` measures integrated loudness and sample peak of audio you feed it.

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
