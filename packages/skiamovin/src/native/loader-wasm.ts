// Loads the WebAssembly build. Selected through the "#loader" import condition `default` (browsers, workers).
import type { Binding } from './types.ts';
import { createWasmBinding, type EmscriptenModule } from './wasm.ts';

export const runtime = 'wasm' as const;

let pending: Promise<Binding> | null = null;

export interface WasmLoadOptions {
  wasmUrl?: string | URL;
}

export function loadBindingSync(): Binding {
  throw new Error('Skiamovin (web): call `await init()` before using the API.');
}

export function loadBinding(options: WasmLoadOptions = {}): Promise<Binding> {
  if (!pending) {
    pending = (async () => {
      const glueUrl = new URL('../../wasm/skiamovin.js', import.meta.url);
      const factory = (await import(/* @vite-ignore */ glueUrl.href)).default as (
        o: object,
      ) => Promise<EmscriptenModule>;
      const wasmUrl = options.wasmUrl
        ? String(options.wasmUrl)
        : new URL('../../wasm/skiamovin.wasm', import.meta.url).href;
      const mod = await factory({ locateFile: (p: string) => (p.endsWith('.wasm') ? wasmUrl : p) });
      return createWasmBinding(mod);
    })();
  }
  return pending;
}

export function nativeCodecs(): any {
  return null;
}
