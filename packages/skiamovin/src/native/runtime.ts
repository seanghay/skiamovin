import type { Binding } from './types.ts';

let binding: Binding | null = null;

/** The active native binding. Throws if `init()` hasn't completed (web). */
export function N(): Binding {
  if (!binding) {
    throw new Error('Skiamovin is not initialized. Call `await init()` from "skiamovin" first.');
  }
  return binding;
}

export function setBinding(b: Binding): void {
  binding = b;
}

export function hasBinding(): boolean {
  return binding !== null;
}
