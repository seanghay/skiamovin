import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FilePathSource } from 'mediabunny';
import { AlphaType, ColorType, ImageInfo, init } from 'skiamovin';
import {
  box,
  Composition,
  CompositionSink,
  type Cue,
  captions,
  cuesFromWords,
  FontAsset,
  parseCaptions,
} from 'skiamovin/scene';

const SRT = `1
00:00:01,000 --> 00:00:02,500
Hello <i>world</i>

2
00:00:03,000 --> 00:00:04,000
Second line
`;

const VTT = `WEBVTT

intro
00:00.000 --> 00:02.000
<00:00.000>Make <00:00.400>videos <00:01.000>with code
`;

test('captions: parse SRT and WebVTT with word timings', () => {
  const srt = parseCaptions(SRT);
  assert.equal(srt.length, 2);
  assert.deepEqual(
    srt.map((c) => [c.start, c.end, c.text]),
    [
      [1, 2.5, 'Hello world'],
      [3, 4, 'Second line'],
    ],
  );
  assert.equal(srt[0]!.words, undefined);
  const vtt = parseCaptions(VTT);
  assert.equal(vtt.length, 1);
  assert.equal(vtt[0]!.text, 'Make videos with code');
  assert.deepEqual(
    vtt[0]!.words!.map((w) => [w.text, w.start, w.end]),
    [
      ['Make', 0, 0.4],
      ['videos', 0.4, 1],
      ['with', 1, 2],
      ['code', 1, 2],
    ],
  );
});

test('captions: group timed words into cues', () => {
  const words = 'One two three. Four five six seven eight nine ten eleven twelve'.split(' ').map((text, i) => ({
    text,
    start: i * 0.3 + (i >= 6 ? 1 : 0),
    end: i * 0.3 + 0.25 + (i >= 6 ? 1 : 0),
  }));
  const cues = cuesFromWords(words, { maxChars: 20 });
  // A sentence end, a pause before "seven", and the length limit each start a cue.
  assert.deepEqual(
    cues.map((c) => c.text),
    ['One two three.', 'Four five six', 'seven eight nine ten', 'eleven twelve'],
  );
  for (const c of cues) assert.ok(c.end > c.start && c.words!.length > 0);
});

test('captions: draw the cue at the current time', async () => {
  await init();
  const arial = new FontAsset(new FilePathSource('/System/Library/Fonts/Supplemental/Arial.ttf'), { family: 'Arial' });
  const cues: Cue[] = parseCaptions(SRT);
  const lit = async (time: number, preset: 'subtitle' | 'karaoke' | 'pop' | 'word') => {
    const comp = new Composition({
      width: 400,
      height: 120,
      frameRate: 30,
      duration: 5,
      background: '#000000',
      fonts: [arial],
      render: () => box({ size: { width: '100%', height: '100%' } }, [captions(cues, { preset, fontSize: 32 })]),
    });
    const sink = new CompositionSink(comp, { gpu: 'raster' });
    const px = (await sink.getImage(time))!.image.readPixels(
      0,
      0,
      new ImageInfo(400, 120, ColorType.RGBA_8888, AlphaType.Unpremul),
    );
    await sink.dispose();
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i]! > 200) n++;
    return n;
  };
  for (const preset of ['subtitle', 'karaoke', 'pop', 'word'] as const) {
    assert.equal(await lit(0.5, preset), 0, `${preset}: nothing before the first cue`);
    assert.ok((await lit(1.8, preset)) > 50, `${preset}: drawn during a cue`);
    assert.equal(await lit(2.8, preset), 0, `${preset}: nothing between cues`);
  }
  // Pop shows words as they're spoken: more of the line later in the cue.
  assert.ok((await lit(1.2, 'pop')) < (await lit(2.2, 'pop')));
});
