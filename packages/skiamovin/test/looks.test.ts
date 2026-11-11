import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FilePathSource } from 'mediabunny';
import { AlphaType, ColorType, ImageInfo, init } from 'skiamovin';
import {
  box,
  Composition,
  CompositionSink,
  credits,
  FontAsset,
  looks,
  lowerThird,
  type SceneNode,
  softShadow,
  titleCard,
} from 'skiamovin/scene';

const arial = new FontAsset(new FilePathSource('/System/Library/Fonts/Supplemental/Arial.ttf'), { family: 'Arial' });

async function lit(node: (t: number) => SceneNode, t: number): Promise<number> {
  const comp = new Composition({
    width: 640,
    height: 360,
    frameRate: 30,
    duration: 10,
    background: '#000000',
    fonts: [arial],
    render: ({ timestamp }) => box({ size: { width: '100%', height: '100%' } }, [node(timestamp)]),
  });
  const sink = new CompositionSink(comp, { gpu: 'raster' });
  const px = (await sink.getImage(t))!.image.readPixels(
    0,
    0,
    new ImageInfo(640, 360, ColorType.RGBA_8888, AlphaType.Unpremul),
  );
  await sink.dispose();
  let n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i]! > 100) n++;
  return n;
}

test('titles: animate in and out', async () => {
  await init();
  const card = (t: number) => titleCard('Title', 'Subtitle', { time: t, out: 3 });
  assert.equal(await lit(card, 0), 0);
  assert.ok((await lit(card, 1)) > 1000);
  assert.equal(await lit(card, 3.5), 0);
  const third = (t: number) => lowerThird('Name', 'Role', { time: t, out: 3 });
  assert.equal(await lit(third, 0), 0);
  assert.ok((await lit(third, 1)) > 500);
  const roll = (t: number) => credits(['Cast', ['Hero', 'Ana']], { time: t, start: 400, speed: 100 });
  assert.equal(await lit(roll, 0), 0, 'starts below the frame');
  assert.ok((await lit(roll, 2)) > 200, 'scrolled into view');
});

test('looks and soft shadows', () => {
  for (const g of Object.values(looks)) assert.ok(g().length > 0);
  const [contact, ambient] = softShadow(10);
  assert.ok(ambient!.blur! > contact!.blur!);
  assert.deepEqual(
    softShadow(0).map((s) => s.blur),
    [0, 0],
  );
});
