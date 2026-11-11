# Installation

> **Status:** the current build ships a prebuilt addon for **macOS arm64** and the single-threaded WebAssembly
> build. Linux and Windows addons, Vulkan/D3D12 and the threaded WASM build are planned. See [status](../status.md).

```sh
npm install skiamovin mediabunny
```

`mediabunny` is a peer dependency (`^1.0.0`). Skiamovin uses it for every container format and codec
operation, so your project and Skiamovin share one copy.

## One package, two builds

`skiamovin` picks its build through [conditional exports](https://nodejs.org/api/packages.html#conditional-exports):

| Condition | Build | Loaded from |
|---|---|---|
| `node` | Native N-API addon | `@skiamovin/<platform>` optional dependency |
| `browser`, `worker`, `deno` | WebAssembly | `skiamovin/wasm/skiamovin.wasm` |

You import the same specifiers (`skiamovin`, `skiamovin/media`, `skiamovin/taffy`, `skiamovin/scene`) in
both environments.

## Node

**Requirements:** Node.js 20 or later (Bun 1.1+ also works).

npm installs the matching prebuilt addon automatically:

| Platform | Package | GPU backend | Hardware codecs |
|---|---|---|---|
| macOS arm64 | `@skiamovin/darwin-arm64` | Metal | VideoToolbox |
| macOS x64 | `@skiamovin/darwin-x64` | Metal | VideoToolbox |
| Linux x64 (glibc 2.28+) | `@skiamovin/linux-x64-gnu` | Vulkan | NVENC/NVDEC, VAAPI |
| Linux arm64 (glibc 2.28+) | `@skiamovin/linux-arm64-gnu` | Vulkan | VAAPI, V4L2 |
| Linux x64 (musl) | `@skiamovin/linux-x64-musl` | Vulkan | NVENC/NVDEC, VAAPI |
| Windows x64 | `@skiamovin/win32-x64-msvc` | D3D12, Vulkan | Media Foundation, NVENC |

Every build includes software codecs too (OpenH264, libvpx, dav1d, SVT-AV1, Opus, AAC), so encoding still
works on machines without a GPU or hardware encoder.

### Headless Linux servers

You don't need a display server. Vulkan works headless. For GPU rendering in a container, expose the GPU and
install the vendor's Vulkan ICD:

```dockerfile
FROM node:22-bookworm
RUN apt-get update && apt-get install -y libvulkan1 mesa-vulkan-drivers
# NVIDIA: run with --gpus all and the NVIDIA Container Toolkit
```

With no GPU at all, Skiamovin falls back to the CPU raster backend and software codecs. Check what was picked
with [`gpu.info()`](../api/gpu.md#gpuinfo).

## Browser

**Requirements:**

| Feature | Needed for | Support |
|---|---|---|
| WebAssembly + SIMD | Everything | All evergreen browsers |
| WebGL2 | GPU rendering (Ganesh) | All evergreen browsers |
| WebGPU | GPU rendering (Graphite), preferred | Chrome/Edge 113+, Safari 26+, Firefox 141+ (Windows) |
| WebCodecs | Encoding and decoding | Chrome/Edge 94+, Safari 16.4+ (video) / 26+ (audio), Firefox 130+ |

Call `init()` once before any other API. It fetches and compiles the WASM module:

```ts
import { init } from 'skiamovin';

await init();
```

### Bundlers

Vite, webpack 5, Rollup, esbuild and Parcel pick up the `browser` condition and the `.wasm` asset
automatically. If your setup serves the WASM file from somewhere else, pass its URL:

```ts
await init({ wasmUrl: '/static/skiamovin.wasm' });
```

For Vite, exclude Skiamovin from dependency pre-bundling so the WASM URL stays intact, and build workers as ES
modules (the worker loads the WASM glue with a dynamic import):

```ts
// vite.config.ts
export default {
  optimizeDeps: { exclude: ['skiamovin'] },
  worker: { format: 'es' },
};
```

[`examples/web-studio`](../../examples/web-studio) is a working Vite setup, tested in both `vite dev` and
production builds.

### Multithreading

The WASM build comes in two flavors and `init()` chooses automatically:

- **Threaded** (`skiamovin.mt.wasm`), used when `crossOriginIsolated` is `true`. Taffy layout, image decoding
  and the Skia raster backend use worker threads.
- **Single-threaded** (`skiamovin.wasm`), used otherwise.

To enable the threaded build, serve your page with:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## TypeScript

Type definitions ship in the package. No `@types` install is needed. Set `"moduleResolution": "bundler"` or
`"node16"` so TypeScript resolves the subpath exports.

## Verify the install

```ts
import { init, gpu } from 'skiamovin';

await init();
console.log(gpu.info());
// { backend: 'metal', device: 'Apple M3 Pro', encoders: ['avc', 'hevc', 'vp9', 'av1'], hardwareEncoders: ['avc', 'hevc'], ... }
```
