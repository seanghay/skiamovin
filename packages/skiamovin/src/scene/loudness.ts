// Integrated loudness as defined by ITU-R BS.1770-4 and EBU R128: K-weighting, 400 ms blocks with 75% overlap, an
// absolute gate at -70 LUFS and a relative gate 10 LU below the gated mean.

/** A biquad filter in direct form I, one state per channel. */
class Biquad {
  readonly #b: number[];
  readonly #a: number[];
  readonly #state: Float64Array;
  constructor(b: number[], a: number[], channels: number) {
    this.#b = b;
    this.#a = a;
    this.#state = new Float64Array(channels * 4);
  }
  run(x: number, ch: number): number {
    const s = this.#state,
      i = ch * 4;
    const y =
      this.#b[0]! * x +
      this.#b[1]! * s[i]! +
      this.#b[2]! * s[i + 1]! -
      this.#a[1]! * s[i + 2]! -
      this.#a[2]! * s[i + 3]!;
    s[i + 1] = s[i]!;
    s[i] = x;
    s[i + 3] = s[i + 2]!;
    s[i + 2] = y;
    return y;
  }
}

/** Measures integrated loudness (LUFS) and sample peak of interleaved audio fed in chunks. */
export class LoudnessMeter {
  readonly sampleRate: number;
  readonly channels: number;
  readonly #shelf: Biquad;
  readonly #highPass: Biquad;
  /** Sum of squared K-weighted samples per 100 ms step, summed over channels. */
  readonly #steps: number[] = [];
  #acc = 0;
  #count = 0;
  readonly #stepLength: number;
  #peak = 0;
  readonly #weights: number[];

  constructor(sampleRate: number, channels: number) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    // In 5.1 (L R C LFE Ls Rs) the LFE channel is left out and the surrounds count 1.41 times.
    this.#weights = Array.from({ length: channels }, (_, c) => (channels === 6 ? [1, 1, 1, 0, 1.41, 1.41][c]! : 1));
    this.#stepLength = Math.round(sampleRate / 10);
    // Filter coefficients for any sample rate, matching the 48 kHz values in BS.1770.
    let K = Math.tan((Math.PI * 1681.974450955533) / sampleRate);
    const Q1 = 0.7071752369554196;
    const Vh = 10 ** (3.999843853973347 / 20);
    const Vb = Vh ** 0.4996667741545416;
    const a0 = 1 + K / Q1 + K * K;
    this.#shelf = new Biquad(
      [(Vh + (Vb * K) / Q1 + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q1 + K * K) / a0],
      [1, (2 * (K * K - 1)) / a0, (1 - K / Q1 + K * K) / a0],
      channels,
    );
    K = Math.tan((Math.PI * 38.13547087602444) / sampleRate);
    const Q2 = 0.5003270373238773;
    const d = 1 + K / Q2 + K * K;
    this.#highPass = new Biquad([1, -2, 1], [1, (2 * (K * K - 1)) / d, (1 - K / Q2 + K * K) / d], channels);
  }

  /** Adds interleaved samples. */
  add(samples: Float32Array): void {
    const ch = this.channels;
    for (let i = 0; i < samples.length; i += ch) {
      for (let c = 0; c < ch; c++) {
        const x = samples[i + c]!;
        const a = Math.abs(x);
        if (a > this.#peak) this.#peak = a;
        const y = this.#highPass.run(this.#shelf.run(x, c), c);
        this.#acc += y * y * this.#weights[c]!;
      }
      if (++this.#count === this.#stepLength) {
        this.#steps.push(this.#acc);
        this.#acc = 0;
        this.#count = 0;
      }
    }
  }

  /** Highest absolute sample value seen. */
  get peak(): number {
    return this.#peak;
  }

  /** Integrated loudness in LUFS, or -Infinity for silence or less than 400 ms of audio. */
  integrated(): number {
    const blocks: number[] = [];
    for (let i = 3; i < this.#steps.length; i++) {
      const sum = this.#steps[i - 3]! + this.#steps[i - 2]! + this.#steps[i - 1]! + this.#steps[i]!;
      blocks.push(sum / (this.#stepLength * 4));
    }
    const lufs = (z: number) => -0.691 + 10 * Math.log10(z);
    const mean = (zs: number[]) => zs.reduce((a, b) => a + b, 0) / zs.length;
    const loud = blocks.filter((z) => z > 0 && lufs(z) > -70);
    if (!loud.length) return -Infinity;
    const relative = lufs(mean(loud)) - 10;
    const gated = loud.filter((z) => lufs(z) > relative);
    return gated.length ? lufs(mean(gated)) : -Infinity;
  }
}

/**
 * The gain that brings audio from `measured` to `target` LUFS, lowered if needed so the sample peak stays at or below
 * `peakLimit` dBFS. 1 for silence.
 */
export function loudnessGain(measured: number, peak: number, target: number, peakLimit = -1): number {
  if (!Number.isFinite(measured) || peak <= 0) return 1;
  const gain = 10 ** ((target - measured) / 20);
  return Math.min(gain, 10 ** (peakLimit / 20) / peak);
}

/** Settings for common destinations: size, codecs, bitrates and loudness. Spread into `Render.init`. */
export const deliveryPresets = Object.freeze({
  /** 1080p for YouTube, normalized to −14 LUFS. */
  youtube: Object.freeze({
    video: Object.freeze({
      width: 1920,
      height: 1080,
      codec: 'avc' as const,
      bitrate: 12_000_000,
      fit: 'contain' as const,
    }),
    audio: Object.freeze({ codec: 'aac' as const, bitrate: 320_000, sampleRate: 48000, loudness: -14 }),
  }),
  /** Vertical 1080×1920 for Instagram Reels, normalized to −14 LUFS. */
  instagram: Object.freeze({
    video: Object.freeze({
      width: 1080,
      height: 1920,
      codec: 'avc' as const,
      bitrate: 8_000_000,
      fit: 'contain' as const,
    }),
    audio: Object.freeze({ codec: 'aac' as const, bitrate: 256_000, sampleRate: 48000, loudness: -14 }),
  }),
  /** Vertical 1080×1920 for TikTok, normalized to −14 LUFS. */
  tiktok: Object.freeze({
    video: Object.freeze({
      width: 1080,
      height: 1920,
      codec: 'avc' as const,
      bitrate: 8_000_000,
      fit: 'contain' as const,
    }),
    audio: Object.freeze({ codec: 'aac' as const, bitrate: 256_000, sampleRate: 48000, loudness: -14 }),
  }),
  /** 1080p for broadcast, normalized to −23 LUFS (EBU R128). */
  broadcast: Object.freeze({
    video: Object.freeze({
      width: 1920,
      height: 1080,
      codec: 'avc' as const,
      bitrate: 20_000_000,
      fit: 'contain' as const,
    }),
    audio: Object.freeze({ codec: 'aac' as const, bitrate: 320_000, sampleRate: 48000, loudness: -23 }),
  }),
});
