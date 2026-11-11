# `skiamovin` › `gpu`

> **Status:** `makeMetal`, `makeDefault`, `makeWebGL` and `surfaces.renderTarget` are implemented. `makeVulkan`
> and `makeD3D` return `null`; `graphite`, `wrapBackendTexture` and `encoderCompatible` are planned. See [status](../status.md).

```ts
import { gpu } from 'skiamovin';
```

Skiamovin exposes Skia's two GPU APIs:

- **Ganesh** (`gpu.DirectContext`) for Metal, Vulkan, D3D12 and WebGL2.
- **Graphite** (`gpu.graphite.Context`) for WebGPU, and optionally Metal/Vulkan on Node.

Both produce GPU-backed `Surface`s with the same `Canvas` API, so drawing code doesn't change between them.

---

## `gpu.info()`

```ts
function info(): GpuInfo;

interface GpuInfo {
  /** The backend `directContexts.makeDefault()` would use. */
  backend: 'metal' | 'vulkan' | 'd3d12' | 'webgpu' | 'webgl2' | 'raster';
  device: string | null; // adapter name, e.g. "NVIDIA L4"
  vendor: string | null;
  /** Codecs Mediabunny can encode in this runtime (hardware + software). */
  encoders: VideoCodec[];
  /** The subset done in hardware. */
  hardwareEncoders: VideoCodec[];
  decoders: VideoCodec[];
  hardwareDecoders: VideoCodec[];
  /** Whether surfaces from this context can go to the encoder without a CPU copy. */
  zeroCopyEncode: boolean;
}
```

## `gpu.directContexts`

Mirrors `skia_safe::gpu::direct_contexts`.

| Function | Runtime | Description |
|---|---|---|
| `makeDefault(options?: ContextOptions): DirectContext \| null` | All | Picks the best available backend: Metal → D3D12 → Vulkan on Node, WebGL2 on web (for WebGPU, use `graphite`) |
| `makeMetal(options?: ContextOptions & { device?: 'default' \| number }): DirectContext \| null` | macOS |  |
| `makeVulkan(options?: ContextOptions & { deviceIndex?: number }): DirectContext \| null` | Linux, Windows | Headless. `deviceIndex` picks a GPU on multi-GPU hosts |
| `makeD3D(options?: ContextOptions & { adapterIndex?: number }): DirectContext \| null` | Windows |  |
| `makeWebGL(canvas: HTMLCanvasElement \| OffscreenCanvas, attrs?: WebGLContextAttributes): DirectContext \| null` | Web | WebGL2 only |

`ContextOptions` follows `skia_safe::gpu::ContextOptions` (for example `allowPathMaskCaching`,
`glyphCacheTextureMaximumBytes`, `reduceOpsTaskSplitting`), plus:

```ts
interface ContextOptions {
  /** Resource cache budget in bytes. Default 256 MiB on Node, 96 MiB on web. */
  resourceCacheLimit?: number;
  /** Fail instead of falling back when the requested backend is unavailable. Default false. */
  strict?: boolean;
}
```

## `gpu.DirectContext`

| Member | Description |
|---|---|
| `backend(): BackendApi` | `Metal`, `Vulkan`, `Direct3D`, `OpenGL` (WebGL) |
| `flushAndSubmit(): void` | Submit all pending work |
| `flushSurface(surface)` / `submit(sync?: SyncCpu): boolean` | Finer-grained control |
| `onFlushed(): Promise<void>` | Resolves when submitted work is done on the GPU |
| `freeGpuResources()`, `purgeUnlockedResources(...)`, `performDeferredCleanup(ms)` | Cache management |
| `resourceCacheUsage(): { resources: number, bytes: number }` |  |
| `abandon()`, `isAbandoned(): boolean` | After a device loss, the context is abandoned and every call is a no-op |
| `oomed(): boolean` |  |

A context belongs to the thread that created it.

## `gpu.surfaces`

```ts
gpu.surfaces.renderTarget(
  context: DirectContext | graphite.Recorder,
  budgeted: Budgeted,
  info: ImageInfo,
  options?: {
    sampleCount?: number;           // MSAA. 1 (default) = off. 4 is a good choice for video
    origin?: SurfaceOrigin;         // default TopLeft
    props?: SurfaceProps;
    mipmapped?: boolean;
    /** Allocate the texture so a hardware encoder can read it directly. Default true when supported. */
    encoderCompatible?: boolean;
  },
): Surface | null;

gpu.surfaces.wrapBackendTexture(context, texture: BackendTexture, origin, sampleCount, colorType, colorSpace?, props?): Surface | null;
gpu.surfaces.wrapCanvas(context, canvas: HTMLCanvasElement | OffscreenCanvas, options?): Surface | null;   // web: draws to the canvas's back buffer
```

With `encoderCompatible`, Skiamovin allocates the render target in a format and memory type the platform encoder
can read directly:

| Platform | Texture backing |
|---|---|
| macOS | `IOSurface`-backed `MTLTexture`, passed to VideoToolbox as a `CVPixelBuffer` |
| Linux, NVIDIA | Vulkan external memory, imported as a CUDA array for NVENC |
| Linux, Intel/AMD | Vulkan exportable image (DMA-BUF), imported as a VA surface |
| Windows | Shared D3D12 resource, imported by Media Foundation / NVENC |
| Web | `OffscreenCanvas` back buffer, wrapped in a `VideoFrame` |

See [Architecture → zero-copy](../architecture/performance.md#zero-copy-encode).

## `gpu.graphite`

```ts
gpu.graphite.makeWebGPUContext(device?: GPUDevice): Promise<graphite.Context>   // web; requests a device if omitted
gpu.graphite.makeMetalContext(): graphite.Context | null                         // Node, macOS
gpu.graphite.makeVulkanContext(): graphite.Context | null                        // Node

context.makeRecorder(options?): graphite.Recorder
recorder.snap(): graphite.Recording
context.insertRecording(recording): boolean
context.submit(sync?: SyncToCpu): void
context.onSubmitted(): Promise<void>
```

Graphite separates _recording_ (any thread, one `Recorder` each) from _submission_ (the context's thread). Pass
a `Recorder` to `gpu.surfaces.renderTarget` to get a Graphite surface. `surface.flushAndSubmit()` snaps and
submits for you, so most code can ignore the difference.

## `gpu.BackendTexture`

Wraps an external texture: an `MTLTexture` handle, a `VkImage`, an `ID3D12Resource`, a `WebGLTexture`, or a
`GPUTexture`. You'll mostly use it with
[`imageFromVideoSample`](media.md#imagefromvideosample), which builds one for you.

## Enums

`Budgeted` (`No`, `Yes`), `SurfaceOrigin` (`TopLeft`, `BottomLeft`), `BackendApi`, `SyncCpu` (`No`, `Yes`),
`Mipmapped` (`No`, `Yes`).
