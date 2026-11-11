import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { OUT } from './fixtures/media.ts';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const run = (...args: string[]) => execFileSync('node', [CLI, ...args], { encoding: 'utf8' });

function module(): string {
  mkdirSync(OUT, { recursive: true });
  const file = `${OUT}cli-comp.ts`;
  writeFileSync(
    file,
    `import { box, Composition, text } from 'skiamovin/scene';
export default new Composition({
  width: 320, height: 180, frameRate: 30, duration: 1, events: { hit: 0.5 },
  render: ({ timestamp }) => box({ size: { width: '100%', height: '100%' }, background: '#123456' }, [
    box({ size: { width: 40 + timestamp * 100, height: 20 }, background: '#ffffff' }),
  ]),
});
`,
  );
  return file;
}

test('cli: inspect prints the composition and its tree as JSON', () => {
  const report = JSON.parse(run('inspect', module(), '--timestamp', '0.5'));
  assert.equal(report.width, 320);
  assert.equal(report.duration, 1);
  assert.deepEqual(report.events, { hit: 0.5 });
  assert.equal(report.tree[0].type, 'box');
  assert.deepEqual(report.tree[0].children[0].style.size, { width: 90, height: 20 });
});

test('cli: still and info', () => {
  const png = `${OUT}cli-still.png`;
  run('still', module(), png, '--timestamp', '0.5');
  assert.ok(existsSync(png));
  const info = JSON.parse(run('info'));
  assert.equal(info.runtime, 'node');
  assert.ok(info.gpu.backend);
  assert.throws(() => run('nope'), /unknown command/);
});
