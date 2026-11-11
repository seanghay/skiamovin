// Synthesizes the launch score (assets/score.wav) on the cut grid in timing.ts.
import { writeFileSync } from 'node:fs';
import { BEAT, CUTS, DURATION } from './timing.ts';

const SR = 48000;
const N = Math.ceil(DURATION * SR);
const L = new Float32Array(N),
  R = new Float32Array(N);
const duck = new Float32Array(N); // kick envelope for sidechain pumping
const music = { pad: [new Float32Array(N), new Float32Array(N)], bass: new Float32Array(N) };
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
let seed = 7;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return (seed / 2 ** 32) * 2 - 1;
};
const at = (t: number) => Math.floor(t * SR);
function put(buf: Float32Array, i: number, v: number) {
  if (i >= 0 && i < N) buf[i]! += v;
}

// ---- harmony: Am F C G (one chord per bar), final C ----
const PROG = [
  [45, 52, 57, 60, 64],
  [41, 48, 53, 57, 60],
  [36, 43, 48, 52, 55],
  [43, 50, 55, 59, 62],
];
const chordAt = (t: number) => PROG[Math.floor(t / (BEAT * 4)) % 4]!;

// Pad (whole film except the silence), sidechained later.
for (let i = 0; i < N; i++) {
  const t = i / SR;
  if (t >= CUTS.silence[0] && t < CUTS.end[0]) continue;
  const chord = t >= CUTS.end[0] ? [36, 43, 48, 52, 55, 60, 64, 67] : chordAt(t);
  const lvl =
    t < CUTS.hero[0]
      ? 0.02 + 0.02 * (t / CUTS.hero[0])
      : t >= CUTS.end[0]
        ? 0.05 * Math.exp(-(t - CUTS.end[0]) / 3)
        : 0.03;
  let l = 0,
    r = 0;
  for (const n of chord) {
    const ph = 2 * Math.PI * hz(n) * t;
    l += Math.sin(ph) + 0.3 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph);
    r += Math.sin(ph * 1.004) + 0.3 * Math.sin(2 * ph * 1.004);
  }
  music.pad[0]![i] = lvl * l;
  music.pad[1]![i] = lvl * r;
}

// ---- drums ----
function kick(t: number, g = 1) {
  const s = at(t);
  let ph = 0;
  for (let i = 0; i < 0.45 * SR; i++) {
    const x = i / SR;
    ph += (2 * Math.PI * (45 + 110 * Math.exp(-x * 30))) / SR;
    const v = g * 0.9 * Math.exp(-x * 7) * Math.sin(ph) + g * 0.25 * Math.exp(-x * 120) * rnd();
    put(L, s + i, v);
    put(R, s + i, v);
    if (s + i < N) duck[s + i] = Math.max(duck[s + i]!, Math.exp(-x * 9));
  }
}
function clap(t: number, g = 0.35) {
  const s = at(t);
  let lp = 0;
  for (let i = 0; i < 0.25 * SR; i++) {
    const x = i / SR;
    const env =
      (x < 0.01 ? 1 : 0) * 0.6 + (x > 0.012 && x < 0.022 ? 0.8 : 0) + Math.exp(-x * 22) * (x >= 0.022 ? 1 : 0);
    const n = rnd();
    lp += (n - lp) * 0.35;
    const v = g * env * (n - lp);
    put(L, s + i, v);
    put(R, s + i, v * 0.9);
  }
}
function hat(t: number, g = 0.08, open = false) {
  const s = at(t);
  let prev = 0;
  for (let i = 0; i < (open ? 0.2 : 0.05) * SR; i++) {
    const x = i / SR;
    const n = rnd();
    const hp = n - prev;
    prev = n;
    const v = g * Math.exp(-x * (open ? 18 : 70)) * hp;
    put(L, s + i, v * 0.8);
    put(R, s + i, v);
  }
}
function impact(t: number, g = 1, tail = 2.5) {
  kick(t, 1.2 * g);
  const s = at(t);
  let lp = 0;
  for (let i = 0; i < tail * SR; i++) {
    const x = i / SR;
    lp += (rnd() - lp) * 0.05;
    const v =
      g * 0.35 * Math.exp(-x / (tail / 4)) * lp + g * 0.3 * Math.exp(-x / tail) * Math.sin(2 * Math.PI * 41 * x);
    put(L, s + i, v);
    put(R, s + i, v);
  }
}
function riser(from: number, to: number, g = 0.22) {
  let lp = 0,
    ph = 0;
  for (let i = at(from); i < at(to); i++) {
    const k = (i / SR - from) / (to - from);
    lp += (rnd() - lp) * (0.02 + 0.4 * k * k);
    ph += (2 * Math.PI * (150 + 1600 * k * k)) / SR;
    put(L, i, g * k ** 2.2 * lp + 0.05 * k * k * Math.sin(ph));
    put(R, i, g * k ** 2.2 * lp * 0.9 + 0.05 * k * k * Math.sin(ph * 1.01));
  }
}
function pluck(t: number, midi: number, g = 0.08, decay = 0.25) {
  const s = at(t),
    f = hz(midi);
  for (let i = 0; i < decay * 4 * SR; i++) {
    const x = i / SR;
    const ph = 2 * Math.PI * f * x;
    const v =
      g *
      Math.exp(-x / decay) *
      (Math.sin(ph) + 0.5 * Math.sin(2 * ph) * Math.exp(-x * 20) + 0.25 * Math.sin(3 * ph) * Math.exp(-x * 30));
    put(L, s + i, v * 0.8);
    put(R, s + i, v);
  }
}

// Intro: heartbeat sub pulses, a bell at "Introducing", risers into the drop.
for (let t = 0.5; t < CUTS.reveal[1]; t += BEAT * 2) kick(t, 0.35);
riser(1.5, CUTS.introducing[0], 0.15);
impact(CUTS.introducing[0], 0.5, 1.5);
pluck(CUTS.introducing[0], 81, 0.12, 0.9);
pluck(CUTS.introducing[0] + 0.75, 76, 0.08, 0.8);
riser(CUTS.introducing[0] + 0.5, CUTS.hero[0], 0.25);
impact(CUTS.hero[0], 1.0, 3.0);

// Groove from the drop to the montage end.
const GROOVE_END = CUTS.silence[0];
for (let t = CUTS.hero[0]; t < GROOVE_END - 1e-6; t += BEAT) {
  const beatInBar = Math.round((t - CUTS.hero[0]) / BEAT) % 4;
  kick(t, t < CUTS.words[0] ? 0.8 : 1);
  if (t >= CUTS.words[0] && (beatInBar === 1 || beatInBar === 3)) clap(t);
  if (t >= CUTS.words[0]) {
    hat(t + BEAT / 2, 0.1, beatInBar === 3);
    hat(t + BEAT / 4, 0.04);
    hat(t + (3 * BEAT) / 4, 0.04);
  }
}
// Bass: 8th notes on the chord root, saw through a decaying lowpass.
for (let t = CUTS.hero[0]; t < GROOVE_END - 1e-6; t += BEAT / 2) {
  const root = chordAt(t)[0]! - 12;
  const f = hz(root);
  let lp = 0;
  for (let i = 0; i < (BEAT / 2) * SR; i++) {
    const x = i / SR;
    const saw = 2 * ((f * x) % 1) - 1;
    const cut = 0.04 + 0.25 * Math.exp(-x * 18);
    lp += (saw - lp) * cut;
    put(music.bass, at(t) + i, 0.32 * lp * Math.min(1, x * 300) * Math.exp(-x * 2));
  }
}
// Arp: 16ths through the device → shaders section.
for (let t = CUTS.device[0]; t < CUTS.montage[0] - 1e-6; t += BEAT / 4) {
  const chord = chordAt(t);
  const step = Math.round((t - CUTS.device[0]) / (BEAT / 4));
  const note = chord[[2, 3, 4, 3][step % 4]!]! + 12;
  pluck(t, note, t >= CUTS.languages[0] ? 0.05 : 0.035, 0.12);
}
// Word strobe and montage: a tick-impact on every cut.
for (let t = CUTS.words[0]; t < CUTS.words[1] - 1e-6; t += BEAT) pluck(t, 88, 0.05, 0.08);
for (let t = CUTS.montage[0]; t < CUTS.montage[1] - 1e-6; t += BEAT) impact(t, 0.25, 0.4);
// Snare roll into the silence.
for (let k = 0; k < 16; k++) clap(CUTS.montage[1] - 1 + k / 16, 0.12 + 0.25 * (k / 16));
// The final hit.
impact(CUTS.end[0], 1.3, 5);
pluck(CUTS.end[0], 72, 0.1, 2.5);
pluck(CUTS.end[0], 79, 0.08, 2.5);
pluck(CUTS.end[0], 84, 0.06, 2.5);

// ---- mix: sidechain the pad and bass under the kick, add a little room ----
for (let i = 0; i < N; i++) {
  const g = 1 - 0.65 * duck[i]!;
  L[i]! += (music.pad[0]![i]! + music.bass[i]!) * g;
  R[i]! += (music.pad[1]![i]! + music.bass[i]!) * g;
}
const dl = at(0.113),
  dr = at(0.151);
for (let i = 0; i < N; i++) {
  if (i >= dl) L[i]! += 0.22 * R[i - dl]!;
  if (i >= dr) R[i]! += 0.22 * L[i - dr]!;
}
// Hard stop for the silence (keep a short tail), fade at the end.
for (let i = 0; i < N; i++) {
  const t = i / SR;
  let g = 1;
  if (t >= CUTS.silence[0] && t < CUTS.end[0]) g = Math.exp(-(t - CUTS.silence[0]) * 6);
  g *= Math.min(1, Math.max(0, (DURATION - t) / 1.5));
  L[i]! *= g;
  R[i]! *= g;
}
// Soft-clip and normalize to -1 dBFS.
let peak = 0;
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh(L[i]! * 1.2);
  R[i] = Math.tanh(R[i]! * 1.2);
  peak = Math.max(peak, Math.abs(L[i]!), Math.abs(R[i]!));
}
const gain = 0.89 / peak;
const data = Buffer.alloc(44 + N * 4);
data.write('RIFF', 0);
data.writeUInt32LE(36 + N * 4, 4);
data.write('WAVEfmt ', 8);
data.writeUInt32LE(16, 16);
data.writeUInt16LE(1, 20);
data.writeUInt16LE(2, 22);
data.writeUInt32LE(SR, 24);
data.writeUInt32LE(SR * 4, 28);
data.writeUInt16LE(4, 32);
data.writeUInt16LE(16, 34);
data.write('data', 36);
data.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(L[i]! * gain * 32767), 44 + i * 4);
  data.writeInt16LE(Math.round(R[i]! * gain * 32767), 46 + i * 4);
}
writeFileSync(new URL('../assets/score.wav', import.meta.url), data);
console.log(`score.wav: ${DURATION}s @ 120 BPM`);
