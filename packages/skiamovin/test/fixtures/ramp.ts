import { box, Composition } from 'skiamovin/scene';

// Background gray level encodes the frame index, so joined chunks can be checked frame by frame.
export default new Composition({
  width: 1280,
  height: 720,
  frameRate: 30,
  duration: 6,
  render: ({ frame }) => {
    const g = Math.round((frame / 179) * 255);
    return box({ size: { width: '100%', height: '100%' }, background: `rgb(${g}, ${g}, ${g})` }, [
      ...Array.from({ length: 40 }, (_, i) =>
        box({
          position: 'absolute',
          inset: { left: (i * 31 + frame * 7) % 1200, top: (i * 17) % 640 },
          size: { width: 60, height: 60 },
          borderRadius: 30,
          background: `hsl(${i * 9}, 80%, 60%)`,
          shadow: { offset: [0, 8], blur: 16, color: 'rgba(0,0,0,0.5)' },
        }),
      ),
    ]);
  },
});
