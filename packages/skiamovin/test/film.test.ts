import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cameraMove, edit, handheld, shot } from 'skiamovin/scene';

const view = { width: 1920, height: 1080 };
const hero = { x: 900, y: 200, width: 120, height: 400 };

test('film: shot sizes frame more or less of the subject', () => {
  const sizes = ['wide', 'long', 'full', 'medium', 'closeUp', 'extremeCloseUp'] as const;
  const zooms = sizes.map((s) => shot(hero, s, view).zoom!);
  for (let i = 1; i < zooms.length; i++) assert.ok(zooms[i]! > zooms[i - 1]!, `${sizes[i]} is closer`);
  // A full shot shows the whole subject with a little headroom.
  const full = shot(hero, 'full', view);
  const top = full.y - view.height / 2 / full.zoom!;
  const bottom = full.y + view.height / 2 / full.zoom!;
  assert.ok(top < hero.y && bottom > hero.y + hero.height);
  // A close-up keeps the top of the subject (the face), not its middle.
  const close = shot(hero, 'closeUp', view);
  assert.ok(close.y < hero.y + hero.height / 4);
  // Placed on the left third: the subject's center is a third of the way across the frame.
  const left = shot(hero, 'medium', view, { place: 'left' });
  const screenX = (hero.x + hero.width / 2 - left.x) * left.zoom! + view.width / 2;
  assert.ok(Math.abs(screenX - view.width / 3) < 1e-6, `at ${screenX}`);
});

test('film: camera moves ease between keys and zoom evenly', () => {
  const keys = [
    { time: 1, camera: { x: 0, y: 0, zoom: 1 } },
    { time: 3, camera: { x: 100, y: 50, zoom: 4 } },
  ];
  assert.deepEqual(cameraMove(keys, 0), keys[0]!.camera);
  assert.deepEqual(cameraMove(keys, 5), keys[1]!.camera);
  const mid = cameraMove(keys, 2);
  assert.ok(Math.abs(mid.x - 50) < 1e-9 && Math.abs(mid.zoom! - 2) < 1e-9, JSON.stringify(mid));
  assert.ok(cameraMove(keys, 1.2).x < 20 * 0.2 * 5, 'eases in');
});

test('film: handheld drifts a little, the same every time', () => {
  const base = { x: 500, y: 300, zoom: 2 };
  const a = handheld(base, 1.3);
  assert.deepEqual(a, handheld(base, 1.3));
  assert.notDeepEqual(a, handheld(base, 1.7));
  for (let t = 0; t < 10; t += 0.1) {
    const s = handheld(base, t, { amount: 1 });
    assert.ok(Math.abs(s.x - base.x) < 10 && Math.abs(s.y - base.y) < 8 && Math.abs(s.rotate!) < 1);
  }
});

test('film: edit cuts between cameras', () => {
  const cuts = [
    { time: 0, camera: 'wide' },
    { time: 2, camera: 'close' },
    { time: 5, camera: 'wide' },
  ];
  assert.equal(edit(cuts, 1.9), 'wide');
  assert.equal(edit(cuts, 2), 'close');
  assert.equal(edit(cuts, 9), 'wide');
});
