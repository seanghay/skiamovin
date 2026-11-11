# Audio

Skiamovin mixes every audible node into one track, which `Render` encodes next to the video.

Audible nodes:

- `audio(input, options)`: music, voice-over, sound effects
- `video(input, …)`: the clip's own audio, unless `muted`

Both take Mediabunny `Input`s (or specific `InputAudioTrack`s), so any format Mediabunny can decode works: MP3,
AAC/M4A, Opus, Vorbis, FLAC, WAV/PCM, and the audio of video files.

## Adding audio

```ts
import { Input, ALL_FORMATS, FilePathSource } from 'mediabunny';
import { Composition, audio, sequence, box } from 'skiamovin/scene';

const open = (path: string) => new Input({ formats: ALL_FORMATS, source: new FilePathSource(path) });

const music = open('./music.mp3');
const whoosh = open('./whoosh.wav');
const voiceover = open('./voiceover.m4a');

const composition = new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 30,
  render: () =>
    box({}, [
      audio(music, { volume: 0.4, loop: true }),
      sequence({ start: 1 }, () => audio(voiceover)),
      sequence({ start: 2.9, end: 3.6 }, () => audio(whoosh, { volume: 0.8 })),
      /* visuals ... */
    ]),
});
```

## Timing

An audio node plays while it's in the tree, timed by its enclosing sequence:

- `sequence({ start: 1 }, () => audio(a))` starts `a` at 1 second.
- `trim: { start, end }` selects part of the source, in seconds, like Mediabunny's `Conversion` `trim`.
- A sequence with an `end` cuts the sound off there.
- `loop: true` repeats the (trimmed) source to fill the sequence.

Audio is scheduled to the sample, not snapped to video frames.

## Volume and fades

`volume` is a number, or a function of the node's local timestamp:

```ts
audio(music, {
  volume: (t) => interpolate(t, [0, 1, 29, 30], [0, 0.5, 0.5, 0]), // fade in and out
});
```

The function is evaluated per 128-sample block and smoothed, so fades don't click.

### Ducking

Lower the music under a voice-over:

```ts
const voiceStart = 1;
const voiceEnd = voiceStart + (await voiceover.computeDuration()); // top-level await, outside render

audio(music, {
  volume: (t) => 0.6 - 0.45 * interpolate(t, [voiceStart - 0.3, voiceStart, voiceEnd, voiceEnd + 0.5], [0, 1, 1, 0]),
});
```

## Output settings

Audio encoding is configured on the `Render`, like the `audio` options of a Mediabunny `Conversion`:

```ts
await Render.init({ composition, output, audio: { codec: 'aac', bitrate: 192_000 } });
await Render.init({ composition, output: webmOutput, audio: { codec: 'opus' } });
await Render.init({ composition, output, audio: { discard: true } });
```

The mixer works in 32-bit float and applies a soft limiter before encoding, so many overlapping sounds don't
clip. The default is 48 kHz stereo.

## Getting the mix: `CompositionAudioSink`

To process the audio yourself, pull it out as Mediabunny `AudioSample`s. `CompositionAudioSink` works like
`AudioSampleSink`:

```ts
import { CompositionAudioSink } from 'skiamovin/scene';

const sink = new CompositionAudioSink(composition, { sampleRate: 48_000 });

for await (const sample of sink.samples()) {
  await myAudioSource.add(sample);
  sample.close();
}
```

## Preview

In the browser, `Player` plays the same mix through Web Audio, in sync with the picture:

```ts
new Player(composition, { canvas, audio: true });
```

## Audio-reactive visuals

`render` must stay pure, so analyze the audio once and read the results by timestamp:

```ts
import { analyzeAudio } from 'skiamovin/scene';

const track = open('./track.mp3');
const analysis = await analyzeAudio(track, { frameRate: 30, bands: 32 }); // module scope

const visualizer = new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: () => track.computeDuration(),
  render: ({ timestamp }) =>
    box({ flexDirection: 'row', alignItems: 'flex-end', gap: 4, size: { width: '100%', height: '100%' } }, [
      audio(track),
      ...Array.from(analysis.getBands(timestamp), (v) =>
        box({ size: { width: 20, height: v * 400 }, background: '#22d3ee' }),
      ),
    ]),
});
```
