/** Base class for all Skiamovin errors. */
export class SkiamovinError extends Error {
  override name = 'SkiamovinError';
}
/** A Skia operation failed (invalid SkSL, undecodable image, deleted object, ...). */
export class SkiaError extends SkiamovinError {
  override name = 'SkiaError';
}
/** A GPU context couldn't be created, or the device was lost. */
export class GpuError extends SkiamovinError {
  override name = 'GpuError';
}
/** A codec isn't available or an encode/decode failed. */
export class CodecError extends SkiamovinError {
  override name = 'CodecError';
}
/** A Taffy operation referenced an invalid node or style. */
export class LayoutError extends SkiamovinError {
  override name = 'LayoutError';
}

function classify(name: string, message: string): Error {
  if (name.startsWith('taffy_') || message.startsWith('layout error') || message.startsWith('style.'))
    return new LayoutError(message);
  if (name.startsWith('gpu_')) return new GpuError(message);
  return new SkiaError(message);
}

/** Wraps every function so native errors surface as typed Skiamovin errors. */
export function wrapErrors<T extends Record<string, unknown>>(raw: T): T {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === 'function' && /^[a-z]/.test(name) && !/^Native/.test(name)) {
      const fn = value as (...a: unknown[]) => unknown;
      out[name] = (...args: unknown[]) => {
        try {
          return fn(...args);
        } catch (e) {
          if (e instanceof SkiamovinError) throw e;
          throw classify(name, (e as Error)?.message ?? String(e));
        }
      };
    } else {
      out[name] = value;
    }
  }
  return out as T;
}
