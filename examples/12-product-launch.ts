// 12 — Product launch: an aurora background, a glass card that springs in, a title card, soft shadows and motion
// blur.
import {
  backgrounds,
  box,
  Composition,
  Easing,
  interpolate,
  softShadow,
  spring,
  springs,
  text,
  titleCard,
} from 'skiamovin/scene';
import { fonts } from './shared.ts';

const FEATURES = ['Pure functions of time', 'Same pixels on Node and web', 'Physics, math and 3D built in'];

export default new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 8,
  fonts: [fonts.sf],
  motionBlur: { shutter: 180, samples: 6 },
  render: ({ timestamp: t }) => {
    const card = spring({ timestamp: t - 2.4, from: 0, to: 1, ...springs.bouncy });
    const titleOut = interpolate(t, [2, 2.6], [1, 0]);
    return box({ size: { width: '100%', height: '100%' } }, [
      backgrounds.aurora({ base: '#030712', colors: ['#38bdf8', '#c084fc'], speed: 0.6 }),
      box(
        {
          position: 'absolute',
          inset: 0,
          justifyContent: 'center',
          alignItems: 'center',
          opacity: titleOut,
          transform: { scale: 1 + (1 - titleOut) * 0.08 },
        },
        [titleCard('Skiamovin 1.0', 'Videos written in code', { time: t - 0.3, fontFamily: 'SF Pro' })],
      ),
      t > 2.2
        ? box({ position: 'absolute', inset: 0, justifyContent: 'center', alignItems: 'center' }, [
            box(
              {
                size: { width: 900 },
                padding: 56,
                borderRadius: 36,
                glass: { blur: 24, tint: 'rgba(255,255,255,0.08)' },
                shadow: softShadow(40, 'rgba(2,6,23,0.6)'),
                flexDirection: 'column',
                gap: 26,
                opacity: Math.min(1, card * 1.5),
                transform: [{ translateY: (1 - card) * 140 }, { scale: 0.9 + 0.1 * card }],
              },
              [
                text("What's new", {
                  fontFamily: 'SF Pro',
                  fontSize: 64,
                  fontWeight: 800,
                  color: '#f8fafc',
                  letterSpacing: -1,
                }),
                ...FEATURES.map((f, i) => {
                  const k = Easing.outCubic(Math.min(1, Math.max(0, (t - 3 - i * 0.35) / 0.5)));
                  return box(
                    {
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 22,
                      opacity: k,
                      transform: { translateX: (1 - k) * 40 },
                    },
                    [
                      box({ size: { width: 18, height: 18 }, borderRadius: 9, background: '#38bdf8' }),
                      text(f, { fontFamily: 'SF Pro', fontSize: 40, color: '#e2e8f0' }),
                    ],
                  );
                }),
              ],
            ),
          ])
        : null,
    ]);
  },
});
