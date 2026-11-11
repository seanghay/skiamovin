import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlphaType, ColorType, ImageInfo, init } from 'skiamovin';
import { box, Composition, CompositionSink, tailwindTheme, text, tw } from 'skiamovin/scene';

test('tw: layout, spacing and sizing', () => {
  const s = tw(
    'flex flex-col items-center justify-between gap-4 p-8 px-2 -mt-3 w-1/2 h-full min-w-10 aspect-video grow',
  );
  assert.equal(s.display, 'flex');
  assert.equal(s.flexDirection, 'column');
  assert.equal(s.alignItems, 'center');
  assert.equal(s.justifyContent, 'space-between');
  assert.equal(s.gap, 16);
  assert.deepEqual(s.padding, { left: 8, right: 8, top: 32, bottom: 32 });
  assert.deepEqual(s.margin, { top: -12 });
  assert.deepEqual(s.size, { width: '50%', height: '100%' });
  assert.deepEqual(s.minSize, { width: 40 });
  assert.equal(s.aspectRatio, 16 / 9);
  assert.equal(s.flexGrow, 1);
  assert.deepEqual(tw('grid grid-cols-3 col-span-2').gridTemplateColumns, ['repeat(3, 1fr)']);
  assert.deepEqual(tw('absolute inset-0 top-[13px]').inset, { left: 0, right: 0, top: 13, bottom: 0 });
});

test('tw: type, color, gradients, radius, shadows and transforms', () => {
  const t = tw('text-4xl font-bold tracking-tight leading-none text-white text-center italic');
  assert.equal(t.fontSize, tailwindTheme.fontSize['4xl'][0]);
  assert.equal(t.fontWeight, 700);
  assert.equal(t.lineHeight, 1);
  assert.ok(Math.abs((t.letterSpacing as number) - tailwindTheme.tracking.tight * (t.fontSize as number)) < 1e-9);
  assert.equal(t.color, '#ffffff');
  assert.equal(t.textAlign, 'center');
  assert.equal(tw('bg-blue-500').background, tailwindTheme.colors.blue['500']);
  assert.equal(tw('bg-black/50').background, 'rgba(0,0,0,0.5)');
  assert.equal(tw('bg-[#123456]').background, '#123456');
  const g = tw('bg-linear-to-r from-indigo-500 via-pink-500 to-amber-400').background as {
    angle: number;
    stops: string[];
  };
  assert.equal(g.angle, 90);
  assert.deepEqual(g.stops, [
    tailwindTheme.colors.indigo['500'],
    tailwindTheme.colors.pink['500'],
    tailwindTheme.colors.amber['400'],
  ]);
  assert.equal(tw('rounded-2xl').borderRadius, tailwindTheme.radius['2xl']);
  assert.deepEqual(tw('rounded-t-lg').borderRadius, [8, 8, 0, 0]);
  assert.equal(tw('rounded-full').borderRadius, 9999);
  assert.deepEqual(tw('shadow-xl').shadow, tailwindTheme.shadow.xl);
  assert.deepEqual(tw('scale-110 -rotate-6 translate-x-4').transform, { scale: 1.1, rotate: -6, translateX: 16 });
  assert.equal(tw('opacity-75 blur-md').opacity, 0.75);
  assert.equal(tw('backdrop-blur-sm').backdropBlur, tailwindTheme.blur.sm);
});

test('tw: unknown classes throw with their names', () => {
  assert.throws(() => tw('flex itms-center bg-blu-500'), /unknown classes 'itms-center', 'bg-blu-500'/);
});

test('class prop renders, and explicit style wins', async () => {
  await init();
  const comp = new Composition({
    width: 40,
    height: 40,
    frameRate: 30,
    duration: 1,
    render: () =>
      box({ class: 'flex items-center justify-center size-full bg-slate-900' }, [
        box({ class: 'size-4 bg-red-500 rounded-sm', background: '#00ff00' }),
        text('x', { class: 'text-xs text-white' }),
      ]),
  });
  const sink = new CompositionSink(comp, { gpu: 'raster' });
  const img = (await sink.getImage(0))!.image;
  const px = (x: number, y: number) =>
    [...img.readPixels(x, y, new ImageInfo(1, 1, ColorType.RGBA_8888, AlphaType.Unpremul))].slice(0, 3);
  const slate = tailwindTheme.colors.slate['900'];
  const n = parseInt(slate.slice(1), 16);
  assert.deepEqual(px(1, 1), [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
  // The 16px green square sits left of center (the text follows it in the row).
  const green = [...Array(40).keys()].some((x) => px(x, 20).join() === '0,255,0');
  assert.ok(green, 'explicit background beats bg-red-500');
  await sink.dispose();
});
