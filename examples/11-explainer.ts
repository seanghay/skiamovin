// 11 — A short math explainer: a plan as a diagram, a formula written on, a graph with the camera moving in, and
// the answer.
import {
  axes,
  box,
  Composition,
  camera,
  diagram,
  Easing,
  fadeIn,
  fitCamera,
  indicate,
  interpolate,
  math,
  path,
  text,
} from 'skiamovin/scene';
import { fonts } from './shared.ts';

const W = 1920,
  H = 1080;
const AXES = { x: [-0.25, 1.5, 0.5], y: [-0.2, 1.6, 0.5], width: 900, height: 620 } as const;
const ax = axes(AXES);
const AX = { left: (W - ax.width) / 2, top: 240 };

// The area under x² between 0 and 1, as a closed path in the axes' pixels.
function area(): string {
  const pts: string[] = [];
  for (let i = 0; i <= 64; i++) {
    const x = i / 64;
    const [px, py] = ax.toPoint(x, x * x);
    pts.push(`${px.toFixed(2)} ${py.toFixed(2)}`);
  }
  const [x0, y0] = ax.toPoint(0, 0);
  const [x1] = ax.toPoint(1, 0);
  return `M${x0} ${y0} L${pts.join(' L')} L${x1} ${y0} Z`;
}
const AREA = area();

const ease = { easing: Easing.inOutCubic };
const title = (s: string, t: number, at: number) =>
  fadeIn(text(s, { fontSize: 56, fontWeight: 'bold', color: '#f8fafc' }), t - at);

export default new Composition({
  width: W,
  height: H,
  frameRate: 30,
  duration: 12,
  background: '#0b1120',
  fonts: [fonts.arial, fonts.arialBold],
  render: ({ timestamp: t }) => {
    if (t < 3.2) {
      return box({ size: { width: '100%', height: '100%' }, justifyContent: 'center', alignItems: 'center' }, [
        diagram('flowchart LR\n  Q[What is the area?] --> P[Plot x²] --> I[Integrate] --> A((Answer))', {
          fontSize: 44,
          draw: interpolate(t, [0.2, 2.6], [0, 1]),
          opacity: interpolate(t, [2.8, 3.2], [1, 0]),
        }),
      ]);
    }
    const [ax0, ay0] = ax.toPoint(0, 0),
      [ax1, ay1] = ax.toPoint(1, 1);
    const focus = fitCamera(
      { x: AX.left + ax0 - 40, y: AX.top + ay1 - 60, width: ax1 - ax0 + 80, height: ay0 - ay1 + 120 },
      { width: W, height: H },
      120,
    );
    const k = interpolate(t, [6.4, 8], [0, 1], ease) - interpolate(t, [9.6, 10.6], [0, 1], ease);
    const view = {
      x: interpolate(k, [0, 1], [W / 2, focus.x]),
      y: interpolate(k, [0, 1], [H / 2, focus.y]),
      zoom: interpolate(k, [0, 1], [1, Math.min(1.6, focus.zoom ?? 1)]),
    };
    const graph = axes({ ...AXES, draw: interpolate(t, [3.4, 4.6], [0, 1]) }).view(
      path(AREA, {
        position: 'absolute',
        inset: { left: 0, top: 0 },
        size: { width: ax.width, height: ax.height },
        fill: '#38bdf8',
        opacity: 0.35 * interpolate(t, [5.6, 6.4], [0, 1]),
      }),
      ax.plot((x) => x * x, { color: '#38bdf8', strokeWidth: 5, draw: interpolate(t, [4.4, 5.8], [0, 1]) }),
    );
    const content = box({ size: { width: W, height: H } }, [box({ position: 'absolute', inset: AX }, [graph])]);
    const answer = math('\\int_0^1 x^2\\,dx = \\frac{1}{3}', {
      fontSize: 72,
      color: '#f8fafc',
      write: interpolate(t, [3.6, 5.2], [0, 1]),
    });
    return box({ size: { width: '100%', height: '100%' } }, [
      camera(view, { width: W, height: H }, [content]),
      box(
        {
          position: 'absolute',
          inset: { left: 0, top: 90 },
          size: { width: W },
          justifyContent: 'center',
          opacity: 1 - k,
        },
        [title('The area under x²', t, 3.2)],
      ),
      box({ position: 'absolute', inset: { right: 100, top: 420 } }, [
        t < 10.6 ? answer : indicate(answer, interpolate(t, [10.6, 11.6], [0, 1]), { scale: 1.15, color: '#facc15' }),
      ]),
    ]);
  },
});
