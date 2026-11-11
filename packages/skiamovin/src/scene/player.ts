// Real-time preview on a browser canvas.
import { AlphaType, ColorType, ImageInfo, init } from '../index.ts';
import { AudioMixer, buildSchedule } from './audio.ts';
import { Composition, CompositionModule } from './composition.ts';
import { FrameRenderer, type GpuChoice } from './renderer.ts';
import { CompositionWorker, type WorkerFactory, type WorkerFrame } from './worker.ts';

export interface PlayerOptions {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  props?: Record<string, unknown>;
  loop?: boolean;
  autoplay?: boolean;
  audio?: boolean;
  playbackRate?: number;
  scale?: number;
  /**
   * Where to render frames: a function that creates a worker running `serveComposition()`, `true` for the built-in
   * worker (needs a `CompositionModule`), or `false` for this thread. Defaults to `true` for a `CompositionModule`.
   */
  worker?: boolean | WorkerFactory;
  gpu?: GpuChoice;
}

/** What Player needs from a renderer, on this thread or in a worker. */
interface Backend {
  readonly duration: number;
  readonly backend: string;
  frame(timestamp: number): Promise<WorkerFrame>;
  setProps(props: Record<string, unknown>): Promise<void>;
  mix(from: number, frames: number): Promise<Float32Array | null>;
  dispose(): Promise<void>;
}

class LocalBackend implements Backend {
  #r: FrameRenderer;
  #mixer: AudioMixer | null | undefined;
  constructor(r: FrameRenderer) {
    this.#r = r;
  }
  get duration(): number {
    return this.#r.duration;
  }
  get backend(): string {
    return this.#r.backend;
  }
  async frame(timestamp: number): Promise<WorkerFrame> {
    const r = this.#r;
    const surface = await r.renderFrame(timestamp);
    if (r.lastBitmap) {
      const bitmap = r.lastBitmap;
      r.lastBitmap = null;
      return { bitmap };
    }
    const w = surface.width(),
      h = surface.height();
    return {
      pixels: surface.readPixels(0, 0, new ImageInfo(w, h, ColorType.RGBA_8888, AlphaType.Unpremul)),
      width: w,
      height: h,
    };
  }
  async setProps(props: Record<string, unknown>): Promise<void> {
    Object.assign(this.#r.props, props);
  }
  async mix(from: number, frames: number): Promise<Float32Array | null> {
    const r = this.#r;
    if (this.#mixer === undefined) {
      const schedule = buildSchedule((t) => r.collectAudio(t), r.duration, r.comp.frameRate);
      this.#mixer = schedule.length ? new AudioMixer(schedule, 48000, 2) : null;
    }
    return this.#mixer ? this.#mixer.mix(from, frames) : null;
  }
  async dispose(): Promise<void> {
    await this.#mixer?.dispose();
    await this.#r.dispose();
  }
}

class WorkerBackend implements Backend {
  #w: CompositionWorker;
  duration = 0;
  backend = 'raster';
  constructor(w: CompositionWorker) {
    this.#w = w;
  }
  frame(timestamp: number): Promise<WorkerFrame> {
    return this.#w.call('frame', { timestamp });
  }
  setProps(props: Record<string, unknown>): Promise<void> {
    return this.#w.call('props', { props });
  }
  mix(from: number, frames: number): Promise<Float32Array | null> {
    return this.#w.call('mix', { from, frames, sampleRate: 48000, channels: 2 });
  }
  async dispose(): Promise<void> {
    await this.#w.call('close').catch(() => {});
    this.#w.terminate();
  }
}

/** Real-time preview of a composition on a canvas (web). */
export class Player {
  /** Set once the composition has loaded (immediately when a `Composition` is passed). */
  composition!: Composition<any>;
  #source: Composition<any> | CompositionModule;
  #opts: PlayerOptions;
  #backend: Backend | null = null;
  #ready: Promise<void>;
  #playing = false;
  #time = 0;
  #startWall = 0;
  #startTime = 0;
  #raf = 0;
  #busy = false;
  #disposed = false;
  #audioCtx: AudioContext | null = null;
  #audioNodes: AudioBufferSourceNode[] = [];
  #props: Record<string, unknown>;
  #present: ImageBitmapRenderingContext | null = null;
  #ctx2d: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  /** True when frames are rendered in a worker. */
  readonly inWorker: boolean;
  onTimeUpdate?: (timestamp: number) => unknown;
  onEnded?: () => unknown;

  constructor(composition: Composition<any> | CompositionModule, options: PlayerOptions) {
    this.#source = composition;
    if (composition instanceof Composition) this.composition = composition;
    this.#opts = options;
    this.#props = { ...(options.props ?? {}) };
    const w = options.worker ?? composition instanceof CompositionModule;
    if (w === true && !(composition instanceof CompositionModule)) {
      throw new TypeError(
        'Player: `worker: true` needs a CompositionModule. Pass a worker factory that runs serveComposition() instead',
      );
    }
    this.inWorker = w !== false;
    this.#ready = this.#setup();
    this.#ready.catch(() => {});
    if (options.autoplay) void this.#ready.then(() => this.play());
  }

  /** Resolves when the first frame is on the canvas. */
  get ready(): Promise<void> {
    return this.#ready;
  }

  /** The backend used to render frames, such as 'webgl2' or 'raster'. */
  get backend(): string {
    return this.#backend?.backend ?? 'raster';
  }

  async #setup(): Promise<void> {
    const src = this.#source;
    const comp = src instanceof Composition ? src : await src.load();
    this.composition = comp;
    const scale = this.#opts.scale ?? 1;
    const w = Math.round(comp.width * scale);
    const h = Math.round(comp.height * scale);
    const c = this.#opts.canvas;
    c.width = w;
    c.height = h;
    const gpu = this.#opts.gpu ?? 'auto';
    if (this.inWorker) {
      const factory = this.#opts.worker;
      const cw = typeof factory === 'function' ? new CompositionWorker(factory()) : CompositionWorker.forModule();
      const b = new WorkerBackend(cw);
      this.#backend = b;
      const module =
        src instanceof CompositionModule
          ? { url: new URL(src.url, location.href).href, exportName: src.exportName }
          : undefined;
      const info = await cw.call<{ duration: number; backend: string }>('open', {
        options: { module, props: this.#props, width: w, height: h, gpu },
      });
      b.duration = info.duration;
      b.backend = info.backend;
    } else {
      await init();
      const r = new FrameRenderer(comp, { width: w, height: h, gpu, props: this.#props, capture: true });
      await r.init();
      this.#backend = new LocalBackend(r);
    }
    await this.#draw();
  }

  get playing(): boolean {
    return this.#playing;
  }
  get currentTime(): number {
    return this.#time;
  }
  async computeDuration(): Promise<number> {
    await this.#ready;
    return this.#backend!.duration;
  }

  async #draw(): Promise<void> {
    const f = await this.#backend!.frame(this.#time);
    if (this.#disposed) {
      if ('bitmap' in f) f.bitmap.close();
      return;
    }
    const c = this.#opts.canvas;
    if ('bitmap' in f) {
      // Show the bitmap directly, without copying its pixels.
      this.#present ??= c.getContext('bitmaprenderer') as ImageBitmapRenderingContext | null;
      if (this.#present) this.#present.transferFromImageBitmap(f.bitmap);
      else f.bitmap.close();
    } else {
      this.#ctx2d ??= c.getContext('2d') as CanvasRenderingContext2D | null;
      this.#ctx2d?.putImageData(
        new ImageData(
          new Uint8ClampedArray(f.pixels.buffer as ArrayBuffer, f.pixels.byteOffset, f.pixels.byteLength),
          f.width,
          f.height,
        ),
        0,
        0,
      );
    }
    this.onTimeUpdate?.(this.#time);
  }

  async #startAudio(): Promise<void> {
    if (!this.#opts.audio || typeof AudioContext === 'undefined') return;
    const remaining = this.#backend!.duration - this.#time;
    const frames = Math.round(remaining * 48000);
    if (frames <= 0) return;
    const data = await this.#backend!.mix(this.#time, frames);
    if (!data || !this.#playing) return;
    this.#audioCtx ??= new AudioContext({ sampleRate: 48000 });
    const ctx = this.#audioCtx;
    const buf = ctx.createBuffer(2, frames, 48000);
    const l = buf.getChannelData(0),
      rr = buf.getChannelData(1);
    for (let i = 0; i < frames; i++) {
      l[i] = data[i * 2]!;
      rr[i] = data[i * 2 + 1]!;
    }
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.playbackRate.value = this.#opts.playbackRate ?? 1;
    node.connect(ctx.destination);
    node.start();
    this.#audioNodes.push(node);
  }

  #stopAudio(): void {
    for (const n of this.#audioNodes) n.stop();
    this.#audioNodes = [];
  }

  async play(): Promise<void> {
    await this.#ready;
    if (this.#playing || this.#disposed) return;
    const dur = this.#backend!.duration;
    const fps = this.composition.frameRate;
    if (this.#time >= dur - 1e-6) this.#time = 0;
    this.#playing = true;
    this.#startWall = performance.now();
    this.#startTime = this.#time;
    await this.#startAudio();
    const tick = async () => {
      if (!this.#playing) return;
      const rate = this.#opts.playbackRate ?? 1;
      let t = this.#startTime + ((performance.now() - this.#startWall) / 1000) * rate;
      if (t >= dur) {
        if (this.#opts.loop) {
          this.#stopAudio();
          this.#time = 0;
          this.#startWall = performance.now();
          this.#startTime = 0;
          t = 0;
          await this.#startAudio();
        } else {
          this.#time = dur - 1 / fps;
          this.#playing = false;
          await this.#draw();
          this.onEnded?.();
          return;
        }
      }
      // Skip frames instead of falling behind.
      if (!this.#busy) {
        this.#busy = true;
        this.#time = Math.floor(t * fps) / fps;
        // Worker rendering doesn't block this thread, so keep scheduling ticks meanwhile.
        const p = this.#draw().finally(() => (this.#busy = false));
        if (!this.inWorker) await p;
      }
      this.#raf = requestAnimationFrame(() => void tick());
    };
    this.#raf = requestAnimationFrame(() => void tick());
  }

  pause(): void {
    this.#playing = false;
    cancelAnimationFrame(this.#raf);
    this.#stopAudio();
  }

  async seek(timestamp: number): Promise<void> {
    await this.#ready;
    const wasPlaying = this.#playing;
    this.pause();
    this.#time = Math.max(0, Math.min(timestamp, this.#backend!.duration - 1e-6));
    await this.#draw();
    if (wasPlaying) await this.play();
  }

  async setProps(props: Record<string, unknown>): Promise<void> {
    await this.#ready;
    Object.assign(this.#props, props);
    await this.#backend!.setProps(props);
    if (!this.#playing) await this.#draw();
  }

  dispose(): void {
    this.pause();
    this.#disposed = true;
    void this.#audioCtx?.close();
    void this.#ready.finally(() => this.#backend?.dispose());
  }
}
