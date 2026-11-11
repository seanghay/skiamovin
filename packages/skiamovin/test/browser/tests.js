// Runs inside the browser. Each test returns details; failures throw.

import {
  ALL_FORMATS,
  AudioSampleSink,
  BufferSource,
  BufferTarget,
  canEncodeVideo,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  UrlSource,
  WebMOutputFormat,
} from 'mediabunny';
import {
  EncodedImageFormat,
  FontMgr,
  gpu,
  Image,
  ImageInfo,
  init,
  Paint,
  Rect,
  surfaces,
  textlayout,
  version,
} from 'skiamovin';
import { ImageSink, SurfaceSource } from 'skiamovin/media';
import {
  audio,
  box,
  Composition,
  CompositionModule,
  CompositionSink,
  FontAsset,
  interpolate,
  linearGradient,
  Player,
  Render,
  spring,
  text,
  video,
} from 'skiamovin/scene';
import { TaffyTree } from 'skiamovin/taffy';

const assert = (cond, msg) => {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
};
const px = (s, x, y) => [...s.readPixels(x, y, new ImageInfo(1, 1, 0, 3))];
const near = (a, b, tol = 8) => b.every((v, i) => Math.abs(a[i] - v) <= tol);

const tests = {
  async init() {
    await init();
    const v = version();
    assert(v.runtime === 'wasm', 'runtime is wasm');
    return v;
  },

  async raster() {
    const s = surfaces.rasterN32Premul([64, 64]);
    const c = s.canvas();
    c.clear('#000000');
    c.drawCircle([32, 32], 16, new Paint('#ff0000').setAntiAlias(true));
    assert(near(px(s, 32, 32), [255, 0, 0, 255]), 'red circle');
    const png = s.encodeToData(EncodedImageFormat.PNG);
    const img = Image.fromEncoded(png);
    assert(img.width() === 64, 'png round trip');
    return { png: png.length };
  },

  async webgl() {
    const info = gpu.info();
    assert(info.backend === 'webgl2', `backend ${info.backend}`);
    const ctx = gpu.directContexts.makeDefault();
    assert(ctx, 'WebGL2 context');
    const s = gpu.surfaces.renderTarget(ctx, gpu.Budgeted.Yes, ImageInfo.newN32Premul([64, 64]), { sampleCount: 1 });
    assert(s?.isGpu(), 'gpu surface');
    s.canvas().clear('#00ff00');
    s.canvas().drawRect(Rect.fromXYWH(0, 0, 16, 16), new Paint('#0000ff'));
    assert(near(px(s, 40, 40), [0, 255, 0, 255]), 'gpu clear');
    assert(near(px(s, 8, 8), [0, 0, 255, 255]), 'gpu rect');
    return { backend: ctx.backend() };
  },

  async text() {
    const bytes = new Uint8Array(await (await fetch('/fonts/Arial.ttf')).arrayBuffer());
    const tf = FontMgr.default().newFromData(bytes);
    assert(tf, 'font loaded');
    const provider = new textlayout.TypefaceFontProvider();
    provider.registerTypeface(tf, 'Arial');
    const fc = new textlayout.FontCollection();
    fc.setAssetFontManager(provider);
    fc.setDefaultFontManager(FontMgr.default());
    const style = new textlayout.TextStyle().setFontFamilies(['Arial']).setFontSize(32).setColor('#ffffff');
    const p = new textlayout.ParagraphBuilder(new textlayout.ParagraphStyle().setTextStyle(style), fc)
      .addText('Hello from WebAssembly')
      .build();
    p.layout(200);
    assert(p.lineNumber() >= 2, 'wraps');
    return { height: p.height(), lines: p.lineNumber() };
  },

  async taffy() {
    const t = new TaffyTree();
    const a = t.newLeaf({ flexGrow: 1 });
    const r = t.newWithChildren({ size: { width: 100, height: 50 }, padding: 5 }, [a]);
    t.computeLayout(r);
    assert(t.layout(a).size.width === 90, 'flex grow');
    return t.layout(a);
  },

  async surfaceSourceWebCodecs() {
    const codec = (await canEncodeVideo('avc', { width: 320, height: 180 })) ? 'avc' : 'vp9';
    const ctx = gpu.directContexts.makeDefault();
    const s = gpu.surfaces.renderTarget(ctx, gpu.Budgeted.Yes, ImageInfo.newN32Premul([320, 180]));
    const target = new BufferTarget();
    const output = new Output({ format: codec === 'avc' ? new Mp4OutputFormat() : new WebMOutputFormat(), target });
    const src = new SurfaceSource(s, { codec, bitrate: QUALITY_HIGH });
    output.addVideoTrack(src, { frameRate: 30 });
    await output.start();
    for (let i = 0; i < 30; i++) {
      s.canvas().clear(i < 15 ? '#ff0000' : '#0000ff');
      await src.add(i / 30, 1 / 30);
    }
    src.close();
    await output.finalize();
    const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(target.buffer) });
    const track = await input.getPrimaryVideoTrack();
    let n = 0;
    let last = null;
    for await (const { image, timestamp } of new ImageSink(track).images()) {
      n++;
      if (timestamp > 0.8) last = px(image, 10, 10);
      image.delete();
    }
    assert(n === 30, `frames ${n}`);
    assert(near(last, [0, 0, 255], 30), `decoded color ${last}`);
    return { codec, bytes: target.buffer.byteLength };
  },

  async renderComposition() {
    const arial = new FontAsset(new UrlSource('/fonts/Arial.ttf'), { family: 'Arial' });
    const clip = new Input({ formats: ALL_FORMATS, source: new UrlSource('/out/clip.mp4') });
    const tone = new Input({ formats: ALL_FORMATS, source: new UrlSource('/out/tone.mp3') });
    const comp = new Composition({
      width: 640,
      height: 360,
      frameRate: 30,
      duration: 2,
      fonts: [arial],
      render: ({ timestamp }) =>
        box(
          {
            size: { width: '100%', height: '100%' },
            background: linearGradient(135, ['#0f172a', '#312e81']),
            justifyContent: 'center',
            alignItems: 'center',
          },
          [
            video(clip, {
              position: 'absolute',
              inset: { left: 20, top: 20 },
              size: { width: 320, height: 180 },
              borderRadius: 16,
              muted: true,
            }),
            audio(tone, { volume: (t) => interpolate(t, [0, 0.5], [0, 1]) }),
            text('Rendered in the browser', {
              fontFamily: 'Arial',
              fontSize: 40,
              color: '#ffffff',
              opacity: spring({ timestamp }),
              transform: { translateY: 100 },
            }),
          ],
        ),
    });
    const target = new BufferTarget();
    const codec = (await canEncodeVideo('avc', { width: 640, height: 360 })) ? 'avc' : 'vp9';
    const render = await Render.init({
      composition: comp,
      output: new Output({ format: codec === 'avc' ? new Mp4OutputFormat() : new WebMOutputFormat(), target }),
    });
    assert(render.isValid, JSON.stringify(render.discardedTracks));
    const progress = [];
    render.onProgress = (p) => progress.push(p);
    const t0 = performance.now();
    await render.execute();
    const ms = performance.now() - t0;
    const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(target.buffer) });
    const v = await input.getPrimaryVideoTrack();
    const a = await input.getPrimaryAudioTrack();
    assert(v && a, 'video and audio tracks');
    const dur = await input.computeDuration();
    assert(Math.abs(dur - 2) < 0.1, `duration ${dur}`);
    const frame = (await new ImageSink(v).getImage(1.0)).image;
    const pngBytes = frame.encodeToData();
    let audioFrames = 0;
    for await (const s of new AudioSampleSink(a).samples()) {
      audioFrames += s.numberOfFrames;
      s.close();
    }
    assert(audioFrames > 80000, `audio frames ${audioFrames}`);
    return {
      codec,
      audioCodec: a.codec,
      backend: render.utilizedBackend,
      ms: Math.round(ms),
      fps: +(60 / (ms / 1000)).toFixed(1),
      bytes: target.buffer.byteLength,
      framePng: btoa(String.fromCharCode(...pngBytes)),
      audioFrames,
    };
  },

  async compositionSink() {
    const comp = new Composition({
      width: 100,
      height: 100,
      frameRate: 10,
      duration: 1,
      render: ({ timestamp }) =>
        box({ size: { width: '100%', height: '100%' }, background: timestamp < 0.5 ? '#ff0000' : '#00ff00' }),
    });
    const sink = new CompositionSink(comp);
    const a = (await sink.getImage(0.1)).image;
    const b = (await sink.getImage(0.9)).image;
    assert(near(px(a, 50, 50), [255, 0, 0]) && near(px(b, 50, 50), [0, 255, 0]), 'sink frames');
    return true;
  },

  async player() {
    const canvas = document.getElementById('preview');
    const comp = new Composition({
      width: 160,
      height: 90,
      frameRate: 30,
      duration: 3,
      render: ({ timestamp }) =>
        box({ size: { width: '100%', height: '100%' }, background: '#000000' }, [
          box({ size: { width: 20, height: 20 }, background: '#ffff00', transform: { translateX: timestamp * 40 } }),
        ]),
    });
    const player = new Player(comp, { canvas });
    await player.play();
    await new Promise((r) => setTimeout(r, 600));
    const t = player.currentTime;
    player.pause();
    await player.seek(2);
    // Player presents through 'bitmaprenderer' (GPU) or '2d' (raster); read back via a 2D copy.
    const copy = new OffscreenCanvas(canvas.width, canvas.height).getContext('2d');
    copy.drawImage(canvas, 0, 0);
    const d = copy.getImageData(90, 10, 1, 1).data;
    player.dispose();
    assert(t > 0.2, `played to ${t}`);
    assert(near([...d], [255, 255, 0], 10), `seek renders frame at 2s: ${[...d]}`);
    return { playedTo: t };
  },
};

const SCENES = new URL('./fixtures/scenes.js', import.meta.url);

/** Plays, seeks to 2 s and reads the pixel the moving box covers then. */
async function checkPlayer(player, canvas) {
  await player.ready;
  await player.play();
  await new Promise((r) => setTimeout(r, 600));
  const t = player.currentTime;
  player.pause();
  await player.seek(2);
  const copy = new OffscreenCanvas(canvas.width, canvas.height).getContext('2d');
  copy.drawImage(canvas, 0, 0);
  const d = copy.getImageData(90, 10, 1, 1).data;
  const backend = player.backend;
  player.dispose();
  assert(t > 0.2, `played to ${t}`);
  assert(near([...d], [255, 255, 0], 10), `seek renders frame at 2s: ${[...d]}`);
  return { playedTo: t, backend };
}

/** Longest gap between 4 ms timer ticks while `fn` runs: how blocked the main thread was. */
async function mainThreadStall(fn) {
  let last = performance.now(),
    worst = 0;
  const iv = setInterval(() => {
    const n = performance.now();
    worst = Math.max(worst, n - last);
    last = n;
  }, 4);
  try {
    const result = await fn();
    return { result, worstStallMs: Math.round(worst) };
  } finally {
    clearInterval(iv);
  }
}

async function exportBusy(options) {
  const target = new BufferTarget();
  const render = await Render.init({ output: new Output({ format: new Mp4OutputFormat(), target }), ...options });
  assert(render.isValid, JSON.stringify(render.discardedTracks));
  const progress = [];
  render.onProgress = (p) => progress.push(p);
  const { worstStallMs } = await mainThreadStall(() => render.execute());
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(target.buffer) });
  const v = await input.getPrimaryVideoTrack();
  const a = await input.getPrimaryAudioTrack();
  assert(v && a, 'video and audio tracks');
  const dur = await input.computeDuration();
  assert(Math.abs(dur - 2) < 0.1, `duration ${dur}`);
  const pixel = async (t) => {
    const img = (await new ImageSink(v).getImage(t)).image;
    const s = surfaces.rasterN32Premul([img.width(), img.height()]);
    s.canvas().drawImage(img, [0, 0]);
    return px(s, 10, 10);
  };
  const early = await pixel(0.5),
    late = await pixel(1.5);
  assert(near(early, [0, 255, 0], 40) && near(late, [255, 0, 0], 40), `corner colors ${early} / ${late}`);
  assert(progress.length > 0 && Math.abs(progress.at(-1) - 1) < 1e-6, `progress ends at 1: ${progress.at(-1)}`);
  return { worstStallMs, workers: render.stats?.workers, ms: Math.round(render.stats?.totalMs ?? 0) };
}

tests.playerWorkerModule = async () => {
  const canvas = document.getElementById('preview');
  const fresh = canvas.cloneNode();
  canvas.replaceWith(fresh);
  fresh.id = 'preview';
  const player = new Player(new CompositionModule(SCENES, 'movingBox'), { canvas: fresh });
  assert(player.inWorker, 'renders in a worker');
  return checkPlayer(player, fresh);
};

tests.playerWorkerFactory = async () => {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const { movingBox } = await import(SCENES.href);
  const player = new Player(movingBox, {
    canvas,
    worker: () => new Worker(new URL('./fixtures/scenes.worker.js', import.meta.url), { type: 'module' }),
  });
  const r = await checkPlayer(player, canvas);
  canvas.remove();
  return r;
};

tests.renderWorker = async () => {
  await init();
  const inWorker = await exportBusy({ composition: new CompositionModule(SCENES, 'busy') });
  assert(inWorker.workers === 1, `one worker: ${inWorker.workers}`);
  const twoWorkers = await exportBusy({
    composition: new CompositionModule(SCENES, 'busy'),
    concurrency: 2,
    video: { keyFrameInterval: 0.5 },
  });
  assert(twoWorkers.workers === 2, `two workers: ${twoWorkers.workers}`);
  const { busy } = await import(SCENES.href);
  const mainThread = await exportBusy({ composition: busy });
  return { inWorker, twoWorkers, mainThread };
};

window.runTest = async (name) => {
  try {
    return { ok: true, result: await tests[name]() };
  } catch (e) {
    return { ok: false, error: String(e?.stack ?? e) };
  }
};
window.testNames = Object.keys(tests);
window.ready = true;
