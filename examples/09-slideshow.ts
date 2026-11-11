// 09 — Photo slideshow: Ken Burns, crossfade transitions with series(), captions and a music bed with fades.
import { audio, box, Composition, Easing, image, interpolate, series, text } from 'skiamovin/scene';
import { fonts, image as img, input } from './shared.ts';

const music = input('music.mp3');
const PHOTOS = [
  { src: img('photo1.jpg'), caption: 'Mandelbrot', from: [1.0, 0, 0], to: [1.25, -60, -30] },
  { src: img('photo2.jpg'), caption: 'Gradients', from: [1.25, 40, 20], to: [1.0, 0, 0] },
  { src: img('photo3.jpg'), caption: 'Cellular automaton', from: [1.1, -40, 0], to: [1.3, 40, -20] },
] as const;
const SLIDE = 3.4,
  FADE = 0.7;
const DURATION = PHOTOS.length * SLIDE - (PHOTOS.length - 1) * FADE;

export default new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: DURATION,
  fonts: [fonts.georgiaItalic, fonts.arial],
  render: (ctx) =>
    box({ size: { width: '100%', height: '100%' }, background: '#000' }, [
      audio(music, { volume: (t) => interpolate(t, [0, 1, DURATION - 1.2, DURATION], [0, 0.7, 0.7, 0]) }),
      series(
        ctx,
        PHOTOS.map((p, i) => ({
          duration: SLIDE,
          offset: i === 0 ? 0 : -FADE,
          render: ({ timestamp }) => {
            const k = interpolate(timestamp, [0, SLIDE], [0, 1], { easing: Easing.inOutSine });
            const [s0, x0, y0] = p.from,
              [s1, x1, y1] = p.to;
            const fadeIn = i === 0 ? 1 : interpolate(timestamp, [0, FADE], [0, 1]);
            const cap = interpolate(timestamp, [0.6, 1.2, SLIDE - 0.8, SLIDE - 0.4], [0, 1, 1, 0]);
            return box(
              {
                position: 'absolute',
                inset: 0,
                size: { width: '100%', height: '100%' },
                opacity: fadeIn,
                overflow: 'hidden',
              },
              [
                image(p.src, {
                  position: 'absolute',
                  inset: 0,
                  size: { width: '100%', height: '100%' },
                  fit: 'cover',
                  sampling: 'linear',
                  transform: { scale: s0 + (s1 - s0) * k, translate: [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k] },
                }),
                box(
                  {
                    position: 'absolute',
                    inset: { left: 90, bottom: 90 },
                    padding: [14, 28],
                    background: 'rgba(0,0,0,0.55)',
                    borderRadius: 6,
                    backdropBlur: 12,
                    opacity: cap,
                    transform: { translateY: (1 - cap) * 20 },
                  },
                  [text(p.caption, { fontFamily: 'Georgia', fontStyle: 'italic', fontSize: 56, color: '#ffffff' })],
                ),
                text(`${i + 1} / ${PHOTOS.length}`, {
                  position: 'absolute',
                  inset: { right: 90, top: 70 },
                  fontFamily: 'Arial',
                  fontSize: 34,
                  color: 'rgba(255,255,255,0.8)',
                }),
              ],
            );
          },
        })),
      ),
    ]),
});
