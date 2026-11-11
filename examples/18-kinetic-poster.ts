// 18 — Kinetic poster: outlined letters drawn on, a wave of font weight, a headline fitted to the width with the
// width axis, and a hand-drawn underline.
import { box, Composition, fitText, interpolate, path, stroke, textPaths, variableText } from 'skiamovin/scene';
import { fonts } from './shared.ts';

export default new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 7,
  background: '#fef3c7',
  fonts: [fonts.sf],
  render: ({ timestamp: t }) =>
    box(
      {
        size: { width: '100%', height: '100%' },
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 30,
      },
      [
        textPaths('MOTION', {
          fontFamily: 'SF Pro',
          fontSize: 220,
          fontWeight: 900,
          each: (g) => {
            const drawn = interpolate(t, [0.2 + g.index * 0.15, 1.4 + g.index * 0.15], [0, 1]);
            const filled = interpolate(t, [1.6 + g.index * 0.1, 2.2 + g.index * 0.1], [0, 1]);
            return [
              path(g.path, { fill: '#1e293b', opacity: filled }),
              path(g.path, { stroke: '#1e293b', strokeWidth: 4, fill: null, trim: { end: drawn } }),
            ];
          },
        }),
        box({ flexDirection: 'column', alignItems: 'center' }, [
          variableText('is just a function of time', (u) => ({ wght: 500 + 400 * Math.sin(t * 3 - u.index * 0.35) }), {
            fontFamily: 'SF Pro',
            fontSize: 72,
            color: '#b45309',
          }),
          stroke('M0 20 C200 0 500 40 760 14', {
            size: 10,
            taper: [30, 120],
            color: '#dc2626',
            draw: interpolate(t, [2.4, 3.4], [0, 1]),
          }),
        ]),
        fitText('PURE • DETERMINISTIC • FAST', {
          width: 1500,
          range: [30, 150],
          fontFamily: 'SF Pro',
          fontSize: 64,
          fontWeight: 700,
          color: '#1e293b',
          opacity: interpolate(t, [3.4, 4], [0, 1]),
        }),
      ],
    ),
});
