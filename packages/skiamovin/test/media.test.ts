import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  Conversion,
  canEncodeAudio,
  canEncodeVideo,
  FilePathSource,
  FilePathTarget,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
} from 'mediabunny';
import { AlphaType, ColorType, gpu, ImageInfo, init, Paint, Rect } from 'skiamovin';
import {
  ImageSink,
  imageFromVideoSample,
  nativeCodecSupport,
  SurfaceSource,
  videoSampleFromSurface,
} from 'skiamovin/media';
import { OUT, prepareTestMedia } from './fixtures/media.ts';

prepareTestMedia();
const ffprobe = (file: string, entries: string) =>
  execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'json', file], { encoding: 'utf8' });

const W = 320,
  H = 180,
  FPS = 30,
  FRAMES = 60;
const COLORS = ['#ff0000', '#00ff00', '#0000ff'];
const colorAt = (i: number) => COLORS[Math.floor(i / 20)]!;

test('native codecs are registered with mediabunny', async () => {
  await init();
  const s = nativeCodecSupport();
  assert.ok(s.videoEncode.includes('avc'));
  assert.ok(await canEncodeVideo('avc', { width: W, height: H }));
  assert.ok(await canEncodeAudio('aac'));
});

test('SurfaceSource: Metal surface → H.264 MP4 → ImageSink round trip', async () => {
  const ctx = gpu.directContexts.makeDefault()!;
  const surface = gpu.surfaces.renderTarget(ctx, gpu.Budgeted.Yes, ImageInfo.newN32Premul([W, H]))!;
  const canvas = surface.canvas();
  const file = `${OUT}media-surface.mp4`;
  const output = new Output({ format: new Mp4OutputFormat(), target: new FilePathTarget(file) });
  const source = new SurfaceSource(surface, { codec: 'avc', bitrate: QUALITY_HIGH });
  output.addVideoTrack(source, { frameRate: FPS });
  await output.start();
  const box = new Paint('#ffffff');
  for (let i = 0; i < FRAMES; i++) {
    canvas.clear(colorAt(i));
    canvas.drawRect(Rect.fromXYWH(i * 4, 70, 40, 40), box);
    await source.add(i / FPS, 1 / FPS);
  }
  source.close();
  await output.finalize();

  const probe = JSON.parse(ffprobe(file, 'stream=codec_name,width,height,nb_frames,avg_frame_rate'));
  assert.equal(probe.streams[0].codec_name, 'h264');
  assert.equal(probe.streams[0].width, W);
  assert.equal(Number(probe.streams[0].nb_frames), FRAMES);

  const input = new Input({ formats: ALL_FORMATS, source: new FilePathSource(file) });
  const track = (await input.getPrimaryVideoTrack())!;
  assert.ok(await track.canDecode());
  assert.ok(Math.abs((await input.computeDuration()) - 2) < 0.05);
  const sink = new ImageSink(track, { poolSize: 2 });
  let n = 0;
  for await (const { image, timestamp } of sink.images()) {
    const i = Math.round(timestamp * FPS);
    const [r, g, b] = image.readPixels(5, 5, new ImageInfo(1, 1, ColorType.RGBA_8888, AlphaType.Unpremul));
    const want = colorAt(i);
    const expected = [parseInt(want.slice(1, 3), 16), parseInt(want.slice(3, 5), 16), parseInt(want.slice(5, 7), 16)];
    for (let k = 0; k < 3; k++)
      assert.ok(Math.abs([r, g, b][k]! - expected[k]!) < 24, `frame ${i}: ${[r, g, b]} vs ${expected}`);
    image.delete();
    n++;
  }
  assert.equal(n, FRAMES);
  // Random access through getImage
  const mid = await new ImageSink(track, { width: 160, height: 90 }).getImage(1.0);
  assert.equal(mid!.image.width(), 160);
  input.dispose();
});

test('videoSampleFromSurface / imageFromVideoSample', async () => {
  const ctx = gpu.directContexts.makeDefault()!;
  const s = gpu.surfaces.renderTarget(ctx, gpu.Budgeted.Yes, ImageInfo.newN32Premul([8, 8]))!;
  s.canvas().clear('#123456');
  const sample = videoSampleFromSurface(s, { timestamp: 1, duration: 0.5 });
  assert.equal(sample.codedWidth, 8);
  assert.equal(sample.timestamp, 1);
  const buf = new Uint8Array(sample.allocationSize());
  await sample.copyTo(buf);
  assert.deepEqual([...buf.slice(0, 4)], [0x12, 0x34, 0x56, 255]);
  const img = await imageFromVideoSample(sample);
  assert.deepEqual([...img.readPixels(0, 0, new ImageInfo(1, 1, 0, 3))], [0x12, 0x34, 0x56, 255]);
  sample.close();
});

test('AAC audio: encode a sine, decode it back', async () => {
  const file = `${OUT}media-audio.mp4`;
  const output = new Output({ format: new Mp4OutputFormat(), target: new FilePathTarget(file) });
  const src = new AudioSampleSource({ codec: 'aac', bitrate: 128_000 });
  output.addAudioTrack(src);
  await output.start();
  const sr = 48000,
    secs = 2,
    chunk = 4800;
  for (let off = 0; off < sr * secs; off += chunk) {
    const data = new Float32Array(chunk * 2);
    for (let i = 0; i < chunk; i++)
      data[i * 2] = data[i * 2 + 1] = 0.5 * Math.sin((2 * Math.PI * 440 * (off + i)) / sr);
    const s = new AudioSample({ data, format: 'f32', numberOfChannels: 2, sampleRate: sr, timestamp: off / sr });
    await src.add(s);
    s.close();
  }
  src.close();
  await output.finalize();
  const probe = JSON.parse(ffprobe(file, 'stream=codec_name,sample_rate,channels'));
  assert.equal(probe.streams[0].codec_name, 'aac');

  const input = new Input({ formats: ALL_FORMATS, source: new FilePathSource(file) });
  const track = (await input.getPrimaryAudioTrack())!;
  let frames = 0,
    energy = 0;
  for await (const s of new AudioSampleSink(track).samples()) {
    const buf = new Float32Array(s.numberOfFrames);
    s.copyTo(buf, { planeIndex: 0, format: 'f32-planar' });
    frames += s.numberOfFrames;
    for (const v of buf) energy += v * v;
    s.close();
  }
  assert.ok(Math.abs(frames - sr * secs) < 4096, `frames ${frames}`);
  const rms = Math.sqrt(energy / frames);
  assert.ok(rms > 0.3 && rms < 0.4, `rms ${rms}`); // 0.5 amplitude sine → ~0.354
  input.dispose();
});

test('mediabunny Conversion uses native codecs (H.264 → HEVC)', async () => {
  const input = new Input({ formats: ALL_FORMATS, source: new FilePathSource(`${OUT}media-surface.mp4`) });
  const out = `${OUT}media-hevc.mp4`;
  const conversion = await Conversion.init({
    input,
    output: new Output({ format: new Mp4OutputFormat(), target: new FilePathTarget(out) }),
    video: { codec: 'hevc', forceTranscode: true },
  });
  assert.ok(conversion.isValid, JSON.stringify(conversion.discardedTracks));
  await conversion.execute();
  const probe = JSON.parse(ffprobe(out, 'stream=codec_name,nb_frames'));
  assert.equal(probe.streams[0].codec_name, 'hevc');
  assert.equal(Number(probe.streams[0].nb_frames), FRAMES);
  input.dispose();
});

test('zero-copy: IOSurface-backed surfaces go straight to VideoToolbox', async () => {
  await init();
  const ctx = gpu.directContexts.makeDefault()!;
  const surface = gpu.surfaces.renderTarget(ctx, gpu.Budgeted.Yes, ImageInfo.newN32Premul([W, H]), {
    encoderCompatible: true,
  })!;
  assert.ok(surface.isEncoderCompatible(), 'IOSurface-backed render target');
  const file = `${OUT}media-zero-copy.mp4`;
  const output = new Output({ format: new Mp4OutputFormat(), target: new FilePathTarget(file) });
  const source = new SurfaceSource(surface, { codec: 'avc', bitrate: QUALITY_HIGH });
  output.addVideoTrack(source, { frameRate: FPS });
  await output.start();
  for (let i = 0; i < FRAMES; i++) {
    surface.canvas().clear(colorAt(i));
    await source.add(i / FPS, 1 / FPS);
  }
  source.close();
  await output.finalize();
  const input = new Input({ formats: ALL_FORMATS, source: new FilePathSource(file) });
  let n = 0;
  for await (const { image, timestamp } of new ImageSink((await input.getPrimaryVideoTrack())!).images()) {
    const want = colorAt(Math.round(timestamp * FPS));
    const [r, g, b] = image.readPixels(5, 5, new ImageInfo(1, 1, ColorType.RGBA_8888, AlphaType.Unpremul));
    const exp = [1, 3, 5].map((k) => parseInt(want.slice(k, k + 2), 16));
    assert.ok(
      [r, g, b].every((v, k) => Math.abs(v! - exp[k]!) < 24),
      `frame ${n}: ${[r, g, b]} vs ${exp}`,
    );
    image.delete();
    n++;
  }
  assert.equal(n, FRAMES);
  input.dispose();
});
