import assert from 'node:assert/strict';
import { test } from 'node:test';
import { init } from 'skiamovin';
import { physics } from 'skiamovin/scene';

test('physics: a ball falls, bounces and comes to rest on the floor', async () => {
  await init();
  const world = physics({
    bodies: [
      { type: 'fixed', shape: { kind: 'box', width: 800, height: 20 }, x: 400, y: 510 },
      { id: 'ball', shape: { kind: 'circle', radius: 20 }, x: 400, y: 100, restitution: 0.6 },
    ],
    duration: 6,
  });
  const ys = Array.from({ length: 120 }, (_, i) => world.body('ball', i / 20).y);
  assert.ok(ys[5]! > 100, 'falls');
  assert.ok(Math.max(...ys) <= 500 + 1, 'never passes through the floor');
  const bounced = ys.some((y, i) => i > 0 && y < ys[i - 1]! - 1);
  assert.ok(bounced, 'bounces back up');
  assert.ok(Math.abs(world.body('ball', 6).y - 480) < 1.5, `rests on the floor (${world.body('ball', 6).y})`);
  const hits = world.contactsUntil(6, 'ball');
  assert.ok(hits.length >= 2, `touches the floor more than once (${hits.length})`);
  assert.ok(hits[0]!.time > 0.5 && hits[0]!.time < 1.2);
});

test('physics: joints and repeatability', async () => {
  await init();
  const def = {
    bodies: [
      {
        id: 'pivot',
        type: 'fixed' as const,
        shape: { kind: 'circle' as const, radius: 2 },
        x: 200,
        y: 50,
        sensor: true,
      },
      { id: 'bob', shape: { kind: 'circle' as const, radius: 10 }, x: 300, y: 50 },
    ],
    joints: [
      { kind: 'revolute' as const, a: 'pivot', b: 'bob', anchorA: [0, 0] as const, anchorB: [-100, 0] as const },
    ],
    duration: 3,
  };
  const world = physics(def);
  for (const t of [0.5, 1, 2, 3]) {
    const b = world.body('bob', t);
    const r = Math.hypot(b.x - 200, b.y - 50);
    assert.ok(Math.abs(r - 100) < 1, `stays 100 px from the pivot (${r.toFixed(2)} at ${t}s)`);
  }
  assert.ok(world.body('bob', 0.5).y > 100, 'swings down');
  // Simulating the same world again gives exactly the same result.
  const again = physics({ ...def, hz: 120 });
  assert.deepEqual(again.all(2.3), world.all(2.3));
  assert.throws(() => world.body('nope', 0), /no body/);
  assert.throws(() => physics({ bodies: [{ shape: { kind: 'blob' } as never, x: 0, y: 0 }] }), /unknown shape 'blob'/);
});
