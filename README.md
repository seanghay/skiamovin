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
- **Layout.** Flexbox, CSS Grid and block layout from [Taffy](https://github.com/DioxusLabs/taffy).
- **Scenes.** Describe each frame as a tree of boxes, text, images, video and audio. Skiamovin handles layout,
  animation helpers, audio mixing and encoding. Or draw every frame yourself with the canvas.
- **Fast on macOS.** Frames render on the GPU with Metal and go to the hardware encoder without copying pixels.
- **In the browser.** The same API runs as WebAssembly with WebGL2. Previews and exports run in Web Workers and
  encode with WebCodecs.

See [docs/status.md](docs/status.md) for exactly what each platform supports today.

| Platform | Drawing | Video encoding and decoding |
|---|---|---|
| macOS (Apple silicon) | GPU (Metal) | Hardware (VideoToolbox) |
| Linux, Windows | CPU | Not yet |
| Browsers | GPU (WebGL2) | WebCodecs |

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

- [`examples/`](examples): ten short example videos and a product launch film. Run
  `examples/make-assets.sh` first to generate the media they use, then `node examples/render-all.ts`.
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
