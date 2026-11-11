// 17 — Physics: letters fall onto a shelf and tumble, simulated once with Rapier; each landing makes a flash.
import { box, Composition, physics, pulse, text } from 'skiamovin/scene';
import { fonts } from './shared.ts';

const WORD = 'GRAVITY';
const SIZE = 150;
const COLORS = ['#f472b6', '#fb923c', '#facc15', '#4ade80', '#38bdf8', '#a78bfa', '#f87171'];

const world = physics({
  duration: 8,
  bodies: [
    { id: 'floor', type: 'fixed', shape: { kind: 'box', width: 1500, height: 40 }, x: 960, y: 900 },
    { id: 'left', type: 'fixed', shape: { kind: 'box', width: 40, height: 800 }, x: 190, y: 520 },
    { id: 'right', type: 'fixed', shape: { kind: 'box', width: 40, height: 800 }, x: 1730, y: 520 },
    ...[...WORD].map((_, i) => ({
      shape: { kind: 'box' as const, width: SIZE, height: SIZE, radius: 18 },
      x: 420 + i * 180,
      y: -150 - i * 110,
      angle: (i % 2 ? 1 : -1) * 6,
      restitution: 0.3,
      friction: 0.6,
    })),
  ],
});
// When each letter first lands on something.
const landed = [...WORD].map(
  (_, i) => world.contacts.find((c) => c.started && (c.a === i + 3 || c.b === i + 3))?.time ?? 99,
);

export default new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 8,
  fonts: [fonts.arialBlack],
  render: ({ timestamp: t }) =>
    box({ size: { width: '100%', height: '100%' }, background: '#111827' }, [
      box({
        position: 'absolute',
        inset: { left: 210, top: 880 },
        size: { width: 1500, height: 40 },
        background: '#374151',
        borderRadius: 8,
      }),
      ...[...WORD].map((ch, i) => {
        const b = world.body(i + 3, t);
        const flash = pulse([landed[i]!], t, 0.4);
        return box(
          {
            position: 'absolute',
            inset: { left: b.x - SIZE / 2, top: b.y - SIZE / 2 },
            size: { width: SIZE, height: SIZE },
            borderRadius: 18,
            background: COLORS[i]!,
            justifyContent: 'center',
            alignItems: 'center',
            transform: { rotate: b.angle },
            shadow: { color: COLORS[i]!, blur: 10 + flash * 50 },
          },
          [text(ch, { fontFamily: 'Arial Black', fontSize: 96, color: '#111827' })],
        );
      }),
    ]),
});
