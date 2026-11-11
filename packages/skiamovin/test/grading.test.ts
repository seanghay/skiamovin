import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { AlphaType, ColorType, EncodedImageFormat, Image, ImageInfo, images, init } from 'skiamovin';
import {
  adjust,
  blendGrades,
  box,
  Composition,
  CompositionSink,
  curves,
  type Grade,
  gradientMap,
  LutAsset,
  levels,
  linearGradient,
  lut,
  parseCube,
  posterize,
  threshold,
} from 'skiamovin/scene';
import { OUT, prepareTestMedia } from './fixtures/media.ts';

prepareTestMedia();
const W = 64,
  H = 48;

/** A test card: a rainbow gradient on top, a gray ramp below. */
function card(grade?: Grade | Grade[]) {
  return new Composition({
    width: W,
    height: H,
    frameRate: 30,
    duration: 1,
    render: () =>
      box({ size: { width: '100%', height: '100%' }, flexDirection: 'column', grade }, [
        box({
          size: { width: '100%', height: 24 },
          background: linearGradient(90, ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff']),
        }),
        box({ size: { width: '100%', height: 24 }, background: linearGradient(90, ['#000000', '#ffffff']) }),
      ]),
  });
}

async function render(grade?: Grade | Grade[]): Promise<Uint8Array> {
  const sink = new CompositionSink(card(grade), { gpu: 'raster' });
  const img = (await sink.getImage(0))!.image;
  const px = img.readPixels(0, 0, new ImageInfo(W, H, ColorType.RGBA_8888, AlphaType.Unpremul));
  await sink.dispose();
  return px;
}

const at = (px: Uint8Array, x: number, y: number) => [...px.slice((y * W + x) * 4, (y * W + x) * 4 + 3)];
function maxDiff(a: Uint8Array, b: Uint8Array, stride = 4, channels = 3): number {
  let m = 0;
  for (let i = 0; i < a.length / stride; i++)
    for (let c = 0; c < channels; c++) m = Math.max(m, Math.abs(a[i * stride + c]! - b[i * stride + c]!));
  return m;
}

/** A 17-point cube that does something non-linear in every channel. */
function testCube(n = 17): string {
  const lines = ['TITLE "test"', `LUT_3D_SIZE ${n}`];
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        const [R, G, B] = [r / (n - 1), g / (n - 1), b / (n - 1)];
        lines.push(
          [R ** 0.8 * 0.9 + B * 0.1, (G * G + R * 0.2) / 1.2, Math.sqrt(B) * 0.85 + 0.1]
            .map((v) => v.toFixed(6))
            .join(' '),
        );
      }
  return `${lines.join('\n')}\n`;
}

test('parseCube: 3D, domain, 1D and errors', () => {
  const c = parseCube(
    'LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n',
  );
  assert.equal(c.size, 2);
  assert.deepEqual(c.domainMax, [2, 2, 2]);
  const one = parseCube('LUT_1D_SIZE 2\n0 0 0\n1 1 1\n');
  assert.equal(one.size, 33);
  assert.throws(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n'), SyntaxError);
  assert.throws(() => parseCube('TITLE "x"\n'), SyntaxError);
});

test('LUT matches ffmpeg lut3d (tetrahedral)', async () => {
  await init();
  const cubeFile = `${OUT}grading-test.cube`;
  writeFileSync(cubeFile, testCube());
  const original = await render();
  // Write the ungraded card, grade it with ffmpeg, and read the result back.
  const pngIn = `${OUT}grading-card.png`,
    pngOut = `${OUT}grading-card-ffmpeg.png`;
  const img = images.rasterFromPixels(new ImageInfo(W, H, ColorType.RGBA_8888, AlphaType.Unpremul), original, W * 4)!;
  writeFileSync(pngIn, img.encodeToData(EncodedImageFormat.PNG)!);
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    pngIn,
    '-vf',
    `lut3d=file=${cubeFile}:interp=tetrahedral`,
    '-pix_fmt',
    'rgba',
    pngOut,
  ]);
  const ref = Image.fromEncoded(new Uint8Array(readFileSync(pngOut)))!.readPixels(
    0,
    0,
    new ImageInfo(W, H, ColorType.RGBA_8888, AlphaType.Unpremul),
  );
  const ours = await render(lut(new LutAsset(cubeFile)));
  const d = maxDiff(ours, ref);
  assert.ok(d <= 2, `LUT differs from ffmpeg by up to ${d}/255`);
  // Strength 0 keeps the original; trilinear is close to tetrahedral on a smooth cube.
  assert.ok(maxDiff(await render(lut(new LutAsset(cubeFile), { strength: 0 })), original) <= 1);
  assert.ok(maxDiff(await render(lut(new LutAsset(cubeFile), { interpolation: 'trilinear' })), ref) <= 4);
});

test('grades: identity, strength, curves, levels, saturation, maps', async () => {
  await init();
  const original = await render();
  assert.ok(maxDiff(await render(adjust({})), original) <= 1, 'empty adjust is identity');
  assert.ok(maxDiff(await render(adjust({ contrast: 0.8, strength: 0 })), original) <= 1, 'strength 0 is identity');
  // An inverting curve.
  const inv = await render(
    curves({
      rgb: [
        [0, 1],
        [1, 0],
      ],
    }),
  );
  const [r, g, b] = at(original, 2, 2);
  const [ir, ig, ib] = at(inv, 2, 2);
  assert.ok(Math.abs(ir! - (255 - r!)) <= 2 && Math.abs(ig! - (255 - g!)) <= 2 && Math.abs(ib! - (255 - b!)) <= 2);
  // Grayscale: every pixel has equal channels.
  const gray = await render(adjust({ saturation: -1 }));
  for (let y = 0; y < H; y += 7)
    for (let x = 0; x < W; x += 7) {
      const [a, bb, c] = at(gray, x, y);
      assert.ok(Math.abs(a! - bb!) <= 2 && Math.abs(bb! - c!) <= 2, `gray at ${x},${y}: ${a},${bb},${c}`);
    }
  // Exposure +1 brightens mid gray.
  assert.ok(at(await render(adjust({ exposure: 1 })), W / 2, 36)[0]! > at(original, W / 2, 36)[0]! + 20);
  // Levels: crush the bottom half to black.
  assert.ok(at(await render(levels({ inBlack: 0.5 })), W / 4, 36)[0]! <= 2);
  // Duotone: black maps to the first color, white to the last.
  const duo = await render(gradientMap(['#102030', '#f0e0d0']));
  const near = (p: number[], q: number[]) => p.every((v, i) => Math.abs(v - q[i]!) <= 8);
  assert.ok(near(at(duo, 0, 36), [0x10, 0x20, 0x30]), `dark end ${at(duo, 0, 36)}`);
  assert.ok(near(at(duo, W - 1, 36), [0xf0, 0xe0, 0xd0]), `bright end ${at(duo, W - 1, 36)}`);
  const th = await render(threshold(0.5));
  assert.deepEqual(at(th, 2, 36), [0, 0, 0]);
  assert.deepEqual(at(th, W - 2, 36), [255, 255, 255]);
  const post = await render(posterize(2));
  for (const v of at(post, W / 3, 36)) assert.ok(v === 0 || v === 255);
  // Blending two looks halfway lands between them.
  const half = at(await render(blendGrades(adjust({ exposure: -2 }), adjust({ exposure: 2 }), 0.5)), W / 2, 36)[0]!;
  const lo = at(await render(adjust({ exposure: -2 })), W / 2, 36)[0]!,
    hi = at(await render(adjust({ exposure: 2 })), W / 2, 36)[0]!;
  assert.ok(half > lo && half < hi);
});
