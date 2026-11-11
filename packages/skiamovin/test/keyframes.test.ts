import assert from 'node:assert/strict';
import { test } from 'node:test';
import { init, Path } from 'skiamovin';
import { cleanShape, curve, hold, modifiers, modify, shapeKeys, strips } from 'skiamovin/scene';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('curve: keys are hit, handles shape the motion', () => {
  const keys = [
    { time: 0, value: 0 },
    { time: 1, value: 10 },
    { time: 2, value: 0 },
  ];
  near(curve(keys, 0), 0);
  near(curve(keys, 1), 10);
  near(curve(keys, 2), 0);
  near(curve(keys, -1), 0);
  // Auto handles pass smoothly through a peak and may rise above it; clamped ones never do.
  const peak = Math.max(
    ...Array.from({ length: 201 }, (_, i) =>
      curve(
        keys.map((k) => ({ ...k, handle: 'clamped' as const })),
        i / 100,
      ),
    ),
  );
  near(peak, 10, 1e-3);
  near(
    curve(
      [
        { time: 0, value: 0, handle: 'linear' },
        { time: 2, value: 4 },
      ],
      0.5,
    ),
    1,
  );
  near(
    curve(
      [
        { time: 0, value: 3, handle: 'constant' },
        { time: 2, value: 4 },
      ],
      1.9,
    ),
    3,
  );
  // Free handles: an ease in and out.
  const ease = [
    { time: 0, value: 0, handle: 'free' as const, out: [0.5, 0] as const },
    { time: 1, value: 1, handle: 'free' as const, in: [-0.5, 0] as const },
  ];
  near(curve(ease, 0.5), 0.5, 1e-6);
  assert.ok(curve(ease, 0.1) < 0.05);
});

test('strips: actions placed, repeated and blended', () => {
  const wave = { duration: 1, values: (t: number) => ({ x: t * 10 }) };
  const hold5 = { duration: 2, values: () => ({ x: 5, y: 1 }) };
  near(strips([{ action: wave, start: 1 }], 1.5).x!, 5);
  near(strips([{ action: wave, start: 0, repeat: 3 }], 2.25).x!, 2.5);
  near(strips([{ action: wave, start: 0, speed: 2 }], 0.25).x!, 5);
  const blended = strips(
    [
      { action: wave, start: 0 },
      { action: hold5, start: 0, influence: 0.5 },
    ],
    0.2,
  );
  near(blended.x!, 2 + (5 - 2) * 0.5);
  near(strips([{ action: wave, start: 0, mode: 'add' }], 0.5, { x: 100 }).x!, 105);
  near(strips([{ action: hold5, start: 0, blendIn: 1 }], 0.25).x!, 1.25);
});

test('shapeKeys: blends path numbers by weight', () => {
  const base = 'M0 0 L10 0 L10 10 Z';
  const keys = { wide: 'M0 0 L20 0 L20 10 Z', tall: 'M0 0 L10 0 L10 30 Z' };
  assert.equal(shapeKeys(base, keys, { wide: 0.5 }), 'M0 0 L15 0 L15 10 Z');
  assert.equal(shapeKeys(base, keys, { wide: 1, tall: 1 }), 'M0 0 L20 0 L20 30 Z');
  assert.throws(() => shapeKeys(base, { bad: 'M0 0 L1 1' }, { bad: 1 }), /same commands/);
});

test('modifiers: a stack of path changes', async () => {
  await init();
  const square = 'M0 0 L10 0 L10 10 L0 10 Z';
  const row = modify(square, [modifiers.repeat(3, { x: 20 })]);
  const b = row.computeTightBounds();
  assert.deepEqual([b.left, b.right], [0, 50]);
  const both = modify(square, [modifiers.mirror('x', 0)]).computeTightBounds();
  assert.deepEqual([both.left, both.right], [-10, 10]);
  const grown = modify(square, [modifiers.offset(5)]).computeTightBounds();
  assert.deepEqual([grown.left, grown.right], [-5, 15]);
  const round = modify(square, [modifiers.roundCorners(4)]);
  assert.ok(!round.contains([0.3, 0.3]) && round.contains([5, 5]));
  const rough = modify(Path.fromSVG('M0 0 L100 0')!, [modifiers.noise(5, 3, 1)]);
  assert.ok(rough.computeTightBounds().height() > 0);
});

test('hold and cleanShape', () => {
  near(hold(0.05, 24, 2), 0);
  near(hold(1 / 12 + 0.001, 24, 2), 1 / 12);
  const circle = Array.from(
    { length: 40 },
    (_, i) => [50 + 30 * Math.cos(i / 6.2) + (i % 3), 50 + 30 * Math.sin(i / 6.2)] as const,
  );
  assert.equal(cleanShape(circle).kind, 'circle');
  const line = Array.from({ length: 20 }, (_, i) => [i * 10, 5 + (i % 2) * 0.8] as const);
  assert.equal(cleanShape(line).kind, 'line');
  const tri = [
    ...Array.from({ length: 10 }, (_, i) => [i * 10, 0] as const),
    ...Array.from({ length: 10 }, (_, i) => [100 - i * 5, i * 9] as const),
    ...Array.from({ length: 11 }, (_, i) => [50 - i * 5, 90 - i * 9] as const),
  ];
  const t = cleanShape(tri);
  assert.equal(t.kind, 'polygon');
  assert.equal(t.d.split('L').length, 3);
});
