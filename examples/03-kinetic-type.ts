// 03 — Kinetic typography: per-word springs, a typewriter line and a multilingual end card (Khmer, emoji).
import { box, Composition, interpolate, interpolateColor, sequence, spring, text } from 'skiamovin/scene';
import { fonts } from './shared.ts';

const WORDS = 'Every frame is a pure function of time'.split(' ');
const LINE = 'render(frame) → layout → paint → encode';

export default new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 8,
  fonts: [fonts.arialBlack, fonts.courier, fonts.georgiaItalic, fonts.khmer],
  render: ({ timestamp }) =>
    box(
      {
        size: { width: '100%', height: '100%' },
        background: interpolateColor(timestamp, [0, 4, 8], ['#0b1020', '#1e1b4b', '#0b1020']),
      },
      [
        sequence({ start: 0, end: 4.2 }, (ctx) =>
          box(
            {
              size: { width: '100%', height: '100%' },
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'center',
              alignContent: 'center',
              gap: { width: 36, height: 10 },
              padding: 160,
            },
            WORDS.map((w, i) => {
              const s = spring({ timestamp: ctx.timestamp, delay: 0.18 * i, damping: 11, stiffness: 160 });
              const out = interpolate(ctx.timestamp, [3.6, 4.2], [1, 0]);
              return text(w, {
                fontFamily: 'Arial Black',
                fontSize: 120,
                color: i === WORDS.length - 1 ? '#fbbf24' : '#ffffff',
                opacity: Math.min(1, s) * out,
                transform: { translateY: (1 - s) * 80, rotate: (1 - s) * -8, scale: 0.8 + 0.2 * s },
              });
            }),
          ),
        ),
        sequence({ start: 4.2, end: 6.4 }, (ctx) =>
          box({ size: { width: '100%', height: '100%' }, justifyContent: 'center', alignItems: 'center' }, [
            text(LINE, {
              fontFamily: 'Courier New',
              fontSize: 64,
              color: '#34d399',
              visibleGraphemes: Math.floor(interpolate(ctx.timestamp, [0.1, 1.6], [0, LINE.length])),
            }),
          ]),
        ),
        sequence({ start: 6.4 }, (ctx) => {
          const s = spring({ timestamp: ctx.timestamp, damping: 14 });
          return box(
            {
              size: { width: '100%', height: '100%' },
              justifyContent: 'center',
              alignItems: 'center',
              flexDirection: 'column',
              gap: 20,
              opacity: Math.min(1, s),
              transform: { scale: 0.9 + 0.1 * s },
            },
            [
              text('សួស្តី ពិភពលោក', { fontFamily: 'Khmer Sangam MN', fontSize: 110, color: '#ffffff' }),
              text('Hello, world 👋  —  shaped with HarfBuzz', {
                fontFamily: 'Georgia',
                fontStyle: 'italic',
                fontSize: 52,
                color: '#c4b5fd',
              }),
            ],
          );
        }),
      ],
    ),
});
