import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlphaType, ColorType, ImageInfo, init } from 'skiamovin';
import { box, Composition, CompositionSink, type SceneNode, stroke } from 'skiamovin/scene';

const W = 400,
  H = 120;

async function inked(node: () => SceneNode): Promise<number> {
  const comp = new Composition({
    width: W,
    height: H,
    frameRate: 30,
    duration: 1,
    background: '#000000',
    render: () => box({ size: { width: '100%', height: '100%' } }, [node()]),
  });
  const sink = new CompositionSink(comp, { gpu: 'raster' });
  const px = (await sink.getImage(0))!.image.readPixels(
    0,
    0,
    new ImageInfo(W, H, ColorType.RGBA_8888, AlphaType.Unpremul),
  );
  await sink.dispose();
  let n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i]! > 127) n++;
  return n;
}

const LINE = 'M20 60 L380 60';

test('stroke: draws along a path and draws on', async () => {
  await init();
  const full = await inked(() => stroke(LINE, { size: 10, color: '#fff' }));
  // About 360 px long and 10 to 15 px wide (simulated pressure widens slow parts).
  assert.ok(full > 3200 && full < 5600, `${full}`);
  assert.equal(await inked(() => stroke(LINE, { size: 10, color: '#fff', draw: 0 })), 0);
  const half = await inked(() => stroke(LINE, { size: 10, color: '#fff', draw: 0.5 }));
  assert.ok(Math.abs(half / full - 0.5) < 0.08, `${half} of ${full}`);
  const tapered = await inked(() => stroke(LINE, { size: 10, color: '#fff', taper: 120 }));
  assert.ok(tapered < full * 0.85, `tapered ends (${tapered})`);
});

test('stroke: width follows pressure', async () => {
  await init();
  const line = (pressure: number) =>
    Array.from({ length: 40 }, (_, i) => [20 + i * 9, 60, pressure] as [number, number, number]);
  const light = await inked(() => stroke(line(0.1), { size: 16, color: '#fff' }));
  const heavy = await inked(() => stroke(line(1), { size: 16, color: '#fff' }));
  assert.ok(heavy > light * 1.5, `${heavy} vs ${light}`);
});
