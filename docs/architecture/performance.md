# Performance

> **Status:** on macOS, zero-copy encode and decode are implemented (IOSurface ↔ Metal ↔ VideoToolbox). In the
> browser, frames go from the WebGL2 canvas to WebCodecs without a CPU readback. Linux and Windows aren't built yet.
> See [status](../status.md).

## Measured (Apple M3 Max, 1080p, H.264)

|  | Before zero-copy | Now |
|---|---|---|
| 10 sample videos (69.8 s of video), 1 thread | 20.5 s | 7.4 s |
| Launch film (48 s @ 60 fps, 2,880 frames), 1 thread | 26.5 s | 8.6 s |
| Launch film, best worker count | 10.9 s (3 workers) | 7.4 s (3 workers) |
| Video grid sample (4 decoded streams + PiP) | 40 fps | 174 fps |

Per frame, drawing costs well under 1 ms on the GPU; the hardware encoder (~2.7 ms/frame per session) is now the
limit, so extra workers help only modestly (`concurrency: 'auto'` uses 2 workers for renders of 600+ frames).

### In the browser (headless Chrome, ANGLE Metal, M3 Max)

A 2-second, 60 fps motion-graphics scene (gradient, 40 animated shapes, text), measured with
`node test/browser/bench-run.mjs` in a fresh browser:

|  | Before | Now |
|---|---|---|
| Export 1080p60, H.264 (first export in the session) | 44 fps | 234 fps |
| Export 720p60, H.264 | 172 fps | 291 fps |
| Export 1080p60, `gpu: 'raster'` | 14 fps | 14 fps |
| `Player` at 1080p | 13.6 fps, 151 ms main-thread stalls | 60 fps (vsync), 12 ms stalls |

Two changes made the difference:

- **GPU capture.** Skia draws straight into the WebGL2 canvas's framebuffer. Each frame becomes an
  `ImageBitmap` (`transferToImageBitmap()`), which is wrapped as a `VideoFrame` for WebCodecs or shown through a
  `bitmaprenderer` context by `Player`. Nothing is read back to the CPU.
- **Bitrate rate control by default.** Mediabunny encodes `QUALITY_*` presets in quantizer (constant QP) mode
  when the codec supports it. In Chrome on macOS, the first quantizer-mode hardware encoder in a session takes
  about two seconds to start, and each frame encodes more slowly. `Render` now defaults to
  `new Quality({ quality: 'high', preferBitrate: true })`, which has no start-up delay. Passing `QUALITY_HIGH`
  explicitly brings the quantizer mode back.

## Where time goes

A frame's cost is usually dominated by one of:

| Stage | Typical bottleneck | What helps |
|---|---|---|
| Scene work (JS) | Big trees, expensive `draw` callbacks, rebuilding paragraphs | `cache`, hoisting work out of `render`, concurrency |
| GPU paint | Large blurs, many `saveLayer`s, heavy SkSL, high MSAA | Smaller blur sigmas/regions, fewer layers, `scale` for previews |
| Video decode | High-resolution, long-GOP sources | Hardware decode, intra-frame proxies, sequential rendering |
| Encode | Software AV1/VP9, high resolution | Hardware encoders, H.264/HEVC |
| Readback | Platforms without zero-copy | `readPixelsAsync`, double buffering |

Measure first:

```ts
const render = await Render.init({ composition, output, profile: true });
await render.execute();
// prints per-stage timings: render, layout, media, paint (GPU), encode, plus stalls
```

## Zero-copy encode

With `gpu.info().zeroCopyEncode === true`, frames go from Skia's render target to the hardware encoder with no
CPU involvement:

| Platform | Path |
|---|---|
| macOS | `IOSurface` → `MTLTexture` (Skia renders) → `CVPixelBuffer` → VideoToolbox |
| Linux + NVIDIA | `VkImage` (external memory) → CUDA array → NVENC |
| Linux + Intel/AMD | `VkImage` → DMA-BUF → VA surface → VAAPI |
| Windows | `ID3D12Resource` (shared) → Media Foundation / NVENC |
| Chromium, Safari | `OffscreenCanvas`/WebGPU texture → `VideoFrame` → WebCodecs (the browser's own GPU path) |

The RGB → YUV (NV12/P010) conversion runs as a GPU compute pass before handoff.

The fast path turns off (and Skiamovin falls back to async readback) when:

- rendering on the CPU raster backend,
- the encoder runs on a different GPU than the renderer,
- the encoder is a software codec,
- the surface was created without `encoderCompatible`.

## Zero-copy decode

Decoded frames stay on the GPU in the same way: VideoToolbox `CVPixelBuffer`s, NVDEC/VAAPI surfaces and D3D
textures are imported as Skia textures, and the YUV → RGB conversion runs in the shader that draws them. In the
browser, WebGPU imports `VideoFrame`s with `importExternalTexture`. WebGL2 uses `texImage2D(VideoFrame)`, which
is GPU-to-GPU in Chromium and Safari.

## Double buffering

Encoding is asynchronous. While the encoder reads frame _n_, Skiamovin draws frame _n+1_ into a second surface.
`Render` does this automatically. In your own loops:

```ts
const surfaces = [makeSurface(), makeSurface()];
const sources = surfaces.map((s) => new SurfaceSource(s, config)); // ❌ two tracks: not what we want
```

Instead, use `videoSampleFromSurface` with one source and alternate surfaces:

```ts
const source = new VideoSampleSource(config);
let pending: Promise<void> = Promise.resolve();

for (let f = 0; f < frames; f++) {
  const surface = surfaces[f % 2];
  draw(surface.canvas(), f);
  const sample = videoSampleFromSurface(surface, { timestamp: f / frameRate, duration: 1 / frameRate });
  await pending; // the previous add() must finish before we draw into its surface again
  pending = source.add(sample).finally(() => sample.close());
}
await pending;
```

## Concurrency tuning

`concurrency: 'auto'` picks `min(cores / 2, gpus × encoderSessionsPerGpu)`, at least 1. Tune by hand when:

- **Scenes are JS-heavy and encoding is cheap:** raise concurrency toward the core count.
- **The encoder is the bottleneck:** consumer NVIDIA GPUs support a limited number of concurrent NVENC
  sessions. Going above that only adds queueing.
- **Sources are long-GOP video:** every worker seeks to its chunk start. With few, long chunks the seek cost
  is negligible. With very high concurrency on short renders it isn't.

Chunks are aligned to `keyFrameInterval`. Each chunk must be at least one GOP long.

## Scene-level tips

- **Hoist work out of `render`.** Build paints, shaders, `RuntimeEffect`s and fonts at module scope or in
  `assets`. `render` should only build nodes.
- **Use `cache` for static subtrees.** A complex background with `cache: 'bg'` is drawn once and reused as an
  image.
- **Prefer `transform` over animating layout** when the result looks the same. Both are fast, but transforms
  skip layout entirely.
- **Avoid unbounded blurs.** Blur cost grows with sigma and area. Blur a downscaled copy, or clip the region.
- **`opacity` on a group creates a layer.** On a single leaf, Skiamovin applies alpha directly with no layer.
- **Use preview settings.** `scale: 0.5` cuts pixel work by 4×. `video: { codec: 'avc' }` with
  `bitrate: QUALITY_LOW` keeps encoding cheap.

## Benchmarking

The repository has a benchmark suite under `bench/` that renders standard scenes (text-heavy, video
compositing, shader-heavy, Lottie, 4K) on every backend:

```sh
npm run bench                       # all scenes, default backend
npm run bench -- --scene video-pip --backend vulkan --concurrency 1,2,4,8
npm run bench -- --compare main     # regression check against another branch
```

It reports frames per second, per-stage timings and peak memory as JSON and as a Markdown table. When you report
a performance issue, include the output of `npx skiamovin info` and the relevant benchmark run.
