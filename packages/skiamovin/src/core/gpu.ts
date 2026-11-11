import { nativeCodecs } from '#loader';
import { N } from '../native/runtime.ts';
import { GpuError } from './errors.ts';
import { SkObject } from './object.ts';
import { type ImageInfo, Surface } from './skia.ts';

export type GpuBackend = 'metal' | 'vulkan' | 'd3d12' | 'webgpu' | 'webgl2' | 'raster';

export interface ContextOptions {
  /** Resource cache budget in bytes. Default 256 MiB on Node, 96 MiB on web. */
  resourceCacheLimit?: number;
  /** Throw instead of returning null when the backend is unavailable. */
  strict?: boolean;
}

export const Budgeted = Object.freeze({ No: 0, Yes: 1 } as const);
export type Budgeted = (typeof Budgeted)[keyof typeof Budgeted];

/** A GPU context (Metal on macOS, WebGL2 on the web), owned by the thread that created it. */
export class DirectContext extends SkObject {
  /** The shared WebGL context lives for the whole thread; deleting it is a no-op. */
  override delete(): void {
    if (this === sharedGl) return;
    super.delete();
  }
  backend(): GpuBackend {
    return N().gpu_context_backend(this.handle) as GpuBackend;
  }
  deviceName(): string {
    return N().gpu_context_device_name(this.handle);
  }
  flushAndSubmit(syncCpu = false): void {
    N().gpu_context_flush_and_submit(this.handle, syncCpu);
  }
  /** Resolves once submitted work has finished on the GPU. */
  async onFlushed(): Promise<void> {
    N().gpu_context_flush_and_submit(this.handle, true);
  }
  freeGpuResources(): void {
    N().gpu_context_free_gpu_resources(this.handle);
  }
  performDeferredCleanup(ms: number): void {
    N().gpu_context_perform_deferred_cleanup(this.handle, ms);
  }
  resourceCacheUsage(): { resources: number; bytes: number } {
    const [r, b] = N().gpu_context_resource_cache_usage(this.handle);
    return { resources: r!, bytes: b! };
  }
  isAbandoned(): boolean {
    return N().gpu_context_is_abandoned(this.handle);
  }
  abandon(): void {
    N().gpu_context_abandon(this.handle);
  }
}

function make(fn: () => number, opts: ContextOptions, what: string): DirectContext | null {
  const hh = fn();
  if (!hh) {
    if (opts.strict) throw new GpuError(`${what} is not available`);
    return null;
  }
  return new DirectContext(hh);
}

const isNode = typeof process !== 'undefined' && !!process.versions?.node;
let sharedGl: DirectContext | null = null;
let sharedCanvas: OffscreenCanvas | null = null;

/** @internal The OffscreenCanvas backing this thread's shared WebGL context (web). */
export function _sharedGlCanvas(): OffscreenCanvas | null {
  return sharedCanvas;
}

export const directContexts = {
  /** The best available backend: Metal on macOS, WebGL2 on the web (if a GL context is current). */
  makeDefault(opts: ContextOptions = {}): DirectContext | null {
    const b = N().gpu_default_backend();
    if (b === 'metal') return directContexts.makeMetal(opts);
    if (b === 'webgl2') {
      // Each thread shares one WebGL2 context on an OffscreenCanvas.
      if (!sharedGl) {
        if (typeof OffscreenCanvas === 'undefined') return make(() => 0, opts, 'WebGL2');
        const canvas = new OffscreenCanvas(1, 1);
        sharedGl = directContexts.makeWebGL(canvas, { stencil: true }, opts);
        if (sharedGl) sharedCanvas = canvas;
      }
      return sharedGl;
    }
    if (opts.strict) throw new GpuError('no GPU backend is available in this build');
    return null;
  },
  makeMetal(opts: ContextOptions = {}): DirectContext | null {
    return make(() => N().gpu_make_metal_context(opts.resourceCacheLimit ?? 256 * 2 ** 20), opts, 'Metal');
  },
  makeVulkan(opts: ContextOptions = {}): DirectContext | null {
    if (opts.strict) throw new GpuError('Vulkan is not available in this build');
    return null;
  },
  makeD3D(opts: ContextOptions = {}): DirectContext | null {
    if (opts.strict) throw new GpuError('Direct3D is not available in this build');
    return null;
  },
  /** Web: creates a WebGL2 context on `canvas` and a Skia context on top of it. */
  makeWebGL(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    attrs: WebGLContextAttributes = {},
    opts: ContextOptions = {},
  ): DirectContext | null {
    const anyN = N() as unknown as { gl_make_context_current?: (c: unknown, a: unknown) => boolean };
    if (!anyN.gl_make_context_current?.(canvas, attrs)) return make(() => 0, opts, 'WebGL2');
    return make(() => N().gpu_make_gl_context(opts.resourceCacheLimit ?? 96 * 2 ** 20), opts, 'WebGL2');
  },
};

export interface RenderTargetOptions {
  /** Samples per pixel for antialiasing. 1 turns it off. */
  sampleCount?: number;
  /** Lets a hardware encoder read the texture without copying it (macOS only). Ignored when `sampleCount` > 1. */
  encoderCompatible?: boolean;
}

export const surfaces = {
  /** @internal Wraps the shared WebGL canvas's default framebuffer (web). */
  _wrapCanvasFramebuffer(context: DirectContext, width: number, height: number): Surface | null {
    try {
      return Surface._wrap(N().gpu_surface_wrap_gl_framebuffer(context.handle, width, height, 0, 0, 8));
    } catch {
      return null;
    }
  },
  renderTarget(
    context: DirectContext,
    _budgeted: Budgeted,
    info: ImageInfo,
    opts: RenderTargetOptions = {},
  ): Surface | null {
    if (opts.encoderCompatible && (opts.sampleCount ?? 1) <= 1) {
      try {
        const hh = N().gpu_surface_iosurface(context.handle, info.width, info.height, info.colorSpace);
        if (hh) return Surface._wrap(hh);
      } catch {
        /* fall through */
      }
    }
    try {
      return Surface._wrap(
        N().gpu_surface_render_target(
          context.handle,
          info.width,
          info.height,
          opts.sampleCount ?? 1,
          info.colorType,
          info.colorSpace,
        ),
      );
    } catch {
      return null;
    }
  },
};

export interface GpuInfo {
  backend: GpuBackend;
  device: string | null;
  encoders: string[];
  hardwareEncoders: string[];
  decoders: string[];
  hardwareDecoders: string[];
  zeroCopyEncode: boolean;
}

let infoCache: GpuInfo | null = null;

/** What this runtime can do: GPU backend and codec support. */
export function info(): GpuInfo {
  if (infoCache) return infoCache;
  const backend = N().gpu_default_backend() as GpuBackend;
  let device: string | null = null;
  if (backend === 'metal') {
    const c = directContexts.makeMetal();
    device = c?.deviceName() ?? null;
    c?.delete();
  }
  const codecs = isNode ? nativeCodecs()?.codec_capabilities?.() : null;
  infoCache = {
    backend,
    device,
    encoders: codecs?.videoEncode ?? [],
    hardwareEncoders: codecs?.videoEncodeHardware ?? [],
    decoders: codecs?.videoDecode ?? [],
    hardwareDecoders: codecs?.videoDecodeHardware ?? [],
    zeroCopyEncode: backend === 'metal' && !!codecs,
  };
  return infoCache;
}

export const gpu = { info, directContexts, surfaces, Budgeted, DirectContext };
