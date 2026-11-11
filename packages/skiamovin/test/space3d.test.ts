import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlphaType, ColorType, ImageInfo, init } from 'skiamovin';
import { box, Composition, CompositionSink, type Item3D, space3d } from 'skiamovin/scene';

const W = 400,
  H = 300;

async function frame(items: Item3D[], camera = {}): Promise<Uint8Array> {
  const comp = new Composition({
    width: W,
    height: H,
    frameRate: 30,
    duration: 1,
    background: '#000000',
    render: () => space3d({ width: W, height: H }, camera, items),
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

const card = (color: string) => box({ size: { width: 100, height: 60 }, background: color });
const at = (px: Uint8Array, x: number, y: number) => [...px.slice((y * W + x) * 4, (y * W + x) * 4 + 3)];

/** Width of the red area along the middle row. */
function redWidth(px: Uint8Array): number {
  let n = 0;
  for (let x = 0; x < W; x++) if (at(px, x, H / 2)[0]! > 127) n++;
  return n;
}

test('space3d: true size at z = 0, smaller farther away', async () => {
  await init();
  const flat = await frame([{ node: card('#ff0000') }]);
  assert.equal(redWidth(flat), 100);
  assert.deepEqual(at(flat, W / 2 - 49, H / 2 - 29), [255, 0, 0]);
  assert.deepEqual(at(flat, W / 2 - 52, H / 2), [0, 0, 0]);
  const far = redWidth(await frame([{ node: card('#ff0000'), z: -400 }]));
  assert.ok(far > 30 && far < 70, `${far}`);
  const behind = redWidth(await frame([{ node: card('#ff0000'), z: 2000 }]));
  assert.equal(behind, 0);
});

test('space3d: nearer items cover farther ones, and backfaces can hide', async () => {
  await init();
  const items: Item3D[] = [
    { node: card('#00ff00'), z: 50 },
    { node: card('#ff0000'), z: -50 },
  ];
  assert.deepEqual(at(await frame(items), W / 2, H / 2), [0, 255, 0]);
  const flipped = await frame([{ node: card('#ff0000'), rotateY: 180, backface: 'hidden' }]);
  assert.equal(redWidth(flipped), 0);
  const shown = await frame([{ node: card('#ff0000'), rotateY: 180 }]);
  assert.equal(redWidth(shown), 100);
  // Turned 60 degrees around the vertical axis, it looks half as wide.
  const turned = redWidth(await frame([{ node: card('#ff0000'), rotateY: 60 }]));
  assert.ok(Math.abs(turned - 50) <= 3, `${turned}`);
});

test('space3d: a positive tilt looks down from above', async () => {
  await init();
  // A floor card lying flat below the center: from above it shows its top; seen level it's edge-on and invisible.
  const floor: Item3D[] = [{ node: card('#ff0000'), y: 40, rotateX: 90, backface: 'hidden' }];
  const level = await frame(floor);
  const above = await frame(floor, { tilt: 30 });
  const red = (px: Uint8Array) => {
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i]! > 127) n++;
    return n;
  };
  assert.equal(red(level), 0);
  assert.ok(red(above) > 500, `${red(above)}`);
});

test('space3d: depth of field blurs what is out of focus', async () => {
  await init();
  // The camera is about 412 px from z = 0 at the default field of view.
  const sharpness = async (focus: number) => {
    const px = await frame([{ node: card('#ff0000') }], { focus, aperture: 30 });
    let edge = 0;
    for (let x = 0; x < W; x++) {
      const v = at(px, x, H / 2)[0]!;
      if (v > 10 && v < 245) edge++;
    }
    return edge;
  };
  assert.ok((await sharpness(412)) <= 2, 'in focus');
  assert.ok((await sharpness(150)) > 10, 'out of focus');
});

test('space3d: nodes drawn through a layer (opacity, blur, grades) still show', async () => {
  await init();
  const red = (px: Uint8Array) => {
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i]! > 60) n++;
    return n;
  };
  const faded = box({ size: { width: 100, height: 60 }, background: '#ff0000', opacity: 0.5 });
  const blurred = box({ size: { width: 100, height: 60 }, background: '#ff0000', blur: 3 });
  assert.ok(red(await frame([{ node: faded }])) > 5000, 'opacity');
  assert.ok(red(await frame([{ node: blurred, rotateY: 30 }])) > 3000, 'blur, turned');
});
