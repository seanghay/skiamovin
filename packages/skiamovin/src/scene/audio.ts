// Mixes audible nodes into one stereo float stream.
import { type AudioSample, AudioSampleSink, type Input, type InputAudioTrack, type InputVideoTrack } from 'mediabunny';
import type { AudioClip, AudioRole } from './nodes.ts';

/** A clip and the time range where it is audible. */
export interface ScheduledClip extends AudioClip {
  /** Start and end of the audible range, in composition time. */
  activeStart: number;
  activeEnd: number;
}

let mediaCounter = 0;
function clipKey(c: AudioClip, ids: WeakMap<object, number>): string {
  let id = ids.get(c.media as object);
  if (id === undefined) {
    id = ++mediaCounter;
    ids.set(c.media as object, id);
  }
  return `${id}|${c.absStart.toFixed(6)}|${c.trimStart}|${c.trimEnd}|${c.playbackRate}|${c.loop}|${c.role}`;
}

/** Builds the schedule by sampling the composition's audio nodes once per frame. */
export function buildSchedule(
  collect: (t: number) => AudioClip[],
  duration: number,
  frameRate: number,
): ScheduledClip[] {
  const ids = new WeakMap<object, number>();
  const map = new Map<string, ScheduledClip>();
  const frames = Math.ceil(duration * frameRate - 1e-9);
  for (let i = 0; i < frames; i++) {
    const t = i / frameRate;
    for (const c of collect(t)) {
      const k = clipKey(c, ids);
      const s = map.get(k);
      const end = Math.min(c.absEnd, t + 1 / frameRate);
      if (!s) map.set(k, { ...c, activeStart: Math.max(c.absStart, t), activeEnd: end });
      else {
        s.activeStart = Math.min(s.activeStart, t);
        s.activeEnd = Math.max(s.activeEnd, end);
      }
    }
  }
  // A clip present from its scope start begins exactly there, not at the next frame.
  for (const s of map.values()) if (s.activeStart - s.absStart < 1 / frameRate) s.activeStart = Math.max(0, s.absStart);
  return [...map.values()];
}

async function audioTrackOf(media: Input | InputAudioTrack | InputVideoTrack): Promise<InputAudioTrack | null> {
  const m = media as any;
  if (typeof m.getPrimaryAudioTrack === 'function') return m.getPrimaryAudioTrack();
  if (typeof m.isAudioTrack === 'function' && m.isAudioTrack()) return m as InputAudioTrack;
  if (m.input && typeof m.input.getPrimaryAudioTrack === 'function') return m.input.getPrimaryAudioTrack();
  return null;
}

/** Reads a source audio track as stereo floats at the source rate, sequentially from any start time. */
class ClipReader {
  #sink: AudioSampleSink;
  #iter: AsyncIterator<AudioSample> | null = null;
  #buf = new Float32Array(0); // interleaved stereo
  #bufStart = 0; // source seconds of buf[0]
  #rate = 48000;
  #done = false;
  #duration: number;
  constructor(track: InputAudioTrack, duration: number) {
    this.#sink = new AudioSampleSink(track);
    this.#duration = duration;
  }
  get duration(): number {
    return this.#duration;
  }
  async #reset(t: number): Promise<void> {
    await this.#iter?.return?.();
    this.#iter = this.#sink.samples(Math.max(0, t))[Symbol.asyncIterator]();
    this.#buf = new Float32Array(0);
    this.#bufStart = t;
    this.#done = false;
    this.#first = true;
  }
  #first = true;
  async #pull(): Promise<boolean> {
    if (this.#done || !this.#iter) return false;
    const r = await this.#iter.next();
    if (r.done) {
      this.#done = true;
      return false;
    }
    const s = r.value;
    this.#rate = s.sampleRate;
    const n = s.numberOfFrames;
    const ch = s.numberOfChannels;
    const l = new Float32Array(n),
      rr = new Float32Array(n);
    s.copyTo(l, { planeIndex: 0, format: 'f32-planar' });
    if (ch > 1) s.copyTo(rr, { planeIndex: 1, format: 'f32-planar' });
    else rr.set(l);
    const st = s.timestamp;
    s.close();
    const add = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      add[i * 2] = l[i]!;
      add[i * 2 + 1] = rr[i]!;
    }
    if (this.#first) {
      this.#bufStart = st;
      this.#buf = add;
      this.#first = false;
    } else {
      const merged = new Float32Array(this.#buf.length + add.length);
      merged.set(this.#buf);
      merged.set(add, this.#buf.length);
      this.#buf = merged;
    }
    return true;
  }
  /** Adds source audio from `t0` into `out` (interleaved stereo), advancing `step` source seconds per frame. */
  async read(t0: number, step: number, frames: number, out: Float32Array, gain: (i: number) => number): Promise<void> {
    const tEnd = t0 + step * frames;
    const have = (t: number) =>
      this.#iter && !this.#first && t >= this.#bufStart && (t - this.#bufStart) * this.#rate < this.#buf.length / 2 - 1;
    if (
      !this.#iter ||
      (!this.#first && (t0 < this.#bufStart - 1e-3 || t0 > this.#bufStart + this.#buf.length / 2 / this.#rate + 1))
    )
      await this.#reset(t0);
    while (!have(tEnd) && (await this.#pull())) {
      /* fill */
    }
    if (this.#first) return;
    const rate = this.#rate;
    const n = this.#buf.length / 2;
    for (let i = 0; i < frames; i++) {
      const pos = (t0 + i * step - this.#bufStart) * rate;
      if (pos < 0 || pos >= n - 1) continue;
      const i0 = Math.floor(pos),
        f = pos - i0;
      const g = gain(i);
      out[i * 2]! += (this.#buf[i0 * 2]! * (1 - f) + this.#buf[(i0 + 1) * 2]! * f) * g;
      out[i * 2 + 1]! += (this.#buf[i0 * 2 + 1]! * (1 - f) + this.#buf[(i0 + 1) * 2 + 1]! * f) * g;
    }
    // Drop data already used, keeping a little for interpolation.
    const keepFrom = Math.max(0, Math.floor((tEnd - this.#bufStart) * rate) - 2);
    if (keepFrom > 4096) {
      this.#buf = this.#buf.slice(keepFrom * 2);
      this.#bufStart += keepFrom / rate;
    }
  }
  async dispose(): Promise<void> {
    await this.#iter?.return?.();
  }
}

export class AudioMixer {
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  #clips: ScheduledClip[];
  #dialogue: ScheduledClip[];
  #readers = new Map<ScheduledClip, ClipReader | null>();

  /** `roles` keeps only clips with those roles (clips without a role count as effects); ducking still follows all dialogue. */
  constructor(clips: ScheduledClip[], sampleRate = 48000, numberOfChannels = 2, roles?: readonly AudioRole[]) {
    this.#clips = roles ? clips.filter((c) => roles.includes(c.role ?? 'effects')) : clips;
    this.#dialogue = clips.filter((c) => c.role === 'dialogue');
    this.sampleRate = sampleRate;
    this.numberOfChannels = numberOfChannels;
  }

  /** How far ducking is engaged at `t`, 0..1: it ramps down ahead of dialogue and back up after it. */
  #ducking(t: number): number {
    const ATTACK = 0.15,
      RELEASE = 0.5;
    let k = 0;
    for (const d of this.#dialogue) {
      if (t >= d.activeStart && t < d.activeEnd) return 1;
      if (t < d.activeStart && t > d.activeStart - ATTACK) k = Math.max(k, 1 - (d.activeStart - t) / ATTACK);
      if (t >= d.activeEnd && t < d.activeEnd + RELEASE) k = Math.max(k, 1 - (t - d.activeEnd) / RELEASE);
    }
    return k * k * (3 - 2 * k);
  }

  get hasClips(): boolean {
    return this.#clips.length > 0;
  }

  async #reader(c: ScheduledClip): Promise<ClipReader | null> {
    if (!this.#readers.has(c)) {
      const track = await audioTrackOf(c.media);
      let r: ClipReader | null = null;
      if (track) {
        const dur = await track.computeDuration();
        r = new ClipReader(track, dur);
      }
      this.#readers.set(c, r);
    }
    return this.#readers.get(c)!;
  }

  /** Mixes `frames` frames starting at absolute time `t0`. Returns channel-interleaved floats. */
  async mix(t0: number, frames: number): Promise<Float32Array> {
    const sr = this.sampleRate;
    const out = new Float32Array(frames * 2);
    const t1 = t0 + frames / sr;
    for (const c of this.#clips) {
      if (c.activeEnd <= t0 || c.activeStart >= t1) continue;
      const reader = await this.#reader(c);
      if (!reader) continue;
      const srcEnd = Math.min(c.trimEnd, reader.duration);
      const loopLen = srcEnd - c.trimStart;
      // Work in blocks of 128 frames so volume changes and loops stay smooth.
      const BLOCK = 128;
      for (let b = 0; b < frames; b += BLOCK) {
        const n = Math.min(BLOCK, frames - b);
        const tb = t0 + b / sr;
        if (tb + n / sr <= c.activeStart || tb >= c.activeEnd) continue;
        const local = tb - c.absStart;
        let src = c.trimStart + local * c.playbackRate;
        if (c.loop && loopLen > 0) src = c.trimStart + ((((src - c.trimStart) % loopLen) + loopLen) % loopLen);
        else if (src >= srcEnd) continue;
        const duck = (t: number) => (c.duck > 0 ? 10 ** ((-c.duck * this.#ducking(t)) / 20) : 1);
        const v0 = (typeof c.volume === 'function' ? c.volume(local) : c.volume) * duck(tb);
        const v1 = (typeof c.volume === 'function' ? c.volume(local + n / sr) : c.volume) * duck(tb + n / sr);
        const tmp = new Float32Array(n * 2);
        await reader.read(src, c.playbackRate / sr, n, tmp, (i) => {
          const tAbs = tb + i / sr;
          if (tAbs < c.activeStart || tAbs >= c.activeEnd) return 0;
          return v0 + ((v1 - v0) * i) / n;
        });
        out.set(
          out.subarray(b * 2, (b + n) * 2).map((v, i) => v + tmp[i]!),
          b * 2,
        );
      }
    }
    // Soften peaks above 0.9 to avoid clipping.
    for (let i = 0; i < out.length; i++) {
      const x = out[i]!;
      const a = Math.abs(x);
      if (a > 0.9) out[i] = Math.sign(x) * (0.9 + 0.1 * Math.tanh((a - 0.9) / 0.1));
    }
    if (this.numberOfChannels === 1) {
      const mono = new Float32Array(frames);
      for (let i = 0; i < frames; i++) mono[i] = (out[i * 2]! + out[i * 2 + 1]!) / 2;
      return mono;
    }
    return out;
  }

  async dispose(): Promise<void> {
    for (const r of this.#readers.values()) await r?.dispose();
    this.#readers.clear();
  }
}
