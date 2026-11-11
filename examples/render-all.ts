// Renders every sample and benchmarks it. Usage (repo root): node examples/render-all.ts [filter]
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { BufferTarget, FilePathTarget, Mp4OutputFormat, Output } from 'mediabunny';
import { gpu, init } from 'skiamovin';
import { type Composition, CompositionModule, Render } from 'skiamovin/scene';

await init();
const here = new URL('./', import.meta.url);
const filter = process.argv[2];
const samples = readdirSync(here)
  .filter((f) => /^\d\d-.*\.ts$/.test(f) && (!filter || f.includes(filter)))
  .sort();

type Run = {
  initMs: number;
  totalMs: number;
  fps: number;
  realtime: number;
  renderMs?: number;
  encodeMs?: number;
  workers: number;
  backend: string;
};
const rows: {
  name: string;
  size: string;
  duration: number;
  frames: number;
  bytes: number;
  metal: Run;
  raster: Run;
  parallel: Run;
}[] = [];

async function run(
  file: string,
  comp: Composition<any>,
  mode: 'metal' | 'raster' | 'parallel',
  outPath?: string,
): Promise<Run & { frames: number; duration: number }> {
  const t0 = performance.now();
  const r = await Render.init({
    composition: mode === 'parallel' ? new CompositionModule(new URL(file, here)) : comp,
    output: new Output({
      format: new Mp4OutputFormat(),
      target: outPath ? new FilePathTarget(outPath) : new BufferTarget(),
    }),
    gpu: mode === 'raster' ? 'raster' : 'auto',
    concurrency: mode === 'parallel' ? 3 : 1,
  });
  const initMs = performance.now() - t0;
  await r.execute();
  const s = r.stats!;
  return {
    initMs,
    totalMs: s.totalMs,
    fps: s.frames / (s.totalMs / 1000),
    realtime: r.duration / (s.totalMs / 1000),
    renderMs: s.renderMs / s.frames,
    encodeMs: s.encodeMs / s.frames,
    workers: s.workers,
    backend: r.utilizedBackend,
    frames: s.frames,
    duration: r.duration,
  };
}

console.log(`GPU: ${gpu.info().device} · CPU: ${cpus()[0]?.model} × ${cpus().length}\n`);
for (const file of samples) {
  const name = file.replace(/\.ts$/, '');
  const comp = (await import(new URL(file, here).href)).default as Composition<any>;
  const out = new URL(`output/${name}.mp4`, here).pathname;
  const metal = await run(file, comp, 'metal', out);
  const raster = await run(file, comp, 'raster');
  const parallel = await run(file, comp, 'parallel');
  const row = {
    name,
    size: `${comp.width}×${comp.height}`,
    duration: metal.duration,
    frames: metal.frames,
    bytes: statSync(out).size,
    metal,
    raster,
    parallel,
  };
  rows.push(row);
  console.log(
    `${name.padEnd(22)} ${row.size.padEnd(10)} ${metal.frames} frames | metal ${metal.fps.toFixed(0).padStart(4)} fps (${metal.realtime.toFixed(1)}× realtime, render ${metal.renderMs!.toFixed(1)}ms + encode ${metal.encodeMs!.toFixed(1)}ms/frame)` +
      ` | raster ${raster.fps.toFixed(0).padStart(4)} fps | 3 workers ${parallel.fps.toFixed(0).padStart(4)} fps`,
  );
}

const md = [
  '# Sample render benchmark',
  '',
  `Machine: ${gpu.info().device}, ${cpus()[0]?.model} (${cpus().length} cores), Node ${process.version}. Release build, H.264 (VideoToolbox) + AAC, MP4.`,
  '"Total" includes rendering, encoding, audio mixing and muxing; it excludes `Render.init` (asset loading, audio scheduling).',
  '',
  '| Sample | Size | Length | Frames | Metal fps | × realtime | Render ms/f | Encode ms/f | Raster fps | Metal ×3 workers fps | Init ms | File |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| ${r.name} | ${r.size} | ${r.duration.toFixed(1)} s | ${r.frames} | **${r.metal.fps.toFixed(0)}** | ${r.metal.realtime.toFixed(1)}× | ${r.metal.renderMs!.toFixed(1)} | ${r.metal.encodeMs!.toFixed(1)} | ${r.raster.fps.toFixed(0)} | ${r.parallel.fps.toFixed(0)} | ${r.metal.initMs.toFixed(0)} | ${(r.bytes / 1e6).toFixed(1)} MB |`,
  ),
  '',
  `Totals: ${rows.reduce((a, r) => a + r.frames, 0)} frames (${rows.reduce((a, r) => a + r.duration, 0).toFixed(1)} s of video) rendered in ${(rows.reduce((a, r) => a + r.metal.totalMs, 0) / 1000).toFixed(1)} s on Metal (1 thread).`,
];
writeFileSync(new URL('output/BENCHMARK.md', here), `${md.join('\n')}\n`);
writeFileSync(new URL('output/benchmark.json', here), JSON.stringify(rows, null, 2));
console.log(`\n${md.join('\n')}`);
