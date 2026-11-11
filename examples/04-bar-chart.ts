// 04 — Animated bar chart race: data → layout, interpolated ranks and counters.
import { box, Composition, Easing, interpolate, text } from 'skiamovin/scene';
import { fonts } from './shared.ts';

const YEARS = [2020, 2021, 2022, 2023, 2024];
const DATA: Record<string, { color: string; values: number[] }> = {
  Rust: { color: '#f97316', values: [12, 25, 41, 63, 88] },
  TypeScript: { color: '#3b82f6', values: [40, 52, 61, 70, 79] },
  Python: { color: '#eab308', values: [65, 70, 74, 77, 81] },
  Go: { color: '#06b6d4', values: [30, 36, 40, 45, 49] },
  Kotlin: { color: '#a855f7', values: [18, 24, 28, 33, 36] },
  Swift: { color: '#ef4444', values: [28, 30, 31, 34, 35] },
  Zig: { color: '#f59e0b', values: [2, 5, 11, 19, 30] },
  C: { color: '#64748b', values: [55, 50, 46, 42, 38] },
};
const NAMES = Object.keys(DATA);
const STEP = 1.6; // seconds per year
const T = YEARS.map((_, i) => 0.5 + i * STEP);
const ranks = YEARS.map((_, yi) => {
  const sorted = [...NAMES].sort((a, b) => DATA[b]!.values[yi]! - DATA[a]!.values[yi]!);
  return Object.fromEntries(sorted.map((n, r) => [n, r]));
});
const ROW = 104;
const ease = { easing: Easing.inOutCubic };

export default new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 8,
  fonts: [fonts.arial, fonts.arialBold, fonts.din],
  render: ({ timestamp }) => {
    const year = Math.round(interpolate(timestamp, T, YEARS, ease));
    const max = 100;
    return box(
      {
        size: { width: '100%', height: '100%' },
        background: '#0f172a',
        padding: [70, 100],
        flexDirection: 'column',
        gap: 30,
      },
      [
        box({ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }, [
          text('Language momentum', { fontFamily: 'Arial', fontWeight: 'bold', fontSize: 64, color: '#f8fafc' }),
          text(String(year), { fontFamily: 'DIN Alternate', fontSize: 120, color: 'rgba(248,250,252,0.25)' }),
        ]),
        box(
          { flexGrow: 1, position: 'relative' },
          NAMES.map((name) => {
            const d = DATA[name]!;
            const value = interpolate(timestamp, T, d.values, ease);
            const top = interpolate(
              timestamp,
              T,
              ranks.map((r) => r[name]! * ROW),
              ease,
            );
            return box(
              {
                position: 'absolute',
                inset: { left: 0, top },
                size: { width: '100%', height: ROW - 18 },
                flexDirection: 'row',
                alignItems: 'center',
                gap: 20,
              },
              [
                box({ size: { width: 220 }, justifyContent: 'flex-end' }, [
                  text(name, {
                    fontFamily: 'Arial',
                    fontWeight: 'bold',
                    fontSize: 38,
                    color: '#e2e8f0',
                    textAlign: 'right',
                  }),
                ]),
                box({
                  size: { width: `${(value / max) * 75}%`, height: '100%' },
                  background: d.color,
                  borderRadius: [0, 12, 12, 0],
                  shadow: { offset: [0, 6], blur: 18, color: 'rgba(0,0,0,0.35)' },
                }),
                text(value.toFixed(1), {
                  fontFamily: 'DIN Alternate',
                  fontSize: 40,
                  color: '#f8fafc',
                  fontFeatures: { tnum: 1 },
                }),
              ],
            );
          }),
        ),
      ],
    );
  },
});
