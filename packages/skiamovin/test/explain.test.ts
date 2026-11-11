import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlphaType, ColorType, ImageInfo, init } from 'skiamovin';
import {
  axes,
  box,
  Composition,
  CompositionSink,
  camera,
  create,
  fadeIn,
  fitCamera,
  indicate,
  path,
  text,
} from 'skiamovin/scene';

test('axes map graph coordinates to pixels', () => {
  const ax = axes({ x: [-2, 2, 1], y: [0, 4, 1], width: 400, height: 200, labels: false });
  assert.deepEqual(ax.toPoint(-2, 0), [0, 200]);
  assert.deepEqual(ax.toPoint(2, 4), [400, 0]);
  assert.deepEqual(ax.toPoint(0, 2), [200, 100]);
  const plot = ax.plot((x) => x * x, { draw: 0.5 });
  assert.equal(plot.type, 'path');
  assert.deepEqual((plot as { trim?: { end: number } }).trim, { end: 0.5 });
});

test('camera pans and zooms; fitCamera frames a rectangle', async () => {
  await init();
  // A red square at content (90..110, 90..110); a camera centered on it at 2× fills the middle of the view.
  const comp = new Composition({
    width: 100,
    height: 100,
    frameRate: 30,
    duration: 1,
    background: '#000000',
    render: () =>
      camera({ x: 100, y: 100, zoom: 2 }, { width: 100, height: 100 }, [
        box({
          position: 'absolute',
          inset: { left: 90, top: 90 },
          size: { width: 20, height: 20 },
          background: '#ff0000',
        }),
      ]),
  });
  const sink = new CompositionSink(comp, { gpu: 'raster' });
  const img = (await sink.getImage(0))!.image;
  const at = (x: number, y: number) =>
    [...img.readPixels(x, y, new ImageInfo(1, 1, ColorType.RGBA_8888, AlphaType.Unpremul))].slice(0, 3);
  assert.deepEqual(at(50, 50), [255, 0, 0]);
  assert.deepEqual(at(68, 50), [255, 0, 0], 'zoomed: 20 px square is 40 px wide');
  assert.deepEqual(at(75, 50), [0, 0, 0]);
  await sink.dispose();
  const c = fitCamera({ x: 0, y: 0, width: 200, height: 100 }, { width: 400, height: 400 }, 0);
  assert.deepEqual(c, { x: 100, y: 50, zoom: 2 });
});

test('create, fadeIn and indicate', () => {
  const p = path('M0 0 L10 10', { stroke: '#fff' });
  assert.deepEqual((create(p, 0.25) as { trim: { end: number } }).trim.end, 0.25);
  const t = text('Hello');
  assert.equal((create(t, 0.6) as { text: { visibleGraphemes: number } }).text.visibleGraphemes, 3);
  const f = fadeIn(box({}), 0);
  assert.equal(f.style.opacity, 0);
  assert.equal(fadeIn(box({}), 1).style.opacity, 1);
  const i = indicate(box({}), 0.5, { scale: 1.5 });
  assert.ok(Math.abs((i.style.transform as { scale: number }).scale - 1.5) < 1e-9);
  assert.equal((indicate(box({}), 1).style.transform as { scale: number }).scale, 1);
});
