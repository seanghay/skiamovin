// 10 — Vertical (9:16) social clip: 3D card flip, countdown with a progress ring, stat cards and a CTA.
import { Paint, PaintStyle, Rect, StrokeCap } from 'skiamovin';
import {
  box,
  Composition,
  draw,
  Easing,
  interpolate,
  linearGradient,
  sequence,
  spring,
  Timeline,
  text,
} from 'skiamovin/scene';
import { fonts } from './shared.ts';

const ring = new Paint()
  .setAntiAlias(true)
  .setStyle(PaintStyle.Stroke)
  .setStrokeWidth(28)
  .setStrokeCap(StrokeCap.Round);
const tl = new Timeline()
  .from('card', { rotateY: -90, opacity: 0 }, { at: 3.1, duration: 0.9, easing: Easing.outBack })
  .from('cta', { y: 200, opacity: 0 }, { at: 5.2, duration: 0.6, easing: Easing.outCubic });

const stat = (label: string, value: string, t: number, delay: number) => {
  const s = spring({ timestamp: t - delay, damping: 12 });
  return box(
    {
      flexGrow: 1,
      padding: 34,
      borderRadius: 32,
      background: 'rgba(255,255,255,0.08)',
      border: 2,
      borderColor: 'rgba(255,255,255,0.15)',
      flexDirection: 'column',
      gap: 8,
      opacity: Math.min(1, s),
      transform: { translateY: (1 - s) * 80 },
    },
    [
      text(value, { fontFamily: 'DIN Alternate', fontSize: 96, color: '#ffffff' }),
      text(label, { fontFamily: 'Arial', fontSize: 34, color: '#cbd5e1' }),
    ],
  );
};

export default new Composition({
  width: 1080,
  height: 1920,
  frameRate: 30,
  duration: 7,
  fonts: [fonts.arial, fonts.arialBold, fonts.arialBlack, fonts.din],
  render: ({ timestamp }) => {
    const v = tl.getValues(timestamp);
    return box(
      {
        size: { width: '100%', height: '100%' },
        background: linearGradient(160, ['#4c1d95', '#be185d', '#f97316']),
        padding: 80,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      },
      [
        sequence({ start: 0, end: 3.0 }, (ctx) => {
          const n = 3 - Math.floor(ctx.timestamp);
          const p = ctx.timestamp % 1;
          const s = spring({ timestamp: p, stiffness: 220, damping: 14 });
          return box({ position: 'absolute', inset: 0, justifyContent: 'center', alignItems: 'center' }, [
            draw(
              (c, { width, height }) => {
                const r = 260;
                ring.setColor('rgba(255,255,255,0.2)');
                c.drawCircle([width / 2, height / 2], r, ring);
                ring.setColor('#ffffff');
                c.drawArc(Rect.fromXYWH(width / 2 - r, height / 2 - r, r * 2, r * 2), -90, 360 * p, false, ring);
              },
              { position: 'absolute', inset: 0, size: { width: '100%', height: '100%' } },
            ),
            text(String(n), {
              fontFamily: 'Arial Black',
              fontSize: 300,
              color: '#ffffff',
              transform: { scale: 0.6 + 0.4 * s },
              opacity: interpolate(p, [0.8, 1], [1, 0]),
            }),
          ]);
        }),
        sequence({ start: 3.0 }, (ctx) =>
          box({ size: { width: '100%' }, flexDirection: 'column', gap: 40 }, [
            box(
              {
                padding: 60,
                borderRadius: 48,
                background: '#ffffff',
                flexDirection: 'column',
                gap: 16,
                shadow: { offset: [0, 30], blur: 60, color: 'rgba(0,0,0,0.35)' },
                opacity: Math.min(1, v.card!.opacity),
                transform: { perspective: 1400, rotateY: v.card!.rotateY },
              },
              [
                text('Skiamovin 1.0', { fontFamily: 'Arial Black', fontSize: 92, color: '#0f172a' }),
                text('Skia + Taffy + Mediabunny. Render on servers and in browsers from one codebase.', {
                  fontFamily: 'Arial',
                  fontSize: 44,
                  color: '#475569',
                  lineHeight: 1.3,
                }),
              ],
            ),
            box({ flexDirection: 'row', gap: 30 }, [
              stat('fps on Metal', '85', ctx.timestamp, 0.9),
              stat('Skia APIs', '330+', ctx.timestamp, 1.1),
            ]),
            box(
              {
                alignSelf: 'center',
                padding: [30, 70],
                borderRadius: 999,
                background: '#0f172a',
                opacity: v.cta!.opacity,
                transform: { translateY: v.cta!.y },
              },
              [
                text('npm install skiamovin', {
                  fontFamily: 'Arial',
                  fontWeight: 'bold',
                  fontSize: 48,
                  color: '#ffffff',
                }),
              ],
            ),
          ]),
        ),
      ],
    );
  },
});
