import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FilePathSource } from 'mediabunny';
import { AlphaType, ColorType, ImageInfo, init } from 'skiamovin';
import { box, Composition, CompositionSink, diagram, diagramThemes, FontAsset } from 'skiamovin/scene';

const arial = new FontAsset(new FilePathSource('/System/Library/Fonts/Supplemental/Arial.ttf'), { family: 'Arial' });
const FLOW = 'flowchart LR\n  A[Write] --> B{Good?}\n  B -->|yes| C(Render)\n  B -->|no| A';

async function frame(node: () => ReturnType<typeof box>, w = 640, h = 240): Promise<Uint8Array> {
  const comp = new Composition({ width: w, height: h, frameRate: 30, duration: 1, fonts: [arial], render: node });
  const sink = new CompositionSink(comp, { gpu: 'raster' });
  const px = (await sink.getImage(0))!.image.readPixels(
    0,
    0,
    new ImageInfo(w, h, ColorType.RGBA_8888, AlphaType.Unpremul),
  );
  await sink.dispose();
  return px;
}

const covered = (px: Uint8Array) => {
  let n = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i]! > 0) n++;
  return n;
};

test('diagram: lays out Mermaid with Pele and draws it', async () => {
  await init();
  const full = await frame(() => box({}, [diagram(FLOW)]));
  const n = covered(full);
  assert.ok(n > 5000, `drawn (${n} pixels)`);
  // Box fill comes from the dark theme's surface color.
  const surface = [0x1e, 0x29, 0x3b];
  let found = false;
  for (let i = 0; i < full.length && !found; i += 4)
    found = full[i] === surface[0] && full[i + 1] === surface[1] && full[i + 2] === surface[2];
  assert.ok(found, 'theme surface color used');
});

test('diagram: draw reveals it in order', async () => {
  await init();
  const at = async (draw: number) => covered(await frame(() => box({}, [diagram(FLOW, { draw })])));
  const none = await at(0);
  const some = await at(0.3);
  const more = await at(0.7);
  const all = await at(1);
  assert.equal(none, 0);
  assert.ok(some > 0 && some < more && more < all, `${some} < ${more} < ${all}`);
});

test('diagram: styles by id and themes', async () => {
  await init();
  const all = covered(await frame(() => box({}, [diagram(FLOW)])));
  const hidden = covered(await frame(() => box({}, [diagram(FLOW, { styles: { C: { opacity: 0 } } })])));
  assert.ok(hidden < all, `node C hidden (${hidden} < ${all})`);
  const light = await frame(() => box({}, [diagram(FLOW, { theme: 'light' })]));
  const s = diagramThemes.light.surface;
  const rgb = [1, 3, 5].map((i) => Number.parseInt(s.slice(i, i + 2), 16));
  let found = false;
  for (let i = 0; i < light.length && !found; i += 4)
    found = light[i] === rgb[0] && light[i + 1] === rgb[1] && light[i + 2] === rgb[2];
  assert.ok(found, 'light theme surface color used');
});
