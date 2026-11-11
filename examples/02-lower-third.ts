// 02 — News-style lower third over a video, driven by props.
import { box, Composition, Easing, interpolate, linearGradient, spring, text, video } from 'skiamovin/scene';
import { fonts, input } from './shared.ts';

const clip = input('clip.mp4');

export default new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 6,
  fonts: [fonts.arial, fonts.arialBold],
  defaultProps: { name: 'Sophea Chan', role: 'Lead Engineer, Skiamovin', accent: '#ef4444' },
  render: ({ timestamp, duration, props }) => {
    const enter = spring({ timestamp: timestamp - 0.5, damping: 16, stiffness: 140 });
    const exit = interpolate(timestamp, [duration - 0.8, duration - 0.2], [0, 1], { easing: Easing.inCubic });
    const bar = interpolate(timestamp, [0.4, 1.0], [0, 1], { easing: Easing.outCubic }) * (1 - exit);
    return box({ size: { width: '100%', height: '100%' } }, [
      video(clip, {
        position: 'absolute',
        inset: 0,
        size: { width: '100%', height: '100%' },
        fit: 'cover',
        volume: 0.6,
      }),
      box({
        position: 'absolute',
        inset: { left: 0, right: 0, bottom: 0 },
        size: { height: 400 },
        background: linearGradient(0, ['rgba(0,0,0,0.75)', 'rgba(0,0,0,0)']),
      }),
      box(
        {
          position: 'absolute',
          inset: { left: 120, bottom: 120 },
          flexDirection: 'row',
          alignItems: 'stretch',
          opacity: 1 - exit,
          transform: { translateX: (1 - enter) * -200 },
        },
        [
          box({ size: { width: 14 * bar + 0.01 }, background: props.accent }),
          box(
            {
              padding: [20, 36],
              background: 'rgba(15,23,42,0.88)',
              flexDirection: 'column',
              gap: 6,
              overflow: 'hidden',
              size: { width: 900 * bar + 1 },
            },
            [
              text(props.name, {
                fontFamily: 'Arial',
                fontSize: 64,
                fontWeight: 'bold',
                color: '#ffffff',
                maxLines: 1,
              }),
              text(props.role.toUpperCase(), {
                fontFamily: 'Arial',
                fontSize: 30,
                color: '#cbd5e1',
                letterSpacing: 4,
                maxLines: 1,
              }),
            ],
          ),
        ],
      ),
      box(
        {
          position: 'absolute',
          inset: { right: 60, top: 50 },
          padding: [8, 18],
          borderRadius: 8,
          background: props.accent,
          opacity: interpolate(timestamp, [0, 0.4], [0, 1]),
        },
        [text('● LIVE', { fontFamily: 'Arial', fontSize: 32, fontWeight: 'bold', color: '#ffffff' })],
      ),
    ]);
  },
});
