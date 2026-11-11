import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FilePathSource } from 'mediabunny';
import { AlphaType, ColorType, ImageInfo, init } from 'skiamovin';
import {
  box,
  Composition,
  CompositionSink,
  FontAsset,
  fitText,
  fontAxes,
  path,
  type SceneNode,
  text,
  textPaths,
  variableText,
} from 'skiamovin/scene';

// San Francisco is a variable font with width and weight axes.
const sf = new FontAsset(new FilePathSource('/System/Library/Fonts/SFNS.ttf'), { family: 'SF' });
const W = 800,
  H = 200;

async function pixels(node: () => SceneNode): Promise<Uint8Array> {
  const comp = new Composition({
    width: W,
    height: H,
    frameRate: 30,
    duration: 1,
    background: '#000000',
    fonts: [sf],
    render: () => box({ padding: 10 }, [node()]),
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

const lit = (px: Uint8Array) => {
  let n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i]! > 127) n++;
  return n;
};

const sum = (px: Uint8Array) => {
  let n = 0;
  for (let i = 0; i < px.length; i += 4) n += px[i]!;
  return n;
};

const right = (px: Uint8Array) => {
  let r = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4]! > 127) r = Math.max(r, x);
  return r;
};

test('textPaths: one shape per character, matching drawn text', async () => {
  await init();
  const seen: string[] = [];
  const shapes = await pixels(() =>
    textPaths('Héllo', {
      fontSize: 80,
      color: '#ffffff',
      each: (g) => {
        seen.push(g.text);
        return path(g.path, { fill: g.color });
      },
    }),
  );
  assert.deepEqual(seen.slice(0, 5), ['H', 'é', 'l', 'l', 'o']);
  const drawn = await pixels(() => text('Héllo', { fontSize: 80, color: '#ffffff' }));
  // Same place and shape; text antialiasing applies a gamma that paths don't, so compare loosely.
  assert.equal(right(shapes), right(drawn));
  const a = sum(shapes),
    b = sum(drawn);
  assert.ok(Math.abs(a - b) / b < 0.1, `same coverage (${a} vs ${b})`);
  const outline = lit(
    await pixels(() =>
      textPaths('Héllo', {
        fontSize: 80,
        each: (g) => path(g.path, { stroke: '#ffffff', strokeWidth: 2, fill: null }),
      }),
    ),
  );
  assert.ok(outline > 0 && outline < lit(shapes), `outlines (${outline})`);
});

test('variableText: heavier characters take more room', async () => {
  await init();
  const light = right(
    await pixels(() => variableText('Weight', () => ({ wght: 100 }), { fontSize: 80, color: '#fff' })),
  );
  const heavy = right(
    await pixels(() => variableText('Weight', () => ({ wght: 900 }), { fontSize: 80, color: '#fff' })),
  );
  assert.ok(heavy > light + 10, `${heavy} > ${light}`);
});

test('fitText: sets the width axis to fill the width', async () => {
  await init();
  for (const width of [200, 300]) {
    const r = right(await pixels(() => fitText('FIT ME', { width, range: [30, 150], fontSize: 80, color: '#fff' })));
    // The box starts at x = 10; glyph side bearings leave a few pixels. At 80 pixels the width axis spans about
    // 120 to 354 pixels for this text.
    assert.ok(Math.abs(r - (10 + width)) < 12, `right edge ${r} for width ${width}`);
  }
  assert.ok(fontAxes(sf).some((a) => a.tag === 'wdth' && a.min === 30 && a.max === 150));
});
