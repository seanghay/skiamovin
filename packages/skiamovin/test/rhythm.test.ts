import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beatAt, detectRhythm, parseMidi, pulse } from 'skiamovin/scene';

const SR = 44100;

/** Short decaying tone bursts every `60 / bpm` seconds, starting at `start`, over quiet noise. */
function clicks(bpm: number, seconds: number, start = 0.25): Float32Array {
  const out = new Float32Array(Math.round(SR * seconds));
  let seed = 1;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32 - 0.5;
  };
  for (let i = 0; i < out.length; i++) out[i] = rand() * 0.01;
  for (let t = start; t < seconds; t += 60 / bpm) {
    const at = Math.round(t * SR);
    for (let i = 0; i < SR * 0.04 && at + i < out.length; i++)
      out[at + i]! += Math.sin((2 * Math.PI * 1000 * i) / SR) * Math.exp(-i / (SR * 0.008)) * 0.8;
  }
  return out;
}

test('rhythm: finds onsets, tempo and beats in a click track', () => {
  for (const bpm of [90, 120, 150]) {
    const r = detectRhythm(clicks(bpm, 12), SR);
    assert.ok(Math.abs(r.tempo - bpm) < 1.5, `tempo ${r.tempo} for ${bpm}`);
    const expected = Math.floor((12 - 0.25) / (60 / bpm)) + 1;
    assert.ok(Math.abs(r.onsets.length - expected) <= 1, `${r.onsets.length} onsets, expected ${expected}`);
    for (const o of r.onsets) {
      const k = Math.round((o.time - 0.25) / (60 / bpm));
      assert.ok(Math.abs(o.time - (0.25 + k * (60 / bpm))) < 0.03, `onset at ${o.time}`);
    }
    // Beats sit on the clicks.
    for (const b of r.beats.slice(1, -1)) {
      const k = Math.round((b - 0.25) / (60 / bpm));
      assert.ok(Math.abs(b - (0.25 + k * (60 / bpm))) < 0.03, `beat at ${b}`);
    }
  }
  const silent = detectRhythm(new Float32Array(SR * 4), SR);
  assert.equal(silent.tempo, 0);
  assert.deepEqual(silent.beats, []);
});

test('rhythm: pulse and beatAt', () => {
  const beats = [1, 2, 3];
  assert.equal(pulse(beats, 0.5), 0);
  assert.equal(pulse(beats, 1), 1);
  assert.ok(pulse(beats, 1.1, 0.2) < 0.2);
  assert.deepEqual(beatAt(beats, 0.5), { index: -1, progress: 0 });
  assert.deepEqual(beatAt(beats, 1.5), { index: 0, progress: 0.5 });
  assert.deepEqual(beatAt(beats, 3.25), { index: 2, progress: 0.25 });
});

/** Builds a format 1 MIDI file: a tempo track and one note track. */
function midiFile(): Uint8Array {
  const vlq = (n: number) => {
    const out = [n & 0x7f];
    for (let v = n >> 7; v > 0; v >>= 7) out.unshift((v & 0x7f) | 0x80);
    return out;
  };
  const chunk = (tag: string, data: number[]) => [
    ...[...tag].map((c) => c.charCodeAt(0)),
    (data.length >>> 24) & 255,
    (data.length >>> 16) & 255,
    (data.length >>> 8) & 255,
    data.length & 255,
    ...data,
  ];
  // 480 ticks per beat. 120 BPM, then 240 BPM from tick 960 (2 beats = 1 second in).
  // biome-ignore format: one MIDI event per line is easier to check against the spec
  const tempo = [
    ...vlq(0), 0xff, 0x51, 3, 0x07, 0xa1, 0x20,
    ...vlq(960), 0xff, 0x51, 3, 0x03, 0xd0, 0x90,
    ...vlq(0), 0xff, 0x2f, 0,
  ];
  // Running status at the end: a note-on, then a note-off written as a note-on with velocity 0.
  // biome-ignore format: one MIDI event per line is easier to check against the spec
  const notes = [
    ...vlq(0), 0xff, 0x03, 4, ...[...'Lead'].map((c) => c.charCodeAt(0)),
    ...vlq(0), 0x90, 60, 100,
    ...vlq(480), 0x80, 60, 0,
    ...vlq(480), 0x90, 64, 127,
    ...vlq(480), 64, 0,
    ...vlq(0), 0xff, 0x2f, 0,
  ];
  return Uint8Array.from([
    ...chunk('MThd', [0, 1, 0, 2, 0x01, 0xe0]),
    ...chunk('MTrk', tempo),
    ...chunk('MTrk', notes),
  ]);
}

test('midi: reads notes in seconds through tempo changes', () => {
  const m = parseMidi(midiFile());
  assert.deepEqual(
    m.notes.map((n) => [n.time, n.duration, n.pitch, Math.round(n.velocity * 127), n.track]),
    [
      [0, 0.5, 60, 100, 1],
      [1, 0.25, 64, 127, 1],
    ],
  );
  assert.deepEqual(m.tempos, [
    { time: 0, bpm: 120 },
    { time: 1, bpm: 240 },
  ]);
  assert.equal(m.trackNames[1], 'Lead');
  assert.equal(m.duration, 1.25);
  assert.throws(() => parseMidi(new Uint8Array(16)), /not a MIDI file/);
});
