#!/usr/bin/env node
// Builds the WebAssembly module (emscripten) into packages/skiamovin/wasm/.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync('node', [join(root, 'scripts/gen-bindings.mjs')], { stdio: 'inherit' });
execFileSync('cargo', ['build', '-p', 'skiamovin-wasm', '--target', 'wasm32-unknown-emscripten', '--release'], {
  cwd: root,
  stdio: 'inherit',
  // panic=abort: the prebuilt Skia uses emscripten setjmp/longjmp, which can't be combined with wasm exceptions.
  env: { ...process.env, CARGO_PROFILE_RELEASE_PANIC: 'abort' },
});
const outDir = join(root, 'packages/skiamovin/wasm');
mkdirSync(outDir, { recursive: true });
for (const f of ['skiamovin.js', 'skiamovin.wasm'])
  copyFileSync(join(root, 'target/wasm32-unknown-emscripten/release', f), join(outDir, f));
console.log(`→ ${outDir} (${(statSync(join(outDir, 'skiamovin.wasm')).size / 2 ** 20).toFixed(1)} MiB wasm)`);
