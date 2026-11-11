// 08 — Logo reveal: an SVG path drawn with a trim path effect, then filled; an SVG asset recolored per frame.
import { type ImageFilter, imageFilters, Paint, PaintStyle, Path, pathEffects, StrokeCap, StrokeJoin } from 'skiamovin';
import {
  box,
  Composition,
  draw,
  Easing,
  interpolate,
  interpolateColor,
  SvgAsset,
  spring,
  svg,
  text,
} from 'skiamovin/scene';
import { fonts } from './shared.ts';

// A stylized "S" + ring mark.
const MARK = Path.fromSVG(
  'M150 40 C 90 40 60 70 60 105 C 60 175 240 150 240 215 C 240 250 205 270 150 270 C 105 270 72 250 60 220 M 150 5 A 150 150 0 1 1 149.9 5',
)!;
const stroke = new Paint()
  .setAntiAlias(true)
  .setStyle(PaintStyle.Stroke)
  .setStrokeWidth(14)
  .setStrokeCap(StrokeCap.Round)
  .setStrokeJoin(StrokeJoin.Round);
const fill = new Paint().setAntiAlias(true);
const glows = new Map<number, ImageFilter>();
const glowFilter = (sigma: number) => {
  const k = Math.round(sigma);
  if (!glows.has(k)) glows.set(k, imageFilters.dropShadow([0, 0], [k, k], 'rgba(34,211,238,0.8)')!);
  return k > 0 ? glows.get(k)! : undefined;
};
const BADGE = new SvgAsset(
  new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect id="bg" width="120" height="40" rx="20" fill="#22d3ee"/><text x="60" y="27" font-size="18" text-anchor="middle" font-family="Arial" font-weight="bold" fill="#0f172a">v1.0</text></svg>',
  ),
);

export default new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  fonts: [fonts.arialBlack, fonts.arial],
  render: ({ timestamp }) => {
    const drawn = interpolate(timestamp, [0.2, 2.0], [0, 1], { easing: Easing.inOutCubic });
    const filled = interpolate(timestamp, [1.8, 2.4], [0, 1]);
    const word = spring({ timestamp: timestamp - 2.1, damping: 14 });
    const glow = interpolate(timestamp, [2.0, 2.6, 5], [0, 40, 18]);
    return box(
      {
        size: { width: '100%', height: '100%' },
        background: '#0a0a0f',
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'row',
        gap: 70,
      },
      [
        draw(
          (canvas) => {
            canvas.save();
            canvas.translate([10, 10]);
            using trim = pathEffects.trim(0, Math.max(0.001, drawn))!;
            stroke.setPathEffect(trim).setColor('#22d3ee');
            canvas.drawPath(MARK, stroke);
            stroke.setPathEffect(null);
            if (filled > 0) {
              fill.setColor(interpolateColor(filled, [0, 1], ['rgba(34,211,238,0)', 'rgba(34,211,238,0.15)']));
              canvas.drawCircle([150, 155], 145, fill);
            }
            canvas.restore();
          },
          { size: { width: 320, height: 320 }, filter: glowFilter(glow / 2) },
        ),
        box(
          { flexDirection: 'column', gap: 16, opacity: Math.min(1, word), transform: { translateX: (1 - word) * -60 } },
          [
            text('SKIAMOVIN', { fontFamily: 'Arial Black', fontSize: 150, color: '#f8fafc', letterSpacing: 6 }),
            box({ flexDirection: 'row', gap: 24, alignItems: 'center' }, [
              text('Programmatic video', { fontFamily: 'Arial', fontSize: 52, color: '#94a3b8' }),
              svg(BADGE, {
                size: { width: 150, height: 50 },
                attributes: { bg: { fill: timestamp > 3.2 ? '#a78bfa' : '#22d3ee' } },
              }),
            ]),
          ],
        ),
      ],
    );
  },
});
