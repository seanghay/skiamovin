import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decay,
  decayDuration,
  Easing,
  fall,
  fling,
  gesture,
  motions,
  projectedEnd,
  rubberBand,
  spring,
  springConstants,
  springPath,
  springSettlingTime,
  springState,
  springs,
} from 'skiamovin/scene';

const close = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('SwiftUI spring formula and presets', () => {
  const smooth = springConstants(springs.smooth);
  close(smooth.stiffness, 157.91, 0.01);
  close(smooth.damping, 25.13, 0.01);
  close(smooth.zeta, 1);
  const bouncy = springConstants(springs.bouncy);
  close(bouncy.zeta, 0.7);
  close(springConstants({ response: 0.5, bounce: -0.5 }).zeta, 2);
  // spring({ response, bounce }) settles at the target and overshoots only with bounce.
  close(spring({ timestamp: 3, response: 0.5, bounce: 0.3 }), 1);
  const peak = Math.max(...Array.from({ length: 200 }, (_, i) => spring({ timestamp: i / 200, ...springs.bouncy })));
  assert.ok(peak > 1.01, `bouncy overshoots (${peak})`);
  const noBounce = Math.max(
    ...Array.from({ length: 200 }, (_, i) => spring({ timestamp: i / 200, ...springs.smooth })),
  );
  assert.ok(noBounce <= 1 + 1e-9, `smooth doesn't overshoot (${noBounce})`);
  // Existing callers keep their behavior.
  close(spring({ timestamp: 0 }), 0);
  assert.ok(spring({ timestamp: 2, stiffness: 100, damping: 10 }) > 0.99);
});

test('spring solver: all damping cases, starting speed and velocity', () => {
  for (const zeta of [0.3, 1, 2.5]) {
    const omega = 10;
    const [x0, v0] = springState(0, 2, -3, omega, zeta);
    assert.deepEqual([x0, v0], [2, -3]);
    // Velocity matches the numerical derivative of position.
    const t = 0.37,
      h = 1e-5;
    const d = (springState(t + h, 2, -3, omega, zeta)[0] - springState(t - h, 2, -3, omega, zeta)[0]) / (2 * h);
    close(springState(t, 2, -3, omega, zeta)[1], d, 1e-4);
    close(springState(20, 2, -3, omega, zeta)[0], 0);
  }
  // A thrown value keeps moving forward before settling.
  assert.ok(spring({ timestamp: 0.05, from: 0, to: 0, velocity: 500, ...springs.smooth }) > 5);
  close(spring.velocity({ timestamp: 0, velocity: 7, ...springs.smooth }), 7);
  const settle = springSettlingTime(springs.smooth);
  assert.ok(settle > 0.5 && settle < 2, `settles in ${settle}s`);
  const ease = Easing.spring(springs.bouncy);
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
});

test('retargeting: additive and merged springs agree and never jump', () => {
  const targets = [
    { at: 0, to: 100 },
    { at: 0.2, to: -50 },
  ];
  for (const t of [0.1, 0.25, 0.6, 2]) {
    const [a] = springPath({ timestamp: t, from: 0, targets, spring: springs.bouncy, mode: 'add' });
    const [m] = springPath({ timestamp: t, from: 0, targets, spring: springs.bouncy, mode: 'merge' });
    close(a, m, 1e-6);
  }
  // Continuous across the change.
  const before = springPath({ timestamp: 0.2 - 1e-6, from: 0, targets })[0];
  const after = springPath({ timestamp: 0.2 + 1e-6, from: 0, targets })[0];
  close(before, after, 1e-2);
  close(springPath({ timestamp: 5, from: 0, targets })[0], -50);
});

test('momentum, rubber banding and snapping', () => {
  // iOS-style deceleration: v(t) = v0 · rate^(1000t).
  const [x1, v1] = decay({ timestamp: 1, from: 0, velocity: 1000 });
  close(v1, 1000 * 0.998 ** 1000, 1e-6);
  close(projectedEnd(0, 1000), 1000 / (-1000 * Math.log(0.998)), 1e-6);
  assert.ok(x1 < projectedEnd(0, 1000));
  close(decay({ timestamp: 100, from: 0, velocity: 1000 })[0], projectedEnd(0, 1000), 1e-3);
  assert.ok(decayDuration(1000) > 3 && decayDuration(1000) < 4);

  close(rubberBand(0, 100), 0);
  assert.ok(rubberBand(50, 100) < 50 && rubberBand(50, 100) > 0);
  assert.ok(rubberBand(1e6, 100) < 100);
  close(rubberBand(-50, 100), -rubberBand(50, 100));

  // Paging: lands on the page nearest to where the fling would stop.
  const end = fling({ timestamp: 5, from: 0, velocity: 800, snap: 320 })[0];
  close(end, Math.round(projectedEnd(0, 800) / 320) * 320);
  // Bounds: glides to the edge, overshoots a little, and comes back.
  const path = Array.from(
    { length: 300 },
    (_, i) => fling({ timestamp: i / 100, from: 0, velocity: 3000, bounds: [0, 500] })[0],
  );
  assert.ok(Math.max(...path) > 500, 'overshoots the edge');
  close(path[path.length - 1]!, 500, 0.5);
});

test('falling, gestures and ready-made motions', () => {
  // Free fall: x = ½gt² with g = 1000.
  close(fall({ timestamp: 0.1, from: 0 })[0], 5);
  // Bounces on the floor and comes to rest there.
  const ys = Array.from(
    { length: 400 },
    (_, i) => fall({ timestamp: i / 100, from: 0, floor: 300, elasticity: 0.6 })[0],
  );
  assert.ok(ys.every((y) => y <= 300 + 1e-9));
  close(ys[ys.length - 1]!, 300);
  const g = gesture([
    { t: 0, x: 0, y: 0 },
    { t: 0.5, x: 100, y: 0 },
    { t: 0.6, x: 150, y: 0 },
  ]);
  assert.deepEqual(g.at(0.25), { x: 50, y: 0 });
  close(g.releaseVelocity.x, 500);
  close(motions.sheetUp(0, 400), 400);
  close(motions.sheetUp(3, 400), 0);
  close(motions.press(0.1), 0.94, 0.03);
  close(motions.press(2), 1);
  close(motions.pop(3), 1);
});
