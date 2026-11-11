# Sources and sinks

Skiamovin is designed as a companion to [Mediabunny](https://mediabunny.dev). It doesn't have its own container
layer or media types. Every file is read and written by Mediabunny, and every frame and audio buffer that
crosses the boundary is a Mediabunny `VideoSample` or `AudioSample`. Skiamovin's API follows Mediabunny's
patterns, so if you know one library you can predict the other:

| Mediabunny | Skiamovin | Purpose |
|---|---|---|
| `CanvasSource` | [`SurfaceSource`](../api/media.md#surfacesource) | Encode what's on a Skia surface |
| `CanvasSink` | [`ImageSink`](../api/media.md#imagesink) | Decode a video track into Skia images |
| `CanvasSink` | [`CompositionSink`](../api/scene.md#reading-frames-compositionsink) | Pull rendered frames from a composition |
| `AudioSampleSink` | [`CompositionAudioSink`](../api/scene.md#reading-audio-compositionaudiosink) | Pull the mixed audio from a composition |
| `Conversion` | [`Render`](../api/scene.md#rendering-to-a-file-render) | Composition → `Output` |
| `Input` | `Input` (used as is) | Video and audio layers |
| `Source` | `Source` (used as is) | Where assets are loaded from |
| `registerMp3Encoder()` | [`registerNativeCodecs()`](../api/media.md#registernativecodecs) | Add codecs to Mediabunny |

Times are in seconds, construction is cheap, and work happens lazily in async methods, just as in Mediabunny.

```
                  Mediabunny                     Skiamovin                     Mediabunny
     ┌───────────────────────────┐   ┌────────────────────────────┐   ┌──────────────────────────┐
     │ Input → demux → decode    │──▶│ ImageSink → Image          │   │                          │
     │                           │   │      ↓                     │   │                          │
     │                           │   │ Canvas → Surface ──────────┼──▶│ SurfaceSource → encode   │
     │                           │   │                            │   │      → mux → Output      │
     └───────────────────────────┘   └────────────────────────────┘   └──────────────────────────┘
```

## Native codecs on Node

Mediabunny uses WebCodecs, which browsers provide and Node doesn't. Skiamovin adds encoders and decoders through
Mediabunny's [custom coder API](https://mediabunny.dev/guide/supported-formats-and-codecs#custom-coders), the
same way Mediabunny's own extension packages do. `init()` registers them for you. To register them yourself:

```ts
import { registerNativeCodecs } from 'skiamovin/media';

registerNativeCodecs();
```

With the codecs registered, plain Mediabunny code runs on Node with hardware acceleration, and you don't have to
draw anything. For example, a transcode:

```ts
import { registerNativeCodecs } from 'skiamovin/media';
import { Input, Output, Conversion, ALL_FORMATS, FilePathSource, FilePathTarget, Mp4OutputFormat } from 'mediabunny';

registerNativeCodecs();

const conversion = await Conversion.init({
  input: new Input({ formats: ALL_FORMATS, source: new FilePathSource('in.mov') }),
  output: new Output({ format: new Mp4OutputFormat(), target: new FilePathTarget('out.mp4') }),
  video: { codec: 'hevc' },
});
await conversion.execute();
```

## Encoding Skia frames: `SurfaceSource`

`SurfaceSource` works like `CanvasSource`. Pass it a surface and an encoding config, add it to an output, and
call `add(timestamp, duration)` after drawing each frame:

```ts
import { Output, Mp4OutputFormat, BufferTarget, QUALITY_HIGH } from 'mediabunny';
import { SurfaceSource } from 'skiamovin/media';

const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
const videoSource = new SurfaceSource(surface, { codec: 'avc', bitrate: QUALITY_HIGH });
output.addVideoTrack(videoSource, { frameRate: 60 });

await output.start();

for (let i = 0; i < 300; i++) {
  draw(surface.canvas(), i / 60);
  await videoSource.add(i / 60, 1 / 60);
}

videoSource.close();
await output.finalize();
```

On GPU surfaces, the frame goes to the encoder as a texture, without a CPU copy where the platform supports it.

## Decoding into Skia: `ImageSink`

`ImageSink` works like `CanvasSink`, but yields Skia `Image`s. Give it a GPU context and frames stay on the GPU:

```ts
import { Input, ALL_FORMATS, FilePathSource } from 'mediabunny';
import { ImageSink } from 'skiamovin/media';

const input = new Input({ formats: ALL_FORMATS, source: new FilePathSource('clip.mp4') });
const videoTrack = await input.getPrimaryVideoTrack();

if (videoTrack && (await videoTrack.canDecode())) {
  const sink = new ImageSink(videoTrack, { context, poolSize: 2 });

  // A single frame
  const wrapped = await sink.getImage(5);
  wrapped?.image; // Skia Image, texture-backed
  wrapped?.timestamp; // in seconds

  // Every frame in the first 10 seconds
  for await (const { image, timestamp } of sink.images(0, 10)) {
    canvas.drawImage(image, [0, 0]);
  }
}
```

`poolSize` works as in `CanvasSink`. With `0`, every image is new and yours to `delete()`. With `n > 0`, images
are reused in rotation, which is the right choice for frame loops.

## Putting it together: drawing over a video

Decode with `ImageSink`, draw, encode with `SurfaceSource`, and copy the audio across untouched:

```ts
import {
  Input,
  Output,
  ALL_FORMATS,
  FilePathSource,
  FilePathTarget,
  Mp4OutputFormat,
  EncodedPacketSink,
  EncodedAudioPacketSource,
  QUALITY_HIGH,
} from 'mediabunny';
import { init, gpu, ImageInfo, Rect, Paint, Font, FontMgr } from 'skiamovin';
import { ImageSink, SurfaceSource } from 'skiamovin/media';

await init();

const input = new Input({ formats: ALL_FORMATS, source: new FilePathSource('in.mp4') });
const videoTrack = (await input.getPrimaryVideoTrack())!;
const audioTrack = await input.getPrimaryAudioTrack();
const width = videoTrack.displayWidth;
const height = videoTrack.displayHeight;

const context = gpu.directContexts.makeDefault()!;
const surface = gpu.surfaces.renderTarget(context, gpu.Budgeted.Yes, ImageInfo.newN32Premul([width, height]))!;
const canvas = surface.canvas();

const output = new Output({ format: new Mp4OutputFormat(), target: new FilePathTarget('out.mp4') });

const videoSource = new SurfaceSource(surface, { codec: 'avc', bitrate: QUALITY_HIGH });
output.addVideoTrack(videoSource);

const audioSource = audioTrack ? new EncodedAudioPacketSource(audioTrack.codec!) : null;
if (audioSource) output.addAudioTrack(audioSource);

await output.start();

const font = new Font(FontMgr.default().legacyMakeTypeface('sans-serif')!, 48);
const white = new Paint().setColor('#ffffff').setAntiAlias(true);
const plain = new Paint();

for await (const { image, timestamp, duration } of new ImageSink(videoTrack, { context, poolSize: 2 }).images()) {
  canvas.drawImageRect(image, null, Rect.fromWH(width, height), plain);
  canvas.drawStr(`${timestamp.toFixed(2)}s`, [40, height - 40], font, white);
  await videoSource.add(timestamp, duration);
}
videoSource.close();

if (audioTrack && audioSource) {
  const decoderConfig = (await audioTrack.getDecoderConfig())!;
  let first = true;
  for await (const packet of new EncodedPacketSink(audioTrack).packets()) {
    await audioSource.add(packet, first ? { decoderConfig } : undefined);
    first = false;
  }
  audioSource.close();
}

await output.finalize();
input.dispose();
```

In practice the composition layer does all of this in a few lines. See [Video input](video-input.md). The
manual version is useful when you need full control over the pipeline.

## Samples in both directions

When you need a Mediabunny `VideoSample` instead of a source or sink, for example inside a `Conversion`'s
`process` callback, convert directly:

```ts
import { videoSampleFromSurface, videoSampleFromImage, imageFromVideoSample } from 'skiamovin/media';

const sample = videoSampleFromSurface(surface, { timestamp, duration }); // Skia → Mediabunny
const image = await imageFromVideoSample(sample, context); // Mediabunny → Skia
```

For example, applying a Skia effect to every frame of a `Conversion`:

```ts
const conversion = await Conversion.init({
  input,
  output,
  video: {
    process: async (sample) => {
      using frame = await imageFromVideoSample(sample, context);
      canvas.drawImage(frame, [0, 0], vignettePaint);
      return videoSampleFromSurface(surface, { timestamp: sample.timestamp, duration: sample.duration });
    },
  },
});
await conversion.execute();
```

## Compositions in a Mediabunny pipeline

`CompositionSink` and `CompositionAudioSink` pull a composition's frames and audio, so you can build any output
yourself. For example, add a rendered overlay as a second video track:

```ts
const overlay = new CompositionSink(overlayComposition, { poolSize: 2 });
const overlaySource = new VideoSampleSource({ codec: 'vp9', bitrate: QUALITY_HIGH });
output.addVideoTrack(overlaySource, { name: 'Overlay' });

await output.start();
for await (const { image, timestamp, duration } of overlay.images()) {
  const sample = videoSampleFromImage(image, { timestamp, duration });
  await overlaySource.add(sample);
  sample.close();
}
```
