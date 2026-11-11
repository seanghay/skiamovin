# `skiamovin`: core Skia

```ts
import {
  init,
  // types
  Surface,
  Canvas,
  Paint,
  Path,
  PathBuilder,
  Image,
  Picture,
  PictureRecorder,
  Data,
  Font,
  FontMgr,
  Typeface,
  TextBlob,
  Shader,
  ColorFilter,
  ImageFilter,
  MaskFilter,
  PathEffect,
  RuntimeEffect,
  Matrix,
  M44,
  Rect,
  IRect,
  RRect,
  Color,
  Color4f,
  ColorSpace,
  ImageInfo,
  // enums
  PaintStyle,
  BlendMode,
  TileMode,
  ClipOp,
  FilterMode,
  MipmapMode,
  StrokeCap,
  StrokeJoin,
  ColorType,
  AlphaType,
  EncodedImageFormat,
  FontStyle,
  PathFillType,
  // namespaces
  surfaces,
  images,
  imageFilters,
  colorFilters,
  maskFilters,
  pathEffects,
  shaders,
  gpu,
  textlayout,
  skottie,
  svg,
  pdf,
} from 'skiamovin';
```

This page covers the types used most often in video work. Every other type and method follows
[`skia-safe`](https://rust-skia.github.io/doc/skia_safe/) through the [naming conventions](README.md#conventions).

---

## `init`

```ts
function init(options?: InitOptions): Promise<void>;

interface InitOptions {
  /** Web only. URL of the WASM binary. Defaults to the bundled asset. */
  wasmUrl?: string | URL;
  /** Web only. Force the threaded or single-threaded build. Defaults to `crossOriginIsolated`. */
  threads?: boolean;
  /** Node only. Call `registerNativeCodecs()` for you. Default `true`. See media.md. */
  registerNativeCodecs?: boolean;
}
```

Initializes the library. **Required in the browser before using the Skia layer directly. On Node it only registers codecs.**
`Render`, `CompositionSink` and `Player` call it for you. Calling
it more than once is safe and returns the same promise.

---

## `surfaces`

CPU raster surfaces. For GPU surfaces, see [`gpu.surfaces`](gpu.md#gpusurfaces).

| Function | Description |
|---|---|
| `surfaces.raster(info: ImageInfo, rowBytes?: number, props?: SurfaceProps): Surface \| null` | Raster surface with the given pixel format |
| `surfaces.rasterN32Premul(size: [w, h]): Surface \| null` | 8-bit RGBA/BGRA premultiplied, the usual choice |
| `surfaces.wrapPixels(info: ImageInfo, pixels: Uint8Array, rowBytes?: number): Surface \| null` | Draw directly into your own buffer |
| `surfaces.null(size: [w, h]): Surface \| null` | Draws nothing. Useful for measuring |

## `Surface`

| Member | Description |
|---|---|
| `canvas(): Canvas` | The canvas that draws into this surface. The same `Canvas` object is returned each time |
| `width(): number`, `height(): number` | Dimensions in pixels |
| `imageInfo(): ImageInfo` | Pixel format |
| `imageSnapshot(): Image` | Immutable snapshot (copy-on-write, so cheap if you keep drawing) |
| `readPixels(info: ImageInfo, dst: Uint8Array, rowBytes: number, srcPoint?: [x, y]): boolean` | Copy pixels to CPU memory. For GPU surfaces this waits for the GPU |
| `readPixelsAsync(info?: ImageInfo): Promise<Uint8Array>` | Non-blocking readback. Preferred for GPU surfaces |
| `recordingContext(): gpu.RecordingContext \| null` | The GPU context, or `null` for raster |
| `flushAndSubmit(): void` | Send pending GPU work. Not needed for raster surfaces |
| `encodeToData(format?: EncodedImageFormat, quality?: number): Data \| null` | Encode the current contents as PNG, JPEG or WebP |

## `Canvas`

Every `draw*`, transform and clip method from `skia_safe::Canvas` is available. The ones you'll use most:

```ts
// state
save(): number
saveLayer(rec: SaveLayerRec | { bounds?: Rect, paint?: Paint }): number
saveLayerAlpha(bounds: Rect | null, alpha: number): number
restore(): void
restoreToCount(count: number): void

// transforms
translate(d: [dx, dy]): void
scale(s: [sx, sy]): void
rotate(degrees: number, pivot?: [x, y]): void
skew(k: [kx, ky]): void
concat(m: Matrix): void
concat44(m: M44): void
setMatrix(m: M44): void
resetMatrix(): void
localToDevice(): M44

// clips
clipRect(rect: Rect, op?: ClipOp, antiAlias?: boolean): void
clipRRect(rrect: RRect, op?: ClipOp, antiAlias?: boolean): void
clipPath(path: Path, op?: ClipOp, antiAlias?: boolean): void
clipShader(shader: Shader, op?: ClipOp): void

// drawing
clear(color: Color): void
drawColor(color: Color, mode?: BlendMode): void
drawPaint(paint: Paint): void
drawRect(rect: Rect, paint: Paint): void
drawRRect(rrect: RRect, paint: Paint): void
drawDRRect(outer: RRect, inner: RRect, paint: Paint): void
drawCircle(center: [x, y], radius: number, paint: Paint): void
drawOval(rect: Rect, paint: Paint): void
drawArc(oval: Rect, startAngle: number, sweepAngle: number, useCenter: boolean, paint: Paint): void
drawLine(p0: [x, y], p1: [x, y], paint: Paint): void
drawPoints(mode: PointMode, points: [x, y][], paint: Paint): void
drawPath(path: Path, paint: Paint): void
drawImage(image: Image, leftTop: [x, y], paint?: Paint): void
drawImageWithSamplingOptions(image: Image, leftTop: [x, y], sampling: SamplingOptions, paint?: Paint): void
drawImageRect(image: Image, src: Rect | null, dst: Rect, paint: Paint): void
drawImageRectWithSamplingOptions(image: Image, src: Rect | null, dst: Rect, sampling: SamplingOptions, paint: Paint): void
drawImageNine(image: Image, center: IRect, dst: Rect, filter: FilterMode, paint?: Paint): void
drawStr(text: string, origin: [x, y], font: Font, paint: Paint): void
drawTextBlob(blob: TextBlob, origin: [x, y], paint: Paint): void
drawGlyphsAt(glyphs: number[], positions: [x, y][], origin: [x, y], font: Font, paint: Paint): void
drawPicture(picture: Picture, matrix?: Matrix, paint?: Paint): void
drawVertices(vertices: Vertices, mode: BlendMode, paint: Paint): void
drawAtlas(atlas: Image, xform: RSXform[], tex: Rect[], colors: Color[] | null, mode: BlendMode, sampling: SamplingOptions, cull: Rect | null, paint?: Paint): void
```

## `Paint`

```ts
const paint = new Paint(); // Paint::default()
const red = new Paint(Color4f.fromColor(Color.RED));
```

| Method | Notes |
|---|---|
| `setColor(color: Color)` / `setColor4f(c: Color4f, cs?: ColorSpace)` |  |
| `setAlphaf(a: number)` | 0–1 |
| `setAntiAlias(aa: boolean)` | Off by default, as in Skia. Turn it on for shapes |
| `setStyle(style: PaintStyle)` | `Fill`, `Stroke`, `StrokeAndFill` |
| `setStrokeWidth(w)`, `setStrokeCap(cap)`, `setStrokeJoin(join)`, `setStrokeMiter(limit)` |  |
| `setShader(s: Shader \| null)` | Gradients, images, runtime effects |
| `setColorFilter(f)`, `setImageFilter(f)`, `setMaskFilter(f)`, `setPathEffect(e)` |  |
| `setBlendMode(mode: BlendMode)` / `setBlender(b: Blender)` |  |
| `setDither(d: boolean)` | Turn on for gradients in 8-bit video to reduce banding |

Every setter returns the `Paint`, so calls can be chained, as with `&mut Self` in `skia-safe`:

```ts
const stroke = new Paint().setAntiAlias(true).setStyle(PaintStyle.Stroke).setStrokeWidth(4).setColor('#7c5cff');
```

## `Path` and `PathBuilder`

```ts
const path = new Path().moveTo([0, 0]).lineTo([100, 0]).cubicTo([150, 50], [50, 150], [100, 200]).close();

const fromSvg = Path.fromSVG('M10 10 L90 90 Z'); // utils::parse_path::from_svg
const trim = pathEffects.trim(0, 0.5); // draw only the first half: handy for line-draw animations
const measure = new ContourMeasureIter(path, false); // length, position and tangent along the path
```

`Path.interpolate(a, b, t)` interpolates between two paths with compatible verbs (`Path::interpolate`). Use it
for morphing.

## `Image` and `images`

| Function | Description |
|---|---|
| `images.deferredFromEncodedData(data: Uint8Array \| Data): Image \| null` | Decodes lazily, on first draw (PNG, JPEG, WebP, GIF, BMP, ICO, WBMP, AVIF, HEIF where the OS supports it) |
| `images.rasterFromData(info, data, rowBytes): Image \| null` | Wraps raw pixels |
| `images.rasterFromPixels(info, pixels, rowBytes): Image \| null` | Copies raw pixels |
| `images.textureFromImage(context, image, mipmapped?, budgeted?): Image \| null` | Uploads to the GPU |
| `Image.fromPath(path: string): Promise<Image>` | Node only: reads and decodes a file |
| `Image.fromUrl(url: string \| URL): Promise<Image>` | Fetches and decodes (Node 20+ and web) |

`Image` methods: `width()`, `height()`, `dimensions()`, `isTextureBacked()`, `makeShader(tmx?, tmy?, sampling?, localMatrix?)`,
`makeSubset(context, rect)`, `makeRasterImage()`, `makeTextureImage(context, mipmapped?)`,
`readPixels(...)`, `encode(context, format, quality)`.

## `Shader` and `shaders`

```ts
Shader.linearGradient(points: [[x,y],[x,y]], colors: Color[] | Color4f[], positions: number[] | null, mode: TileMode, flags?, localMatrix?): Shader | null
Shader.radialGradient(center, radius, colors, positions, mode, flags?, localMatrix?): Shader | null
Shader.twoPointConicalGradient(start, startRadius, end, endRadius, colors, positions, mode, flags?, localMatrix?): Shader | null
Shader.sweepGradient(center, colors, positions, mode, angles?, flags?, localMatrix?): Shader | null

shaders.color(c: Color): Shader
shaders.blend(mode: BlendMode, dst: Shader, src: Shader): Shader
shaders.fractalNoise(baseFreq: [fx, fy], numOctaves: number, seed: number, tileSize?): Shader | null
shaders.turbulence(baseFreq, numOctaves, seed, tileSize?): Shader | null
shaders.image(image, tmx, tmy, sampling, localMatrix?): Shader | null
```

## `RuntimeEffect`

SkSL runtime effects. See the [shaders guide](../guides/shaders.md).

```ts
RuntimeEffect.makeForShader(sksl: string): RuntimeEffect      // throws SkiaError with the compiler message
RuntimeEffect.makeForColorFilter(sksl: string): RuntimeEffect
RuntimeEffect.makeForBlender(sksl: string): RuntimeEffect

effect.uniforms(): Uniform[]                 // { name, type, offset, count }
effect.children(): Child[]                   // { name, type, index }
effect.makeShader(uniforms: Record<string, number | number[]> | Float32Array, children?: Record<string, Shader | ColorFilter | Blender> | (Shader | null)[], localMatrix?: Matrix): Shader
effect.makeColorFilter(uniforms, children?): ColorFilter
effect.makeBlender(uniforms, children?): Blender
```

Unlike `skia-safe`, which takes a uniform byte buffer, `makeShader` also accepts an object keyed by uniform
name. Skiamovin packs it for you using the layout from `uniforms()`.

## `imageFilters`

Mirrors `skia_safe::image_filters`. Common ones:

```ts
imageFilters.blur(sigma: [sx, sy], tileMode?: TileMode, input?: ImageFilter, cropRect?: Rect): ImageFilter | null
imageFilters.dropShadow(offset: [dx, dy], sigma: [sx, sy], color: Color, input?, cropRect?): ImageFilter | null
imageFilters.dropShadowOnly(offset, sigma, color, input?, cropRect?): ImageFilter | null
imageFilters.colorFilter(cf: ColorFilter, input?, cropRect?): ImageFilter | null
imageFilters.displacementMap(channels: [ColorChannel, ColorChannel], scale: number, displacement: ImageFilter, color?: ImageFilter, cropRect?): ImageFilter | null
imageFilters.matrixTransform(m: Matrix, sampling: SamplingOptions, input?): ImageFilter | null
imageFilters.runtimeShader(builder: RuntimeShaderBuilder, childName: string, input?): ImageFilter | null
imageFilters.compose(outer: ImageFilter, inner: ImageFilter): ImageFilter | null
imageFilters.merge(filters: (ImageFilter | null)[], cropRect?): ImageFilter | null
```

## Fonts

```ts
const fontMgr = FontMgr.default(); // system fonts on Node, bundled fallback set on web
const typeface = fontMgr.newFromData(await readFile('Inter.ttf'));
const font = new Font(typeface, 48);
font.setEdging(FontEdging.SubpixelAntiAlias);
const [advance, bounds] = font.measureStr('Hello', paint);
```

For multi-line, styled or bidirectional text use [`textlayout`](textlayout.md).

> **Web:** browsers don't expose system font files, so `FontMgr.default()` on the web contains only the
> bundled fallback fonts (Noto Sans and Noto Color Emoji subsets). Load your own fonts with `newFromData`, or
> register them with `TypefaceFontProvider`.

## Recording: `PictureRecorder` and `Picture`

Recording lets you replay a drawing many times, for example a static background on every frame, or across
threads after serializing it:

```ts
const recorder = new PictureRecorder();
const canvas = recorder.beginRecording(Rect.fromWH(1920, 1080));
drawBackground(canvas);
const background = recorder.finishRecordingAsPicture()!;

// per frame
frameCanvas.drawPicture(background);

// serialize to another worker
const bytes = background.serialize();
const again = Picture.fromData(bytes);
```

## `pdf`

`pdf.newDocument(stream, metadata?)` creates multi-page PDFs (`skia_safe::pdf`). It's handy for exporting
storyboards of frames.

## `ColorSpace` and HDR

Surfaces default to sRGB. For wide-gamut or HDR output, create the surface with `ColorSpace.newRGB(...)`
(Display P3, Rec. 2020, PQ, HLG) and an `F16` or `RGBA1010102` color type, and encode with a 10-bit codec
profile. See [Rendering → color](../guides/rendering.md#color-and-hdr).
