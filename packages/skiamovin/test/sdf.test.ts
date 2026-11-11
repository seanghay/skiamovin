import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlphaType, ColorType, ImageInfo, init } from 'skiamovin';
import { Composition, CompositionSink, type SdfObject, sdfScene } from 'skiamovin/scene';

const W = 120,
  H = 90;

async function frame(objects: SdfObject[], tilt = 0): Promise<(x: number, y: number) => number[]> {
  const comp = new Composition({
    width: W,
    height: H,
    frameRate: 30,
    duration: 1,
    render: () => sdfScene({ width: W, height: H }, { tilt }, objects, { background: '#ff0000' }),
  });
  const sink = new CompositionSink(comp, { gpu: 'raster' });
  const px = (await sink.getImage(0))!.image.readPixels(
    0,
    0,
    new ImageInfo(W, H, ColorType.RGBA_8888, AlphaType.Unpremul),
  );
  await sink.dispose();
  return (x, y) => [...px.slice((y * W + x) * 4, (y * W + x) * 4 + 3)];
}

test('sdfScene: shapes at true size, lit, over the background', async () => {
  await init();
  const at = await frame([{ shape: { kind: 'sphere', radius: 25 }, color: '#00ff00' }]);
  assert.deepEqual(at(2, 2), [255, 0, 0], 'background');
  assert.ok(at(W / 2, H / 2)[1]! > 60 && at(W / 2, H / 2)[0] === 0, 'sphere');
  assert.deepEqual(at(W / 2 + 29, H / 2), [255, 0, 0], 'edge at about the radius');
  // Lit from the upper left.
  assert.ok(at(W / 2 - 10, H / 2 - 10)[1]! > at(W / 2 + 10, H / 2 + 10)[1]!);
});

test('sdfScene: a floor seen from above, and shapes blending', async () => {
  await init();
  const floor: SdfObject[] = [{ shape: { kind: 'floor' }, y: 20, color: '#ffffff' }];
  assert.deepEqual((await frame(floor))(W / 2, 5), [255, 0, 0], 'sky above the horizon');
  assert.notDeepEqual((await frame(floor, 20))(W / 2, H - 5), [255, 0, 0], 'floor below');
});
