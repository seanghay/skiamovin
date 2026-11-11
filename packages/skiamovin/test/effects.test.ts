import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlphaType, ColorType, ImageInfo, init } from 'skiamovin';
import {
  backgrounds,
  box,
  type Child,
  Composition,
  CompositionSink,
  chromaticAberration,
  glow,
  grain,
  linearGradient,
  pixelate,
  vignette,
} from 'skiamovin/scene';

const W = 80,
  H = 60;

async function render(child: () => Child, t = 0): Promise<Uint8Array> {
  const comp = new Composition({
    width: W,
    height: H,
    frameRate: 30,
    duration: 2,
    background: '#000000',
    render: () => child(),
  });
  const sink = new CompositionSink(comp, { gpu: 'raster' });
  const px = (await sink.getImage(t))!.image.readPixels(
    0,
    0,
    new ImageInfo(W, H, ColorType.RGBA_8888, AlphaType.Unpremul),
  );
  await sink.dispose();
  return px;
}
const at = (px: Uint8Array, x: number, y: number) => [...px.slice((y * W + x) * 4, (y * W + x) * 4 + 3)];
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
const scene =
  (style: object = {}) =>
  () =>
    box({ size: { width: '100%', height: '100%' }, background: linearGradient(90, ['#3b82f6', '#f43f5e']), ...style });

test('effects: grain, vignette, pixelate, glow, chromatic aberration', async () => {
  await init();
  const plain = await render(scene());
  // Grain changes pixels, the same way every render, and differently on the next frame.
  const g0 = await render(scene({ effects: [grain({ amount: 0.2 })] }));
  assert.notDeepEqual(g0, plain);
  assert.deepEqual(await render(scene({ effects: [grain({ amount: 0.2 })] })), g0);
  assert.notDeepEqual(await render(scene({ effects: [grain({ amount: 0.2 })] }), 1 / 30), g0);
  // Vignette darkens the corners but not the center.
  const v = await render(scene({ effects: [vignette({ amount: 0.8 })] }));
  assert.ok(sum(at(v, 1, 1)) < sum(at(plain, 1, 1)) - 30);
  assert.ok(Math.abs(sum(at(v, W / 2, H / 2)) - sum(at(plain, W / 2, H / 2))) < 6);
  // Pixelate makes 8×8 blocks of one color.
  const p = await render(scene({ effects: [pixelate({ size: 8 })] }));
  assert.deepEqual(at(p, 8, 8), at(p, 15, 15));
  // Glow brightens dark pixels near a bright shape.
  const spot = (style: object) => () =>
    box({ size: { width: '100%', height: '100%' }, justifyContent: 'center', alignItems: 'center', ...style }, [
      box({ size: { width: 16, height: 16 }, background: '#ffffff' }),
    ]);
  const noGlow = await render(spot({}));
  const glowing = await render(spot({ effects: [glow({ radius: 12, intensity: 1, threshold: 0.5 })] }));
  assert.ok(sum(at(glowing, W / 2 + 12, H / 2)) > sum(at(noGlow, W / 2 + 12, H / 2)) + 20);
  // Chromatic aberration separates channels near the edges.
  const ca = await render(spot({ effects: [chromaticAberration({ amount: 6 })] }));
  assert.notDeepEqual(ca, noGlow);
});

test('glass bends and frosts what is behind it, and only inside its shape', async () => {
  await init();
  const stripes = () =>
    box(
      { position: 'absolute', inset: 0, size: { width: '100%', height: '100%' }, flexDirection: 'row' },
      Array.from({ length: 8 }, (_, i) =>
        box({ size: { width: 10, height: '100%' }, background: i % 2 ? '#ffffff' : '#000000' }),
      ),
    );
  const base = await render(() => box({ size: { width: '100%', height: '100%' } }, [stripes()]));
  const glassed = await render(() =>
    box({ size: { width: '100%', height: '100%' }, justifyContent: 'center', alignItems: 'center' }, [
      stripes(),
      box({ size: { width: 40, height: 30 }, borderRadius: 10, glass: { blur: 8 } }),
    ]),
  );
  // Outside the glass nothing changes; inside, the hard stripe edges are softened.
  assert.deepEqual(at(glassed, 2, 2), at(base, 2, 2));
  const inside = at(glassed, 40, 30);
  assert.ok(
    inside.every((c) => c > 40 && c < 230),
    `frosted: ${inside}`,
  );
});

test('backgrounds render varied, full-size images', async () => {
  await init();
  for (const make of [
    () => backgrounds.mesh(),
    () => backgrounds.aurora(),
    () => backgrounds.noise(),
    () => backgrounds.dots(),
    () => backgrounds.grid(),
  ]) {
    const px = await render(() => box({ size: { width: '100%', height: '100%' } }, [make()]));
    const colors = new Set<string>();
    for (let y = 0; y < H; y += 6) for (let x = 0; x < W; x += 6) colors.add(at(px, x, y).join());
    assert.ok(colors.size > 3, `varied output (${colors.size} colors)`);
  }
});
