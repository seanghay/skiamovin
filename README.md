# Skiamovin

Make videos with code, using [Skia](https://skia.org) for drawing. Skiamovin runs on Node and in the browser,
and it's built to work with [Mediabunny](https://mediabunny.dev): compositions render to Mediabunny `Output`s
and play Mediabunny `Input`s.

```ts
import { FilePathTarget, Mp4OutputFormat, Output } from 'mediabunny';
import { box, Composition, interpolate, Render, text } from 'skiamovin/scene';

const composition = new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 3,
  render: ({ timestamp }) =>
    box({ size: { width: '100%', height: '100%' }, justifyContent: 'center', alignItems: 'center', background: '#0b0d12' }, [
      text('Hello, Skiamovin', { fontSize: 120, color: '#ffffff', opacity: interpolate(timestamp, [0, 1], [0, 1]) }),
    ]),
});

const render = await Render.init({
  composition,
  output: new Output({ format: new Mp4OutputFormat(), target: new FilePathTarget('hello.mp4') }),
});
await render.execute();
```

## What you get

- **Skia drawing.** Canvas, paths, paints, gradients, image filters, SkSL shaders, text layout, SVG and PDF. The
  API follows [`skia-safe`](https://github.com/rust-skia/rust-skia), in camelCase.
- **Layout.** Flexbox, CSS Grid and block layout from [Taffy](https://github.com/DioxusLabs/taffy), and
  Tailwind-style classes such as `box({ class: 'flex items-center gap-4 p-8 rounded-2xl bg-slate-900' })`.
- **Scenes.** Describe each frame as a tree of boxes, text, images, video and audio. Every frame is a pure
  function of time, so any frame renders on its own and every build gives the same result. Or draw each frame
  yourself with the canvas.
- **Animation.** Easings, keyframe curves with Bézier handles, timelines, staggers, action strips, springs set by
  feel (SwiftUI's `response` and `bounce`), momentum and rubber banding, motion that follows layout changes, text
  animators and path morphing.
- **Looks.** Color grading with LUTs and curves, look presets, effects (grain, glow, halftone, lens distortion),
  glass, layer styles, mattes, soft shadows, animated backgrounds and all 214
  [gl-transitions](https://gl-transitions.com).
- **Film tools.** Motion blur from a shutter angle, shot sizes, camera moves, handheld shake, depth of field,
  title cards, lower thirds and credits.
- **Type, code and captions.** Text as vector shapes, per-letter variable font axes, fit-to-width, code blocks
  that animate between versions (highlighted by Shiki), and captions from SRT, WebVTT or word timings.
- **Explainers.** LaTeX math typeset in Rust, graphs and axes, Mermaid diagrams, 2D physics with Rapier, and a
  camera that pans and zooms.
- **3D.** Cards in 3D space, lit meshes (boxes, spheres, tori, extruded shapes and text) with an optional depth
  buffer, and ray-marched scenes with soft shadows.
- **Sound.** Audio mixing, music that ducks under dialogue, stems by role, beat and onset detection, MIDI files,
  and loudness normalization to a LUFS target.
- **Command line.** `npx skiamovin render`, `still`, `sheet` (a contact sheet of a whole video) and `inspect`
  (the composition and its node tree as JSON, for tools and AI agents).
- **Fast on macOS.** Frames render on the GPU with Metal and go to the hardware encoder without copying pixels.
- **In the browser.** The same API runs as WebAssembly with WebGL2. Previews and exports run in Web Workers and
  encode with WebCodecs.

See [docs/status.md](docs/status.md) for exactly what each platform supports today.

| Platform | Drawing | Video encoding and decoding |
|---|---|---|
| macOS (Apple silicon) | GPU (Metal) | Hardware (VideoToolbox) |
| Linux, Windows | CPU | Not yet |
| Browsers | GPU (WebGL2) | WebCodecs |

## How it compares

| | Skiamovin | [Remotion](https://www.remotion.dev) | [HyperFrames](https://github.com/heygen-com/hyperframes) | [FFrames](https://github.com/dmtrKovalenko/fframes) |
|---|---|---|---|---|
| You write | TypeScript: scene nodes or Skia canvas calls | React components | HTML, CSS and JavaScript | Rust, with frames as SVG |
| Frames are drawn by | Skia, in a native addon or WebAssembly | Headless Chrome, one screenshot per frame | A headless browser | An SVG renderer on the GPU |
| Encoding | Mediabunny: hardware encoders on macOS, WebCodecs in browsers | FFmpeg | FFmpeg | FFmpeg |
| Needs a browser to render | No | Yes | Yes | No |
| Renders and exports inside a web page | Yes | Preview with `@remotion/player` | No | No |
| License | MIT | Remotion License: free for individuals and teams of up to 3, paid for larger companies | Apache 2.0 | MIT |

Skiamovin is new (version 0.1) and the others are more established. If you want to use web technology you
already know, Remotion and HyperFrames let you write videos as web pages. Skiamovin is for when you want to draw
directly with Skia, avoid running a browser on the server, or render and export inside the user's browser.
This table is based on each project's public docs as of November 2026. Corrections are welcome.

## Install

```sh
npm install skiamovin mediabunny
```

## Build from source

You need Rust (stable), Node.js 24, and [emscripten](https://emscripten.org) 4.0.7 for the WebAssembly build.
The first build downloads prebuilt Skia binaries.

```sh
npm ci
npm run build:native   # Node addon
npm run build:wasm     # WebAssembly
npm run build:ts       # TypeScript
npm test               # full test suite (macOS)
```

## Examples

- [`examples/`](examples): 24 example videos, from lower thirds and kinetic type to physics, code walkthroughs,
  3D and captions, plus a product launch film. Run `examples/make-assets.sh` and `examples/fetch-assets.sh`
  first, then `node examples/render-all.ts`, or render one with `npx skiamovin render`.
- [`examples/keynote`](examples/keynote): the Skiamovin launch film (`24-skiamovin-launch.ts`), about a minute
  cut to the beat, made only from what the library does.
- [`examples/transformer`](examples/transformer): a 97-second explainer of how a Transformer works, with RoPE,
  shot as one continuous camera move. It renders in English (`22-how-transformers-work.ts`) and Khmer
  (`23-how-transformers-work-km.ts`).
- [`examples/web-studio`](examples/web-studio): a Vite app with a live preview, editable props and MP4 export.

## Documentation

Start at [docs/README.md](docs/README.md).

| | |
|---|---|
| [Installation](docs/getting-started/installation.md) | Platforms and bundler setup |
| [Quick start](docs/getting-started/quick-start.md) | Your first video |
| [Guides](docs/README.md#guides) | Drawing, text, shaders, layout, scenes, video, audio, the web |
| [API reference](docs/api/README.md) | Every module and class |
| [Architecture](docs/architecture/overview.md) | How rendering, decoding and encoding fit together |

## License

[MIT](LICENSE)
