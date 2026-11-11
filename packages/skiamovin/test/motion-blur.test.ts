import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlphaType, ColorType, ImageInfo, init } from 'skiamovin';
import { box, Composition, CompositionSink } from 'skiamovin/scene';

const W = 400,
  H = 100;

async function frame(speed: number, motionBlur?: { shutter: number; samples?: number }): Promise<Uint8Array> {
  const comp = new Composition({
    width: W,
    height: H,
    frameRate: 30,
    duration: 1,
    background: '#000000',
    motionBlur,
    render: ({ timestamp: t }) =>
      box({ size: { width: '100%', height: '100%' } }, [
        box({
          position: 'absolute',
          inset: { left: 100 + t * speed, top: 30 },
          size: { width: 40, height: 40 },
          background: '#ffffff',
        }),
      ]),
  });
  const sink = new CompositionSink(comp, { gpu: 'raster' });
  const px = (await sink.getImage(0.5))!.image.readPixels(
    0,
    0,
    new ImageInfo(W, H, ColorType.RGBA_8888, AlphaType.Unpremul),
  );
  await sink.dispose();
  return px;
}

/** Brightness-weighted center along x, and pixels that are neither black nor white. */
function measure(px: Uint8Array) {
  let sum = 0,
    weighted = 0,
    partial = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = px[(y * W + x) * 4]!;
      sum += v;
      weighted += v * x;
      if (v > 8 && v < 247) partial++;
    }
  return { center: weighted / sum, partial };
}

test('motion blur: still things stay sharp', async () => {
  await init();
  const sharp = await frame(0);
  const blurred = await frame(0, { shutter: 180 });
  let worst = 0;
  for (let i = 0; i < sharp.length; i++) worst = Math.max(worst, Math.abs(sharp[i]! - blurred[i]!));
  assert.ok(worst <= 1, `max difference ${worst}`);
});

test('motion blur: moving things streak around where they are', async () => {
  await init();
  const sharp = measure(await frame(300));
  const half = measure(await frame(300, { shutter: 180, samples: 16 }));
  const full = measure(await frame(300, { shutter: 360, samples: 16 }));
  // 300 px/s at 30 fps moves 10 px per frame: the shutter centers the streak on the frame's position.
  assert.ok(Math.abs(half.center - sharp.center) < 0.5, `${half.center} vs ${sharp.center}`);
  assert.ok(half.partial > sharp.partial + 100, `streaked (${half.partial} vs ${sharp.partial})`);
  assert.ok(full.partial > half.partial, `a wider shutter streaks more (${full.partial} vs ${half.partial})`);
});
