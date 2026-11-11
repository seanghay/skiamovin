import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlphaType, ColorType, ImageInfo, init } from 'skiamovin';
import { Composition, CompositionSink, type MeshObject, meshes, meshScene } from 'skiamovin/scene';

const W = 400,
  H = 300;

async function frame(objects: MeshObject[], depth = false): Promise<Uint8Array> {
  const comp = new Composition({
    width: W,
    height: H,
    frameRate: 30,
    duration: 1,
    background: '#000000',
    render: () => meshScene({ width: W, height: H }, {}, objects, { depth }),
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
const covered = (px: Uint8Array) => {
  let n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i]! + px[i + 1]! + px[i + 2]! > 30) n++;
  return n;
};
const at = (px: Uint8Array, x: number, y: number) => {
  const i = (y * W + x) * 4;
  return px[i]! + px[i + 1]! + px[i + 2]!;
};

test('meshes: a sphere covers its disc and is lit from the upper left', async () => {
  await init();
  const px = await frame([{ mesh: meshes.sphere(60, 48), color: '#ffffff' }]);
  // At z = 0 the camera shows true size; a sphere's outline is a little larger than its radius in perspective.
  const area = covered(px);
  assert.ok(area > Math.PI * 60 * 60 * 0.97 && area < Math.PI * 64 * 64, `${area}`);
  assert.ok(at(px, W / 2 - 25, H / 2 - 25) > at(px, W / 2 + 25, H / 2 + 25), 'upper left is brighter');
});

test('meshes: boxes, tori and extrusions with holes', async () => {
  await init();
  const cube = meshes.box(100, 100, 100);
  assert.equal(cube.indices.length, 36);
  const front = covered(await frame([{ mesh: cube }]));
  // Seen straight on, only the front face shows. It is 50 px in front of the true-size plane, so it looks larger.
  const focal = H / 2 / Math.tan((20 * Math.PI) / 180);
  const side = (100 * focal) / (focal - 50);
  assert.ok(Math.abs(front - side * side) < 300, `${front} vs ${side * side}`);
  const ring = await frame([{ mesh: meshes.torus(80, 25), rotateX: 90 }]);
  assert.equal(at(ring, W / 2, H / 2), 0, 'the torus has a hole');
  assert.ok(at(ring, W / 2 + 80, H / 2) > 0);
  // A square with a square hole wound the other way.
  const frameShape = 'M-60 -60 L60 -60 L60 60 L-60 60 Z M-30 -30 L-30 30 L30 30 L30 -30 Z';
  const solid = await frame([{ mesh: meshes.extrude(frameShape, 20) }]);
  assert.equal(at(solid, W / 2, H / 2), 0, 'hole');
  assert.ok(at(solid, W / 2 + 45, H / 2) > 0, 'frame');
});

test('meshes: a depth buffer handles objects that cut through each other', async () => {
  await init();
  // Two plates crossing in an X: the red one is nearer on the left, the green one on the right.
  const plates: MeshObject[] = [
    { mesh: meshes.box(300, 200, 2), color: '#ff0000', rotateY: 30 },
    { mesh: meshes.box(300, 200, 2), color: '#00ff00', rotateY: -30 },
  ];
  const px = await frame(plates, true);
  const pick = (x: number) => {
    const i = ((H / 2) * W + x) * 4;
    return px[i]! > px[i + 1]! ? 'red' : 'green';
  };
  assert.equal(pick(W / 2 - 60), 'red');
  assert.equal(pick(W / 2 + 60), 'green');
  // Same picture size as sorted drawing for a single object.
  const sphere = [{ mesh: meshes.sphere(60, 48) }];
  const a = covered(await frame(sphere)),
    b = covered(await frame(sphere, true));
  assert.ok(Math.abs(a - b) / a < 0.02, `${a} vs ${b}`);
});
