// Loads the native addon. Selected through the "#loader" import condition `node`.

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wrapErrors } from '../core/errors.ts';
import type { Binding } from './types.ts';

export const runtime = 'node' as const;

let cached: Binding | null = null;

function candidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const triple = `${process.platform}-${process.arch}`;
  const pkgRoot = join(here, '..', '..');
  return [
    process.env.SKIAMOVIN_NATIVE_PATH ?? '',
    join(pkgRoot, 'native', `skiamovin.${triple}.node`),
    `@skiamovin/${triple}`,
  ].filter(Boolean);
}

export function loadBindingSync(): Binding {
  if (cached) return cached;
  const require = createRequire(import.meta.url);
  const errors: string[] = [];
  for (const c of candidates()) {
    if (isAbsolute(c) && !existsSync(c)) continue;
    try {
      const raw = require(c);
      cached = wrapErrors({ ...raw, runtime: 'node' }) as Binding;
      return cached;
    } catch (e) {
      errors.push(`${c}: ${(e as Error).message}`);
    }
  }
  throw new Error(
    `Skiamovin: no native addon for ${process.platform}-${process.arch}.\n` +
      (errors.join('\n') || 'No candidates found.'),
  );
}

export async function loadBinding(_options?: unknown): Promise<Binding> {
  return loadBindingSync();
}

/** Native codec classes (VideoToolbox/AudioToolbox on macOS). */
export function nativeCodecs(): any {
  return loadBindingSync() as any;
}
