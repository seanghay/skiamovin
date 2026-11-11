// Runs compositions in a Web Worker.

import { AlphaType, ColorType } from '../core/enums.ts';
import { ImageInfo } from '../core/skia.ts';
import { init } from '../index.ts';
import { AudioMixer, buildSchedule } from './audio.ts';
import { type Composition, CompositionModule } from './composition.ts';
import { type ChunkJob, renderChunk } from './render-chunk.ts';
import { FrameRenderer, type GpuChoice } from './renderer.ts';

/** Creates the worker that serves a composition, e.g. `() => new Worker(new URL('./promo.worker.ts', import.meta.url), { type: 'module' })`. */
export type WorkerFactory = () => Worker;

export interface OpenOptions {
  module?: { url: string; exportName: string };
  props?: Record<string, unknown>;
  width: number;
  height: number;
  gpu?: GpuChoice;
}

/** A frame from a worker: an ImageBitmap when rendered on the GPU, otherwise RGBA pixels. */
export type WorkerFrame = { bitmap: ImageBitmap } | { pixels: Uint8Array; width: number; height: number };

type Request =
  | { id: number; op: 'open'; options: OpenOptions }
  | { id: number; op: 'frame'; timestamp: number }
  | { id: number; op: 'props'; props: Record<string, unknown> }
  | { id: number; op: 'mix'; from: number; frames: number; sampleRate: number; channels: number }
  | { id: number; op: 'chunk'; job: ChunkJob }
  | { id: number; op: 'close' };

type Reply =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
  | { id: number; progress: number };

/**
 * Serves `composition` to `Player` and `Render` from inside a Web Worker. Call it at the top level of a worker
 * module:
 *
 * ```ts
 * // promo.worker.ts
 * import { serveComposition } from 'skiamovin/scene';
 * import { promo } from './promo.ts';
 * serveComposition(promo);
 * ```
 *
 * Without an argument, the worker loads the composition named by the caller's `CompositionModule`.
 */
export function serveComposition(composition?: Composition<any>): void {
  const scope = globalThis as unknown as {
    postMessage(m: unknown, t?: Transferable[]): void;
    addEventListener(t: 'message', f: (e: MessageEvent) => void): void;
  };
  let renderer: FrameRenderer | null = null;
  let mixer: AudioMixer | null | undefined;
  const load = async (module?: { url: string; exportName: string }): Promise<Composition<any>> => {
    if (composition) return composition;
    if (!module) throw new Error('serveComposition(): no composition given and the caller sent no CompositionModule');
    return new CompositionModule(module.url, module.exportName).load();
  };

  const handle = async (req: Request): Promise<[unknown, Transferable[]?]> => {
    switch (req.op) {
      case 'open': {
        await init();
        const comp = await load(req.options.module);
        await renderer?.dispose();
        renderer = new FrameRenderer(comp, {
          width: req.options.width,
          height: req.options.height,
          gpu: req.options.gpu ?? 'auto',
          props: req.options.props,
          capture: true,
        });
        await renderer.init();
        mixer = undefined;
        return [
          {
            duration: renderer.duration,
            backend: renderer.backend,
            width: comp.width,
            height: comp.height,
            frameRate: comp.frameRate,
          },
        ];
      }
      case 'frame': {
        const r = renderer!;
        const surface = await r.renderFrame(req.timestamp);
        if (r.lastBitmap) {
          const bitmap = r.lastBitmap;
          r.lastBitmap = null;
          return [{ bitmap }, [bitmap]];
        }
        const w = surface.width(),
          h = surface.height();
        const pixels = surface.readPixels(0, 0, new ImageInfo(w, h, ColorType.RGBA_8888, AlphaType.Unpremul));
        return [{ pixels, width: w, height: h }, [pixels.buffer as ArrayBuffer]];
      }
      case 'props':
        Object.assign(renderer!.props, req.props);
        return [undefined];
      case 'mix': {
        const r = renderer!;
        if (mixer === undefined) {
          const schedule = buildSchedule((t) => r.collectAudio(t), r.duration, r.comp.frameRate);
          mixer = schedule.length ? new AudioMixer(schedule, req.sampleRate, req.channels) : null;
        }
        if (!mixer) return [null];
        const data = await mixer.mix(req.from, req.frames);
        return [data, [data.buffer as ArrayBuffer]];
      }
      case 'chunk': {
        await init();
        const comp = await load(
          req.job.moduleUrl ? { url: req.job.moduleUrl, exportName: req.job.exportName ?? 'default' } : undefined,
        );
        const total = req.job.endFrame - req.job.firstFrame;
        const buffer = await renderChunk(comp, req.job, (f) =>
          scope.postMessage({ id: req.id, progress: (f - req.job.firstFrame + 1) / total } satisfies Reply),
        );
        return [buffer, [buffer]];
      }
      case 'close':
        await mixer?.dispose();
        await renderer?.dispose();
        renderer = null;
        mixer = undefined;
        return [undefined];
    }
  };

  // Requests run one at a time, in order.
  let queue = Promise.resolve();
  scope.addEventListener('message', (e: MessageEvent) => {
    const req = e.data as Request;
    if (!req || typeof req.id !== 'number' || typeof req.op !== 'string') return;
    queue = queue.then(async () => {
      try {
        const [result, transfer] = await handle(req);
        scope.postMessage({ id: req.id, ok: true, result } satisfies Reply, transfer ?? []);
      } catch (err) {
        scope.postMessage({ id: req.id, ok: false, error: String((err as Error)?.stack ?? err) } satisfies Reply);
      }
    });
  });
}

/** Main-thread handle on a worker running `serveComposition()`. */
export class CompositionWorker {
  readonly worker: Worker;
  #next = 1;
  #pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; progress?: (p: number) => void }>();
  #error: Error | null = null;

  constructor(worker: Worker) {
    this.worker = worker;
    worker.addEventListener('message', (e: MessageEvent) => {
      const m = e.data as Reply;
      const p = this.#pending.get(m.id);
      if (!p) return;
      if ('progress' in m) return p.progress?.(m.progress);
      this.#pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(`composition worker: ${m.error}`));
    });
    worker.addEventListener('error', (e: ErrorEvent) => {
      this.#error = new Error(`composition worker failed: ${e.message || 'could not load the worker script'}`);
      for (const p of this.#pending.values()) p.reject(this.#error);
      this.#pending.clear();
    });
  }

  /** The built-in worker, which loads a `CompositionModule` by URL. Needs no bundler support. */
  static forModule(): CompositionWorker {
    return new CompositionWorker(new Worker(new URL('./composition-worker.js', import.meta.url), { type: 'module' }));
  }

  call<T>(op: Request['op'], args: Record<string, unknown> = {}, onProgress?: (p: number) => void): Promise<T> {
    if (this.#error) return Promise.reject(this.#error);
    const id = this.#next++;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject, progress: onProgress });
      this.worker.postMessage({ id, op, ...args });
    });
  }

  terminate(): void {
    this.worker.terminate();
    const err = new Error('composition worker terminated');
    for (const p of this.#pending.values()) p.reject(err);
    this.#pending.clear();
  }
}
