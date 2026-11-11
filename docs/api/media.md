# `skiamovin/media`

```ts
import {
  registerNativeCodecs,
  SurfaceSource,
  ImageSink,
  videoSampleFromSurface,
  videoSampleFromImage,
  imageFromVideoSample,
} from 'skiamovin/media';
```

Skiamovin works with [Mediabunny](https://mediabunny.dev) rather than replacing it. Mediabunny handles reading and
writing MP4/WebM/MOV/MKV. This module adds what Mediabunny doesn't have:

1. **Native codecs for Node**, registered through Mediabunny's custom coder API, so `Output`, `Input` and
   `Conversion` work on a server the same as in a browser.
2. **A source and a sink for Skia**: `SurfaceSource` (the Skia counterpart of `CanvasSource`) and `ImageSink`
   (the Skia counterpart of `CanvasSink`).
3. **Zero-copy conversions** between Skia images and surfaces and Mediabunny `VideoSample`s.

Times are in seconds throughout, as in Mediabunny.

See the [sources and sinks guide](../guides/mediabunny.md).

---

## `registerNativeCodecs`

```ts
function registerNativeCodecs(options?: {
  /** Default 'auto': hardware where available, software otherwise. */
  prefer?: 'auto' | 'hardware' | 'software';
  /** Codecs to leave alone. */
  exclude?: (VideoCodec | AudioCodec)[];
}): void;
```

Registers Skiamovin's encoders and decoders with Mediabunny (`registerEncoder` / `registerDecoder`). This works
the same way as Mediabunny's own extensions, such as `registerMp3Encoder()` from `@mediabunny/mp3-encoder`.

`init()` calls it for you on Node. Opt out with `init({ registerNativeCodecs: false })`. In the browser it does
nothing, since Mediabunny already uses WebCodecs.

| Codec | Encode | Decode |
|---|---|---|
| `avc` (H.264) | VideoToolbox | VideoToolbox |
| `hevc` (H.265) | VideoToolbox, incl. alpha | VideoToolbox |
| `aac` | AudioToolbox (AAC-LC, mono/stereo) | AudioToolbox |
| `mp3` | none | AudioToolbox |

This is the current macOS implementation. Linux and Windows backends, and software VP8/VP9/AV1/Opus, are planned
(see [status](../status.md)). PCM is handled by Mediabunny itself.

Once registered, Mediabunny's own capability checks include these codecs. Use them as usual:

```ts
import { canEncodeVideo, getFirstEncodableVideoCodec } from 'mediabunny';

await canEncodeVideo('hevc'); // true on a Mac
await getFirstEncodableVideoCodec(['av1', 'hevc', 'avc'], { width: 1920, height: 1080 });
```

To find out whether a codec runs in hardware, check [`gpu.info()`](gpu.md#gpuinfo).

---

## `SurfaceSource`

```ts
class SurfaceSource extends VideoSource {
  constructor(surface: Surface, encodingConfig: VideoEncodingConfig);
  add(timestamp: number, duration?: number, encodeOptions?: VideoEncoderEncodeOptions): Promise<void>;
}
```

A Mediabunny video source that captures a Skia surface each time you call `add`. It works exactly like
Mediabunny's [`CanvasSource`](https://mediabunny.dev/guide/media-sources#canvassource), with a `Surface` in
place of a canvas. `encodingConfig` is Mediabunny's `VideoEncodingConfig` (`codec`, `bitrate`,
`keyFrameInterval`, `latencyMode`, `bitrateMode`, …).

```ts
const source = new SurfaceSource(surface, { codec: 'avc', bitrate: QUALITY_HIGH });
output.addVideoTrack(source, { frameRate: 30 });
await output.start();

for (let i = 0; i < 90; i++) {
  draw(surface.canvas(), i / 30);
  await source.add(i / 30, 1 / 30);
}

source.close();
await output.finalize();
```

`add()` flushes the surface's GPU work and passes its texture to the encoder without a copy when
[`gpu.info().zeroCopyEncode`](gpu.md#gpuinfo) is true. As with `CanvasSource`, wait for `add()` to resolve
before you draw the next frame. Its promise also gives you backpressure.

---

## `ImageSink`

```ts
class ImageSink {
  constructor(
    videoTrack: InputVideoTrack,
    options?: {
      /** GPU context to decode into. Without one, images are raster. */
      context?: gpu.DirectContext | gpu.graphite.Recorder;
      width?: number;
      height?: number;
      fit?: 'fill' | 'contain' | 'cover';
      /** Reuse this many images in rotation. Default 0 (a new image per frame). */
      poolSize?: number;
    },
  );

  getImage(timestamp: number): Promise<WrappedImage | null>;
  images(startTimestamp?: number, endTimestamp?: number): AsyncGenerator<WrappedImage>;
  imagesAtTimestamps(timestamps: Iterable<number> | AsyncIterable<number>): AsyncGenerator<WrappedImage | null>;
}

interface WrappedImage {
  image: Image;
  timestamp: number; // seconds
  duration: number; // seconds
}
```

The Skia counterpart of Mediabunny's [`CanvasSink`](https://mediabunny.dev/guide/media-sinks#canvassink), with
the same methods and semantics. It decodes the track and gives you Skia `Image`s.

With a GPU `context`, decoded frames are imported as textures without a CPU copy (`CVPixelBuffer`, VA
surfaces, D3D textures on Node; `VideoFrame` imports on the web), and YUV → RGB conversion runs on the GPU. Each
frame is then copied GPU-to-GPU into an image the sink owns, so the image stays valid after the decoder moves
on.

- With `poolSize: 0` the images are yours. Call `image.delete()` when you're done (or use `using`).
- With `poolSize: n`, images are reused in rotation. An image stays valid until `n` more have been yielded.
  This is the right setting for sequential rendering loops.

`imagesAtTimestamps` is the efficient way to sample a video at an unrelated frame rate, for example a 24 fps
source in a 30 fps composition. Consecutive timestamps that land on the same source frame decode it once.

---

## `videoSampleFromSurface` and `videoSampleFromImage`

```ts
function videoSampleFromSurface(surface: Surface, init: { timestamp: number; duration?: number }): VideoSample;
function videoSampleFromImage(image: Image, init: { timestamp: number; duration?: number }): VideoSample;
```

Wraps Skia pixels as a Mediabunny `VideoSample` that you can pass to any Mediabunny API: `VideoSampleSource.add`,
a `Conversion`'s `process` function, `sample.draw()`, and so on. For texture-backed input, the sample references
the texture, and Skiamovin's encoders read it directly. Anything else that reads the sample triggers a lazy
readback.

Close the sample (`sample.close()`) before drawing into the surface again.

## `imageFromVideoSample`

```ts
function imageFromVideoSample(sample: VideoSample, context?: gpu.DirectContext | null): Promise<Image>;
```

The reverse: a Mediabunny `VideoSample` as a Skia `Image`. With a GPU `context` the image is uploaded to the GPU;
without one it's a raster image. The image owns its pixels, so you can close the sample right away. (Zero-copy
import of decoder surfaces is planned; see [status](../status.md).)
