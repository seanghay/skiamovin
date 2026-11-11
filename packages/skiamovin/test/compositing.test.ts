import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlphaType, ColorType, ImageInfo, init, Path } from 'skiamovin';
import { adjust, adjustmentLayer, box, type Child, Composition, CompositionSink, clipTo } from 'skiamovin/scene';

const W = 40,
  H = 40;
async function render(child: () => Child): Promise<Uint8Array> {
  const comp = new Composition({
    width: W,
    height: H,
    frameRate: 30,
    duration: 1,
    background: '#000000',
    render: () => child(),
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
const at = (px: Uint8Array, x: number, y: number) => [...px.slice((y * W + x) * 4, (y * W + x) * 4 + 3)];
const fill = (color: string, style: object = {}) =>
  box({ size: { width: '100%', height: '100%' }, background: color, ...style });
// A mask that is white on the left half and black on the right.
const halfMask = () =>
  box({ size: { width: '100%', height: '100%' }, flexDirection: 'row' }, [
    fill('#ffffff', { size: { width: 20, height: '100%' } }),
    fill('#000000', { size: { width: 20, height: '100%' } }),
  ]);

test('mattes: alpha, luminance and inverted', async () => {
  await init();
  const red = (maskMode?: string) => () => fill('#ff0000', { mask: halfMask(), maskMode });
  // An opaque mask in alpha mode keeps everything.
  const alpha = await render(red());
  assert.deepEqual(
    [at(alpha, 5, 20), at(alpha, 35, 20)],
    [
      [255, 0, 0],
      [255, 0, 0],
    ],
  );
  const luma = await render(red('luminance'));
  assert.deepEqual(
    [at(luma, 5, 20), at(luma, 35, 20)],
    [
      [255, 0, 0],
      [0, 0, 0],
    ],
  );
  const inv = await render(red('luminance-inverted'));
  assert.deepEqual(
    [at(inv, 5, 20), at(inv, 35, 20)],
    [
      [0, 0, 0],
      [255, 0, 0],
    ],
  );
});

test('clipTo draws layers only where the base is', async () => {
  await init();
  const px = await render(() =>
    box({ size: { width: '100%', height: '100%' }, justifyContent: 'center', alignItems: 'center' }, [
      clipTo(box({ size: { width: 20, height: 20 }, background: '#ffffff' }), fill('#00ff00')),
    ]),
  );
  assert.deepEqual(at(px, 20, 20), [0, 255, 0]);
  assert.deepEqual(at(px, 2, 2), [0, 0, 0]);
});

test('adjustment layers grade what is beneath, inside their box', async () => {
  await init();
  const px = await render(() =>
    box({ size: { width: '100%', height: '100%' } }, [
      fill('#ff0000', { position: 'absolute', inset: 0 }),
      adjustmentLayer({ grade: adjust({ saturation: -1 }) }, { size: { width: 20, height: '100%' } }),
    ]),
  );
  const [r, g, b] = at(px, 5, 20);
  assert.ok(Math.abs(r! - g!) < 3 && Math.abs(g! - b!) < 3, `gray inside: ${r},${g},${b}`);
  assert.deepEqual(at(px, 35, 20), [255, 0, 0]);
});

test('layer styles follow the content shape', async () => {
  await init();
  const shape = (layerStyle: object) => () =>
    box({ size: { width: '100%', height: '100%' }, justifyContent: 'center', alignItems: 'center' }, [
      box({ size: { width: 10, height: 10 }, background: '#ffffff', layerStyle }),
    ]);
  const stroked = await render(shape({ stroke: { color: '#00ff00', width: 3 } }));
  assert.deepEqual(at(stroked, 13, 20), [0, 255, 0], 'stroke outside the shape');
  assert.deepEqual(at(stroked, 20, 20), [255, 255, 255], 'content unchanged');
  const over = await render(shape({ colorOverlay: { color: '#0000ff' } }));
  assert.deepEqual(at(over, 20, 20), [0, 0, 255]);
  assert.deepEqual(at(over, 5, 5), [0, 0, 0]);
});

test('Path.warp bends a path inside its box', async () => {
  await init();
  const line = Path.fromSVG('M0 10 L100 10')!;
  const arched = line.warp('arch', 1, [0, 0, 100, 20]);
  const b = arched.computeTightBounds();
  assert.ok(b.top < 5, `arched up (top ${b.top})`);
  const same = line.warp('wave', 0, [0, 0, 100, 20]).computeTightBounds();
  assert.ok(Math.abs(same.top - 10) < 1e-3 && Math.abs(same.bottom - 10) < 1e-3);
});
