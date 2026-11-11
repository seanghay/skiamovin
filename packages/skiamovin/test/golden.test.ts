// Renders the same scenes with the Node addon and the WebAssembly build on the CPU and compares them.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { FilePathSource } from 'mediabunny';
import { init } from 'skiamovin';
import { FontAsset } from 'skiamovin/scene';
import { openTestPage, type TestPage } from './browser/session.ts';
import { goldenLayout, renderGolden } from './shared/golden.js';

let session: TestPage;
before(async () => {
  await init();
  session = await openTestPage();
});
after(async () => {
  await session?.close();
});

/** Fraction of pixels whose largest channel difference exceeds `limit`, and the largest difference seen. */
function compare(a: Uint8Array, b: Uint8Array, limit: number) {
  let over = 0,
    max = 0,
    exact = true;
  for (let i = 0; i < a.length; i += 4) {
    let d = 0;
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(a[i + c]! - b[i + c]!));
    if (d) exact = false;
    if (d > limit) over++;
    max = Math.max(max, d);
  }
  return { exact, overFraction: over / (a.length / 4), max };
}

test('golden: CPU frames match between the Node addon and WebAssembly', async () => {
  const font = new FontAsset(new FilePathSource('/System/Library/Fonts/Supplemental/Arial.ttf'), { family: 'Arial' });
  const native = await renderGolden(font);
  const web = (await session.page.evaluate(() => (window as any).golden())) as {
    frames: { name: string; pixels: string }[];
    layout: number[][];
  };
  assert.equal(web.frames.length, native.length);
  for (let i = 0; i < native.length; i++) {
    const n = native[i]!;
    const w = Buffer.from(web.frames[i]!.pixels, 'base64');
    assert.equal(web.frames[i]!.name, n.name);
    const r = compare(n.pixels, w, 16);
    // Shapes and gradients use Skia's own rasterizer and match exactly. Glyph masks and shaders can differ by a
    // few levels because of per-platform gamma tables and floating-point math.
    const limit = n.name.startsWith('shapes') ? 0 : 4;
    assert.ok(r.max <= limit, `${n.name}: largest difference ${r.max} exceeds ${limit}`);
  }
  assert.deepEqual(web.layout, goldenLayout(), 'Taffy layout is identical');
});
