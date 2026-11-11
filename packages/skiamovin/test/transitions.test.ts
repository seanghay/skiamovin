import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlphaType, ColorType, ImageInfo, init } from 'skiamovin';
import { box, Composition, CompositionSink, listTransitions, series, transition } from 'skiamovin/scene';

const W = 64,
  H = 36;
const red = () => box({ size: { width: '100%', height: '100%' }, background: '#ff0000' });
const blue = () => box({ size: { width: '100%', height: '100%' }, background: '#0000ff' });

async function frame(render: (t: number) => ReturnType<typeof box> | null, t = 0) {
  const comp = new Composition({
    width: W,
    height: H,
    frameRate: 30,
    duration: 4,
    background: '#000000',
    render: ({ timestamp }) => render(timestamp),
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
const center = (px: Uint8Array) => [...px.slice(((H / 2) * W + W / 2) * 4, ((H / 2) * W + W / 2) * 4 + 3)];

test('transitions: metadata, endpoints and series', async () => {
  await init();
  const all = await listTransitions();
  assert.ok(all.length >= 200, `${all.length} transitions`);
  const fade = all.find((t) => t.name.toLowerCase() === 'fade')!;
  assert.ok(fade, 'has a fade');
  assert.deepEqual(center(await frame(() => transition(fade.name, 0, red(), blue()))), [255, 0, 0]);
  assert.deepEqual(center(await frame(() => transition(fade.name, 1, red(), blue()))), [0, 0, 255]);
  const mid = center(await frame(() => transition(fade.name, 0.5, red(), blue())));
  assert.ok(mid[0]! > 100 && mid[2]! > 100, `halfway blends: ${mid}`);
  // In a series, the cut at 1 s is blended from 0.75 s to 1.25 s.
  const s = (t: number) =>
    frame(
      (ts) =>
        series(
          { timestamp: ts, duration: 4, frame: 0, frameRate: 30, width: W, height: H, props: {}, events: {}, exit: 0 },
          [
            { duration: 1, render: red, transition: { name: fade.name, duration: 0.5 } },
            { duration: 1, render: blue },
          ],
        ),
      t,
    );
  assert.deepEqual(center(await s(0.5)), [255, 0, 0]);
  const cut = center(await s(1));
  assert.ok(cut[0]! > 100 && cut[2]! > 100, `blended at the cut: ${cut}`);
  assert.deepEqual(center(await s(1.5)), [0, 0, 255]);
  await assert.rejects(() => frame(() => transition('NoSuchTransition', 0.5, red(), blue())), /Unknown transition/);
});

test('transitions: every one in the collection compiles and renders', async () => {
  await init();
  const failed: string[] = [];
  const pattern = () => box({ size: { width: '100%', height: '100%' }, background: '#808080' });
  for (const t of await listTransitions()) {
    const textures = Object.fromEntries(t.textures.map((name) => [name, pattern()]));
    try {
      await frame(() => transition(t.name, 0.5, red(), blue(), { textures }));
    } catch (e) {
      failed.push(`${t.name}: ${String((e as Error).message).split('\n')[0]}`);
    }
  }
  assert.deepEqual(failed, []);
  await assert.rejects(() => frame(() => transition('LumaWipe', 0.5, red(), blue())), /needs a texture 'luma'/);
});
