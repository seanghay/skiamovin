// Renders the launch film. Usage (repo root): node examples/launch/render.ts [workers]
import { FilePathTarget, Mp4OutputFormat, Output } from 'mediabunny';
import { CompositionModule, Render } from 'skiamovin/scene';

const workers = Number(process.argv[2] ?? 3);
const out = new URL('../output/skiamovin-launch.mp4', import.meta.url).pathname;
const t0 = performance.now();
const render = await Render.init({
  composition: new CompositionModule(new URL('./launch.ts', import.meta.url)),
  output: new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new FilePathTarget(out) }),
  video: { bitrate: 16_000_000, keyFrameInterval: 1 },
  audio: { bitrate: 256_000 },
  concurrency: workers,
});
const initMs = performance.now() - t0;
let last = -1;
render.onProgress = (p) => {
  const pct = Math.floor(p * 20);
  if (pct !== last) process.stdout.write(`\r${'█'.repeat(pct)}${'░'.repeat(20 - pct)} ${Math.round(p * 100)}%`);
  last = pct;
};
await render.execute();
const s = render.stats!;
console.log(
  `\n${out}\n${s.frames} frames (${render.duration}s @ 60fps) in ${(s.totalMs / 1000).toFixed(1)}s → ${(s.frames / (s.totalMs / 1000)).toFixed(0)} fps, ` +
    `${(render.duration / (s.totalMs / 1000)).toFixed(2)}× realtime, ${s.workers} worker(s), init ${initMs.toFixed(0)}ms, backend ${render.utilizedBackend}`,
);
