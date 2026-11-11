import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlphaType, ColorType, ImageInfo, init } from 'skiamovin';
import { box, Composition, CompositionSink, math } from 'skiamovin/scene';

async function coverage(node: () => ReturnType<typeof box>, w = 300, h = 120): Promise<number> {
  const comp = new Composition({
    width: w,
    height: h,
    frameRate: 30,
    duration: 1,
    background: '#000000',
    render: node,
  });
  const sink = new CompositionSink(comp, { gpu: 'raster' });
  const px = (await sink.getImage(0))!.image.readPixels(
    0,
    0,
    new ImageInfo(w, h, ColorType.RGBA_8888, AlphaType.Unpremul),
  );
  await sink.dispose();
  let lit = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i]! > 100) lit++;
  return lit;
}

test('math: typesets, sizes its box and draws on with write', async () => {
  await init();
  const node = math('\\frac{a}{b} + \\sqrt{x}', { fontSize: 40, color: '#ffffff' });
  const size = node.style.size as { width: number; height: number };
  assert.ok(size.width > 60 && size.width < 200, `width ${size.width}`);
  assert.ok(size.height > 40, `height ${size.height}`);
  const full = await coverage(() => box({ padding: 10 }, [math('E = mc^2', { fontSize: 48, color: '#ffffff' })]));
  assert.ok(full > 300, `drawn (${full} pixels)`);
  const none = await coverage(() =>
    box({ padding: 10 }, [math('E = mc^2', { fontSize: 48, color: '#ffffff', write: 0 })]),
  );
  const half = await coverage(() =>
    box({ padding: 10 }, [math('E = mc^2', { fontSize: 48, color: '#ffffff', write: 0.5 })]),
  );
  assert.equal(none, 0);
  assert.ok(half > 0 && half < full, `half written (${half} of ${full})`);
  assert.throws(() => math('\\frac{a}{', {}), /math:/);
});
