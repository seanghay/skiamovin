# GPU rendering

> **Status:** implemented backends are **Metal** (Node, macOS), **WebGL2** (web) and CPU raster. Vulkan, D3D12,
> Graphite/WebGPU, multi-GPU selection and zero-copy encoding are planned. See [status](../status.md).

Skiamovin renders on the GPU by default. The scene layer chooses a backend for you. This guide is for working
with GPU contexts and surfaces directly.

## Backends

| Runtime | Default | Also available |
|---|---|---|
| macOS | Metal (Ganesh) | Metal (Graphite) |
| Windows | D3D12 (Ganesh) | Vulkan |
| Linux | Vulkan (Ganesh) | Vulkan (Graphite) |
| Browser | WebGPU (Graphite) if available | WebGL2 (Ganesh) |
| Anywhere | none | CPU raster |

Check what you'll get:

```ts
import { gpu } from 'skiamovin';
console.log(gpu.info());
```

## Creating a context and surface

```ts
import { gpu, ImageInfo, ColorSpace } from 'skiamovin';

const context = gpu.directContexts.makeDefault();
if (!context) throw new Error('No GPU available');

const surface = gpu.surfaces.renderTarget(
  context,
  gpu.Budgeted.Yes,
  ImageInfo.newN32Premul([1920, 1080], ColorSpace.newSRGB()),
  { sampleCount: 4 }, // 4× MSAA: smoother edges for geometry-heavy scenes
)!;
```

Pick a backend explicitly:

```ts
gpu.directContexts.makeMetal();
gpu.directContexts.makeVulkan({ deviceIndex: 1 }); // second GPU
gpu.directContexts.makeD3D();
```

In the browser:

```ts
// WebGPU via Graphite
const ctx = await gpu.graphite.makeWebGPUContext();
const recorder = ctx.makeRecorder();
const surface = gpu.surfaces.renderTarget(recorder, gpu.Budgeted.Yes, ImageInfo.newN32Premul([1920, 1080]))!;

// WebGL2 via Ganesh, drawing straight to a visible canvas
const glCtx = gpu.directContexts.makeWebGL(canvasElement)!;
const onscreen = gpu.surfaces.wrapCanvas(glCtx, canvasElement)!;
```

## Flushing

GPU drawing is deferred. Commands queue up until you flush:

```ts
draw(surface.canvas());
surface.flushAndSubmit();
```

You rarely need to call this yourself. `SurfaceSource.add`, `videoSampleFromSurface`, `readPixelsAsync` and
`imageSnapshot` all flush the surface they read.

## Readback

Getting pixels to the CPU is the slowest thing you can do with a GPU surface. Avoid it in frame loops. To
encode, use [`SurfaceSource`](../api/media.md#surfacesource), which passes the texture directly to the
encoder. When you do need pixels, use the async version so the GPU isn't stalled:

```ts
const rgba = await surface.readPixelsAsync();
```

## Zero-copy encoding

On supported platforms, render targets are allocated in memory the hardware encoder can read directly (see the
table in [`gpu.surfaces`](../api/gpu.md#gpusurfaces)). Frames go from the shader cores to the encoder without
touching the CPU. `gpu.info().zeroCopyEncode` tells you whether this path is active. When it isn't (for example
CPU raster, or an encoder on a different GPU), Skiamovin falls back to an async readback, which is still
pipelined.

## Multiple GPUs

On Linux and Windows servers with several GPUs, run one worker per GPU:

```ts
const render = await Render.init({
  composition: new CompositionModule(new URL('./comp.ts', import.meta.url)),
  output,
  concurrency: 'auto', // spreads workers across all GPUs found
});
```

Or pin one by hand with `gpu.directContexts.makeVulkan({ deviceIndex })`.

## Device loss

Drivers can reset, browser tabs get backgrounded, and laptops switch GPUs. When that happens the context is
abandoned: `context.isAbandoned()` returns `true` and drawing does nothing. `Render` detects this,
recreates the context and re-renders from the last keyframe. In your own loops, check after each `add()`:

```ts
if (context.isAbandoned()) throw new GpuError('device lost');
```

## Caching and memory

- The resource cache (textures, glyph atlases, path masks) is limited to `resourceCacheLimit` (256 MiB on Node,
  96 MiB on web by default). Increase it for scenes with many large images.
- Call `context.performDeferredCleanup(5000)` every so often in long-running processes to free resources unused
  for 5 seconds.
- Texture-backed `Image`s created from video samples are **not** cached. They borrow the decoder's frames.
