#!/usr/bin/env node
// The `skiamovin` command: render videos and stills, inspect compositions as JSON, and report what this machine
// supports.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  FilePathTarget,
  MkvOutputFormat,
  MovOutputFormat,
  Mp4OutputFormat,
  Output,
  type OutputFormat,
  type VideoCodec,
  WebMOutputFormat,
} from 'mediabunny';
import { EncodedImageFormat, gpu, init, surfaces, version } from './index.ts';
import { type Composition, CompositionModule } from './scene/composition.ts';
import { deliveryPresets } from './scene/loudness.ts';
import type { SceneNode } from './scene/nodes.ts';
import { CompositionSink, Render } from './scene/render.ts';
import { FrameRenderer } from './scene/renderer.ts';

const HELP = `skiamovin <command>

  render <module> <out> [--props JSON] [--export NAME] [--codec avc|hevc|vp9|av1] [--preset youtube|instagram|
         tiktok|broadcast] [--loudness LUFS] [--start S] [--end S] [--concurrency N|auto]
  still <module> <out.png|.jpg|.webp> [--timestamp S] [--props JSON] [--export NAME]
         [--variants FILE.json]  (one render per named set of props: out-<name>.mp4)
  sheet <module> <out.png> [--count N] [--columns N] [--width PX] [--props JSON]
         A contact sheet: frames spread over the video, in a grid. Prints the frame times as JSON.
  inspect <module> [--timestamp S] [--props JSON] [--export NAME]
         Prints the composition's settings and its node tree at a time, as JSON.
  info   Prints the version, GPU and codecs, as JSON.
`;

function formatFor(path: string): OutputFormat {
  const ext = path.toLowerCase().split('.').pop();
  if (ext === 'webm') return new WebMOutputFormat();
  if (ext === 'mov') return new MovOutputFormat();
  if (ext === 'mkv') return new MkvOutputFormat();
  return new Mp4OutputFormat();
}

/** A JSON-friendly summary of a node: its type, the style values that are plain data, text, and children. */
function describe(n: SceneNode): Record<string, unknown> {
  const style: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n.style)) {
    if (v === undefined || typeof v === 'function' || (typeof v === 'object' && v !== null && 'handle' in v)) continue;
    style[k] = v;
  }
  const out: Record<string, unknown> = { type: n.type };
  if (Object.keys(style).length) out.style = style;
  if (n.type === 'text') out.text = n.content.map((c) => (typeof c === 'string' ? c : c.text)).join('');
  if (n.type === 'box' && n.deferred) out.content = n.deferred.key.split(':')[0];
  if (n.children.length) out.children = n.children.map(describe);
  return out;
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      props: { type: 'string' },
      export: { type: 'string', default: 'default' },
      codec: { type: 'string' },
      preset: { type: 'string' },
      loudness: { type: 'string' },
      start: { type: 'string' },
      end: { type: 'string' },
      concurrency: { type: 'string' },
      timestamp: { type: 'string', default: '0' },
      variants: { type: 'string' },
      count: { type: 'string' },
      columns: { type: 'string' },
      width: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, file, out] = positionals;
  if (values.help || !command) {
    process.stdout.write(HELP);
    return command ? 0 : 1;
  }
  if (!['render', 'still', 'sheet', 'inspect', 'info'].includes(command))
    throw new Error(`unknown command '${command}'. Run skiamovin --help.`);
  await init();
  if (command === 'info') {
    process.stdout.write(`${JSON.stringify({ ...version(), gpu: gpu.info() }, null, 2)}\n`);
    return 0;
  }
  if (!file) throw new Error(`${command}: missing the composition module`);
  const module = new CompositionModule(pathToFileURL(resolve(file)), values.export);
  const comp: Composition<any> = await module.load();
  const props = values.props ? JSON.parse(values.props) : undefined;
  const t = Number(values.timestamp);

  if (command === 'inspect') {
    const renderer = new FrameRenderer(comp, { gpu: 'raster', props, width: 1, height: 1 });
    renderer.duration = await comp.computeDuration({ ...comp.defaultProps, ...props });
    const tree = renderer.buildTree(t).map(describe);
    const report = {
      width: comp.width,
      height: comp.height,
      frameRate: comp.frameRate,
      duration: renderer.duration,
      events: comp.events,
      fonts: await Promise.all(comp.fonts.map((f) => f.getFamilyName())),
      timestamp: t,
      tree,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    await renderer.dispose();
    return 0;
  }
  if (!out) throw new Error(`${command}: missing the output path`);

  if (command === 'still') {
    const sink = new CompositionSink(comp, { props });
    const frame = await sink.getImage(t);
    const ext = out.toLowerCase().split('.').pop();
    const format =
      ext === 'jpg' || ext === 'jpeg'
        ? EncodedImageFormat.JPEG
        : ext === 'webp'
          ? EncodedImageFormat.WEBP
          : EncodedImageFormat.PNG;
    const bytes = frame?.image.encodeToData(format, 92);
    await sink.dispose();
    if (!bytes) throw new Error('still: could not encode the frame');
    writeFileSync(out, bytes);
    return 0;
  }

  if (command === 'sheet') {
    // Frames spread evenly over the video, in a grid, so the whole video can be seen at a glance.
    const count = Math.max(1, Number(values.count ?? 12));
    const columns = Math.min(count, Number(values.columns ?? 4));
    const cellW = Number(values.width ?? 480);
    const cellH = Math.round((cellW * comp.height) / comp.width);
    const gap = 8;
    const rows = Math.ceil(count / columns);
    const surface = surfaces.rasterN32Premul([columns * cellW + (columns + 1) * gap, rows * cellH + (rows + 1) * gap]);
    if (!surface) throw new Error('sheet: could not allocate the image');
    const canvas = surface.canvas();
    canvas.clear('#111111');
    const sink = new CompositionSink(comp, { props, width: cellW, height: cellH });
    const duration = await comp.computeDuration({ ...comp.defaultProps, ...props });
    const times: number[] = [];
    for (let i = 0; i < count; i++) {
      const at = ((i + 0.5) / count) * duration;
      times.push(Math.round(at * 1000) / 1000);
      const frame = await sink.getImage(at);
      if (frame)
        canvas.drawImage(frame.image, [
          gap + (i % columns) * (cellW + gap),
          gap + Math.floor(i / columns) * (cellH + gap),
        ]);
    }
    await sink.dispose();
    const bytes = surface.imageSnapshot().encodeToData(EncodedImageFormat.PNG);
    surface.delete();
    if (!bytes) throw new Error('sheet: could not encode the image');
    writeFileSync(out, bytes);
    process.stdout.write(`${JSON.stringify({ columns, rows, times })}\n`);
    return 0;
  }

  if (command === 'render') {
    const preset = values.preset ? deliveryPresets[values.preset as keyof typeof deliveryPresets] : undefined;
    if (values.preset && !preset) throw new Error(`render: unknown preset '${values.preset}'`);
    // With --variants, render once per named set of props: out.mp4 becomes out-<name>.mp4.
    const variants: [string | null, unknown][] = values.variants
      ? Object.entries(JSON.parse(readFileSync(values.variants, 'utf8')) as Record<string, unknown>)
      : [[null, props]];
    for (const [name, variantProps] of variants) {
      const target = name === null ? out : out.replace(/(\.[^./]+)?$/, (ext) => `-${name}${ext}`);
      const output = new Output({ format: formatFor(target), target: new FilePathTarget(target) });
      const render = await Render.init({
        composition: module,
        output,
        props: variantProps as never,
        video: { ...preset?.video, ...(values.codec ? { codec: values.codec as VideoCodec } : {}) },
        audio: {
          ...preset?.audio,
          ...(values.loudness !== undefined ? { loudness: Number(values.loudness) } : {}),
        },
        trim: {
          ...(values.start !== undefined ? { start: Number(values.start) } : {}),
          ...(values.end !== undefined ? { end: Number(values.end) } : {}),
        },
        concurrency:
          values.concurrency === undefined || values.concurrency === 'auto' ? 'auto' : Number(values.concurrency),
      });
      if (!render.isValid)
        throw new Error(`render: can't render this output (${JSON.stringify(render.discardedTracks)})`);
      let shown = -1;
      render.onProgress = (p) => {
        const pct = Math.floor(p * 100);
        if (pct !== shown && process.stderr.isTTY) process.stderr.write(`\r${name ?? ''} ${pct}%`);
        shown = pct;
      };
      await render.execute();
      if (process.stderr.isTTY) process.stderr.write('\r');
    }
    return 0;
  }
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write(`skiamovin: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  },
);
