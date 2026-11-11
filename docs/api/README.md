# API reference

| Module | Contents |
|---|---|
| [`skiamovin`](core.md) | `init`, core Skia types (`Surface`, `Canvas`, `Paint`, `Path`, `Image`, `Shader`, `RuntimeEffect`, ...), and the `gpu`, `textlayout`, `skottie`, `svg`, `surfaces`, `images`, `imageFilters` namespaces |
| [`skiamovin` › `gpu`](gpu.md) | GPU contexts and GPU-backed surfaces |
| [`skiamovin` › `textlayout`](textlayout.md) | SkParagraph: `FontCollection`, `ParagraphBuilder`, `Paragraph`, styles |
| [`skiamovin` › `skottie`, `svg`](skottie-svg.md) | Lottie animations and SVG documents |
| [`skiamovin/media`](media.md) | Mediabunny integration: `registerNativeCodecs`, `SurfaceSource`, `ImageSink`, `VideoSample` conversions |
| [`skiamovin/taffy`](taffy.md) | `TaffyTree` and layout styles |
| [`skiamovin/scene`](scene.md) | `Composition`, nodes, assets, animation helpers, `Render`, `CompositionSink`, `Player` |

## Conventions

There are two sets of conventions:

- **`skiamovin/scene` and `skiamovin/media`** follow [Mediabunny](https://mediabunny.dev). Times and durations
  are in seconds. Classes are cheap to construct and do their work in async methods. Media comes in through
  Mediabunny `Source`s and `Input`s and goes out through `Output`s. Sinks expose `getX(timestamp)`, `xs(start, end)`
  and `xsAtTimestamps(timestamps)`. Long-running operations use `init()` → `execute()` with an `onProgress`
  property.
- **The core Skia API** (`skiamovin`) mirrors `skia-safe`, as described below.

### Skia naming

The core Skia API mirrors [`skia-safe`](https://rust-skia.github.io/doc/skia_safe/). If you know a `skia-safe`
function, you can predict its Skiamovin name, and the `skia-safe` docs remain a useful second reference. The
mapping rules:

| Rust (`skia-safe`) | JavaScript (Skiamovin) |
|---|---|
| `snake_case` functions and methods | `camelCase`: `draw_rrect` → `drawRRect`, `image_snapshot` → `imageSnapshot` |
| Modules (`skia_safe::textlayout`) | Namespaces: `import { textlayout } from 'skiamovin'` |
| `Type::new(..)`, `Type::default()` | `new Type(..)` |
| Other associated constructors (`Rect::from_xywh`) | Static methods: `Rect.fromXYWH(...)` |
| Enums (`PaintStyle::Stroke`) | Frozen objects with the same variant names: `PaintStyle.Stroke` |
| `Option<T>` | `T \| null` (and `undefined` for arguments) |
| Trailing `Option` arguments | May be omitted. Where a function has several, they collapse into a final options object |
| `Result<T, E>` | Returns `T` or throws a `SkiaError` carrying the message |
| `Point`, `Vector`, `Size`, `ISize` | Tuples: `[x, y]`, `[width, height]` |
| `Rect` | `Rect` instance or a 4-tuple `[left, top, right, bottom]` |
| `Color` (u32) | Number `0xAARRGGBB`, a `Color` constant, or a CSS color string such as `'#ff8800'` |
| `Color4f` | `Color4f` instance or `[r, g, b, a]` with components 0–1 |
| `Matrix` | `Matrix` instance or a 9-element row-major array |
| `&[u8]`, `Data` | `Uint8Array`, `ArrayBuffer`, or `Data` |
| `Drop` | Garbage collection, or explicit disposal (see below) |

### Resource management

Skia objects hold native memory (and on GPU, textures and buffers) that the JavaScript garbage collector can't
see. All Skiamovin objects are released when they are garbage collected, but for anything created per frame you
should release them yourself. Every object implements `Symbol.dispose` and a `delete()` method:

```ts
{
  using paint = new Paint();
  using path = new Path();
  // ...
} // released here

const image = surface.imageSnapshot();
// ...
image.delete();
```

Using a deleted object throws `SkiaError: object has been deleted`.

### Errors

| Class | Thrown when |
|---|---|
| `SkiaError` | A Skia operation fails (invalid SkSL, undecodable image, deleted object) |
| `GpuError` | A GPU context can't be created, or the device was lost |
| `CodecError` | A codec isn't available or an encode/decode fails. Also surfaces Mediabunny errors |
| `LayoutError` | A Taffy operation references an invalid node |

All extend `SkiamovinError`.

### Threads

Skia objects are bound to the thread (or worker) that created them. To render across threads, create the
objects in each worker. [`Render`](scene.md#concurrency) does this for you.
