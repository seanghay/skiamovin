// 21 — Math lesson: a vector field written on axes, the formula written on, and a camera that zooms to a detail.
import {
  axes,
  box,
  Composition,
  camera,
  cameraMove,
  indicate,
  interpolate,
  math,
  numberLine,
  sequence,
} from 'skiamovin/scene';
import { fonts } from './shared.ts';

const W = 1920,
  H = 1080;
const AX = { x: [-4, 4, 1], y: [-3, 3, 1], width: 1100, height: 820 } as const;
const ax = axes(AX);
const ORIGIN = { left: (W - AX.width) / 2, top: 130 };

export default new Composition({
  width: W,
  height: H,
  frameRate: 30,
  duration: 10,
  background: '#020617',
  fonts: [fonts.arial],
  render: ({ timestamp: t }) => {
    const live = axes({ ...AX, draw: interpolate(t, [0.2, 1.2], [0, 1]) });
    const field = t > 1.2 ? live.vectorField((x, y) => [-y, x], { spacing: 1, color: '#38bdf8', scale: 0.35 }) : null;
    const [px, py] = ax.toPoint(1, 1);
    const view = cameraMove(
      [
        { time: 5, camera: { x: W / 2, y: H / 2, zoom: 1 } },
        { time: 6.5, camera: { x: ORIGIN.left + px, y: ORIGIN.top + py, zoom: 2.4 } },
        { time: 8.5, camera: { x: ORIGIN.left + px, y: ORIGIN.top + py, zoom: 2.4 } },
        { time: 9.8, camera: { x: W / 2, y: H / 2, zoom: 1 } },
      ],
      t,
    );
    const formula = math('\\vec F(x, y) = (-y,\\ x)', {
      fontSize: 64,
      color: '#f8fafc',
      write: interpolate(t, [2, 3.6], [0, 1]),
    });
    return box({ size: { width: '100%', height: '100%' } }, [
      camera(view, { width: W, height: H }, [
        box({ size: { width: W, height: H } }, [
          box({ position: 'absolute', inset: ORIGIN }, [
            live.view(field, t > 4 ? live.dot(1, 1, { color: '#facc15', radius: 10 }) : null),
          ]),
        ]),
      ]),
      box({ position: 'absolute', inset: { right: 80, top: 80 } }, [
        t < 4 ? formula : indicate(formula, interpolate(t, [4, 5], [0, 1]), { color: '#facc15' }),
      ]),
      sequence({ start: 8.6 }, ({ timestamp }) =>
        box({ position: 'absolute', inset: { left: 0, right: 0, bottom: 60 }, alignItems: 'center' }, [
          numberLine({ range: [-4, 4, 1], width: 900, draw: interpolate(timestamp, [0, 1], [0, 1]) }).view(),
        ]),
      ),
    ]);
  },
});
