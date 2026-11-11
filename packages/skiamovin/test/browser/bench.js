// Browser benchmarks: export speed (Render → WebCodecs) and live preview speed (Player).

import { BufferTarget, canEncodeVideo, Mp4OutputFormat, Output, UrlSource } from 'mediabunny';
import { init } from 'skiamovin';
import {
  box,
  Composition,
  FontAsset,
  interpolate,
  linearGradient,
  Player,
  Render,
  random,
  spring,
  text,
} from 'skiamovin/scene';

const font = new FontAsset(new UrlSource('/fonts/Arial.ttf'), { family: 'Arial' });

/** A typical motion-graphics scene: gradient, 40 animated shapes, text. */
export const scene = (width, height) =>
  new Composition({
    width,
    height,
    frameRate: 60,
    duration: 2,
    fonts: [font],
    render: ({ timestamp }) =>
      box(
        {
          size: { width: '100%', height: '100%' },
          background: linearGradient(135, ['#0f172a', '#312e81']),
          justifyContent: 'center',
          alignItems: 'center',
        },
        [
          ...Array.from({ length: 40 }, (_, i) =>
            box({
              position: 'absolute',
              inset: { left: random(`x${i}`) * (width - 80), top: random(`y${i}`) * (height - 80) },
              size: { width: 80, height: 80 },
              borderRadius: 40,
              background: `hsl(${i * 9}, 80%, 60%)`,
              transform: {
                translateY: Math.sin(timestamp * 3 + i) * 30,
                scale: spring({ timestamp, delay: i * 0.02 }),
              },
            }),
          ),
          text('Skiamovin in the browser', {
            fontFamily: 'Arial',
            fontSize: Math.round(width / 16),
            color: '#ffffff',
            opacity: interpolate(timestamp, [0, 0.5], [0, 1]),
          }),
        ],
      ),
  });

window.benchExport = async (width = 1920, height = 1080, gpu = 'auto') => {
  await init();
  const codec = (await canEncodeVideo('avc', { width, height })) ? 'avc' : 'vp9';
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const tInit = performance.now();
  const render = await Render.init({ composition: scene(width, height), output, video: { codec }, gpu });
  const t0 = performance.now();
  await render.execute();
  const ms = performance.now() - t0;
  const s = render.stats;
  return {
    width,
    height,
    codec,
    backend: render.utilizedBackend,
    frames: s.frames,
    ms: Math.round(ms),
    totalMs: Math.round(performance.now() - tInit),
    fps: +(s.frames / (ms / 1000)).toFixed(1),
    renderMsPerFrame: +(s.renderMs / s.frames).toFixed(2),
    encodeMsPerFrame: +(s.encodeMs / s.frames).toFixed(2),
    bytes: output.target.buffer.byteLength,
  };
};

window.benchPlayer = async (width = 1920, height = 1080, seconds = 2) => {
  await init();
  const canvas = document.getElementById('preview');
  const player = new Player(scene(width, height), { canvas, loop: true });
  let frames = 0;
  player.onTimeUpdate = () => frames++;
  await player.play();
  frames = 0;
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  const fps = frames / ((performance.now() - t0) / 1000);
  // Main-thread responsiveness: longest gap between timer ticks during playback.
  let worst = 0,
    last = performance.now();
  await new Promise((resolve) => {
    const id = setInterval(() => {
      const now = performance.now();
      worst = Math.max(worst, now - last);
      last = now;
    }, 10);
    setTimeout(() => {
      clearInterval(id);
      resolve();
    }, 1000);
  });
  player.dispose();
  return { width, height, fps: +fps.toFixed(1), worstMainThreadStallMs: Math.round(worst) };
};
window.benchReady = true;
