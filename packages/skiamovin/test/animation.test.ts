import assert from 'node:assert/strict';
import { test } from 'node:test';
import { init } from 'skiamovin';
import {
  Easing,
  interpolate,
  interpolateColor,
  keyframes,
  loopTime,
  noise,
  random,
  spring,
  stagger,
  Timeline,
  wiggle,
} from 'skiamovin/scene';

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
    if (
      typeof f !== 'function' ||
      [
        'in',
        'out',
        'inOut',
        'back',
        'elastic',
        'bezier',
        'cubicBezier',
        'steps',
        'squish',
        'piecewise',
        'custom',
        'irregular',
        'thereAndBack',
      ].includes(name)
    )
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

test('easing: smooth, thereAndBack, squish, piecewise, custom, irregular', async () => {
  assert.equal(Easing.smooth(0), 0);
  assert.equal(Easing.smooth(1), 1);
  assert.ok(Math.abs(Easing.smooth(0.5) - 0.5) < 1e-9);
  assert.ok(Math.abs(Easing.thereAndBack(0.5) - 1) < 1e-9);
  assert.equal(Easing.thereAndBack(1), 0);
  const sq = Easing.squish(Easing.linear, 0.25, 0.75);
  assert.deepEqual([sq(0), sq(0.5), sq(1)], [0, 0.5, 1]);
  // CSS linear(0, 0.8 50%, 1): halfway to 50% is 0.4.
  const pw = Easing.piecewise([0, [0.8, 0.5], 1]);
  assert.ok(Math.abs(pw(0.25) - 0.4) < 1e-9);
  assert.ok(Math.abs(pw(0.75) - 0.9) < 1e-9);
  await init();
  const line = Easing.custom('M0,0 L1,1');
  assert.ok(Math.abs(line(0.3) - 0.3) < 1e-3);
  const s = Easing.custom('M0,0 C0.5,0 0.5,1 1,1');
  assert.ok(Math.abs(s(0.5) - 0.5) < 1e-3);
  assert.ok(s(0.25) < 0.25 && s(0.75) > 0.75);
  const rough = Easing.irregular('seed', { points: 10 });
  assert.equal(rough(0), 0);
  assert.equal(rough(1), 1);
  assert.equal(rough(0.37), Easing.irregular('seed', { points: 10 })(0.37));
});

test('stagger: from, edges, grid, ranges and seeded random', () => {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  assert.ok(near(stagger(0.1)(3, 5), 0.3));
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((i) => +stagger(0.1, { from: 'center' })(i, 5).toFixed(6)),
    [0.2, 0.1, 0, 0.1, 0.2],
  );
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((i) => +stagger(1, { from: 'edges' })(i, 5).toFixed(6)),
    [0, 1, 2, 1, 0],
  );
  assert.ok(near(stagger(1, { grid: [2, 3] })(4, 6), Math.SQRT2));
  assert.ok(near(stagger(1, { grid: [2, 3], axis: 'x' })(4, 6), 1));
  assert.ok(near(stagger([0, 100])(2, 5), 50));
  assert.ok(near(stagger(0.1, { start: 1 })(0, 3), 1));
  const r = stagger(1, { from: 'random', seed: 7 });
  const order = [0, 1, 2, 3, 4, 5].map((i) => r(i, 6));
  assert.deepEqual([...order].sort(), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(
    order,
    [0, 1, 2, 3, 4, 5].map((i) => stagger(1, { from: 'random', seed: 7 })(i, 6)),
  );
});

test('keyframes, wiggle and loopTime', () => {
  assert.equal(keyframes(0.5, [0, 100, 50]), 100);
  assert.equal(keyframes(0.25, [0, 100, 50], { times: [0, 0.25, 1] }), 100);
  assert.equal(keyframes(2, [0, 100, 50], { duration: 2 }), 50);
  assert.throws(() => keyframes(0, [0, 1], { times: [0] }), RangeError);
  const w = [0, 0.3, 1.7, 5].map((t) => wiggle(t, 2, 10, { seed: 'x' }));
  assert.ok(w.every((v) => Math.abs(v) <= 10));
  assert.deepEqual(
    w,
    [0, 0.3, 1.7, 5].map((t) => wiggle(t, 2, 10, { seed: 'x' })),
  );
  assert.notEqual(w[1], w[2]);
  assert.equal(loopTime(2.5, 2), 0.5);
  assert.equal(loopTime(2.5, 2, 'pingpong'), 1.5);
  assert.equal(loopTime(4.5, 2, 'pingpong'), 0.5);
});

test('timeline: percent offsets, repeat, yoyo, timeScale and labels', () => {
  const lin = Easing.linear;
  const tl = new Timeline()
    .to('a', { x: 100 }, { duration: 2, easing: lin })
    .to('b', { x: 10 }, { at: '<50%', duration: 1, easing: lin });
  assert.equal(tl.valueAt('b', 'x', 1.5), 5);

  const yo = new Timeline().to('a', { x: 100 }, { duration: 1, repeat: 1, yoyo: true, easing: lin });
  assert.equal(yo.duration, 2);
  assert.equal(yo.valueAt('a', 'x', 0.5), 50);
  assert.equal(yo.valueAt('a', 'x', 1.25), 75);
  assert.equal(yo.valueAt('a', 'x', 3), 0);

  const rep = new Timeline({ repeat: 1 }).to('a', { x: 100 }, { duration: 1, easing: lin });
  assert.equal(rep.totalDuration, 2);
  assert.equal(rep.valueAt('a', 'x', 1.5), 50);
  const fast = new Timeline({ timeScale: 2 }).to('a', { x: 100 }, { duration: 1, easing: lin });
  assert.equal(fast.totalDuration, 0.5);
  assert.equal(fast.valueAt('a', 'x', 0.25), 50);

  const ev = new Timeline({ labels: { drop: 2 } }).to('a', { x: 1 }, { at: 'drop', duration: 1, easing: lin });
  assert.equal(ev.valueAt('a', 'x', 2.5), 0.5);

  const st = new Timeline().to(
    ['a', 'b', 'c'],
    { x: 1 },
    { duration: 1, easing: lin, stagger: { each: 0.5, from: 'last' } },
  );
  assert.equal(st.valueAt('c', 'x', 0.5), 0.5);
  assert.equal(st.valueAt('a', 'x', 1.5), 0.5);
});

test('timeline: keyframes and flow helpers', () => {
  const lin = Easing.linear;
  const kf = new Timeline().keyframes('a', { x: [0, 100, 50] }, { duration: 2, times: [0, 0.25, 1] });
  assert.equal(kf.valueAt('a', 'x', 0.5), 100);
  assert.equal(kf.valueAt('a', 'x', 2), 50);
  const one = () => new Timeline().to('a', { x: 1 }, { duration: 1, easing: lin });
  const two = () => new Timeline().to('b', { y: 1 }, { duration: 2, easing: lin });
  assert.equal(Timeline.all(one(), two()).duration, 2);
  assert.equal(Timeline.chain(one(), two()).duration, 3);
  assert.equal(Timeline.chain(one(), two()).valueAt('b', 'y', 2), 0.5);
  assert.equal(Timeline.sequence(0.5, one(), two()).duration, 2.5);
  assert.equal(Timeline.delay(1, one()).valueAt('a', 'x', 1.5), 0.5);
  // A repeating timeline keeps its own clock when nested.
  const looping = new Timeline({ repeat: 2 }).to('a', { x: 100 }, { duration: 1, easing: lin });
  const outer = Timeline.chain(one(), looping);
  assert.equal(outer.duration, 4);
  assert.equal(outer.valueAt('a', 'x', 2.5), 50);
});
