# Running in the browser

> **Status:** the web build uses WebGL2 (WebGPU is planned). Each WebAssembly instance is single-threaded, so
> `Player` and `Render` use Web Workers for parallelism. There are no bundled fallback fonts, so always load a
> `FontAsset`. See [status](../status.md).

A complete Vite app with a live preview, editable props and an export button is in
[`examples/web-studio`](../../examples/web-studio).

The browser build is the same library compiled to WebAssembly. It draws with WebGPU or WebGL2, and Mediabunny
handles encoding and decoding through WebCodecs.

## Setup

`Render`, `CompositionSink` and `Player` initialize Skiamovin on first use. If you use the Skia layer directly,
call `init()` yourself, as early as you can:

```ts
import { init } from 'skiamovin';
await init();
```

`init()` fetches about 9 MB of WASM (about 3.5 MB with Brotli) and compiles it while it downloads. Serve the
`.wasm` file with `Content-Type: application/wasm` and long-term caching.

See [Installation → Browser](../getting-started/installation.md#browser) for bundlers and threading.

## Assets in the browser

Assets and inputs take Mediabunny `Source`s, so only the source class differs from Node:

```ts
import { Input, ALL_FORMATS, UrlSource, BlobSource } from 'mediabunny';

const logo = new ImageAsset(new UrlSource(new URL('./logo.png', import.meta.url)));
const inter = new FontAsset(new UrlSource('/fonts/Inter-Variable.ttf'), { family: 'Inter' });
const clip = new Input({ formats: ALL_FORMATS, source: new UrlSource('/media/clip.mp4') });
```

Users can bring their own media. Wrap a `File` in a `BlobSource`. It's decoded locally and never uploaded:

```ts
fileInput.onchange = () => {
  const userClip = new Input({ formats: ALL_FORMATS, source: new BlobSource(fileInput.files![0]) });
  player.setProps({ clip: userClip });
};
```

Inputs and assets can be passed as props, which suits editors where the user picks the media.

## Render in a worker

Rendering on the page's main thread blocks input and animations for the length of each frame. Put the
composition in a worker instead. Write a small worker entry:

```ts
// promo.worker.ts
import { serveComposition } from 'skiamovin/scene';
import { promo } from './promo';

serveComposition(promo);
```

Then pass a factory for it to `Player` and `Render`:

```ts
const worker = () => new Worker(new URL('./promo.worker.ts', import.meta.url), { type: 'module' });
```

Your bundler sees `new Worker(new URL(...))` and bundles the worker, including its own copy of Skiamovin and the
`.wasm`. Props travel to the worker with `postMessage`, so keep them structured-cloneable (strings, numbers, plain
objects, `File`s). See [Workers in the browser](../api/scene.md#workers-in-the-browser).

## Live preview with `Player`

```ts
import { Player } from 'skiamovin/scene';
import { promo } from './promo';

const player = new Player(promo, {
  canvas: document.querySelector<HTMLCanvasElement>('#preview')!,
  worker,
  loop: true,
  audio: true,
});
await player.ready;

playButton.onclick = () => (player.playing ? player.pause() : player.play());
scrubber.max = String(await player.computeDuration());
scrubber.oninput = () => player.seek(Number(scrubber.value));
player.onTimeUpdate = (timestamp) => (scrubber.value = String(timestamp));
titleInput.oninput = () => player.setProps({ title: titleInput.value }); // re-renders the current frame
```

`Player` renders on the page's GPU (WebGL2) and presents each frame to your canvas through a `bitmaprenderer`
context, so the canvas must not already have a `2d` or `webgl` context. At 1080p it holds 60 fps. Seeks and prop
changes render immediately. Playback drops frames rather than drifting.

Size the canvas with CSS. `Player` renders at the composition's resolution; use `scale: 0.5` for cheaper previews.

## Exporting in the browser

```ts
import { Output, Mp4OutputFormat, BufferTarget } from 'mediabunny';
import { Render } from 'skiamovin/scene';

const target = new BufferTarget();
const render = await Render.init({
  composition: promo,
  worker, // renders and encodes in the worker; audio is mixed here
  props,
  output: new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target }),
});
render.onProgress = (p) => (progressBar.value = p);
await render.execute();

const url = URL.createObjectURL(new Blob([target.buffer!], { type: 'video/mp4' }));
```

The worker encodes with WebCodecs and sends the encoded packets back; the page writes them into your `Output`
without re-encoding. Pass `concurrency: 2` or more to split long renders across several workers in
keyframe-aligned chunks. A 6-second 1080p30 export from the example app takes about 1.1 s on an M3 Max,
including worker start-up.

### Bitrate and quality

`Render` defaults to `new Quality({ quality: 'high', preferBitrate: true })`, which uses bitrate-based rate
control. Mediabunny's `QUALITY_*` constants use quantizer (constant QP) mode where the codec supports it. In
Chrome on macOS, the first quantizer-mode export in a session spends about two seconds starting the hardware
encoder, and it encodes more slowly. Prefer a number or a `preferBitrate` quality for interactive exports:

```ts
import { Quality } from 'mediabunny';

await Render.init({
  composition,
  output,
  video: { bitrate: new Quality({ quality: 'very-high', preferBitrate: true }) },
});
```

### Large outputs: stream to disk

`BufferTarget` keeps the whole file in memory. For long or high-bitrate exports, use a `StreamTarget` with the
File System Access API:

```ts
const handle = await showSaveFilePicker({ suggestedName: 'promo.mp4' });
const writable = await handle.createWritable();

const output = new Output({
  format: new Mp4OutputFormat(),
  target: new StreamTarget(writable, { chunked: true }),
});
await (await Render.init({ composition: promo, output })).execute();
```

## Codec support differs by browser

Use Mediabunny's helpers to choose a codec that works in the current browser:

```ts
import { getFirstEncodableVideoCodec } from 'mediabunny';

const codec = await getFirstEncodableVideoCodec(['av1', 'hevc', 'vp9', 'avc'], { width: 1920, height: 1080 });
const render = await Render.init({ composition, output, video: { codec: codec ?? undefined } });
```

If you leave `codec` out, `Render` makes this choice itself, from the codecs the output format supports.

## WebGPU vs WebGL2

Skiamovin prefers WebGPU (Skia Graphite) and falls back to WebGL2 (Ganesh). Both draw everything. WebGPU is
faster for shader-heavy and blur-heavy scenes, and has a direct path from `VideoFrame` to texture for video
layers. Force one with `gpu: 'webgpu'` or `gpu: 'webgl2'` in `Render.init`, `CompositionSink` or `Player`.

## Memory

The WASM heap can grow to 4 GiB. Most memory lives on the GPU (textures, render targets) and in WebCodecs
(decoded frames). To keep it bounded:

- Close Mediabunny samples promptly in Skia-layer code. The composition layer does this for you.
- Use `poolSize` on `ImageSink` and `CompositionSink` in loops.
- Call `player.dispose()` when you unmount a preview, and `input.dispose()` for inputs you no longer need.
