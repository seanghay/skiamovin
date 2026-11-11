# Architecture overview

## Repository layout

```
skiamovin/
├── crates/
│   ├── skiamovin-core/      Rust: skia-safe wrappers, conversions, resource tracking
│   ├── skiamovin-taffy/     Rust: taffy wrappers, style parsing, measure callbacks
│   ├── skiamovin-codecs/    Rust: native encoders/decoders (VideoToolbox, NVENC, VAAPI, MF, software)
│   ├── skiamovin-node/      napi-rs addon: exposes core + taffy + codecs to Node
│   └── skiamovin-wasm/      wasm-bindgen build: exposes core + taffy to the browser
├── packages/
│   └── skiamovin/           the npm package: TS API, conditional exports, scene layer, media bridge
│       ├── src/core/        thin TS layer over the binding (types, ergonomics, disposal)
│       ├── src/media/       Mediabunny integration
│       ├── src/taffy/
│       └── src/scene/       pure TypeScript: nodes, animation, renderer, Player
└── docs/
```

**One Rust core, two binding targets.** Both the native addon and the WASM module are generated from the same
Rust crates on top of `skia-safe`, which is why the APIs match exactly. The TypeScript layer is shared and is
the only thing users import.

## Builds

|  | Node | Web |
|---|---|---|
| Binding | napi-rs | wasm-bindgen + a small JS glue layer |
| Skia | `skia-safe` with `gl`, `metal`, `vulkan`, `d3d`, `textlayout`, `svg`, `webp`, `pdf` features, plus Skottie and Graphite | `skia-safe` built for `wasm32-unknown-emscripten` with WebGL + Graphite/Dawn-WebGPU, same modules |
| Text | HarfBuzz + ICU (embedded data) | same |
| Codecs | `skiamovin-codecs`, registered with Mediabunny | none: WebCodecs |
| Threads | Rust threads inside the addon, plus `worker_threads` for frame parallelism | WASM threads (SharedArrayBuffer) when cross-origin isolated |

## The media boundary

Skiamovin has no muxer or demuxer of its own. **Mediabunny owns every byte of every file**, and Skiamovin
supplies pixels in and out, plus codecs on Node.

On Node, `skiamovin-codecs` implements Mediabunny's `CustomVideoEncoder`/`CustomVideoDecoder` (and the audio
equivalents) in Rust:

```
Mediabunny VideoSampleSource.add(sample)
  └─ CustomVideoEncoder.encode(sample)            (Skiamovin's, registered at init)
        ├─ sample is backed by a Skiamovin GPU texture?   → import directly into the HW encoder
        └─ otherwise                                     → upload/convert to NV12, then encode
  └─ onPacket(EncodedPacket) → Mediabunny muxer
```

A `VideoSample` produced by `videoSampleFromSurface` carries a private handle to the native texture. When it
reaches Skiamovin's own encoder, the encoder recognizes the handle and skips pixel copies. If the sample goes
anywhere else (another encoder, `sample.copyTo()`), it is read back lazily, so correctness never depends on
the fast path.

In the browser, the same function wraps the surface's backing `OffscreenCanvas` (WebGL2) or texture
(WebGPU, through a canvas context) in a `VideoFrame`, which WebCodecs can read without a CPU round trip in
Chromium and Safari.

## The frame pipeline

What `Render` (and `CompositionSink`, and `Player`) does for each frame:

```
          ┌───────────┐   ┌──────────┐   ┌──────────────┐   ┌───────────┐   ┌──────────────┐
frame ──▶ │ render()  │──▶│  layout  │──▶│ resolve media│──▶│   paint   │──▶│ encode (async)│
          │ JS, pure  │   │  Taffy   │   │ video, lottie│   │ Skia, GPU │   │ Mediabunny   │
          └───────────┘   └──────────┘   └──────────────┘   └───────────┘   └──────────────┘
```

1. **render():** user code builds a lightweight node tree (plain objects).
2. **Layout:** the tree is diffed against the previous frame's Taffy tree by position and `key`. Changed
   styles mark nodes dirty, and Taffy recomputes only what changed. Text leaves are measured with SkParagraph,
   and paragraphs are cached by (content, style, width).
3. **Resolve media:** for each `video` node, the renderer asks an `ImageSink` on that `Input`'s track for the
   image at the node's local time (`imagesAtTimestamps` under the hood). Readers prefetch ahead on the decoder, so this usually returns immediately. Lottie
   nodes seek. Subtrees with `cache` keys are looked up.
4. **Paint:** a recursive walk emits Skia calls: `save`/`translate`/`concat44` for transforms, `saveLayer` for
   opacity, blend and filters, clip for `overflow`, then the node's own drawing. Shader nodes with node
   children render those children to offscreen surfaces first.
5. **Encode:** the surface goes to `SurfaceSource.add`. Rendering of frame _n+1_ starts on a second surface
   while frame _n_ encodes ([double buffering](performance.md#double-buffering)).

Audio runs separately: after layout, the renderer has a list of every audible node and the frames where it's
active. The audio mixer turns that into a sample-accurate schedule, decodes with Mediabunny `AudioSampleSink`s,
mixes in 128-sample blocks, and feeds an `AudioSampleSource` in step with the video, so the muxer can
interleave the two.

## Memory model

- Every Skia object on the JS side is a handle to a reference-counted native object.
- Handles register with a `FinalizationRegistry`, so dropped objects are freed eventually.
- `Symbol.dispose` / `delete()` free immediately. The scene renderer disposes everything it creates each frame,
  so its memory use is flat over long renders.
- GPU resources are budgeted by Skia's resource cache (`resourceCacheLimit`). Images made from video samples
  are not cached.
- Objects are owned by one thread. Crossing threads goes through serialization (`Picture.serialize`,
  transferable buffers), never shared handles.

## Determinism

- The scene contract (pure `render`) and the analytic animation helpers make every frame reproducible on its
  own.
- `random`/`noise` are seeded hash functions with no global state.
- Text shaping and layout use embedded HarfBuzz/ICU data, so they don't depend on the OS.
- GPU rasterization may differ slightly between drivers. `gpu: 'raster'` gives bit-exact output on all
  platforms. See [Node vs. web](../getting-started/node-vs-web.md#pixel-identical-output).
