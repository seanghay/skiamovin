import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALL_FORMATS,
  AudioSampleSink,
  BufferSource,
  BufferTarget,
  FilePathSource,
  Input,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';
import {
  type AudioRole,
  audio,
  box,
  Composition,
  CompositionAudioSink,
  deliveryPresets,
  LoudnessMeter,
  loudnessGain,
  Render,
  sequence,
} from 'skiamovin/scene';
import { OUT, prepareTestMedia } from './fixtures/media.ts';

/** Interleaved stereo sine at `dbfs` peak, with optional silence after it. */
function sine(dbfs: number, seconds: number, silence = 0, sampleRate = 48000): Float32Array {
  const n = Math.round(seconds * sampleRate),
    m = Math.round(silence * sampleRate);
  const out = new Float32Array((n + m) * 2);
  const a = 10 ** (dbfs / 20);
  for (let i = 0; i < n; i++) out[i * 2] = out[i * 2 + 1] = a * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
  return out;
}

test('loudness: EBU R128 reference tone and gating', () => {
  // EBU Tech 3341 case 1: a stereo 1 kHz sine at −23 dBFS measures −23 LUFS.
  for (const rate of [44100, 48000]) {
    const m = new LoudnessMeter(rate, 2);
    m.add(sine(-23, 20, 0, rate));
    assert.ok(Math.abs(m.integrated() - -23) < 0.1, `${m.integrated()} at ${rate} Hz`);
  }
  // Silence is gated out, so it doesn't lower the result.
  const gated = new LoudnessMeter(48000, 2);
  gated.add(sine(-20, 10, 10));
  assert.ok(Math.abs(gated.integrated() - -20) < 0.1, `${gated.integrated()}`);
  assert.equal(new LoudnessMeter(48000, 2).integrated(), -Infinity);
  // Gain to the target, held back by the peak limit.
  assert.ok(Math.abs(loudnessGain(-20, 0.1, -14) - 10 ** (6 / 20)) < 1e-9);
  assert.ok(Math.abs(loudnessGain(-20, 0.8, -14) - 10 ** (-1 / 20) / 0.8) < 1e-9);
  assert.equal(loudnessGain(-Infinity, 0, -14), 1);
});

test('loudness: Render normalizes the mix', async () => {
  prepareTestMedia();
  const tone = new Input({ formats: ALL_FORMATS, source: new FilePathSource(`${OUT}tone.mp3`) });
  const comp = new Composition({
    width: 64,
    height: 64,
    frameRate: 30,
    duration: 2,
    render: () => [box({ size: { width: '100%', height: '100%' }, background: '#000' }), audio(tone, { volume: 0.1 })],
  });
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const render = await Render.init({
    composition: comp,
    output,
    audio: { loudness: deliveryPresets.youtube.audio.loudness },
  });
  await render.execute();
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(output.target.buffer!) });
  const track = (await input.getPrimaryAudioTrack())!;
  const meter = new LoudnessMeter(await track.getSampleRate(), await track.getNumberOfChannels());
  for await (const s of new AudioSampleSink(track).samples()) {
    const buf = new Float32Array(s.numberOfFrames * s.numberOfChannels);
    s.copyTo(buf, { planeIndex: 0, format: 'f32' });
    meter.add(buf);
    s.close();
  }
  assert.ok(Math.abs(meter.integrated() - -14) < 0.5, `${meter.integrated()} LUFS`);
  tone.dispose();
});

test('audio roles: music ducks under dialogue, and stems keep one role', async () => {
  prepareTestMedia();
  const tone = new Input({ formats: ALL_FORMATS, source: new FilePathSource(`${OUT}tone.mp3`) });
  const comp = new Composition({
    width: 10,
    height: 10,
    frameRate: 30,
    duration: 3,
    render: () => [
      audio(tone, { role: 'music', volume: 0.3, loop: true }),
      sequence({ start: 1, end: 2 }, () => audio(tone, { role: 'dialogue', volume: 0.3 })),
    ],
  });
  /** RMS of a stem between two times. */
  const rms = async (roles: AudioRole[], from: number, to: number) => {
    const sink = new CompositionAudioSink(comp, { roles });
    let sum = 0,
      n = 0;
    for await (const s of sink.samples()) {
      const buf = new Float32Array(s.numberOfFrames * 2);
      s.copyTo(buf, { planeIndex: 0, format: 'f32' });
      for (let i = 0; i < s.numberOfFrames; i++) {
        const t = s.timestamp + i / s.sampleRate;
        if (t >= from && t < to) {
          sum += buf[i * 2]! ** 2;
          n++;
        }
      }
      s.close();
    }
    return Math.sqrt(sum / Math.max(1, n));
  };
  const open = await rms(['music'], 0.2, 0.8);
  const ducked = await rms(['music'], 1.2, 1.8);
  const db = 20 * Math.log10(ducked / open);
  assert.ok(Math.abs(db - -12) < 0.5, `ducked by ${db} dB`);
  assert.ok((await rms(['dialogue'], 0.2, 0.8)) < 1e-4, 'no dialogue before it starts');
  assert.ok((await rms(['dialogue'], 1.2, 1.8)) > 0.01, 'dialogue stem');
  tone.dispose();
});
