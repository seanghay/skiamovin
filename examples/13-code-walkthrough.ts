// 13 — Code walkthrough: a code block that changes version by version, with highlighted lines and a lower third.
import { backgrounds, box, Composition, code, interpolate, lowerThird, text } from 'skiamovin/scene';
import { fonts } from './shared.ts';

const STEPS = [
  `function total(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.price;
  }
  return sum;
}`,
  `function total(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}`,
  `function total(items: Item[], tax = 0.1): number {
  const net = items.reduce((sum, item) => sum + item.price, 0);
  return net * (1 + tax);
}`,
];
const NOTES = ['A plain loop', 'The same thing with reduce', 'Types and tax'];
const HIGHLIGHT = [
  [3, 5],
  [2, 2],
  [1, 3],
] as const;
const STEP = 3;

export default new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: STEP * STEPS.length,
  fonts: [fonts.sf, fonts.menlo],
  render: ({ timestamp: t }) => {
    const i = Math.min(STEPS.length - 1, Math.floor(t / STEP));
    const local = t - i * STEP;
    const progress = i === 0 ? 1 : interpolate(local, [0, 1.2], [0, 1]);
    return box({ size: { width: '100%', height: '100%' } }, [
      backgrounds.grid({ background: '#0b1120', color: '#172033', spacing: 56 }),
      box({ position: 'absolute', inset: 0, justifyContent: 'center', alignItems: 'center' }, [
        code(STEPS[i]!, {
          from: i > 0 ? STEPS[i - 1] : undefined,
          progress,
          language: 'ts',
          fontFamily: 'Menlo',
          fontSize: 34,
          lineNumbers: true,
          highlight: local > 1.4 ? [HIGHLIGHT[i]!] : undefined,
        }),
      ]),
      box({ position: 'absolute', inset: { left: 80, top: 70 } }, [
        text(`Step ${i + 1} of ${STEPS.length}`, { fontFamily: 'SF Pro', fontSize: 30, color: '#64748b' }),
      ]),
      lowerThird(NOTES[i]!, 'Refactoring total()', {
        position: 'absolute',
        inset: { left: 80, bottom: 80 },
        time: local - 0.4,
        out: STEP - 0.2,
        fontFamily: 'SF Pro',
      }),
    ]);
  },
});
