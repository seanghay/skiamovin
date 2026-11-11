// 07 — Audio-reactive visuals: analyzeAudio() precomputes bands and loudness; the render stays pure.
import { analyzeAudio, audio, box, Composition, interpolateColor, text } from 'skiamovin/scene';
import { fonts, input } from './shared.ts';

const music = input('music.mp3');
const analysis = await analyzeAudio(music, { frameRate: 30, bands: 48, minFrequency: 40, maxFrequency: 2000 });

export default new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 10,
  fonts: [fonts.arial, fonts.arialBold],
  render: ({ timestamp }) => {
    const bands = analysis.getBands(timestamp);
    const rms = analysis.getRms(timestamp);
    const pulse = Math.min(1, rms * 3);
    return box(
      {
        size: { width: '100%', height: '100%' },
        background: interpolateColor(pulse, [0, 1], ['#0b0f1a', '#2e1065']),
        justifyContent: 'center',
        alignItems: 'center',
      },
      [
        audio(music),
        box({
          position: 'absolute',
          size: { width: 300 + pulse * 260, height: 300 + pulse * 260 },
          borderRadius: 400,
          background: 'rgba(168,85,247,0.25)',
          blur: 30,
        }),
        box(
          {
            position: 'absolute',
            inset: { left: 160, right: 160, bottom: 140 },
            size: { height: 520 },
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 8,
          },
          Array.from(bands, (v, i) =>
            box({
              flexGrow: 1,
              size: { height: `${Math.max(2, v * 100)}%` },
              borderRadius: [8, 8, 0, 0],
              background: interpolateColor(i / bands.length, [0, 0.5, 1], ['#22d3ee', '#a855f7', '#f43f5e']),
            }),
          ),
        ),
        text('NOW PLAYING', {
          position: 'absolute',
          inset: { left: 160, top: 110 },
          fontFamily: 'Arial',
          fontWeight: 'bold',
          fontSize: 34,
          color: '#a5b4fc',
          letterSpacing: 8,
        }),
        text('Synthesized Beat — 120 BPM', {
          position: 'absolute',
          inset: { left: 160, top: 160 },
          fontFamily: 'Arial',
          fontWeight: 'bold',
          fontSize: 72,
          color: '#ffffff',
        }),
      ],
    );
  },
});
