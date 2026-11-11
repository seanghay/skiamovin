// Renders compositions to video files, images and audio samples.
import {
  type AudioCodec,
  AudioSample,
  AudioSampleSource,
  BufferSource,
  EncodedPacket,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Input,
  MP4,
  type Output,
  QUALITY_HIGH,
  type Quality,
  type VideoCodec,
  VideoSampleSource,
} from 'mediabunny';
import { runtime } from '#loader';
import { init } from '../index.ts';
import type { WrappedImage } from '../media/index.ts';
import { importNode } from '../native/node-import.ts';
import { AudioMixer, buildSchedule } from './audio.ts';
import { type Composition, CompositionModule } from './composition.ts';

import { type ChunkJob, DEFAULT_VIDEO_QUALITY, frameSample } from './render-chunk.ts';
import { FrameRenderer, type GpuChoice } from './renderer.ts';
import { CompositionWorker, type WorkerFactory } from './worker.ts';

export interface RenderOptions<Props> {
  composition: Composition<Props> | CompositionModule;
  /** A fresh Mediabunny Output (not started, no tracks). */
  output: Output;
  props?: Partial<Props>;
  video?: {
    codec?: VideoCodec;
    bitrate?: number | Quality;
    keyFrameInterval?: number;
    bitrateMode?: 'variable' | 'constant';
    hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software';
    width?: number;
    height?: number;
    fit?: 'fill' | 'contain' | 'cover';
    alpha?: 'keep' | 'discard';
    colorSpace?: 'srgb' | 'display-p3' | 'rec2020-pq' | 'rec2020-hlg';
  };
  audio?: {
    discard?: boolean;
    codec?: AudioCodec;
    bitrate?: number | Quality;
    sampleRate?: number;
    numberOfChannels?: number;
    forceTrack?: boolean;
  };
  trim?: { start?: number; end?: number };
  gpu?: GpuChoice;
  /** Number of workers. On Node this needs a `CompositionModule` and 'auto' picks 1 or 2. In the browser 'auto' is 1. */
  concurrency?: number | 'auto';
  /**
   * Browser only. Where to render frames: a function that creates a worker running `serveComposition()`, `true` for
   * the built-in worker (needs a `CompositionModule`), or `false` for this thread. Defaults to `true` for a
   * `CompositionModule`.
   */
  worker?: boolean | WorkerFactory;
  profile?: boolean;
}

export type DiscardReason = 'discarded_by_user' | 'no_encodable_target_codec' | 'nothing_audible';

async function resolveComposition<P>(c: Composition<P> | CompositionModule): Promise<Composition<P>> {
  return c instanceof CompositionModule ? ((await c.load()) as Composition<P>) : c;
}

const AUDIO_CHUNK = 0.25;

/** Kept out of `new Worker(...)` so bundlers don't treat it as a Web Worker. */
const nodeWorkerUrl = (): URL => new URL('./render-worker.js', import.meta.url);

/** All workers share one hardware encoder, so more than 2 doesn't help, and short renders are faster with 1. */
function autoConcurrency(cores: number, frames: number): number {
  if (frames < 600 || cores < 4) return 1;
  return 2;
}

/** Renders a composition into a Mediabunny `Output`. Mirrors Mediabunny's `Conversion`. */
export class Render<Props = any> {
  isValid = true;
  readonly discardedTracks: { type: 'video' | 'audio'; reason: DiscardReason }[] = [];
  utilizedBackend = 'raster';
  onProgress?: (progress: number) => unknown;
  /** Timings from the last `execute()` (milliseconds). */
  stats: {
    frames: number;
    totalMs: number;
    renderMs: number;
    encodeMs: number;
    audioMs: number;
    workers: number;
  } | null = null;

  #opts: RenderOptions<Props>;
  #comp!: Composition<Props>;
  #renderer!: FrameRenderer;
  #videoCodec: VideoCodec | null = null;
  #audioCodec: AudioCodec | null = null;
  #mixer: AudioMixer | null = null;
  #start = 0;
  #end = 0;
  #canceled = false;
  #executed = false;
  #concurrency = 1;
  #workers: { terminate(): unknown }[] = [];
  /** Browser: render in Web Workers. */
  #web: { factory: WorkerFactory | null } | null = null;

  private constructor(opts: RenderOptions<Props>) {
    this.#opts = opts;
  }

  static async init<Props>(options: RenderOptions<Props>): Promise<Render<Props>> {
    await init();
    const r = new Render<Props>(options);
    await r.#init();
    return r;
  }

  async #init(): Promise<void> {
    const o = this.#opts;
    this.#comp = await resolveComposition(o.composition);
    if (runtime !== 'node') {
      const w = o.worker ?? o.composition instanceof CompositionModule;
      if (w === true && !(o.composition instanceof CompositionModule)) {
        throw new TypeError(
          'Render: `worker: true` needs a CompositionModule. Pass a worker factory that runs serveComposition() instead',
        );
      }
      if (w !== false && typeof Worker !== 'undefined') this.#web = { factory: typeof w === 'function' ? w : null };
    }
    const width = o.video?.width ?? this.#comp.width;
    const height = o.video?.height ?? this.#comp.height;
    if (o.video?.width && !o.video.height)
      (o.video as { height?: number }).height = Math.round((o.video.width * this.#comp.height) / this.#comp.width);
    this.#renderer = new FrameRenderer(this.#comp, {
      width,
      height: o.video?.height ?? height,
      fit: o.video?.fit,
      gpu: o.gpu,
      props: o.props as Record<string, unknown>,
      // With workers, this thread only mixes audio.
      encode: !this.#web,
      ...(this.#web ? { gpu: 'raster' as const } : {}),
    });
    // Video codec
    const format = o.output.format;
    const supportedV = format.getSupportedVideoCodecs();
    const candidates = o.video?.codec ? [o.video.codec] : supportedV;
    this.#videoCodec = await getFirstEncodableVideoCodec(
      candidates.filter((c) => supportedV.includes(c)),
      {
        width: this.#renderer.outWidth,
        height: this.#renderer.outHeight,
      },
    );
    if (!this.#videoCodec) {
      this.isValid = false;
      this.discardedTracks.push({ type: 'video', reason: 'no_encodable_target_codec' });
    }

    await this.#renderer.init();
    this.utilizedBackend = this.#renderer.backend;
    const duration = this.#renderer.duration;
    // A CompositionModule on Node renders with worker threads by default.
    const concurrency =
      o.concurrency ?? (o.composition instanceof CompositionModule && runtime === 'node' ? 'auto' : 1);
    if (this.#web) {
      this.#concurrency = concurrency === 'auto' ? 1 : Math.max(1, Math.floor(concurrency));
    } else if (concurrency !== 1) {
      if (!(o.composition instanceof CompositionModule))
        throw new TypeError('Render: concurrency > 1 requires a CompositionModule');
      if (runtime !== 'node') throw new TypeError('Render: concurrency is only supported on Node');
      const os = await importNode<typeof import('node:os')>('node:os');
      this.#concurrency =
        concurrency === 'auto'
          ? autoConcurrency(
              os.availableParallelism(),
              Math.round(
                (Math.min(duration, o.trim?.end ?? duration) - Math.max(0, o.trim?.start ?? 0)) * this.#comp.frameRate,
              ),
            )
          : Math.max(1, Math.floor(concurrency));
    }
    this.#start = Math.max(0, o.trim?.start ?? 0);
    this.#end = Math.min(duration, o.trim?.end ?? duration);
    if (!(this.#end > this.#start)) throw new RangeError('Render: empty trim range');

    // Audio
    if (o.audio?.discard) this.discardedTracks.push({ type: 'audio', reason: 'discarded_by_user' });
    else {
      const schedule = buildSchedule((t) => this.#renderer.collectAudio(t), duration, this.#comp.frameRate);
      if (!schedule.length && !o.audio?.forceTrack)
        this.discardedTracks.push({ type: 'audio', reason: 'nothing_audible' });
      else {
        const sampleRate = o.audio?.sampleRate ?? 48000;
        const numberOfChannels = o.audio?.numberOfChannels ?? 2;
        const supportedA = format.getSupportedAudioCodecs();
        const cands = o.audio?.codec ? [o.audio.codec] : supportedA;
        this.#audioCodec = await getFirstEncodableAudioCodec(
          cands.filter((c) => supportedA.includes(c)),
          { sampleRate, numberOfChannels },
        );
        if (!this.#audioCodec) this.discardedTracks.push({ type: 'audio', reason: 'no_encodable_target_codec' });
        else this.#mixer = new AudioMixer(schedule, sampleRate, numberOfChannels);
      }
    }
  }

  get duration(): number {
    return this.#end - this.#start;
  }

  /** Renders, encodes and finalizes the output. */
  async execute(): Promise<void> {
    if (!this.isValid) throw new Error(`Render is invalid: ${JSON.stringify(this.discardedTracks)}`);
    if (this.#executed) throw new Error('Render.execute() can only be called once');
    this.#executed = true;
    const o = this.#opts;
    const fps = this.#comp.frameRate;
    const output = o.output;
    if (this.#concurrency > 1 || this.#web) return this.#executeParallel();
    const videoSource = new VideoSampleSource({
      codec: this.#videoCodec!,
      bitrate: o.video?.bitrate ?? DEFAULT_VIDEO_QUALITY,
      keyFrameInterval: o.video?.keyFrameInterval ?? 2,
      bitrateMode: o.video?.bitrateMode,
      hardwareAcceleration: o.video?.hardwareAcceleration,
      alpha: o.video?.alpha ?? 'discard',
      latencyMode: 'quality',
    });
    output.addVideoTrack(videoSource, { frameRate: fps });
    let audioSource: AudioSampleSource | null = null;
    if (this.#mixer && this.#audioCodec) {
      audioSource = new AudioSampleSource({ codec: this.#audioCodec, bitrate: o.audio?.bitrate ?? QUALITY_HIGH });
      output.addAudioTrack(audioSource);
    }
    const t0 = performance.now();
    const times = { render: 0, encode: 0, audio: 0 };
    await output.start();
    const frames = Math.max(1, Math.round((this.#end - this.#start) * fps));
    let audioT = 0;
    const sr = this.#mixer?.sampleRate ?? 48000;
    const pumpAudio = async (until: number) => {
      if (!audioSource || !this.#mixer) return;
      const ta = performance.now();
      while (audioT < until && !this.#canceled) {
        const n = Math.round(Math.min(AUDIO_CHUNK, this.duration - audioT) * sr);
        if (n <= 0) break;
        const data = await this.#mixer.mix(this.#start + audioT, n);
        const s = new AudioSample({
          data,
          format: 'f32',
          numberOfChannels: this.#mixer.numberOfChannels,
          sampleRate: sr,
          timestamp: audioT,
        });
        await audioSource.add(s);
        s.close();
        audioT += n / sr;
      }
      times.audio += performance.now() - ta;
    };
    try {
      for (let i = 0; i < frames; i++) {
        if (this.#canceled) return;
        const t = this.#start + i / fps;
        const tr = performance.now();
        const surface = await this.#renderer.renderFrame(t);
        const sample = frameSample(this.#renderer, surface, i / fps, 1 / fps);
        times.render += performance.now() - tr;
        const te = performance.now();
        await videoSource.add(sample);
        sample.close();
        times.encode += performance.now() - te;
        await pumpAudio((i + 1) / fps + 0.5);
        this.onProgress?.((i + 1) / frames);
      }
      await pumpAudio(this.duration);
      videoSource.close();
      audioSource?.close();
      if (this.#canceled) return;
      await output.finalize();
    } finally {
      await this.#mixer?.dispose();
      await this.#renderer.dispose();
    }
    this.stats = {
      frames,
      totalMs: performance.now() - t0,
      renderMs: times.render,
      encodeMs: times.encode,
      audioMs: times.audio,
      workers: 1,
    };
    if (o.profile) {
      const total = performance.now() - t0;
      console.log(
        `[skiamovin] ${frames} frames in ${(total / 1000).toFixed(2)}s (${((frames * 1000) / total).toFixed(1)} fps) — ` +
          `render ${(times.render / frames).toFixed(1)}ms/f, encode ${(times.encode / frames).toFixed(1)}ms/f, audio ${(times.audio / 1000).toFixed(2)}s, backend ${this.utilizedBackend}`,
      );
    }
  }

  /** Renders chunks that start on keyframes in workers, then joins them without re-encoding. */
  async #executeParallel(): Promise<void> {
    const t0 = performance.now();
    const o = this.#opts;
    const mod = o.composition as CompositionModule; // unused with a worker factory
    const fps = this.#comp.frameRate;
    const frames = Math.max(1, Math.round((this.#end - this.#start) * fps));
    const kf = Math.max(1, Math.round((o.video?.keyFrameInterval ?? 2) * fps));
    let chunk = Math.ceil(frames / this.#concurrency);
    chunk = Math.max(kf, Math.ceil(chunk / kf) * kf);
    const jobs: [number, number][] = [];
    for (let f = 0; f < frames; f += chunk) jobs.push([f, Math.min(frames, f + chunk)]);
    let done = 0;
    const jobBase = {
      props: o.props as Record<string, unknown> | undefined,
      width: this.#renderer.outWidth,
      height: this.#renderer.outHeight,
      fit: o.video?.fit,
      gpu: o.gpu,
      codec: this.#videoCodec!,
      bitrate: typeof o.video?.bitrate === 'number' ? o.video.bitrate : null,
      keyFrameInterval: o.video?.keyFrameInterval ?? 2,
      bitrateMode: o.video?.bitrateMode,
      hardwareAcceleration: o.video?.hardwareAcceleration,
      fps,
      start: this.#start,
    };
    const web = this.#web;
    const results = jobs.map(([firstFrame, endFrame]): Promise<ArrayBuffer> => {
      const job: ChunkJob = { ...jobBase, firstFrame, endFrame };
      if (web) {
        if (!web.factory)
          Object.assign(job, { moduleUrl: new URL(mod.url, location.href).href, exportName: mod.exportName });
        const cw = web.factory ? new CompositionWorker(web.factory()) : CompositionWorker.forModule();
        this.#workers.push(cw);
        let last = 0;
        return cw
          .call<ArrayBuffer>('chunk', { job }, (p) => {
            const n = Math.round(p * (endFrame - firstFrame));
            done += n - last;
            last = n;
            this.onProgress?.(done / frames);
          })
          .finally(() => cw.terminate());
      }
      return importNode<typeof import('node:worker_threads')>('node:worker_threads').then(
        ({ Worker }) =>
          new Promise<ArrayBuffer>((resolve, reject) => {
            const w = new Worker(nodeWorkerUrl(), {
              workerData: { ...job, moduleUrl: mod.url, exportName: mod.exportName },
            });
            this.#workers.push(w);
            w.on('message', (m: { type: string; buffer?: ArrayBuffer; message?: string }) => {
              if (m.type === 'progress') this.onProgress?.(++done / frames);
              else if (m.type === 'done') resolve(m.buffer!);
              else if (m.type === 'error') reject(new Error(`render worker: ${m.message}`));
            });
            w.on('error', reject);
            w.on(
              'exit',
              (code) => code !== 0 && !this.#canceled && reject(new Error(`render worker exited with ${code}`)),
            );
          }),
      );
    });
    // Avoid unhandled rejections for chunks that are awaited later.
    for (const r of results) r.catch(() => {});

    const output = o.output;
    const videoSource = new EncodedVideoPacketSource(this.#videoCodec!);
    output.addVideoTrack(videoSource, { frameRate: fps });
    let audioSource: AudioSampleSource | null = null;
    if (this.#mixer && this.#audioCodec) {
      audioSource = new AudioSampleSource({ codec: this.#audioCodec, bitrate: o.audio?.bitrate ?? QUALITY_HIGH });
      output.addAudioTrack(audioSource);
    }
    await output.start();
    try {
      // Audio is mixed here while the workers render.
      if (audioSource && this.#mixer) {
        const sr = this.#mixer.sampleRate;
        for (let t = 0; t < this.duration - 1e-9 && !this.#canceled; ) {
          const n = Math.round(Math.min(AUDIO_CHUNK, this.duration - t) * sr);
          const s = new AudioSample({
            data: await this.#mixer.mix(this.#start + t, n),
            format: 'f32',
            numberOfChannels: this.#mixer.numberOfChannels,
            sampleRate: sr,
            timestamp: t,
          });
          await audioSource.add(s);
          s.close();
          t += n / sr;
        }
      }
      let first = true;
      for (let j = 0; j < jobs.length; j++) {
        const buf = await results[j]!;
        if (this.#canceled) return;
        const input = new Input({ formats: [MP4], source: new BufferSource(buf) });
        const track = (await input.getPrimaryVideoTrack())!;
        const decoderConfig = (await track.getDecoderConfig())!;
        const offset = jobs[j]![0] / fps;
        for await (const p of new EncodedPacketSink(track).packets()) {
          const packet = new EncodedPacket(p.data, p.type, p.timestamp + offset, p.duration);
          await videoSource.add(packet, first ? { decoderConfig } : undefined);
          first = false;
        }
        input.dispose();
      }
      videoSource.close();
      audioSource?.close();
      await output.finalize();
      this.stats = {
        frames,
        totalMs: performance.now() - t0,
        renderMs: NaN,
        encodeMs: NaN,
        audioMs: NaN,
        workers: jobs.length,
      };
    } finally {
      await this.#mixer?.dispose();
      await this.#renderer.dispose();
    }
  }

  /** Stops rendering and cancels the output. */
  async cancel(): Promise<void> {
    this.#canceled = true;
    for (const w of this.#workers) w.terminate();
    await this.#opts.output.cancel();
  }
}

export interface CompositionSinkOptions {
  props?: Record<string, unknown>;
  width?: number;
  height?: number;
  fit?: 'fill' | 'contain' | 'cover';
  /** Unused. Kept to match Mediabunny's `CanvasSink`. */
  poolSize?: number;
  gpu?: GpuChoice;
}

/** Pulls rendered frames out of a composition as Skia images. Modeled on Mediabunny's `CanvasSink`. */
export class CompositionSink {
  #renderer: FrameRenderer;
  #comp: Composition<any>;
  #ready: Promise<void>;
  constructor(composition: Composition<any>, options: CompositionSinkOptions = {}) {
    this.#comp = composition;
    let w = options.width,
      h = options.height;
    if (w && !h) h = Math.round((w * composition.height) / composition.width);
    if (h && !w) w = Math.round((h * composition.width) / composition.height);
    this.#renderer = new FrameRenderer(composition, {
      width: w,
      height: h,
      fit: options.fit,
      gpu: options.gpu,
      props: options.props,
    });
    this.#ready = init().then(() => this.#renderer.init());
  }
  async #frame(t: number): Promise<WrappedImage> {
    await this.#ready;
    const s = await this.#renderer.renderFrame(t);
    return { image: s.imageSnapshot(), timestamp: t, duration: 1 / this.#comp.frameRate };
  }
  async getImage(timestamp: number): Promise<WrappedImage | null> {
    await this.#ready;
    if (timestamp < 0 || timestamp >= this.#renderer.duration) return null;
    return this.#frame(timestamp);
  }
  async *images(startTimestamp = 0, endTimestamp?: number): AsyncGenerator<WrappedImage> {
    await this.#ready;
    const fps = this.#comp.frameRate;
    const end = Math.min(endTimestamp ?? Infinity, this.#renderer.duration);
    for (let i = Math.ceil(startTimestamp * fps - 1e-9); i / fps < end - 1e-9; i++) yield await this.#frame(i / fps);
  }
  async *imagesAtTimestamps(timestamps: Iterable<number> | AsyncIterable<number>): AsyncGenerator<WrappedImage | null> {
    for await (const t of timestamps as AsyncIterable<number>) yield await this.getImage(t);
  }
  async dispose(): Promise<void> {
    await this.#ready;
    await this.#renderer.dispose();
  }
}

/** Pulls the mixed audio of a composition as Mediabunny `AudioSample`s. Modeled on `AudioSampleSink`. */
export class CompositionAudioSink {
  #renderer: FrameRenderer;
  #mixer: Promise<AudioMixer>;
  constructor(
    composition: Composition<any>,
    options: { props?: Record<string, unknown>; sampleRate?: number; numberOfChannels?: number } = {},
  ) {
    const renderer = new FrameRenderer(composition, { gpu: 'raster', props: options.props, width: 1, height: 1 });
    this.#renderer = renderer;
    this.#mixer = (async () => {
      await init();
      renderer.duration = await composition.computeDuration(options.props as never);
      const schedule = buildSchedule((t) => renderer.collectAudio(t), renderer.duration, composition.frameRate);
      return new AudioMixer(schedule, options.sampleRate ?? 48000, options.numberOfChannels ?? 2);
    })();
  }
  async getSample(timestamp: number): Promise<AudioSample | null> {
    const m = await this.#mixer;
    if (timestamp < 0 || timestamp >= this.#renderer.duration) return null;
    const n = Math.round(Math.min(AUDIO_CHUNK, this.#renderer.duration - timestamp) * m.sampleRate);
    return new AudioSample({
      data: await m.mix(timestamp, n),
      format: 'f32',
      numberOfChannels: m.numberOfChannels,
      sampleRate: m.sampleRate,
      timestamp,
    });
  }
  async *samples(startTimestamp = 0, endTimestamp?: number): AsyncGenerator<AudioSample> {
    const m = await this.#mixer;
    const end = Math.min(endTimestamp ?? Infinity, this.#renderer.duration);
    for (let t = startTimestamp; t < end - 1e-9; ) {
      const n = Math.round(Math.min(AUDIO_CHUNK, end - t) * m.sampleRate);
      yield new AudioSample({
        data: await m.mix(t, n),
        format: 'f32',
        numberOfChannels: m.numberOfChannels,
        sampleRate: m.sampleRate,
        timestamp: t,
      });
      t += n / m.sampleRate;
    }
  }
  async dispose(): Promise<void> {
    await (await this.#mixer).dispose();
  }
}
