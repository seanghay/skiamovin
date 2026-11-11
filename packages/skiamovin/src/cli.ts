#!/usr/bin/env node
// The `skiamovin` command: render videos and stills, inspect compositions as JSON, and report what this machine
// supports.
import { writeFileSync } from 'node:fs';
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
import { EncodedImageFormat, gpu, init, version } from './index.ts';
import { type Composition, CompositionModule } from './scene/composition.ts';
import { deliveryPresets } from './scene/loudness.ts';
import type { SceneNode } from './scene/nodes.ts';
import { CompositionSink, Render } from './scene/render.ts';
import { FrameRenderer } from './scene/renderer.ts';

const HELP = `skiamovin <command>

  render <module> <out> [--props JSON] [--export NAME] [--codec avc|hevc|vp9|av1] [--preset youtube|instagram|
         tiktok|broadcast] [--loudness LUFS] [--start S] [--end S] [--concurrency N|auto]
  still <module> <out.png|.jpg|.webp> [--timestamp S] [--props JSON] [--export NAME]
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
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, file, out] = positionals;
  if (values.help || !command) {
    process.stdout.write(HELP);
    return command ? 0 : 1;
  }
  if (!['render', 'still', 'inspect', 'info'].includes(command))
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

  if (command === 'render') {
    const preset = values.preset ? deliveryPresets[values.preset as keyof typeof deliveryPresets] : undefined;
    if (values.preset && !preset) throw new Error(`render: unknown preset '${values.preset}'`);
    const output = new Output({ format: formatFor(out), target: new FilePathTarget(out) });
    const render = await Render.init({
      composition: module,
      output,
      props,
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
      if (pct !== shown && process.stderr.isTTY) process.stderr.write(`\r${pct}%`);
      shown = pct;
    };
    await render.execute();
    if (process.stderr.isTTY) process.stderr.write('\r');
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
