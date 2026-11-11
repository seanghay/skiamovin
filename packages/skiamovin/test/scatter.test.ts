import assert from 'node:assert/strict';
import { test } from 'node:test';
import { init } from 'skiamovin';
import { lookAt, scatter } from 'skiamovin/scene';

test('scatter: seeded points in an area, spread apart', () => {
  const a = scatter(60, { area: { width: 1000, height: 600 }, spacing: 50, seed: 'x' });
  assert.equal(a.length, 60);
  assert.deepEqual(a, scatter(60, { area: { width: 1000, height: 600 }, spacing: 50, seed: 'x' }));
  assert.notDeepEqual(a, scatter(60, { area: { width: 1000, height: 600 }, spacing: 50, seed: 'y' }));
  let closest = Infinity;
  for (const p of a) {
    assert.ok(p.x >= 0 && p.x <= 1000 && p.y >= 0 && p.y <= 600);
    for (const q of a) if (p !== q) closest = Math.min(closest, Math.hypot(p.x - q.x, p.y - q.y));
  }
  assert.ok(closest >= 50, `closest pair ${closest}`);
});

test('scatter: grid and path', async () => {
  await init();
  const g = scatter(6, { grid: { width: 300, height: 200, columns: 3 } });
  assert.deepEqual(
    g.map((p) => [p.x, p.y]),
    [
      [50, 50],
      [150, 50],
      [250, 50],
      [50, 150],
      [150, 150],
      [250, 150],
    ],
  );
  const line = scatter(5, { path: 'M0 0 L400 0' });
  assert.deepEqual(
    line.map((p) => [Math.round(p.x), Math.round(p.y), Math.round(p.angle)]),
    [
      [0, 0, 0],
      [100, 0, 0],
      [200, 0, 0],
      [300, 0, 0],
      [400, 0, 0],
    ],
  );
});

test('lookAt: rotation toward a point', () => {
  assert.equal(lookAt([0, 0], [10, 0]), 0);
  assert.equal(lookAt([0, 0], [0, 10]), 90);
  assert.equal(lookAt([5, 5], [0, 5]), 180);
});
