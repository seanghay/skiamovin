import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ALL_FORMATS, FilePathSource, FilePathTarget, Input, Mp4OutputFormat, Output } from 'mediabunny';
import { ImageInfo } from 'skiamovin';
import { ImageSink } from 'skiamovin/media';
import { CompositionModule, Render } from 'skiamovin/scene';

const OUT = fileURLToPath(new URL('../../../test-output/', import.meta.url));
const mod = new CompositionModule(new URL('./fixtures/ramp.ts', import.meta.url));

async function renderWith(concurrency: number, file: string): Promise<number> {
  const r = await Render.init({
    composition: mod,
    output: new Output({ format: new Mp4OutputFormat(), target: new FilePathTarget(file) }),
    concurrency,
    video: { keyFrameInterval: 1 },
  });
  let progress = 0;
  r.onProgress = (p) => (progress = p);
  const t0 = performance.now();
  await r.execute();
  assert.ok(Math.abs(progress - 1) < 1e-9, `progress ${progress}`);
  return performance.now() - t0;
}

test('concurrency: chunks join into one stream in frame order', async () => {
  const single = await renderWith(1, `${OUT}ramp-1.mp4`);
  const multi = await renderWith(3, `${OUT}ramp-3.mp4`);
  console.log(`  1 worker: ${(single / 1000).toFixed(2)}s, 3 workers: ${(multi / 1000).toFixed(2)}s`);
  const probe = JSON.parse(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-count_frames',
        '-show_entries',
        'stream=nb_read_frames,codec_name',
        '-of',
        'json',
        `${OUT}ramp-3.mp4`,
      ],
      { encoding: 'utf8' },
    ),
  );
  assert.equal(Number(probe.streams[0].nb_read_frames), 180);
  const input = new Input({ formats: ALL_FORMATS, source: new FilePathSource(`${OUT}ramp-3.mp4`) });
  const sink = new ImageSink((await input.getPrimaryVideoTrack())!);
  // Frames around the chunk boundaries (60, 120) and the ends.
  const frames = [0, 59, 60, 61, 119, 120, 121, 179];
  let i = 0;
  for await (const w of sink.imagesAtTimestamps(frames.map((f) => f / 30 + 0.001))) {
    const f = frames[i++]!;
    const [g] = w!.image.readPixels(1275, 715, new ImageInfo(1, 1, 0, 3));
    const want = Math.round((f / 179) * 255);
    assert.ok(Math.abs(g! - want) <= 6, `frame ${f}: gray ${g} vs ${want}`);
    w!.image.delete();
  }
  input.dispose();
});
