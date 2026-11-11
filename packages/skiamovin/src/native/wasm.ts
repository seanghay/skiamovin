// Calls into the Emscripten module using the generated signature table.

import { wrapErrors } from '../core/errors.ts';
import { SIGNATURES } from './generated.ts';
import type { Binding } from './types.ts';

export interface EmscriptenModule {
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  HEAPU32: Uint32Array;
  HEAP32: Int32Array;
  HEAPF64: Float64Array;
  GL?: any;
  [name: string]: any;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function createWasmBinding(M: EmscriptenModule): Binding {
  const alloc = M._skm_alloc as (n: number) => number;
  const free = M._skm_free as (p: number, n: number) => void;
  const retLen = M._skm_ret_len as () => number;
  const retFree = M._skm_ret_free as () => void;
  const errLen = M._skm_err_len as () => number;
  const errPtr = M._skm_err_ptr as () => number;
  const errClear = M._skm_err_clear as () => void;

  const heap = () => M.HEAPU8;

  function checkError() {
    const n = errLen();
    if (n > 0) {
      const msg = decoder.decode(heap().slice(errPtr(), errPtr() + n));
      errClear();
      throw new Error(msg);
    }
  }

  function readRet(kind: string, ptr: number): unknown {
    const n = retLen();
    const h = heap();
    let out: unknown;
    switch (kind) {
      case 's':
        out = decoder.decode(h.slice(ptr, ptr + n));
        break;
      case 'B':
        out = h.slice(ptr, ptr + n);
        break;
      case 'F':
        out = new Float32Array(h.slice(ptr, ptr + n).buffer);
        break;
      case 'U':
        out = new Uint32Array(h.slice(ptr, ptr + n).buffer);
        break;
      case 'I':
        out = new Int32Array(h.slice(ptr, ptr + n).buffer);
        break;
      case 'D':
        out = new Float64Array(h.slice(ptr, ptr + n).buffer);
        break;
    }
    retFree();
    return out;
  }

  const b: Record<string, unknown> = { runtime: 'wasm' };
  for (const [name, sig] of Object.entries(SIGNATURES)) {
    const [params, ret] = sig.split(':') as [string, string];
    const fn = M[`_skm_${name}`] as (...a: number[]) => number;
    if (typeof fn !== 'function') continue;
    const simple = !/[sBFU]/.test(params);
    b[name] = (...args: unknown[]) => {
      const raw: number[] = [];
      const frees: [number, number][] = [];
      if (simple) {
        for (let i = 0; i < params.length; i++) raw.push(params[i] === 'b' ? (args[i] ? 1 : 0) : (args[i] as number));
      } else {
        for (let i = 0; i < params.length; i++) {
          const p = params[i];
          const a = args[i];
          if (p === 's' || p === 'B' || p === 'F' || p === 'U') {
            let bytes: Uint8Array;
            if (p === 's') bytes = encoder.encode(a as string);
            else {
              const v = a as ArrayBufferView;
              bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
            }
            const ptr = bytes.length ? alloc(bytes.length) : 0;
            if (bytes.length) heap().set(bytes, ptr);
            frees.push([ptr, bytes.length]);
            raw.push(ptr, p === 's' || p === 'B' ? bytes.length : bytes.length / 4);
          } else raw.push(p === 'b' ? (a ? 1 : 0) : (a as number));
        }
      }
      let r: number;
      try {
        r = fn(...raw);
      } finally {
        for (const [p, n] of frees) if (n) free(p, n);
      }
      checkError();
      switch (ret) {
        case 'v':
          return undefined;
        case 'b':
          return r !== 0;
        case 'u':
          return r >>> 0;
        case 'i':
        case 'f':
        case 'd':
          return r;
        default:
          return readRet(ret, r);
      }
    };
  }

  // Functions that are not generated.
  const measureCallbacks: ((...a: number[]) => Float64Array)[] = [];
  M.__skm_measure = (cb: number, node: number, kw: number, kh: number, aw: number, ah: number, outPtr: number) => {
    const r = measureCallbacks[cb]!(node, kw, kh, aw, ah);
    M.HEAPF32[outPtr >> 2] = r[0]!;
    M.HEAPF32[(outPtr >> 2) + 1] = r[1]!;
  };
  b.taffy_compute_layout_with_measure = (
    tree: number,
    node: number,
    aw: number,
    ah: number,
    measure: (...a: number[]) => Float64Array,
  ) => {
    const id = measureCallbacks.push(measure) - 1;
    try {
      M._skm_taffy_compute_layout_with_measure(tree, node, aw, ah, id);
      checkError();
    } finally {
      measureCallbacks.pop();
    }
  };
  b.platform_info = () => 'web-wasm32';
  b.gl_make_context_current = (canvas: HTMLCanvasElement | OffscreenCanvas, attrs: WebGLContextAttributes = {}) => {
    const GL = M.GL;
    if (!GL) return false;
    const handle = GL.createContext(canvas, {
      majorVersion: 2,
      minorVersion: 0,
      alpha: true,
      depth: false,
      stencil: true,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      enableExtensionsByDefault: true,
      ...attrs,
    });
    if (!handle) return false;
    GL.makeContextCurrent(handle);
    return true;
  };
  return wrapErrors(b) as unknown as Binding;
}
