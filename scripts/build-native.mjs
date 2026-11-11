#!/usr/bin/env node
// Builds the Node addon and copies it into packages/skiamovin/native/skiamovin.<platform>-<arch>.node
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const release = !process.argv.includes('--debug');
execFileSync('node', [join(root, 'scripts/gen-bindings.mjs')], { stdio: 'inherit' });
execFileSync('cargo', ['build', '-p', 'skiamovin-node', ...(release ? ['--release'] : [])], {
  cwd: root,
  stdio: 'inherit',
});
const ext = process.platform === 'darwin' ? 'dylib' : process.platform === 'win32' ? 'dll' : 'so';
const prefix = process.platform === 'win32' ? '' : 'lib';
const src = join(root, 'target', release ? 'release' : 'debug', `${prefix}skiamovin_node.${ext}`);
const dest = join(root, 'packages/skiamovin/native', `skiamovin.${process.platform}-${process.arch}.node`);
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`→ ${dest}`);
