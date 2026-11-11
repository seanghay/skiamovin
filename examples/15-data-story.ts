// 15 — Data story: a flowchart of the pipeline drawn on, then a growth curve on axes with a counter.
import {
  axes,
  box,
  Composition,
  counter,
  diagram,
  fadeIn,
  interpolate,
  series,
  text,
  titleCard,
} from 'skiamovin/scene';
import { fonts } from './shared.ts';

const PIPELINE = `flowchart LR
  A[Script] --> B[Scenes]
  B --> C{Review}
  C -->|ok| D[Render]
  C -->|edit| B
  D --> E[(Publish)]`;

const AX = { x: [0, 12, 2], y: [0, 100, 20], width: 1100, height: 560 } as const;
const growth = (m: number) => 100 / (1 + Math.exp(-(m - 6) * 0.9));

export default new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 12,
  background: '#0b1120',
  fonts: [fonts.sf],
  render: (ctx) =>
    series(ctx, [
      {
        duration: 5,
        render: ({ timestamp: t }) =>
          box(
            {
              size: { width: '100%', height: '100%' },
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 60,
            },
            [
              titleCard('How a video gets made', undefined, { time: t, fontFamily: 'SF Pro', flexGrow: 0 }),
              diagram(PIPELINE, { fontSize: 46, fontFamily: 'SF Pro', draw: interpolate(t, [0.6, 4], [0, 1]) }),
            ],
          ),
        transition: { name: 'dissolve', duration: 0.6 },
      },
      {
        duration: 7,
        render: ({ timestamp: t }) => {
          const ax = axes({ ...AX, draw: interpolate(t, [0, 1], [0, 1]) });
          const reach = interpolate(t, [1, 5], [0, 12]);
          return box(
            {
              size: { width: '100%', height: '100%' },
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 80,
            },
            [
              ax.view(
                ax.plot(growth, { color: '#34d399', strokeWidth: 6, draw: interpolate(t, [1, 5], [0, 1]) }),
                t > 1 ? ax.dot(reach, growth(reach), { color: '#f8fafc', radius: 10 }) : null,
              ),
              fadeIn(
                box({ flexDirection: 'column', gap: 12 }, [
                  text('Videos per month', { fontFamily: 'SF Pro', fontSize: 34, color: '#94a3b8' }),
                  text(counter(growth(reach) * 120, { grouping: true }), {
                    fontFamily: 'SF Pro',
                    fontSize: 120,
                    fontWeight: 800,
                    color: '#f8fafc',
                    fontFeatures: { tnum: 1 },
                  }),
                ]),
                t - 0.8,
              ),
            ],
          );
        },
      },
    ]),
});
