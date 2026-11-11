# Skiamovin documentation

Skiamovin renders video with code. It has three building blocks and one composition layer:

```
┌──────────────────────────────────────────────────────────────┐
│ skiamovin/scene   Composition: timestamp → node tree,        │
│                   Render, CompositionSink, Player            │
├──────────────────┬───────────────────┬───────────────────────┤
│ skiamovin        │ skiamovin/taffy   │ skiamovin/media       │
│ Skia bindings    │ Flexbox / Grid /  │ SurfaceSource,        │
│ (skia-safe API)  │ Block layout      │ ImageSink, native     │
│ + GPU contexts   │                   │ Mediabunny codecs     │
├──────────────────┴───────────────────┴───────────────────────┤
│ Node: native addon (Metal · Vulkan · D3D12, HW codecs)       │
│ Web:  WebAssembly (WebGPU · WebGL2, WebCodecs)               │
└──────────────────────────────────────────────────────────────┘
```

You can use any layer on its own. The composition and media layers follow Mediabunny's conventions: times in
seconds, `Source`s and `Input`s in, `Output`s out. Most projects start with `skiamovin/scene` and reach down to the Skia canvas
when they need to draw something by hand.

> **Status:** see [Implementation status](status.md) for what the current build implements and what's planned.

## Getting started

- [Installation](getting-started/installation.md): platforms, prebuilt binaries, bundlers
- [Quick start](getting-started/quick-start.md): your first video, with both layers
- [Node vs. web](getting-started/node-vs-web.md): what differs between runtimes, and what doesn't

## Guides

**Drawing with Skia**

- [The Skia API](guides/skia-basics.md): surfaces, canvas, paint, paths, images, and the naming conventions
- [GPU rendering](guides/gpu.md): choosing a backend, GPU surfaces, readback
- [Text and paragraphs](guides/text-layout.md): fonts, `textlayout`, rich text, shaping
- [Skottie (Lottie)](guides/skottie.md): playing Lottie animations frame-accurately
- [Shaders and effects](guides/shaders.md): gradients, SkSL runtime effects, image filters
- [Images and SVG](guides/images-and-svg.md): decoding images, rendering SVG

**Layout**

- [Layout with Taffy](guides/taffy.md): Flexbox, Grid and Block layout, measure functions

**Composing video**

- [Compositions and animation](guides/scenes.md): `Composition`, nodes, assets, `interpolate`, `spring`, `sequence`, `Timeline`
- [Video input](guides/video-input.md): Mediabunny `Input`s as layers
- [Audio](guides/audio.md): background music, source audio, mixing
- [Rendering compositions](guides/rendering.md): `Render`, codecs, concurrency, `CompositionSink` for stills
- [Sources and sinks](guides/mediabunny.md): `SurfaceSource`, `ImageSink`, native codecs: how Skiamovin plugs into Mediabunny
- [Running in the browser](guides/web.md): WASM loading, workers, previews with `Player`

## API reference

- [Overview and conventions](api/README.md)
- [`skiamovin`](api/core.md): core Skia
- [`skiamovin` › `gpu`](api/gpu.md)
- [`skiamovin` › `textlayout`](api/textlayout.md)
- [`skiamovin` › `skottie` and `svg`](api/skottie-svg.md)
- [`skiamovin/media`](api/media.md)
- [`skiamovin/taffy`](api/taffy.md)
- [`skiamovin/scene`](api/scene.md)

## Architecture

- [Overview](architecture/overview.md): the native and WASM builds, frame pipeline, memory model
- [Performance](architecture/performance.md): zero-copy paths, concurrency, tuning, benchmarking
