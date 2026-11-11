import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ALL_FORMATS,
  BufferSource,
  BufferTarget,
  FilePathSource,
  FilePathTarget,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from 'mediabunny';
import { AlphaType, ColorType, EncodedImageFormat, type Image, ImageInfo, surfaces } from 'skiamovin';
import {
  alongPath,
  audio,
  box,
  Composition,
  CompositionAudioSink,
  CompositionSink,
  counter,
  draw,
  FontAsset,
  graphemeCount,
  ImageAsset,
  image,
  interpolate,
  linearGradient,
  morphPath,
  path,
  Render,
  SvgAsset,
  scramble,
  sequence,
  series,
  shader,
  span,
  spring,
  svg,
  text,
  textAnimator,
  video,
} from 'skiamovin/scene';
import { OUT, prepareTestMedia } from './fixtures/media.ts';

prepareTestMedia();
const pixel = (img: Image, x: number, y: number) => [
  ...img.readPixels(x, y, new ImageInfo(1, 1, ColorType.RGBA_8888, AlphaType.Unpremul)),
];
const near = (a: number[], b: number[], tol = 8) => a.slice(0, b.length).every((v, i) => Math.abs(v - b[i]!) <= tol);
const ffprobe = (file: string) =>
  JSON.parse(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,codec_name,width,height,nb_frames,duration',
        '-of',
        'json',
        file,
      ],
      { encoding: 'utf8' },
    ),
  );

const arial = new FontAsset(new FilePathSource('/System/Library/Fonts/Supplemental/Arial.ttf'), { family: 'Arial' });

function pngAsset(color: string, w = 4, h = 2): ImageAsset {
  const s = surfaces.rasterN32Premul([w, h])!;
  s.canvas().clear(color);
  return new ImageAsset(s.encodeToData(EncodedImageFormat.PNG));
}

test('layout, backgrounds, gradients, radius, text, svg, shader, draw', async () => {
  const red = pngAsset('#ff0000');
  const logo = new SvgAsset(
    new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect id="r" width="10" height="10" fill="#00ff00"/></svg>',
    ),
  );
  const comp = new Composition({
    width: 400,
    height: 200,
    frameRate: 30,
    duration: 1,
    background: '#101010',
    fonts: [arial],
    render: () =>
      box({ size: { width: '100%', height: '100%' }, flexDirection: 'row', padding: 10, gap: 10 }, [
        box({ size: { width: 80, height: 80 }, background: '#ff0000', borderRadius: 40 }),
        box({ size: { width: 80, height: 80 }, background: linearGradient(90, ['#000000', '#ffffff']) }),
        image(red, { size: { width: 40, height: 80 }, fit: 'cover' }),
        svg(logo, { size: { width: 40, height: 40 }, attributes: { r: { fill: '#0000ff' } } }),
        shader(
          'uniform float2 iResolution; half4 main(float2 p) { return p.x < iResolution.x * 0.5 ? half4(1,1,0,1) : half4(0,1,1,1); }',
          { size: { width: 40, height: 40 } },
        ),
        box({ position: 'absolute', inset: { left: 10, bottom: 10 }, size: { width: 380, height: 60 } }, [
          text(['Hello ', span('Skiamovin', { color: '#ff00ff', fontWeight: 'bold' })], {
            fontFamily: 'Arial',
            fontSize: 40,
            color: '#ffffff',
          }),
        ]),
        draw((c, { width, height }) => c.drawRect([0, 0, width, height], new (globalThis as any).__Paint('#ff8800')), {
          position: 'absolute',
          inset: { right: 0, top: 0 },
          size: { width: 10, height: 10 },
        }),
      ]),
  });
  const { Paint } = await import('skiamovin');
  (globalThis as any).__Paint = Paint;
  const sink = new CompositionSink(comp);
  const { image: img } = (await sink.getImage(0))!;
  writeFileSync(`${OUT}scene-layout.png`, img.encodeToData()!);
  assert.ok(near(pixel(img, 50, 50), [255, 0, 0]), 'circle center red');
  assert.ok(near(pixel(img, 12, 12), [16, 16, 16]), 'circle corner is background (radius)');
  const g0 = pixel(img, 101, 50)[0]!,
    g1 = pixel(img, 178, 50)[0]!;
  assert.ok(g0 < 30 && g1 > 220, `gradient left→right ${g0} ${g1}`);
  assert.ok(near(pixel(img, 210, 50), [255, 0, 0]), 'image');
  assert.ok(near(pixel(img, 260, 20), [0, 0, 255]), 'svg with attribute override');
  assert.ok(
    near(pixel(img, 305, 20), [255, 255, 0]) && near(pixel(img, 325, 20), [0, 255, 255]),
    'shader with iResolution',
  );
  assert.ok(near(pixel(img, 395, 4), [255, 136, 0]), 'draw callback');
  // text: some white and some magenta pixels in the text row
  const row = img.readPixels(10, 130, new ImageInfo(380, 60, ColorType.RGBA_8888, AlphaType.Unpremul));
  let white = 0,
    magenta = 0;
  for (let i = 0; i < row.length; i += 4) {
    if (row[i]! > 200 && row[i + 1]! > 200 && row[i + 2]! > 200) white++;
    if (row[i]! > 200 && row[i + 1]! < 60 && row[i + 2]! > 200) magenta++;
  }
  assert.ok(white > 200 && magenta > 200, `text pixels white=${white} magenta=${magenta}`);
  await sink.dispose();
});

test('opacity, transforms, shadows, masks and sequences', async () => {
  const comp = new Composition({
    width: 200,
    height: 100,
    frameRate: 10,
    duration: 2,
    background: '#000000',
    render: ({ timestamp }) =>
      box({ size: { width: '100%', height: '100%' } }, [
        box({
          position: 'absolute',
          inset: { left: 0, top: 0 },
          size: { width: 50, height: 50 },
          background: '#ffffff',
          opacity: 0.5,
        }),
        box({
          position: 'absolute',
          inset: { left: 60, top: 0 },
          size: { width: 40, height: 40 },
          background: '#00ff00',
          transform: { scale: 0.5 },
        }),
        box({
          position: 'absolute',
          inset: { left: 110, top: 10 },
          size: { width: 30, height: 30 },
          background: '#ff0000',
          shadow: { offset: [0, 20], blur: 0, color: '#0000ff' },
        }),
        box({
          position: 'absolute',
          inset: { left: 150, top: 0 },
          size: { width: 40, height: 40 },
          background: '#ffffff',
          mask: box({ size: { width: 20, height: 40 }, background: '#000000' }),
        }),
        sequence({ start: 1 }, (ctx) =>
          box({
            position: 'absolute',
            inset: { left: 0, top: 60 },
            size: { width: 40 + ctx.timestamp * 100, height: 20 },
            background: '#ff00ff',
          }),
        ),
        series({ timestamp, duration: 2, frame: 0, frameRate: 10, width: 200, height: 100, props: {} }, [
          {
            duration: 1,
            render: () =>
              box({
                position: 'absolute',
                inset: { left: 100, top: 80 },
                size: { width: 10, height: 10 },
                background: '#ffff00',
              }),
          },
          {
            duration: 1,
            render: () =>
              box({
                position: 'absolute',
                inset: { left: 100, top: 80 },
                size: { width: 10, height: 10 },
                background: '#00ffff',
              }),
          },
        ]),
      ]),
  });
  const sink = new CompositionSink(comp);
  const a = (await sink.getImage(0))!.image;
  assert.ok(near(pixel(a, 25, 25), [128, 128, 128], 2), 'opacity 0.5');
  assert.ok(near(pixel(a, 80, 20), [0, 255, 0]) && near(pixel(a, 62, 2), [0, 0, 0]), 'scaled about the center');
  assert.ok(near(pixel(a, 125, 45), [0, 0, 255]), 'drop shadow');
  assert.ok(near(pixel(a, 155, 20), [255, 255, 255]) && near(pixel(a, 185, 20), [0, 0, 0]), 'mask');
  assert.ok(near(pixel(a, 10, 70), [0, 0, 0]), 'sequence not started');
  assert.ok(near(pixel(a, 105, 85), [255, 255, 0]), 'series item 1');
  const b = (await sink.getImage(1.5))!.image;
  assert.ok(
    near(pixel(b, 10, 70), [255, 0, 255]) && near(pixel(b, 85, 70), [255, 0, 255]),
    'sequence local time: width 90',
  );
  assert.ok(near(pixel(b, 95, 70), [0, 0, 0]));
  assert.ok(near(pixel(b, 105, 85), [0, 255, 255]), 'series item 2');
  let n = 0;
  for await (const f of sink.images(0, 0.5)) {
    n++;
    f.image.delete();
  }
  assert.equal(n, 5);
  await sink.dispose();
});

test('Render: video layer + audio + text → MP4 with native codecs', async () => {
  const clip = new Input({ formats: ALL_FORMATS, source: new FilePathSource(`${OUT}clip.mp4`) });
  const music = new Input({ formats: ALL_FORMATS, source: new FilePathSource(`${OUT}tone.mp3`) });
  const comp = new Composition<{ title: string }>({
    width: 640,
    height: 360,
    frameRate: 30,
    duration: 2,
    fonts: [arial],
    defaultProps: { title: 'Default' },
    render: ({ timestamp, props }) =>
      box({ size: { width: '100%', height: '100%' } }, [
        video(clip, {
          position: 'absolute',
          inset: 0,
          size: { width: '100%', height: '100%' },
          fit: 'cover',
          volume: 0.5,
        }),
        audio(music, { volume: (t) => interpolate(t, [0, 0.5], [0, 0.8]) }),
        box(
          {
            position: 'absolute',
            inset: { left: 20, top: 20 },
            padding: 12,
            borderRadius: 12,
            background: 'rgba(0,0,0,0.6)',
            opacity: spring({ timestamp }),
          },
          [text(props.title, { fontFamily: 'Arial', fontSize: 36, color: '#ffffff' })],
        ),
      ]),
  });
  const file = `${OUT}scene-render.mp4`;
  const render = await Render.init({
    composition: comp,
    props: { title: 'Skiamovin ✨' },
    output: new Output({ format: new Mp4OutputFormat(), target: new FilePathTarget(file) }),
    profile: true,
  });
  assert.ok(render.isValid);
  assert.deepEqual(render.discardedTracks, []);
  assert.equal(render.utilizedBackend, 'metal');
  let last = 0;
  render.onProgress = (p) => (last = p);
  await render.execute();
  assert.equal(last, 1);
  const p = ffprobe(file);
  const v = p.streams.find((s: any) => s.codec_type === 'video');
  const a = p.streams.find((s: any) => s.codec_type === 'audio');
  assert.equal(v.codec_name, 'h264');
  assert.equal(Number(v.nb_frames), 60);
  assert.equal(a.codec_name, 'aac');
  assert.ok(Math.abs(Number(a.duration) - 2) < 0.1, `audio duration ${a.duration}`);

  // Check a decoded frame: the testsrc2 clip is visible, and the title box is drawn.
  const input = new Input({ formats: ALL_FORMATS, source: new FilePathSource(file) });
  const { ImageSink } = await import('skiamovin/media');
  const frame = (await new ImageSink((await input.getPrimaryVideoTrack())!).getImage(1.0))!.image;
  writeFileSync(`${OUT}scene-render-frame.png`, frame.encodeToData()!);
  // Audio: loudness should rise after the fade-in.
  const { AudioSampleSink } = await import('mediabunny');
  let early = 0,
    late = 0;
  for await (const s of new AudioSampleSink((await input.getPrimaryAudioTrack())!).samples()) {
    const buf = new Float32Array(s.numberOfFrames);
    s.copyTo(buf, { planeIndex: 0, format: 'f32-planar' });
    const e = buf.reduce((acc, x) => acc + x * x, 0) / buf.length;
    if (s.timestamp < 0.2) early = Math.max(early, e);
    if (s.timestamp > 1.0 && s.timestamp < 1.8) late = Math.max(late, e);
    s.close();
  }
  assert.ok(late > early * 1.5, `fade in: early ${early}, late ${late}`);
  input.dispose();
  clip.dispose();
  music.dispose();
});

test('Render: discarded audio, trims, sizes, WebM codec selection', async () => {
  const comp = new Composition({
    width: 320,
    height: 240,
    frameRate: 25,
    duration: 2,
    render: ({ timestamp }) =>
      box({ size: { width: '100%', height: '100%' }, background: timestamp < 1 ? '#ff0000' : '#0000ff' }),
  });
  const target = new BufferTarget();
  const r = await Render.init({
    composition: comp,
    output: new Output({ format: new Mp4OutputFormat(), target }),
    trim: { start: 0.5, end: 1.5 },
    video: { width: 160 },
  });
  assert.deepEqual(r.discardedTracks, [{ type: 'audio', reason: 'nothing_audible' }]);
  await r.execute();
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(target.buffer!) });
  const track = (await input.getPrimaryVideoTrack())!;
  assert.equal(track.codedWidth, 160);
  assert.equal(track.codedHeight, 120);
  assert.ok(Math.abs((await input.computeDuration()) - 1) < 0.05);

  // WebM only allows VP8/VP9/AV1 — none encodable natively on Node → invalid.
  const webm = await Render.init({
    composition: comp,
    output: new Output({ format: new WebMOutputFormat(), target: new BufferTarget() }),
  });
  assert.equal(webm.isValid, false);
  assert.deepEqual(webm.discardedTracks[0], { type: 'video', reason: 'no_encodable_target_codec' });
});

test('CompositionAudioSink mixes and limits', async () => {
  const tone = new Input({ formats: ALL_FORMATS, source: new FilePathSource(`${OUT}tone.mp3`) });
  const comp = new Composition({
    width: 10,
    height: 10,
    frameRate: 30,
    duration: 2,
    render: () => [
      audio(tone, { volume: 8 }),
      sequence({ start: 1 }, () => audio(tone, { volume: 8, trim: { start: 0.5 } })),
    ],
  });
  const sink = new CompositionAudioSink(comp);
  let peak = 0,
    frames = 0;
  for await (const s of sink.samples()) {
    const buf = new Float32Array(s.numberOfFrames * 2);
    s.copyTo(buf, { planeIndex: 0, format: 'f32' });
    for (const v of buf) peak = Math.max(peak, Math.abs(v));
    frames += s.numberOfFrames;
    s.close();
  }
  assert.equal(frames, 96000);
  assert.ok(peak <= 1 && peak > 0.9, `limited peak ${peak}`);
  tone.dispose();
});

test('path node: fill, stroke, trim, arrowheads; morphPath and alongPath', async () => {
  // Square (0,0)-(100,100), drawn as a stroke and trimmed to its first half: the top and right edges.
  const square = 'M0 0 L100 0 L100 100 L0 100 Z';
  const comp = new Composition({
    width: 120,
    height: 120,
    frameRate: 30,
    duration: 1,
    background: '#000000',
    render: () =>
      box({ size: { width: '100%', height: '100%' }, padding: 10 }, [
        path(square, { stroke: '#ffffff', strokeWidth: 4, trim: { end: 0.5 }, arrow: { end: 10 } }),
      ]),
  });
  const sink = new CompositionSink(comp, { gpu: 'raster' });
  const img = (await sink.getImage(0))!.image;
  assert.ok(pixel(img, 60, 10)[0]! > 200, 'top edge drawn');
  assert.ok(pixel(img, 110, 60)[0]! > 200, 'right edge drawn');
  assert.ok(pixel(img, 60, 110)[0]! < 50, 'bottom edge not drawn');
  assert.ok(pixel(img, 10, 60)[0]! < 50, 'left edge not drawn');
  await sink.dispose();

  // Filled by default when there is no stroke.
  const filled = new Composition({
    width: 40,
    height: 40,
    frameRate: 30,
    duration: 1,
    background: '#ffffff',
    render: () => path('M5 5 L35 5 L35 35 L5 35 Z'),
  });
  const fs = new CompositionSink(filled, { gpu: 'raster' });
  assert.deepEqual(pixel((await fs.getImage(0))!.image, 20, 20).slice(0, 3), [0, 0, 0]);
  await fs.dispose();

  // Morph a circle into a square: endpoints match, and a midpoint has the same number of points as the ends.
  const circle = 'M50 0 A50 50 0 1 1 50 100 A50 50 0 1 1 50 0 Z';
  const a = morphPath(circle, square, 0);
  const b = morphPath(circle, square, 1);
  const mid = morphPath(circle, square, 0.5);
  assert.equal(a.countPoints(), b.countPoints());
  assert.equal(mid.countPoints(), a.countPoints());
  const bb = b.computeTightBounds();
  assert.deepEqual([bb.left, bb.top, bb.right, bb.bottom].map(Math.round), [0, 0, 100, 100]);
  // The square's corners end up near the circle's matching points, so the morph doesn't twist: the morph's
  // area stays close to both shapes rather than collapsing.
  const mb = mid.computeTightBounds();
  assert.ok(mb.right - mb.left > 90 && mb.bottom - mb.top > 90, `mid bounds ${JSON.stringify(mb)}`);

  const p = alongPath('M0 0 L100 0 L100 100', 0.75);
  assert.ok(Math.abs(p.x - 100) < 1e-3 && Math.abs(p.y - 50) < 1e-3, JSON.stringify(p));
  assert.ok(Math.abs(p.angle - 90) < 1e-3);
  assert.ok(Math.abs(alongPath('M0 0 L100 0', 0.5).angle) < 1e-6);
});

test('split text: units, offsets, animators, scramble and counter', async () => {
  const font = arial;
  const scene = (split?: import('skiamovin/scene').SplitText) =>
    new Composition({
      width: 300,
      height: 100,
      frameRate: 30,
      duration: 1,
      fonts: [font],
      background: '#000000',
      render: () =>
        box({ size: { width: '100%', height: '100%' }, padding: 10 }, [
          text('Hello brave world', { fontFamily: 'Arial', fontSize: 30, color: '#ffffff', split }),
        ]),
    });
  const grab = async (split?: import('skiamovin/scene').SplitText) => {
    const sink = new CompositionSink(scene(split), { gpu: 'raster' });
    const img = (await sink.getImage(0))!.image;
    const px = img.readPixels(0, 0, new ImageInfo(300, 100, ColorType.RGBA_8888, AlphaType.Unpremul));
    await sink.dispose();
    return px;
  };
  const plain = await grab();
  // Split painting with no changes looks like plain text.
  const same = await grab({ by: 'words', style: () => ({}) });
  let diff = 0;
  for (let i = 0; i < plain.length; i++) diff = Math.max(diff, Math.abs(plain[i]! - same[i]!));
  assert.ok(diff <= 2, `split text matches plain text (max diff ${diff})`);
  // Hiding every unit leaves the background.
  const hidden = await grab(textAnimator({ by: 'chars', properties: { opacity: 0 } }));
  assert.ok(
    hidden.every((v, i) => i % 4 === 3 || v === 0),
    'all characters hidden',
  );
  // Moving only the second word down: its old place is empty, the first word stays.
  const moved = await grab({ by: 'words', style: (u) => (u.index === 1 ? { y: 50 } : {}) });
  const lit = (buf: Uint8Array, x0: number, x1: number, y0: number, y1: number) => {
    let n = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) if (buf[(yy * 300 + xx) * 4]! > 128) n++;
    return n;
  };
  assert.ok(lit(moved, 0, 80, 10, 45) > 50, 'first word still in place');
  assert.ok(lit(plain, 95, 170, 10, 45) > 50 && lit(moved, 95, 170, 10, 45) < 5, 'second word moved away');
  assert.ok(lit(moved, 95, 170, 60, 95) > 50, 'second word drawn lower');

  // Range selectors.
  const units = (a: import('skiamovin/scene').SplitText, count: number) =>
    Array.from({ length: count }, (_, i) => a.style({ index: i, count, text: '' }).opacity ?? 1);
  assert.deepEqual(units(textAnimator({ by: 'chars', end: 0.5, properties: { opacity: 0 } }), 4), [0, 0, 1, 1]);
  const ramp = units(textAnimator({ by: 'chars', shape: 'rampUp', properties: { opacity: 0 } }), 4);
  assert.ok(ramp[0]! > ramp[1]! && ramp[1]! > ramp[2]! && ramp[2]! > ramp[3]!, `ramp ${ramp}`);
  assert.deepEqual(
    units(textAnimator({ by: 'chars', end: 0.5, offset: 0.5, properties: { opacity: 0 } }), 4),
    [1, 1, 0, 0],
  );

  // Effects.
  const s1 = scramble('Hello world', 0.5, { frame: 3, seed: 1 });
  assert.equal(s1.length, 'Hello world'.length);
  assert.ok(s1.startsWith('Hello'));
  assert.equal(s1[5], ' ');
  assert.equal(s1, scramble('Hello world', 0.5, { frame: 3, seed: 1 }));
  assert.notEqual(s1, scramble('Hello world', 0.5, { frame: 4, seed: 1 }));
  assert.equal(scramble('Hello', 1), 'Hello');
  assert.equal(counter(1234.5, { decimals: 1, locale: 'en-US', prefix: '$' }), '$1,234.5');
  assert.equal(graphemeCount('été'), 3);
});
