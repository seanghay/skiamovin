import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FilePathSource } from 'mediabunny';
import { AlphaType, ColorType, ImageInfo, init } from 'skiamovin';
import { box, Composition, CompositionSink, code, FontAsset, type SceneNode } from 'skiamovin/scene';

const menlo = new FontAsset(new FilePathSource('/System/Library/Fonts/Menlo.ttc'), { family: 'Menlo' });
const BEFORE = 'function add(a, b) {\n  return a + b;\n}';
const AFTER = 'function add(a: number, b: number) {\n  // Sum.\n  return a + b;\n}';
const W = 900,
  H = 400;

async function pixels(node: () => SceneNode): Promise<Uint8Array> {
  const comp = new Composition({
    width: W,
    height: H,
    frameRate: 30,
    duration: 1,
    background: '#000000',
    fonts: [menlo],
    render: () => box({ padding: 20 }, [node()]),
  });
  const sink = new CompositionSink(comp, { gpu: 'raster' });
  const px = (await sink.getImage(0))!.image.readPixels(
    0,
    0,
    new ImageInfo(W, H, ColorType.RGBA_8888, AlphaType.Unpremul),
  );
  await sink.dispose();
  return px;
}

/** Bounds of everything that isn't black: the code card. */
function bounds(px: Uint8Array): [number, number, number, number] {
  let l = W,
    t = H,
    r = -1,
    b = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (px[i]! + px[i + 1]! + px[i + 2]! > 0) {
        l = Math.min(l, x);
        t = Math.min(t, y);
        r = Math.max(r, x);
        b = Math.max(b, y);
      }
    }
  return [l, t, r, b];
}

const brightness = (px: Uint8Array) => {
  let s = 0;
  for (let i = 0; i < px.length; i += 4) s += px[i]! + px[i + 1]! + px[i + 2]!;
  return s;
};

test('code: highlights code on a themed card', async () => {
  await init();
  const px = await pixels(() => code(BEFORE, { fontSize: 24 }));
  const [l, t, r, b] = bounds(px);
  assert.ok(r - l > 200 && b - t > 80, `card ${r - l}x${b - t}`);
  // github-dark-default's background, #0d1117, fills the card.
  const i = ((t + 4) * W + l + 20) * 4;
  assert.deepEqual([px[i], px[i + 1], px[i + 2]], [0x0d, 0x11, 0x17]);
});

test('code: animates from one version to the next', async () => {
  await init();
  const before = bounds(await pixels(() => code(BEFORE, { fontSize: 24 })));
  const after = bounds(await pixels(() => code(AFTER, { fontSize: 24 })));
  const at0 = bounds(await pixels(() => code(AFTER, { fontSize: 24, from: BEFORE, progress: 0 })));
  const mid = bounds(await pixels(() => code(AFTER, { fontSize: 24, from: BEFORE, progress: 0.5 })));
  const at1 = bounds(await pixels(() => code(AFTER, { fontSize: 24, from: BEFORE, progress: 1 })));
  assert.deepEqual(at0, before);
  assert.deepEqual(at1, after);
  assert.ok(mid[2] > before[2] && mid[2] < after[2], `width grows (${mid[2]})`);
  assert.ok(mid[3] > before[3] && mid[3] < after[3], `height grows (${mid[3]})`);
});

test('code: highlight dims the other lines', async () => {
  await init();
  const all = brightness(await pixels(() => code(AFTER, { fontSize: 24 })));
  const one = brightness(await pixels(() => code(AFTER, { fontSize: 24, highlight: [3] })));
  assert.ok(one < all * 0.9, `${one} < ${all}`);
});
