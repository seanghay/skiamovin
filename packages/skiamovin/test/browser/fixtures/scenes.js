// Compositions loaded by URL (CompositionModule) or served from a worker.

import { ALL_FORMATS, Input, UrlSource } from 'mediabunny';
import { audio, box, Composition } from 'skiamovin/scene';

/** A yellow square moving right at 40 px/s on black. */
export const movingBox = new Composition({
  width: 160,
  height: 90,
  frameRate: 30,
  duration: 3,
  render: ({ timestamp }) =>
    box({ size: { width: '100%', height: '100%' }, background: '#000000' }, [
      box({ size: { width: 20, height: 20 }, background: '#ffff00', transform: { translateX: timestamp * 40 } }),
    ]),
});

/** Busy 1080p scene with audio, for exports. */
export const busy = new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 2,
  render: ({ timestamp }) =>
    box({ size: { width: '100%', height: '100%' }, background: '#102040' }, [
      ...Array.from({ length: 60 }, (_, i) =>
        box({
          position: 'absolute',
          inset: { left: (i % 10) * 190, top: Math.floor(i / 10) * 175 },
          size: { width: 160, height: 160 },
          borderRadius: 80,
          background: `hsl(${i * 6}, 80%, 60%)`,
          transform: { rotate: timestamp * 90 + i, scale: 0.6 + 0.4 * Math.sin(timestamp * 4 + i) },
        }),
      ),
      // Seconds 1–2 are red in the top-left corner, for checking the joined output.
      box({
        position: 'absolute',
        inset: { left: 0, top: 0 },
        size: { width: 40, height: 40 },
        background: timestamp >= 1 ? '#ff0000' : '#00ff00',
      }),
      audio(new Input({ formats: ALL_FORMATS, source: new UrlSource('/out/tone.mp3') })),
    ]),
});
