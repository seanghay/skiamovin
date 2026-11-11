import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Easing, interpolate, interpolateColor, noise, random, spring, Timeline } from 'skiamovin/scene';

const close = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('interpolate', () => {
  close(interpolate(0.5, [0, 1], [0, 100]), 50);
  close(interpolate(-1, [0, 1], [0, 100]), 0);
  close(interpolate(2, [0, 1], [0, 100], { extrapolateRight: 'extend' }), 200);
  close(interpolate(0.15, [0, 0.3, 2.7, 3], [0, 1, 1, 0]), 0.5);
  close(interpolate(0.5, [0, 1], [0, 1], { easing: Easing.inQuad }), 0.25);
  assert.throws(() => interpolate(0, [1, 0], [0, 1]));
});

test('easing endpoints', () => {
  for (const [name, f] of Object.entries(Easing)) {
    if (typeof f !== 'function' || ['in', 'out', 'inOut', 'back', 'elastic', 'bezier', 'steps'].includes(name))
      continue;
    close((f as (t: number) => number)(0), 0, 1e-6);
    close((f as (t: number) => number)(1), 1, 1e-6);
  }
  close(Easing.bezier(0.25, 0.1, 0.25, 1)(0.5), Easing.ease(0.5));
  close(Easing.out(Easing.bounce)(1), 1);
});

test('spring', () => {
  assert.equal(spring({ timestamp: 0 }), 0);
  assert.equal(spring({ timestamp: -1 }), 0);
  close(spring({ timestamp: 5 }), 1, 1e-3);
  assert.ok(spring({ timestamp: 0.3 }) > 1, 'default spring overshoots');
  assert.ok(spring({ timestamp: 0.3, overshootClamping: true }) <= 1);
  close(spring({ timestamp: 0.2, delay: 0.2 }), 0);
  close(spring({ timestamp: 1, duration: 1 }), 1, 2e-3);
  close(spring({ timestamp: 10, from: 5, to: -5, damping: 30 }), -5);
  const settle = spring.computeSettleTime({ damping: 14 });
  assert.ok(settle > 0.2 && settle < 3, `settle ${settle}`);
  // Deterministic, order independent.
  assert.equal(spring({ timestamp: 0.42 }), spring({ timestamp: 0.42 }));
});

test('interpolateColor (OKLab)', () => {
  const mid = interpolateColor(0.5, [0, 1], ['#000000', '#ffffff']);
  const g = (mid >>> 8) & 255;
  assert.ok(g > 90 && g < 110, `oklab mid gray ${g}`); // perceptual midpoint ≈ #636363
  assert.equal(interpolateColor(0, [0, 1], ['#ff0000', '#0000ff']) >>> 0, 0xffff0000);
});

test('Timeline', () => {
  const tl = new Timeline()
    .set('logo', { scale: 0.6, opacity: 0 })
    .to('logo', { scale: 1, opacity: 1 }, { at: 0, duration: 1, easing: Easing.linear })
    .from('tagline', { opacity: 0, y: 30 }, { at: '>-0.5', duration: 1, easing: Easing.linear })
    .label('exit', 4)
    .to(['logo', 'tagline'], { opacity: 0 }, { at: 'exit', duration: 0.5, stagger: 0.25, easing: Easing.linear });
  close(tl.duration, 4.75);
  let v = tl.getValues(0);
  close(v.logo!.scale, 0.6);
  close(v.logo!.opacity, 0);
  close(v.tagline!.opacity, 0); // from-tween holds its from-value before it starts
  close(v.tagline!.y, 30);
  v = tl.getValues(0.5);
  close(v.logo!.scale, 0.8);
  close(v.tagline!.opacity, 0);
  v = tl.getValues(1);
  close(v.tagline!.opacity, 0.5);
  close(v.tagline!.y, 15);
  v = tl.getValues(3);
  close(v.logo!.opacity, 1);
  close(v.tagline!.y, 0);
  v = tl.getValues(4.25);
  close(v.logo!.opacity, 0.5);
  close(v.tagline!.opacity, 1);
  v = tl.getValues(10);
  close(v.logo!.opacity, 0);
  close(v.tagline!.opacity, 0);
  const colors = new Timeline().fromTo('bg', { color: '#000000' }, { color: '#ffffff' }, { duration: 1 });
  assert.equal(typeof colors.getValues(0.5).bg!.color, 'number');
});

test('random and noise', () => {
  assert.equal(random('a'), random('a'));
  assert.notEqual(random('a'), random('b'));
  const vals = Array.from({ length: 1000 }, (_, i) => random(i));
  assert.ok(vals.every((v) => v >= 0 && v < 1));
  const mean = vals.reduce((a, b) => a + b) / vals.length;
  assert.ok(Math.abs(mean - 0.5) < 0.05);
  const ns = Array.from({ length: 500 }, (_, i) => noise('seed', i * 0.137, i * 0.071));
  assert.ok(ns.every((v) => v >= -1 && v <= 1));
  assert.ok(Math.max(...ns) > 0.3 && Math.min(...ns) < -0.3);
  assert.equal(noise('s', 1.5, 2.5), noise('s', 1.5, 2.5));
  assert.ok(Math.abs(noise('s', 1, 1) - noise('s', 1.001, 1)) < 0.01, 'continuous');
});
