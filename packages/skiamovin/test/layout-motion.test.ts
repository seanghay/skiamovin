import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlphaType, ColorType, ImageInfo, init } from 'skiamovin';
import {
  box,
  type Child,
  Composition,
  CompositionSink,
  type RenderContext,
  sequence,
  springs,
  states,
} from 'skiamovin/scene';

const W = 100,
  H = 20;
// A 10×10 square jumps from the left edge to the right edge at 1 s.
const jumping = (ctx: RenderContext): Child =>
  box(
    {
      size: { width: '100%', height: '100%' },
      flexDirection: 'row',
      justifyContent: ctx.timestamp < 1 ? 'flex-start' : 'flex-end',
    },
    [
      box({
        size: { width: 10, height: 10 },
        background: '#ffffff',
        layoutId: 'square',
        layoutTransition: springs.smooth,
      }),
    ],
  );

function comp(render: (ctx: RenderContext) => Child) {
  return new Composition({ width: W, height: H, frameRate: 30, duration: 3, background: '#000000', render });
}
/** x of the white square's left edge in row 5. */
async function squareX(sink: CompositionSink, t: number): Promise<number> {
  const px = (await sink.getImage(t))!.image.readPixels(
    0,
    5,
    new ImageInfo(W, 1, ColorType.RGBA_8888, AlphaType.Unpremul),
  );
  for (let x = 0; x < W; x++) if (px[x * 4]! > 128) return x;
  return -1;
}

test('layoutId: layout changes spring instead of jumping, the same in any render order', async () => {
  await init();
  const sequential = new CompositionSink(comp(jumping), { gpu: 'raster' });
  const xs: number[] = [];
  for (let f = 0; f <= 60; f++) xs.push(await squareX(sequential, f / 30));
  await sequential.dispose();
  assert.equal(xs[29], 0, 'before the change');
  assert.ok(xs[33]! > 0 && xs[33]! < 90, `moving at 1.1 s (${xs[33]})`);
  assert.equal(xs[60], 90, 'settled at the right edge');
  for (let f = 31; f < 60; f++) assert.ok(xs[f]! >= xs[f - 1]!, 'moves steadily right');
  // A fresh renderer asked for one frame gives the same picture.
  const alone = new CompositionSink(comp(jumping), { gpu: 'raster' });
  assert.equal(await squareX(alone, 40 / 30), xs[40]);
  await alone.dispose();
});

test('layoutId across sequences: a shared element moves into its new place', async () => {
  await init();
  const shared = (ctx: RenderContext): Child =>
    box({ size: { width: '100%', height: '100%' } }, [
      sequence({ start: 0, end: 1 }, () =>
        box({
          position: 'absolute',
          inset: { left: 0, top: 0 },
          size: { width: 10, height: 10 },
          background: '#ffffff',
          layoutId: 'card',
        }),
      ),
      sequence({ start: 1 }, () =>
        box({
          position: 'absolute',
          inset: { left: 80, top: 0 },
          size: { width: 10, height: 10 },
          background: '#ffffff',
          layoutId: 'card',
        }),
      ),
    ]);
  const sink = new CompositionSink(comp(shared), { gpu: 'raster' });
  const mid = await squareX(sink, 1.1);
  assert.ok(mid > 0 && mid < 80, `between the two places (${mid})`);
  assert.equal(await squareX(sink, 2.9), 80);
  await sink.dispose();
});

test('sequence exit and time mapping', async () => {
  await init();
  const seen: [number, number][] = [];
  const c = comp(() =>
    sequence({ start: 0, end: 1, exit: 0.5, time: (t) => t * 2 }, (ctx) => {
      seen.push([ctx.timestamp, ctx.exit]);
      return null;
    }),
  );
  const sink = new CompositionSink(c, { gpu: 'raster' });
  await sink.getImage(0.25);
  await sink.getImage(1.25);
  await sink.getImage(1.6);
  await sink.dispose();
  assert.deepEqual(seen[0], [0.5, 0]);
  assert.deepEqual(seen[1], [2.5, 0.5]);
  assert.equal(seen.length, 2, 'gone after the exit time');
});

test('states: springs between named states, colors blend', () => {
  const opt = {
    variants: { hidden: { opacity: 0, y: 20, color: '#000000' }, shown: { opacity: 1, y: 0, color: '#ffffff' } },
    changes: [
      { at: 0, to: 'hidden' as const },
      { at: 1, to: 'shown' as const },
    ],
  };
  assert.deepEqual(states(0.5, opt), { opacity: 0, y: 20, color: '#000000' });
  const mid = states(1.15, opt);
  assert.ok((mid.opacity as number) > 0 && (mid.opacity as number) < 1);
  assert.notEqual(mid.color, '#000000');
  const end = states(4, opt);
  assert.ok(Math.abs((end.opacity as number) - 1) < 1e-3 && Math.abs(end.y as number) < 1e-2);
});

test('withSize lays the composition out again', async () => {
  await init();
  const base = comp(() =>
    box({ size: { width: '100%', height: '100%' }, flexDirection: 'row', justifyContent: 'flex-end' }, [
      box({ size: { width: 10, height: 10 }, background: '#ffffff' }),
    ]),
  );
  const wide = base.withSize(200, 20);
  assert.equal(wide.width, 200);
  const sink = new CompositionSink(wide, { gpu: 'raster' });
  const px = (await sink.getImage(0))!.image.readPixels(
    0,
    5,
    new ImageInfo(200, 1, ColorType.RGBA_8888, AlphaType.Unpremul),
  );
  assert.ok(px[195 * 4]! > 128, 'square at the right edge of the wider frame');
  await sink.dispose();
});
