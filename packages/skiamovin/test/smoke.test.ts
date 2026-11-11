// Checks that run on every platform, including builds without a GPU or native codecs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ImageInfo, init, Paint, Rect, surfaces, version } from 'skiamovin';
import { box, Composition, CompositionSink } from 'skiamovin/scene';

const px = (s: { readPixels(x: number, y: number, info?: ImageInfo): Uint8Array }, x: number, y: number) => [
  ...s.readPixels(x, y, new ImageInfo(1, 1, 0, 3)),
];

test('loads the native addon', async () => {
  await init({ registerNativeCodecs: false });
  assert.equal(version().runtime, 'node');
});

test('draws on the CPU and encodes a PNG', () => {
  using s = surfaces.rasterN32Premul([64, 64])!;
  const c = s.canvas();
  c.clear('#000000');
  using p = new Paint('#ff0000');
  c.drawRect(Rect.fromXYWH(8, 8, 16, 16), p);
  assert.deepEqual(px(s, 10, 10), [255, 0, 0, 255]);
  assert.deepEqual(px(s, 40, 40), [0, 0, 0, 255]);
  const png = s.encodeToData();
  assert.deepEqual([...png.slice(1, 4)], [0x50, 0x4e, 0x47]);
});

test('renders a composition frame', async () => {
  const comp = new Composition({
    width: 64,
    height: 64,
    frameRate: 30,
    duration: 1,
    render: ({ timestamp }) =>
      box({ size: { width: '100%', height: '100%' }, background: '#000000' }, [
        box({ size: { width: 16, height: 16 }, background: '#00ff00', transform: { translateX: timestamp * 30 } }),
      ]),
  });
  const sink = new CompositionSink(comp, { gpu: 'raster' });
  const frame = await sink.getImage(0.5);
  assert.ok(frame);
  using s = surfaces.rasterN32Premul([64, 64])!;
  s.canvas().drawImage(frame.image, [0, 0]);
  assert.deepEqual(px(s, 20, 8), [0, 255, 0, 255]);
  await sink.dispose();
});
