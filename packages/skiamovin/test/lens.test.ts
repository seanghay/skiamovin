import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlphaType, ColorType, ImageInfo, init } from 'skiamovin';
import { box, Composition, CompositionSink, lensDistortion } from 'skiamovin/scene';

test('lensDistortion: barrel bends the picture and crops to keep the corners filled', async () => {
  await init();
  const lit = async (amount: number) => {
    const comp = new Composition({
      width: 200,
      height: 100,
      frameRate: 30,
      duration: 1,
      background: '#000000',
      render: () =>
        box({ size: { width: '100%', height: '100%' }, effects: [lensDistortion({ amount })] }, [
          // A white vertical line a quarter of the way across.
          box({
            position: 'absolute',
            inset: { left: 49, top: 0 },
            size: { width: 2, height: 100 },
            background: '#fff',
          }),
        ]),
    });
    const sink = new CompositionSink(comp, { gpu: 'raster' });
    const px = (await sink.getImage(0))!.image.readPixels(
      0,
      0,
      new ImageInfo(200, 100, ColorType.RGBA_8888, AlphaType.Unpremul),
    );
    await sink.dispose();
    // First lit pixel from the left along the middle row.
    for (let x = 0; x < 200; x++) if (px[(50 * 200 + x) * 4]! > 127) return x;
    return -1;
  };
  const straight = await lit(0);
  const barrel = await lit(0.3);
  assert.ok(Math.abs(straight - 49) <= 1, `${straight}`);
  // Magnified to fill the frame, the line moves out toward the edge (about x = 27 at 0.3).
  assert.ok(barrel > 20 && barrel < 35, `barrel ${barrel}`);
});
