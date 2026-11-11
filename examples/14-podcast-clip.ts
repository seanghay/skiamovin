// 14 — Podcast clip for social media: vertical, pop-style captions from WebVTT word timings, and bars that follow
// the audio.
import { analyzeAudio, audio, box, Composition, captions, interpolateColor, pulse, text } from 'skiamovin/scene';
import { fonts, input } from './shared.ts';

const music = input('score.wav');
const analysis = await analyzeAudio(music, { frameRate: 30, bands: 24 });

const VTT = `WEBVTT

00:00.300 --> 00:02.600
<00:00.300>The <00:00.500>best <00:00.800>videos <00:01.200>start <00:01.500>with <00:01.700>a <00:01.900>great <00:02.200>idea.

00:02.800 --> 00:05.200
<00:02.800>Then <00:03.100>you <00:03.300>write <00:03.700>it <00:03.900>down <00:04.300>as <00:04.500>code.

00:05.400 --> 00:08.000
<00:05.400>Every <00:05.800>frame <00:06.200>is <00:06.400>just <00:06.700>a <00:06.900>function <00:07.400>of <00:07.600>time.
`;

export default new Composition({
  width: 1080,
  height: 1920,
  frameRate: 30,
  duration: 8,
  fonts: [fonts.sf],
  render: ({ timestamp: t }) => {
    const bands = analysis.getBands(t);
    const beat = pulse(analysis.beats, t, 0.25);
    return box({ size: { width: '100%', height: '100%' }, background: '#0f0a1e' }, [
      audio(music, { role: 'music', volume: 0.8 }),
      box(
        {
          position: 'absolute',
          inset: { left: 0, right: 0, top: 260 },
          alignItems: 'center',
          gap: 28,
          flexDirection: 'column',
        },
        [
          box({
            size: { width: 300, height: 300 },
            borderRadius: 150,
            background: '#7c3aed',
            shadow: { color: 'rgba(167,139,250,0.7)', blur: 40 + beat * 60 },
            transform: { scale: 1 + beat * 0.05 },
          }),
          text('The Code Show', { fontFamily: 'SF Pro', fontSize: 56, fontWeight: 800, color: '#f5f3ff' }),
          text('Episode 12', { fontFamily: 'SF Pro', fontSize: 36, color: '#a78bfa' }),
        ],
      ),
      box(
        {
          position: 'absolute',
          inset: { left: 90, right: 90, top: 980 },
          size: { height: 220 },
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
        Array.from(bands, (v, i) =>
          box({
            size: { width: 22, height: 20 + v * 200 },
            borderRadius: 11,
            background: interpolateColor(i / bands.length, [0, 1], ['#a78bfa', '#f472b6']),
          }),
        ),
      ),
      captions(VTT, {
        preset: 'pop',
        fontFamily: 'SF Pro',
        fontSize: 76,
        accent: '#facc15',
        maxWidth: 900,
        position: 'absolute',
        inset: { left: 0, right: 0, top: 1380 },
      }),
    ]);
  },
});
