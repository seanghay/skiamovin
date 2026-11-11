// 01 — Title intro: SkSL plasma background, spring particles, GSAP-style timeline, progress bar.
import {
  box,
  Composition,
  Easing,
  interpolate,
  linearGradient,
  random,
  sequence,
  shader,
  span,
  spring,
  Timeline,
  text,
} from 'skiamovin/scene';
import { fonts } from './shared.ts';

const timeline = new Timeline()
  .from('title', { opacity: 0, y: 60 }, { at: 0.2, duration: 0.8, easing: Easing.outCubic })
  .from('subtitle', { opacity: 0, y: 30 }, { at: '<+0.3', duration: 0.6, easing: Easing.outCubic })
  .label('exit', 4.4)
  .to(['title', 'subtitle'], { opacity: 0 }, { at: 'exit', duration: 0.5, stagger: 0.1 });

const PLASMA = `
  uniform float2 iResolution; uniform float iTime;
  half4 main(float2 p) {
    float2 uv = p / iResolution;
    float v = sin(uv.x * 6 + iTime) + sin(uv.y * 5 - iTime * 1.3) + sin((uv.x + uv.y) * 4 + iTime * 0.7);
    float3 c = 0.5 + 0.5 * cos(v + float3(0, 2, 4));
    return half4(half3(c * 0.35), 1);
  }`;

export default new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  fonts: [fonts.arial, fonts.arialBold],
  render: ({ timestamp }) => {
    const v = timeline.getValues(timestamp);
    return box(
      {
        size: { width: '100%', height: '100%' },
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        gap: 24,
      },
      [
        shader(PLASMA, { position: 'absolute', inset: 0, size: { width: '100%', height: '100%' } }),
        ...Array.from({ length: 24 }, (_, i) => {
          const s = spring({ timestamp, delay: 0.05 * i, damping: 12 });
          return box({
            position: 'absolute',
            inset: { left: random(`x${i}`) * 1820, top: random(`y${i}`) * 980 },
            size: { width: 60, height: 60 },
            borderRadius: 30,
            background: linearGradient(135, ['#a78bfa', '#22d3ee']),
            opacity: 0.6 * s,
            transform: { scale: s, translateY: Math.sin(timestamp * 2 + i) * 20 },
          });
        }),
        text(['Programmatic video with ', span('Skia', { color: '#a78bfa' })], {
          fontFamily: 'Arial',
          fontSize: 110,
          fontWeight: 'bold',
          color: '#ffffff',
          opacity: v.title!.opacity,
          transform: { translateY: v.title!.y },
          textShadow: { offset: [0, 6], blur: 24, color: 'rgba(0,0,0,0.6)' },
        }),
        text('on Node and on the web — built for Mediabunny', {
          fontFamily: 'Arial',
          fontSize: 48,
          color: '#cbd5e1',
          opacity: v.subtitle!.opacity,
          transform: { translateY: v.subtitle!.y },
        }),
        sequence({ start: 2 }, (ctx) =>
          box({
            position: 'absolute',
            inset: { left: 0, bottom: 0 },
            size: { width: `${interpolate(ctx.timestamp, [0, 3], [0, 100])}%`, height: 10 },
            background: '#22d3ee',
          }),
        ),
      ],
    );
  },
});
