import { loadBinding, loadBindingSync, runtime } from '#loader';
import { hasBinding, N, setBinding } from './native/runtime.ts';

export interface InitOptions {
  /** Web only: URL of the WASM binary. */
  wasmUrl?: string | URL;
  /** Node only: register native codecs with Mediabunny. Default true. */
  registerNativeCodecs?: boolean;
}

let initPromise: Promise<void> | null = null;

/** Initializes Skiamovin. Required in the browser; on Node it loads the addon and registers codecs. */
export function init(options: InitOptions = {}): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      if (!hasBinding()) setBinding(await loadBinding(options));
      if (options.registerNativeCodecs !== false && runtime === 'node') {
        const media = await import('./media/index.ts');
        media.registerNativeCodecs();
      }
    })();
  }
  return initPromise;
}

// On Node the addon loads synchronously, so the Skia API works even before `init()`.
if (runtime === 'node' && !hasBinding()) {
  try {
    setBinding(loadBindingSync());
  } catch {
    /* reported on first use / init() */
  }
}

export function isInitialized(): boolean {
  return hasBinding();
}

/** Versions and runtime details. */
export function version(): { skiamovin: string; skia: string; runtime: 'node' | 'wasm'; platform: string } {
  return { skiamovin: '0.1.0', skia: N().skia_version(), runtime: N().runtime, platform: N().platform_info() };
}

/** Number of live native objects on this thread (useful for leak checks). */
export function liveObjectCount(): number {
  return N().object_count();
}

export { Color, Color4f, parseCssColor, toColor4f, toColorInt } from './core/color.ts';
export * from './core/enums.ts';
export * from './core/errors.ts';
export type { MatrixLike, Point, RectLike, Size } from './core/geometry.ts';
export { M44, Matrix, Rect, RRect } from './core/geometry.ts';
export type { ContextOptions, GpuBackend, GpuInfo } from './core/gpu.ts';
export { Budgeted, DirectContext, gpu } from './core/gpu.ts';
export { SkObject } from './core/object.ts';
export type { RuntimeChild, RuntimeUniform, Sampling, SaveLayerRec, UniformValues } from './core/skia.ts';
export {
  Blender,
  blenders,
  Canvas,
  Codec,
  ColorFilter,
  ContourMeasure,
  ContourMeasureIter,
  CubicResampler,
  colorFilters,
  Image,
  ImageFilter,
  ImageInfo,
  imageFilters,
  images,
  MaskFilter,
  maskFilters,
  Paint,
  Path,
  PathEffect,
  PathMorph,
  PdfDocument,
  Picture,
  PictureRecorder,
  pathEffects,
  pdf,
  RuntimeEffect,
  SamplingOptions,
  Shader,
  Surface,
  shaders,
  surfaces,
} from './core/skia.ts';
export { svg } from './core/svg.ts';
export type { FontMetrics, GlyphRun, LineMetrics, TextBox } from './core/text.ts';
export { Font, FontMgr, FontStyle, TextBlob, Typeface, tag, textlayout } from './core/text.ts';
