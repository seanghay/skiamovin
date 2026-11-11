# The Skia API

Skiamovin's core is a complete binding of Skia that follows [`skia-safe`](https://rust-skia.github.io/doc/skia_safe/)'s
structure and names. This guide covers the model. The [API reference](../api/core.md) lists the details.

## The model

```
Surface ──canvas()──▶ Canvas ──draw*(geometry, Paint)──▶ pixels
                                       │
                         Paint = color/shader + style + filters + blend
```

- A **Surface** owns pixels: CPU memory (raster) or a GPU texture.
- A **Canvas** records draw calls into a surface. It has a transform matrix and a clip stack.
- A **Paint** says _how_ to draw: fill or stroke, color or shader, anti-aliasing, blend mode, filters.
- Geometry (`Rect`, `RRect`, `Path`, text, images) says _what_ to draw.

## A first frame

```ts
import { init, surfaces, Paint, PaintStyle, Rect, RRect, Path, Color } from 'skiamovin';
import { writeFile } from 'node:fs/promises';

await init();

using surface = surfaces.rasterN32Premul([800, 450])!;
const canvas = surface.canvas();
canvas.clear('#101418');

using fill = new Paint().setAntiAlias(true).setColor('#7c5cff');
canvas.drawRRect(RRect.newRectXY(Rect.fromXYWH(80, 80, 300, 200), 24, 24), fill);

using stroke = new Paint().setAntiAlias(true).setStyle(PaintStyle.Stroke).setStrokeWidth(8).setColor(Color.WHITE);
using wave = new Path().moveTo([420, 225]).cubicTo([520, 60], [620, 390], [720, 225]);
canvas.drawPath(wave, stroke);

await writeFile('frame.png', surface.encodeToData()!.asBytes());
```

## Reading `skia-safe` docs as Skiamovin docs

Because the names map one-to-one, `skia-safe`'s rustdoc doubles as a reference. Translate with these rules:

| You see in `skia-safe` | You write in Skiamovin |
|---|---|
| `Paint::default()` | `new Paint()` |
| `paint.set_anti_alias(true)` | `paint.setAntiAlias(true)` |
| `Rect::from_xywh(0.0, 0.0, 10.0, 10.0)` | `Rect.fromXYWH(0, 0, 10, 10)` |
| `canvas.draw_circle((50, 50), 20.0, &paint)` | `canvas.drawCircle([50, 50], 20, paint)` |
| `surfaces::raster_n32_premul((w, h))` | `surfaces.rasterN32Premul([w, h])` |
| `gradient_shader::linear(...)` / `Shader::linear_gradient(...)` | `Shader.linearGradient(...)` |
| `image_filters::blur((4.0, 4.0), None, None, None)` | `imageFilters.blur([4, 4])` |
| `Option<T>` return | `T \| null`. Check it or use `!` |
| `Result<T, E>` return | `T`, or a thrown `SkiaError` |

The full mapping is in [API conventions](../api/README.md#conventions).

## Transforms and save/restore

The canvas has a current matrix and clip. `save()` pushes them, `restore()` pops:

```ts
canvas.save();
canvas.translate([cx, cy]);
canvas.rotate(angle);
canvas.scale([s, s]);
canvas.drawRect(Rect.fromXYWH(-50, -50, 100, 100), paint); // drawn centered and rotated
canvas.restore();
```

`saveLayer` also starts an offscreen layer that's composited when you restore. Use it for group opacity, group
blend modes, and filters applied to several draws at once:

```ts
using fade = new Paint().setAlphaf(0.5);
canvas.saveLayer({ paint: fade });
drawComplexThing(canvas); // overlapping parts don't double-blend
canvas.restore();
```

For 3D (perspective cards, flips), use `M44`:

```ts
canvas.concat44(M44.perspective(1, 3000, Math.PI / 4).postConcat(M44.rotate([0, 1, 0], angle)));
```

## Images

```ts
const logo = await Image.fromPath('./logo.png'); // Node
const photo = images.deferredFromEncodedData(await (await fetch(url)).bytes())!; // anywhere

canvas.drawImageRectWithSamplingOptions(
  photo,
  null,
  Rect.fromXYWH(0, 0, 1920, 1080),
  SamplingOptions.cubic(CubicResampler.mitchell()), // high-quality scaling
  paint,
);
```

On a GPU surface, raster images are uploaded on first draw and cached. Call
`images.textureFromImage(context, img)` ahead of time to upload eagerly so the first frame doesn't stall.
See [Images and SVG](images-and-svg.md).

## Reuse objects across frames

Creating `Paint`, `Path` and `Shader` objects is cheap but not free. In frame loops:

- Create paints, fonts and static shaders **once**, outside the loop.
- Use `using` (or `.delete()`) for anything you create per frame.
- Record static content into a `Picture` once and draw it every frame.

```ts
const recorder = new PictureRecorder();
drawStaticBackground(recorder.beginRecording(Rect.fromWH(W, H)));
const background = recorder.finishRecordingAsPicture()!;

for (let f = 0; f < frames; f++) {
  canvas.drawPicture(background);
  drawAnimatedParts(canvas, f);
}
```

## Mixing with the scene layer

Inside a composition, the [`draw`](../api/scene.md#draw) node gives you this canvas, already translated and
clipped to the node's laid-out box:

```ts
draw(
  (canvas, { width, height }) => {
    canvas.drawCircle([width / 2, height / 2], Math.min(width, height) / 2, paint);
  },
  { flexGrow: 1 },
);
```
