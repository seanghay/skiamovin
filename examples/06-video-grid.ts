// 06 — Video compositing: grid of one source at different trims/speeds, with filters, plus picture-in-picture.
import { colorFilters } from 'skiamovin';
import { box, Composition, spring, text, video } from 'skiamovin/scene';
import { fonts, input } from './shared.ts';

const clip = input('clip.mp4');
const gray = colorFilters.saturation(0);
const warm = colorFilters.matrix([1.1, 0, 0, 0, 0.05, 0, 1.0, 0, 0, 0.02, 0, 0, 0.8, 0, 0, 0, 0, 0, 1, 0]);

const cell = (label: string, v: any) =>
  box({ borderRadius: 20, overflow: 'hidden', background: '#000' }, [
    v,
    text(label, {
      position: 'absolute',
      inset: { left: 20, top: 16 },
      fontFamily: 'Arial',
      fontWeight: 'bold',
      fontSize: 32,
      color: '#ffffff',
      textShadow: { offset: [0, 2], blur: 8, color: '#000' },
    }),
  ]);
const full = {
  position: 'absolute' as const,
  inset: 0,
  size: { width: '100%' as const, height: '100%' as const },
  fit: 'cover' as const,
  muted: true,
};

export default new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 6,
  fonts: [fonts.arial, fonts.arialBold],
  render: ({ timestamp }) => {
    const pip = spring({ timestamp: timestamp - 1, damping: 13 });
    return box({ size: { width: '100%', height: '100%' }, background: '#111827' }, [
      box(
        {
          size: { width: '100%', height: '100%' },
          display: 'grid',
          gridTemplateColumns: ['1fr', '1fr'],
          gridTemplateRows: ['1fr', '1fr'],
          gap: 16,
          padding: 16,
        },
        [
          cell('original', video(clip, full)),
          cell('grayscale · 2× speed', video(clip, { ...full, playbackRate: 2, colorFilter: gray })),
          cell('blur · trim 5s', video(clip, { ...full, trim: { start: 5 }, blur: 12 })),
          cell('warm · 0.5× speed', video(clip, { ...full, playbackRate: 0.5, colorFilter: warm })),
        ],
      ),
      box(
        {
          position: 'absolute',
          inset: { right: 60, bottom: 60 },
          size: { width: 480, height: 270 },
          borderRadius: 16,
          overflow: 'hidden',
          border: 6,
          borderColor: '#f8fafc',
          shadow: { offset: [0, 20], blur: 40, color: 'rgba(0,0,0,0.6)' },
          opacity: Math.min(1, pip),
          transform: { scale: 0.6 + 0.4 * pip, rotate: (1 - pip) * 8 },
        },
        [video(clip, { ...full, trim: { start: 8 }, muted: false, volume: 0.5 })],
      ),
    ]);
  },
});
