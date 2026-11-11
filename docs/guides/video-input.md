# Video input

Existing videos are layers like any other: lay them out, transform them, mask them, shade them. You don't wrap
them in anything Skiamovin-specific. A video layer takes a Mediabunny **`Input`**. Decoding goes through
Mediabunny (native hardware decoders on Node, WebCodecs in the browser), and decoded frames reach Skia as GPU
textures without a CPU copy.

## The `video` node

```ts
import { Input, ALL_FORMATS, FilePathSource } from 'mediabunny';
import { Composition, box, video } from 'skiamovin/scene';

const interview = new Input({ formats: ALL_FORMATS, source: new FilePathSource('./interview.mp4') });

const composition = new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: () => interview.computeDuration(),
  render: () =>
    box({ size: { width: '100%', height: '100%' } }, [
      video(interview, { fit: 'cover', size: { width: '100%', height: '100%' } }),
    ]),
});
```

Any Mediabunny `Source` works: `FilePathSource` on Node, `UrlSource` for HTTP (with range requests), and
`BlobSource` for a user's `File` in the browser. As with any `Input`, nothing is read until it's needed.

By default the node uses the input's primary video track (and primary audio track for sound). To pick a track
yourself, pass it instead:

```ts
const [angleA, angleB] = await multicam.getVideoTracks();
video(angleB, { fit: 'cover' });
```

### Trimming, speed, looping

Trim works like Mediabunny's `Conversion` `trim`, in seconds of the source:

```ts
video(broll, { trim: { start: 12.5, end: 18 }, playbackRate: 1.5 });
video(backgroundLoop, { loop: true, muted: true });
```

### Placing in time

Put a video in a `sequence` to start it later. Its playback starts when the sequence does:

```ts
sequence({ start: 3, end: 7 }, () => video(broll, { trim: { start: 4 } }));
```

### Picture-in-picture, split screen, grids

Video nodes are ordinary layout items:

```ts
box({ display: 'grid', gridTemplateColumns: ['1fr', '1fr'], gap: 8, size: { width: '100%', height: '100%' } }, [
  video(cameraA, { fit: 'cover', borderRadius: 16 }),
  video(cameraB, { fit: 'cover', borderRadius: 16 }),
]);
```

### Effects

Everything that works on other nodes works on video:

```ts
video(clip, { blur: 20, colorFilter: grayscale, opacity: 0.4 }); // background plate
shader(VHS, { children: { content: video(clip, { fit: 'cover' }) } }); // custom shader
```

## Frame accuracy

Skiamovin shows the source frame **whose time span contains** the requested timestamp, the same frame Mediabunny's
`getSample(timestamp)` returns and a player would show. When the composition's frame rate differs from the
source's (a 24 fps source in a 30 fps composition, say), frames repeat or drop as they would in an editor.
There's no frame blending.

Sequential rendering decodes forward with no seeking, and a few frames are decoded ahead of time. Random access
(scrubbing in `Player`, parallel workers) seeks to the nearest earlier keyframe and decodes forward. Short-GOP or
intra-only sources (ProRes, all-intra H.264) seek fastest.

## Supported inputs

Any container Mediabunny reads (MP4, MOV, WebM, MKV, MPEG-TS, …) with any codec the runtime can decode:

- **Node:** H.264, HEVC, VP8, VP9 and AV1 everywhere (hardware where available), plus ProRes on macOS.
- **Web:** whatever the browser's WebCodecs supports. Check with `await track.canDecode()`.

HDR sources (PQ/HLG) are tone-mapped to the composition's color space unless you render in an HDR color space.
See [Rendering → color](rendering.md#color-and-hdr).

## At the Skia layer

Use [`ImageSink`](mediabunny.md#decoding-into-skia-imagesink), the Skia counterpart of `CanvasSink`:

```ts
import { ImageSink } from 'skiamovin/media';

const sink = new ImageSink(videoTrack, { context, poolSize: 2 });
const timestamps = Array.from({ length: totalFrames }, (_, i) => i / frameRate);

for await (const wrapped of sink.imagesAtTimestamps(timestamps)) {
  canvas.drawImageRect(wrapped!.image, null, Rect.fromWH(width, height), paint);
  await videoSource.add(wrapped!.timestamp, 1 / frameRate);
}
```

`imagesAtTimestamps` is the efficient way to resample a video to your own frame rate. Repeated source frames are
decoded only once.
