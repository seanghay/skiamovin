// Onsets, tempo and beats from audio samples, and MIDI files as note events. Everything is computed once up front,
// so frames can look the results up by time.

export interface Onset {
  /** Seconds. */
  time: number;
  /** How sudden the change is, 0..1 relative to the strongest onset. */
  strength: number;
}

export interface Rhythm {
  onsets: Onset[];
  /** Beats per minute, or 0 when no steady beat was found. */
  tempo: number;
  /** Beat times in seconds. */
  beats: number[];
}

const HOP = 512;
const SIZE = 2048;

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    const wr = Math.cos(a),
      wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k,
          q = p + len / 2;
        const tr = re[q]! * cr - im[q]! * ci;
        const ti = re[q]! * ci + im[q]! * cr;
        re[q] = re[p]! - tr;
        im[q] = im[p]! - ti;
        re[p] = re[p]! + tr;
        im[p] = im[p]! + ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Spectral flux per hop: how much louder each frequency got since the last hop, summed. */
function flux(mono: Float32Array): Float64Array {
  const frames = Math.max(0, Math.floor((mono.length - SIZE) / HOP) + 1);
  const out = new Float64Array(frames);
  const window = new Float64Array(SIZE);
  for (let i = 0; i < SIZE; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (SIZE - 1));
  const re = new Float64Array(SIZE),
    im = new Float64Array(SIZE);
  let prev = new Float64Array(SIZE / 2);
  let cur = new Float64Array(SIZE / 2);
  for (let f = 0; f < frames; f++) {
    const at = f * HOP;
    for (let i = 0; i < SIZE; i++) {
      re[i] = mono[at + i]! * window[i]!;
      im[i] = 0;
    }
    fft(re, im);
    let sum = 0;
    for (let k = 0; k < SIZE / 2; k++) {
      // Log compression makes quiet and loud passages count alike.
      cur[k] = Math.log1p(100 * Math.hypot(re[k]!, im[k]!));
      if (f > 0) sum += Math.max(0, cur[k]! - prev[k]!);
    }
    out[f] = sum;
    [prev, cur] = [cur, prev];
  }
  return out;
}

/** Peaks of the flux above a moving average, at least `minGap` seconds apart. */
function pickOnsets(env: Float64Array, sampleRate: number, minGap: number): Onset[] {
  const rate = sampleRate / HOP;
  const w = Math.max(1, Math.round(0.1 * rate));
  const peaks: { i: number; v: number }[] = [];
  let last = -Infinity;
  for (let i = 1; i < env.length - 1; i++) {
    const v = env[i]!;
    if (v <= env[i - 1]! || v < env[i + 1]!) continue;
    let sum = 0,
      n = 0;
    for (let j = Math.max(0, i - w * 2); j <= Math.min(env.length - 1, i + w); j++) {
      sum += env[j]!;
      n++;
    }
    if (v <= (sum / n) * 1.4 + 1e-6) continue;
    if ((i - last) / rate < minGap) {
      if (peaks.length && v > peaks[peaks.length - 1]!.v) {
        peaks[peaks.length - 1] = { i, v };
        last = i;
      }
      continue;
    }
    peaks.push({ i, v });
    last = i;
  }
  const max = peaks.reduce((m, p) => Math.max(m, p.v), 0) || 1;
  return peaks.map((p) => ({ time: (p.i * HOP + SIZE / 2) / sampleRate, strength: p.v / max }));
}

/**
 * Finds onsets, tempo and beats in mono samples. Tempo comes from the autocorrelation of the onset strength, with a
 * gentle preference for 120 BPM to settle half and double tempo; beats are then placed where the onsets line up best.
 */
export function detectRhythm(
  mono: Float32Array,
  sampleRate: number,
  options: { minTempo?: number; maxTempo?: number; minGap?: number } = {},
): Rhythm {
  const { minTempo = 60, maxTempo = 200, minGap = 0.08 } = options;
  const env = flux(mono);
  const rate = sampleRate / HOP;
  const onsets = pickOnsets(env, sampleRate, minGap);
  const duration = mono.length / sampleRate;
  if (env.length < rate * 2) return { onsets, tempo: 0, beats: [] };

  const mean = env.reduce((a, b) => a + b, 0) / env.length;
  const e = env.map((v) => Math.max(0, v - mean));
  const lagMin = Math.max(1, Math.floor((60 / maxTempo) * rate));
  const lagMax = Math.ceil((60 / minTempo) * rate);
  let best = 0,
    bestLag = 0;
  let zero = 0;
  for (let i = 0; i < e.length; i++) zero += e[i]! * e[i]!;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0;
    for (let i = lag; i < e.length; i++) s += e[i]! * e[i - lag]!;
    s /= e.length - lag;
    const bpm = (60 * rate) / lag;
    const weight = Math.exp((-0.5 * Math.log2(bpm / 120) ** 2) / 0.9 ** 2);
    if (s * weight > best) {
      best = s * weight;
      bestLag = lag;
    }
  }
  if (bestLag === 0 || best <= (zero / e.length) * 0.05) return { onsets, tempo: 0, beats: [] };
  // Refine the period between neighboring lags with a parabola through the scores.
  const score = (lag: number) => {
    let s = 0;
    for (let i = lag; i < e.length; i++) s += e[i]! * e[i - lag]!;
    return s / (e.length - lag);
  };
  const [a, b, c] = [score(bestLag - 1), score(bestLag), score(bestLag + 1)];
  const shift = a - 2 * b + c === 0 ? 0 : (0.5 * (a - c)) / (a - 2 * b + c);
  const period = bestLag + Math.max(-0.5, Math.min(0.5, shift));
  // Phase: the offset whose beat grid collects the most onset strength.
  let bestPhase = 0,
    bestSum = -1;
  for (let p = 0; p < period; p += 0.25) {
    let s = 0;
    for (let t = p; t < e.length; t += period) s += e[Math.round(t)] ?? 0;
    if (s > bestSum) {
      bestSum = s;
      bestPhase = p;
    }
  }
  const beats: number[] = [];
  const toTime = (hop: number) => (hop * HOP + SIZE / 2) / sampleRate;
  for (let t = bestPhase; toTime(t) <= duration; t += period) beats.push(toTime(t));
  return { onsets, tempo: (60 * rate) / period, beats };
}

/** The last time in a sorted list at or before `t`, with its index, or null. */
function lastBefore(times: readonly number[], t: number): { index: number; time: number } | null {
  let lo = 0,
    hi = times.length - 1,
    found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found < 0 ? null : { index: found, time: times[found]! };
}

/** A value that jumps to 1 at each time in `times` and fades out over `decay` seconds: for pulsing to a beat. */
export function pulse(times: readonly number[], t: number, decay = 0.2): number {
  const last = lastBefore(times, t);
  return last ? Math.exp((-(t - last.time) * 4) / Math.max(1e-6, decay)) : 0;
}

/** Which beat `t` falls in, and how far through it (0..1). Before the first beat, `index` is -1. */
export function beatAt(beats: readonly number[], t: number): { index: number; progress: number } {
  const last = lastBefore(beats, t);
  if (!last) return { index: -1, progress: 0 };
  const next = beats[last.index + 1];
  const len = next !== undefined ? next - last.time : last.index > 0 ? last.time - beats[last.index - 1]! : 1;
  return { index: last.index, progress: Math.min(1, (t - last.time) / len) };
}

// MIDI

export interface MidiNote {
  /** Seconds. */
  time: number;
  duration: number;
  /** 0..127; 60 is middle C. */
  pitch: number;
  /** 0..1. */
  velocity: number;
  channel: number;
  track: number;
}

export interface Midi {
  notes: MidiNote[];
  /** Seconds, to the end of the last event. */
  duration: number;
  /** Tempo changes: time in seconds and beats per minute. */
  tempos: { time: number; bpm: number }[];
  /** Track names, by track index. */
  trackNames: string[];
}

/** Reads a Standard MIDI File (format 0 or 1) into notes in seconds, following its tempo changes. */
export function parseMidi(bytes: Uint8Array): Midi {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  const tag = () => String.fromCharCode(bytes[pos]!, bytes[pos + 1]!, bytes[pos + 2]!, bytes[pos + 3]!);
  if (tag() !== 'MThd') throw new SyntaxError('midi: not a MIDI file');
  const headerLen = view.getUint32(4);
  const tracks = view.getUint16(10);
  const division = view.getUint16(12);
  if (division & 0x8000) throw new SyntaxError('midi: SMPTE time division is not supported');
  pos = 8 + headerLen;

  interface Raw {
    tick: number;
    kind: 'on' | 'off' | 'tempo' | 'end' | 'name';
    track: number;
    channel?: number;
    pitch?: number;
    velocity?: number;
    tempo?: number;
    name?: string;
  }
  const events: Raw[] = [];
  const trackNames: string[] = [];
  for (let tr = 0; tr < tracks && pos + 8 <= bytes.length; tr++) {
    const len = view.getUint32(pos + 4);
    const isTrack = tag() === 'MTrk';
    pos += 8;
    const end = Math.min(bytes.length, pos + len);
    if (!isTrack) {
      pos = end;
      tr--;
      continue;
    }
    let tick = 0,
      status = 0;
    const vlq = () => {
      let v = 0;
      for (let i = 0; i < 4 && pos < end; i++) {
        const b = bytes[pos++]!;
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      return v;
    };
    while (pos < end) {
      tick += vlq();
      let b = bytes[pos]!;
      if (b & 0x80) {
        pos++;
        if (b < 0xf0) status = b;
      } else b = status;
      if (b === 0xff) {
        const type = bytes[pos++]!;
        const l = vlq();
        if (type === 0x51 && l === 3)
          events.push({
            tick,
            kind: 'tempo',
            track: tr,
            tempo: (bytes[pos]! << 16) | (bytes[pos + 1]! << 8) | bytes[pos + 2]!,
          });
        else if (type === 0x03) trackNames[tr] = new TextDecoder().decode(bytes.subarray(pos, pos + l));
        else if (type === 0x2f) events.push({ tick, kind: 'end', track: tr });
        pos += l;
      } else if (b === 0xf0 || b === 0xf7) {
        pos += vlq();
      } else {
        const type = b & 0xf0,
          channel = b & 0x0f;
        const d1 = bytes[pos++]!;
        const d2 = type === 0xc0 || type === 0xd0 ? 0 : bytes[pos++]!;
        if (type === 0x90 && d2 > 0)
          events.push({ tick, kind: 'on', track: tr, channel, pitch: d1, velocity: d2 / 127 });
        else if (type === 0x80 || (type === 0x90 && d2 === 0))
          events.push({ tick, kind: 'off', track: tr, channel, pitch: d1 });
      }
    }
    pos = end;
  }

  // Ticks to seconds through the tempo map (500000 µs per beat until the first tempo event).
  events.sort((a, b) => a.tick - b.tick || (a.kind === 'tempo' ? -1 : b.kind === 'tempo' ? 1 : 0));
  const tempos: { tick: number; time: number; usPerBeat: number }[] = [{ tick: 0, time: 0, usPerBeat: 500000 }];
  for (const e of events)
    if (e.kind === 'tempo') {
      const last = tempos[tempos.length - 1]!;
      const time = last.time + ((e.tick - last.tick) * last.usPerBeat) / 1e6 / division;
      if (e.tick === last.tick) last.usPerBeat = e.tempo!;
      else tempos.push({ tick: e.tick, time, usPerBeat: e.tempo! });
    }
  const seconds = (tick: number) => {
    let seg = tempos[0]!;
    for (const t of tempos) if (t.tick <= tick) seg = t;
    return seg.time + ((tick - seg.tick) * seg.usPerBeat) / 1e6 / division;
  };

  const notes: MidiNote[] = [];
  const open = new Map<string, { time: number; velocity: number }[]>();
  let duration = 0;
  for (const e of events) {
    const time = seconds(e.tick);
    duration = Math.max(duration, time);
    if (e.kind !== 'on' && e.kind !== 'off') continue;
    const key = `${e.track}:${e.channel}:${e.pitch}`;
    if (e.kind === 'on') {
      const list = open.get(key) ?? [];
      list.push({ time, velocity: e.velocity! });
      open.set(key, list);
    } else {
      const started = open.get(key)?.shift();
      if (started)
        notes.push({
          time: started.time,
          duration: time - started.time,
          pitch: e.pitch!,
          velocity: started.velocity,
          channel: e.channel!,
          track: e.track,
        });
    }
  }
  notes.sort((a, b) => a.time - b.time || a.pitch - b.pitch);
  return {
    notes,
    duration,
    tempos: tempos.map((t) => ({ time: t.time, bpm: 60e6 / t.usPerBeat })),
    trackNames,
  };
}
