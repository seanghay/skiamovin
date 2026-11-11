import { N } from '../native/runtime.ts';

const registry = new FinalizationRegistry<number>((handle) => {
  try {
    N().object_delete(handle);
  } catch {
    /* runtime torn down */
  }
});

/** Base class for objects backed by a native handle. Released on GC, or explicitly with `delete()` / `using`. */
export abstract class SkObject {
  #handle: number;
  readonly #owned: boolean;

  constructor(handle: number, owned = true) {
    if (!handle) throw new Error(`${new.target.name}: native constructor returned no object`);
    this.#handle = handle;
    this.#owned = owned;
    if (owned) registry.register(this, handle, this);
  }

  /** The native handle. Throws after `delete()`. */
  get handle(): number {
    if (!this.#handle) throw new Error(`${this.constructor.name}: object has been deleted`);
    return this.#handle;
  }

  isDeleted(): boolean {
    return this.#handle === 0;
  }

  /** Releases the native object now. Safe to call twice. */
  delete(): void {
    if (!this.#handle) return;
    if (this.#owned) {
      registry.unregister(this);
      N().object_delete(this.#handle);
    }
    this.#handle = 0;
  }

  [Symbol.dispose](): void {
    this.delete();
  }
}

/** Handle of an optional object, 0 for none. */
export function h(o: SkObject | null | undefined): number {
  return o ? o.handle : 0;
}

export const EMPTY_F32 = new Float32Array(0);
export const EMPTY_U32 = new Uint32Array(0);
