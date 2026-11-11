// 20 — Beat visualizer: detected beats pulse a radial pattern of petals and a field of scattered sparks.
import {
  analyzeAudio,
  audio,
  beatAt,
  box,
  Composition,
  interpolateColor,
  path,
  pulse,
  radial,
  scatter,
  text,
} from 'skiamovin/scene';
import { fonts, input } from './shared.ts';

const music = input('score.wav');
const analysis = await analyzeAudio(music, { frameRate: 30 });
const SPARKS = scatter(140, { area: { width: 1920, height: 1080 }, spacing: 60, seed: 'sparks' });
const PETAL = 'M0 0 C60 -90 60 -200 0 -300 C-60 -200 -60 -90 0 0 Z';

export default new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 10,
  fonts: [fonts.sf],
  render: ({ timestamp: t }) => {
    const beat = pulse(analysis.beats, t, 0.3);
    const { index } = beatAt(analysis.beats, t);
    const hue = (index % 4) / 4;
    const color = interpolateColor(hue, [0, 0.25, 0.5, 0.75], ['#f472b6', '#a78bfa', '#38bdf8', '#34d399']);
    return box({ size: { width: '100%', height: '100%' }, background: '#05010d' }, [
      audio(music),
      ...SPARKS.map((p) =>
        box({
          position: 'absolute',
          inset: { left: p.x, top: p.y },
          size: { width: 4, height: 4 },
          borderRadius: 2,
          background: '#ffffff',
          opacity: 0.15 + 0.85 * beat * p.random,
          transform: { scale: 1 + beat * 2 * p.random },
        }),
      ),
      box(
        {
          position: 'absolute',
          inset: 0,
          transformOrigin: [960, 540],
          transform: [{ rotate: t * 12 }, { scale: 0.9 + beat * 0.15 }],
        },
        radial(12, [960, 540], (i) =>
          box({ position: 'absolute', inset: { left: 960, top: 540 } }, [
            path(PETAL, {
              fill: color,
              opacity: 0.35 + 0.4 * (i % 2),
              blendMode: 'screen',
            }),
          ]),
        ),
      ),
      box({ position: 'absolute', inset: { left: 0, right: 0, bottom: 70 }, alignItems: 'center' }, [
        text(`${Math.round(analysis.tempo)} BPM · beat ${index + 1}`, {
          fontFamily: 'SF Pro',
          fontSize: 34,
          color: '#cbd5e1',
          fontFeatures: { tnum: 1 },
        }),
      ]),
    ]);
  },
});
