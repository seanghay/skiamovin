# `skiamovin` › `skottie` and `svg`

> **Status:** Skottie isn't in the current build: the prebuilt Skia binaries for macOS and WebAssembly don't
> include it. The `skottie` API below is the planned design. `svg` is implemented. See [status](../status.md).

```ts
import { skottie, svg } from 'skiamovin';
```

## `skottie`

Skottie is Skia's native Lottie player. It renders After Effects animations exported with Bodymovin, with
deterministic per-frame seeking.

### Loading

```ts
// Simple
const anim = skottie.Animation.fromString(json); // throws SkiaError on invalid JSON
const anim2 = skottie.Animation.fromBytes(bytes);

// With fonts, images and property overrides
const anim3 = new skottie.AnimationBuilder()
  .setFontManager(fontMgr)
  .setResourceProvider(skottie.ResourceProvider.fromDirectory('./lottie/')) // Node
  .setPropertyObserver(observer)
  .setMarkerObserver(markers)
  .make(json);
```

| Resource provider | Description |
|---|---|
| `ResourceProvider.fromDirectory(dir)` | Node. Resolves `assets[].p` relative to `dir` |
| `ResourceProvider.fromUrl(base)` | Fetches relative to a base URL. Call `await provider.preload(json)` before `make` |
| `ResourceProvider.fromMap({ 'img_0.png': bytes, ... })` | Pre-loaded bytes |
| `ResourceProvider.dataUri()` | Embedded base64 assets only. This is the default |

### `skottie.Animation`

| Member | Description |
|---|---|
| `duration(): number` | Seconds |
| `fps(): number` |  |
| `inPoint()`, `outPoint(): number` | Frames |
| `size(): [w, h]` |  |
| `version(): string` |  |
| `seek(t: number): void` | Normalized 0–1 |
| `seekFrame(frame: number): void` | Fractional frames allowed |
| `seekFrameTime(seconds: number): void` |  |
| `render(canvas: Canvas, dst?: Rect, flags?: RenderFlags): void` | Fits into `dst` (default: its own size at the origin) |

### Property overrides

```ts
const props = new skottie.PropertyManager();
const anim = new skottie.AnimationBuilder().setPropertyObserver(props).make(json);

props.getColorProps(); // [{ key: 'Title.Fill 1.Color', value: Color }]
props.setColor('Title.Fill 1.Color', '#ff3366');
props.setText('Headline', { text: 'Ship it', size: 72 });
props.setOpacity('Logo', 50);
props.setTransform('Logo', { position: [960, 540], scale: [120, 120] });
```

Overrides persist across seeks. Use them to template one Lottie file with data for each render.

### Markers

```ts
anim.markers(); // [{ name: 'intro', t0: 0, t1: 0.25 }, ...] (normalized)
```

## `svg`

```ts
const dom = svg.Dom.fromBytes(bytes, fontMgr); // or fromString
dom.setContainerSize([800, 600]);
dom.render(canvas);
dom.intrinsicSize(); // { width, height, viewBox }
```

Supports static SVG 1.1 / Tiny 1.2 plus CSS presentation attributes. It does **not** support SMIL
animation, scripting, or `<foreignObject>`. Animate SVG content in the scene layer instead.
