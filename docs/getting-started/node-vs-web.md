# Node vs. web

Skiamovin's goal is that **a composition renders the same on a server and in a browser.** The API, the Skia
version, the shaping engine and the layout engine are the same in both. Only the platform underneath differs.

## What's the same

- Every exported API: `skiamovin`, `skiamovin/media`, `skiamovin/taffy`, `skiamovin/scene`
- Skia version and feature set (Skottie, SkParagraph, SVG, SkSL, PDF)
- Text shaping (HarfBuzz + ICU, compiled in, so it doesn't vary by OS)
- Layout (Taffy)
- Container handling (Mediabunny)
- Animation math. `spring`, `interpolate` and `noise` give bit-identical results

## What differs

|  | Node | Web |
|---|---|---|
| Build | Native addon (N-API) | WebAssembly |
| `init()` | Optional | Required for the Skia layer (the composition layer calls it for you) |
| GPU | Metal, Vulkan, D3D12 (Ganesh or Graphite) | WebGPU (Graphite), WebGL2 (Ganesh) |
| Encode/decode | Native codecs registered with Mediabunny | Browser WebCodecs |
| Codec availability | Same everywhere (software fallbacks included) | Depends on browser and OS |
| Fonts | `FontMgr.default()` = system fonts | Bundled fallback fonts only. Load your own |
| Media I/O | `FilePathSource`, `FilePathTarget` | `UrlSource`, `BlobSource`, `BufferTarget`, `StreamTarget` |
| Threads | `worker_threads`, `concurrency` option | `Worker`s. Threaded WASM needs cross-origin isolation |
| Memory | System RAM / VRAM | WASM heap (max 4 GiB) + GPU |
| Live preview | none | `Player` |

## Pixel-identical output?

Close, but not guaranteed across GPUs. Different drivers rasterize anti-aliased edges and evaluate shaders with
slightly different precision. Expect differences of a few least-significant bits on edges. For exact
reproducibility, for example in visual regression tests, render with `gpu: 'raster'`. The CPU raster backend gives
identical pixels on every platform.

Encoders differ too. The same frames through VideoToolbox and through Chrome's encoder give different (equally
valid) bitstreams.

## Portable code

Because Skiamovin takes all media through Mediabunny, portable code comes down to choosing the right `Source`
and `Target`, as in any Mediabunny project.

1. **Use `UrlSource` for bundled assets** if the code must run in both places:

   ```ts
   const logo = new ImageAsset(new UrlSource(new URL('./logo.png', import.meta.url)));
   ```

2. **Always ship your fonts** as `FontAsset`s. Don't rely on system fonts.

3. **Pick the target by environment:**

   ```ts
   import { BufferTarget, FilePathTarget } from 'mediabunny';
   const target = typeof window === 'undefined' ? new FilePathTarget('out.mp4') : new BufferTarget();
   ```

4. **Let Mediabunny choose the codec**, or check with its helpers:

   ```ts
   import { getFirstEncodableVideoCodec } from 'mediabunny';
   const codec = await getFirstEncodableVideoCodec(['hevc', 'avc'], { width: 1920, height: 1080 });
   ```

## Rendering in a browser worker

Rendering on the main thread blocks the UI. Move it to a worker:

```ts
// render.worker.ts
import { Output, Mp4OutputFormat, BufferTarget } from 'mediabunny';
import { Render } from 'skiamovin/scene';
import { intro } from './intro';

self.onmessage = async ({ data }) => {
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const render = await Render.init({ composition: intro, output, props: data.props });
  render.onProgress = (progress) => self.postMessage({ type: 'progress', progress });
  await render.execute();

  const buffer = output.target.buffer!;
  self.postMessage({ type: 'done', buffer }, [buffer]);
};
```

WebGPU, WebGL2 (through `OffscreenCanvas`) and WebCodecs all work in dedicated workers. See
[Running in the browser](../guides/web.md).
