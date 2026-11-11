import { BufferTarget, Mp4OutputFormat, Output } from 'mediabunny';
import { Player, Render } from 'skiamovin/scene';
import { type PromoProps, promo } from './promo.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('preview');
const play = $<HTMLButtonElement>('play');
const scrub = $<HTMLInputElement>('scrub');
const time = $('time');
const status = $('status');
const exportBtn = $<HTMLButtonElement>('export');
const progress = $<HTMLProgressElement>('progress');
const result = $('result');
const download = $<HTMLButtonElement>('download');
const output = $<HTMLVideoElement>('output');

// One factory for the preview and for exports; Vite bundles the worker from this exact expression.
const worker = () => new Worker(new URL('./promo.worker.ts', import.meta.url), { type: 'module' });

const props = (): PromoProps => ({
  title: $<HTMLInputElement>('title').value,
  subtitle: $<HTMLInputElement>('subtitle').value,
  accent: $<HTMLInputElement>('accent').value,
  particles: Number($<HTMLInputElement>('particles').value),
});

const player = new Player(promo, { canvas, worker, props: { ...props() }, loop: true, scale: 0.5 });
player.onTimeUpdate = (t) => {
  time.textContent = `${t.toFixed(2)} s`;
  if (document.activeElement !== scrub) scrub.value = String(t);
};

const t0 = performance.now();
player.ready.then(
  async () => {
    scrub.max = String(await player.computeDuration());
    for (const el of [play, scrub, exportBtn]) el.disabled = false;
    status.textContent = `Ready in ${Math.round(performance.now() - t0)} ms · ${player.backend} · rendering in a worker`;
    (window as any).studioReady = true;
  },
  (e) => {
    status.textContent = `Failed: ${e}`;
    (window as any).studioError = String(e);
  },
);

play.onclick = async () => {
  if (player.playing) player.pause();
  else await player.play();
  play.textContent = player.playing ? 'Pause' : 'Play';
};
scrub.oninput = () => void player.seek(Number(scrub.value));
for (const id of ['title', 'subtitle', 'accent', 'particles'])
  $(id).addEventListener('input', () => void player.setProps({ ...props() }));

exportBtn.onclick = async () => {
  exportBtn.disabled = true;
  progress.hidden = false;
  progress.value = 0;
  download.hidden = output.hidden = true;
  result.textContent = 'Rendering…';
  const width = Number($<HTMLSelectElement>('size').value);
  const target = new BufferTarget();
  const t = performance.now();
  try {
    const render = await Render.init({
      composition: promo,
      worker,
      props: props(),
      output: new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target }),
      video: { codec: 'avc', width, height: Math.round((width * 9) / 16) },
    });
    if (!render.isValid) throw new Error(`can't export: ${JSON.stringify(render.discardedTracks)}`);
    render.onProgress = (p) => (progress.value = p);
    await render.execute();
    const secs = (performance.now() - t) / 1000;
    const frames = Math.round(render.duration * promo.frameRate);
    const blob = new Blob([target.buffer!], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    output.src = url;
    download.onclick = () =>
      Object.assign(document.createElement('a'), { href: url, download: 'skiamovin-promo.mp4' }).click();
    download.textContent = `Download (${(blob.size / 1e6).toFixed(1)} MB)`;
    download.hidden = output.hidden = false;
    result.textContent = `${frames} frames in ${secs.toFixed(2)} s (${(frames / secs).toFixed(0)} fps)`;
    (window as any).lastExport = { frames, seconds: secs, bytes: blob.size, width };
  } catch (e) {
    result.textContent = `Export failed: ${e}`;
    (window as any).lastExport = { error: String(e) };
  } finally {
    exportBtn.disabled = false;
    progress.hidden = true;
  }
};
