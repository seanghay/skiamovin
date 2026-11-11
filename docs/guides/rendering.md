# Rendering compositions

> **Status:** `Render`, codecs via Mediabunny, trims, sizes, alpha options and multi-worker `concurrency` are
> implemented. On Node, the native encoders cover H.264/HEVC + AAC (MP4/MOV). HDR encoding and the `npx skiamovin`
> CLI are planned. See [status](../status.md).

Rendering a composition to a file works like converting a file with Mediabunny's
[`Conversion`](https://mediabunny.dev/guide/converting-media-files): create an `Output`, initialize a `Render`,
check that it's valid, and execute it.

```ts
import { Output, Mp4OutputFormat, FilePathTarget } from 'mediabunny';
import { Render } from 'skiamovin/scene';

const output = new Output({
  format: new Mp4OutputFormat(),
  target: new FilePathTarget('out.mp4'),
});

const render = await Render.init({ composition, output });

if (!render.isValid) {
  console.error('Cannot render:', render.discardedTracks);
} else {
  render.onProgress = (progress) => console.log(`${(progress * 100).toFixed(1)}%`);
  await render.execute();
}
```

The `Output` must be fresh: not started, with no tracks. `Render` adds a video track (and an audio track if
anything is audible), starts the output, renders, and finalizes it. Everything else about the file
(container, target, fast start, metadata) is configured on the `Output`, as usual in Mediabunny:

```ts
import { Output, Mp4OutputFormat, StreamTarget } from 'mediabunny';

// Stream to an HTTP response or an S3 upload without holding the whole file in memory
const output = new Output({
  format: new Mp4OutputFormat({ fastStart: 'fragmented' }),
  target: new StreamTarget(writableStream),
});
output.setMetadataTags({ title: 'Launch video' });
```

## Video options

```ts
const render = await Render.init({
  composition,
  output,
  video: {
    codec: 'hevc',
    bitrate: QUALITY_HIGH,
    keyFrameInterval: 1,
    width: 1280, // scaled from the composition size, at render time (not a resample)
    height: 720,
  },
});
```

### Codecs

If you don't set `codec`, `Render` picks the first codec the output format supports that can be encoded in
this runtime, the same rule `Conversion` uses.

| Codec | `codec` | Notes |
|---|---|---|
| H.264 | `'avc'` | Plays everywhere |
| H.265 | `'hevc'` | About 40% smaller at equal quality. On Node, needs a hardware encoder (there's no software HEVC encoder) |
| VP9 | `'vp9'` | Supports alpha in WebM |
| AV1 | `'av1'` | Smallest files. Slow in software |
| VP8 | `'vp8'` | Legacy |

Check support with Mediabunny's own helpers. On Node they also see Skiamovin's native codecs:

```ts
import { getFirstEncodableVideoCodec } from 'mediabunny';

const codec = await getFirstEncodableVideoCodec(output.format.getSupportedVideoCodecs(), { width: 1920, height: 1080 });
```

If no codec works, `render.isValid` is `false` and `discardedTracks` contains
`{ type: 'video', reason: 'no_encodable_target_codec' }`.

### Quality

`bitrate` takes a number (bits/s) or a Mediabunny `Quality` (`QUALITY_VERY_LOW` … `QUALITY_VERY_HIGH`), which
scales with resolution, frame rate and codec. The default is `QUALITY_HIGH`. Motion graphics with flat colors and
gradients show banding and blocking first, so prefer a higher bitrate or `bitrateMode: 'variable'` for them.

### Transparent video

```ts
const render = await Render.init({
  composition, // with no `background`
  output: new Output({ format: new WebMOutputFormat(), target: new FilePathTarget('overlay.webm') }),
  video: { codec: 'vp9', alpha: 'keep' },
});
```

On macOS, `{ codec: 'hevc', alpha: 'keep' }` into a `MovOutputFormat` produces HEVC with alpha, which plays in
Safari and Final Cut Pro.

## Audio options

```ts
audio: { codec: 'aac', bitrate: 192_000, sampleRate: 48_000, numberOfChannels: 2 }
audio: { discard: true }            // video only
audio: { forceTrack: true }         // silent track even if nothing is audible (some platforms require audio)
```

When nothing in the composition is audible, no audio track is written. `discardedTracks` then includes
`{ type: 'audio', reason: 'nothing_audible' }`.

## Trimming and props

```ts
await Render.init({
  composition,
  output,
  props: { title: 'Hello' },
  trim: { start: 4, end: 8 }, // seconds
});
```

## Cancellation

```ts
const render = await Render.init({ composition, output });
const done = render.execute();
cancelButton.onclick = () => render.cancel(); // stops workers and cancels the Output
await done;
```

## Concurrency

On Node, `Render` can split the work across worker threads. Each worker owns a GPU context and an encoder and
renders a keyframe-aligned chunk. The encoded chunks are then joined into the output without re-encoding.
Workers import the composition themselves, so pass it as a `CompositionModule`:

```ts
import { CompositionModule, Render } from 'skiamovin/scene';

const render = await Render.init({
  composition: new CompositionModule(new URL('./promo.ts', import.meta.url)), // default export
  output,
  concurrency: 'auto',
});
```

How much it helps depends on the bottleneck:

| Bottleneck | Effect of concurrency |
|---|---|
| CPU-side scene work (layout, many `draw` callbacks) | Near-linear speedup up to the core count |
| Encoder | Limited by hardware encoder sessions: 2–8 on consumer GPUs, more on datacenter GPUs |
| GPU shading (heavy SkSL, big blurs) | Little gain on one GPU. Scales across GPUs |
| Video decoding | Each worker decodes its own chunk, so it scales with decoder sessions |

See [Performance](../architecture/performance.md) for tuning. In the browser, run `Render` inside a
[dedicated worker](web.md#exporting-in-the-browser).

## Stills and frames

To get images instead of a file, use `CompositionSink`. It works like Mediabunny's `CanvasSink`, but yields Skia
`Image`s:

```ts
import { CompositionSink } from 'skiamovin/scene';
import { EncodedImageFormat } from 'skiamovin';

const sink = new CompositionSink(composition, { width: 640, height: 360 });

// One still
const thumb = await sink.getImage(1.5);
await writeFile('thumb.png', thumb!.image.encodeToData(EncodedImageFormat.PNG)!.asBytes());

// A contact sheet
for await (const { image, timestamp } of sink.imagesAtTimestamps([0, 2, 4, 6, 8])) {
  sheetCanvas.drawImage(image, [(timestamp / 2) * 640, 0]);
}

// Every frame in a range
for await (const { image, timestamp, duration } of sink.images(2, 4)) {
  // ...
}
```

## Color and HDR

The default pipeline is 8-bit sRGB with BT.709 in the bitstream, which is right for nearly all web delivery.
For wide gamut or HDR, set the color space on the composition and on the video:

```ts
const composition = new Composition({ /* ... */ colorSpace: 'rec2020-pq' });

await Render.init({ composition, output, video: { codec: 'hevc', colorSpace: 'rec2020-pq' } });
```

With an HDR color space, Skiamovin renders into an `F16` surface in linear Rec. 2020 and converts to 10-bit at
encode time. `Color4f` values in your scene can then exceed 1.0. SDR media are placed at a 203-nit reference
white.

## CLI

```sh
npx skiamovin render src/promo.ts out/promo.mp4 --codec hevc --concurrency auto --props-file data.json
npx skiamovin still src/promo.ts out/thumb.png --timestamp 1.5 --width 640
npx skiamovin info
```
