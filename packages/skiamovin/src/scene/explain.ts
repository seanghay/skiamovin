// Explainer building blocks in the spirit of Manim: axes and plots, a camera, and reveal helpers.
import type { Color } from '../core/color.ts';
import { Path } from '../core/skia.ts';
import { Easing } from './animation.ts';
import { box, type Child, type NodeStyle, path, type SceneNode, type TextProps, text } from './nodes.ts';

type Range = readonly [min: number, max: number, step?: number];

export interface AxesOptions {
  x: Range;
  y: Range;
  /** Size of the plotting area, in pixels. */
  width: number;
  height: number;
  color?: Color;
  strokeWidth?: number;
  /** Tick marks every `step`. Default true when a step is given. */
  ticks?: boolean;
  /** Number labels at the ticks, with this text style. Set false for none. */
  labels?: (TextProps & { size?: number }) | false;
  /** Draws the axes on: 0 shows nothing, 1 shows them fully. */
  draw?: number;
}

export interface Axes {
  readonly width: number;
  readonly height: number;
  /** Pixel position of a point in graph coordinates. */
  toPoint(x: number, y: number): [number, number];
  /** The axes and the given children (plots, dots), in a box of the plotting area's size. */
  view(...children: Child[]): SceneNode;
  /** The graph of `fn` over the x range (or `domain`), drawn on with `draw`. */
  plot(
    fn: (x: number) => number,
    style?: { color?: Color; strokeWidth?: number; samples?: number; domain?: Range; draw?: number },
  ): SceneNode;
  /** A dot at a point in graph coordinates. */
  dot(x: number, y: number, style?: { color?: Color; radius?: number }): SceneNode;
  /** A straight line between two points in graph coordinates. */
  line(
    a: readonly [number, number],
    b: readonly [number, number],
    style?: { color?: Color; strokeWidth?: number; draw?: number; dashed?: boolean },
  ): SceneNode;
  /** Arrows showing a vector field, every `spacing` graph units. */
  vectorField(
    fn: (x: number, y: number) => readonly [number, number],
    style?: { spacing?: number; color?: Color; scale?: number },
  ): SceneNode;
}

const fmt = (v: number) =>
  Math.abs(v) < 1e-9
    ? '0'
    : Number.isInteger(v)
      ? String(v)
      : v.toFixed(Math.min(3, Math.max(0, -Math.floor(Math.log10(Math.abs(v) % 1 || 1)) + 1)));

/** Number axes with a mapping from graph coordinates to pixels, like Manim's `Axes`. */
export function axes(options: AxesOptions): Axes {
  const { width, height, color = '#94a3b8', strokeWidth = 2, draw } = options;
  const [x0, x1, xs] = options.x;
  const [y0, y1, ys] = options.y;
  const sx = width / (x1 - x0),
    sy = height / (y1 - y0);
  const toPoint = (x: number, y: number): [number, number] => [(x - x0) * sx, height - (y - y0) * sy];
  const ox = Math.min(Math.max(0, x0), x1) * 1,
    oy = Math.min(Math.max(0, y0), y1) * 1;
  const abs: NodeStyle = { position: 'absolute', inset: { left: 0, top: 0 } };
  const trim = draw === undefined ? undefined : { end: Easing.smooth(Math.min(1, Math.max(0, draw))) };
  const axisLines = () => {
    const [ax0, ay0] = toPoint(x0, oy),
      [ax1] = toPoint(x1, oy);
    const [bx0, by0] = toPoint(ox, y0),
      [, by1] = toPoint(ox, y1);
    const d = `M${ax0} ${ay0} L${ax1} ${ay0} M${bx0} ${by0} L${bx0} ${by1}`;
    return path(d, { ...abs, stroke: color, strokeWidth, strokeCap: 'round', trim, size: { width, height } });
  };
  const tickNodes = (): Child[] => {
    if (options.ticks === false) return [];
    const out: Child[] = [];
    const size = 6;
    const label = options.labels === false ? null : { fontSize: 18, color, ...(options.labels ?? {}) };
    if (xs)
      for (let v = Math.ceil(x0 / xs) * xs; v <= x1 + 1e-9; v += xs) {
        if (Math.abs(v - ox) < 1e-9) continue;
        const [px, py] = toPoint(v, oy);
        out.push(
          path(`M${px} ${py - size} L${px} ${py + size}`, {
            ...abs,
            stroke: color,
            strokeWidth,
            size: { width, height },
            opacity: draw === undefined ? 1 : Math.min(1, draw * 2),
          }),
        );
        if (label)
          out.push(
            text(fmt(v), {
              ...label,
              position: 'absolute',
              inset: { left: px - 20, top: py + size + 4 },
              size: { width: 40 },
              textAlign: 'center' as never,
              opacity: draw === undefined ? 1 : Math.max(0, draw * 2 - 1),
            }),
          );
      }
    if (ys)
      for (let v = Math.ceil(y0 / ys) * ys; v <= y1 + 1e-9; v += ys) {
        if (Math.abs(v - oy) < 1e-9) continue;
        const [px, py] = toPoint(ox, v);
        out.push(
          path(`M${px - size} ${py} L${px + size} ${py}`, {
            ...abs,
            stroke: color,
            strokeWidth,
            size: { width, height },
            opacity: draw === undefined ? 1 : Math.min(1, draw * 2),
          }),
        );
        if (label)
          out.push(
            text(fmt(v), {
              ...label,
              position: 'absolute',
              inset: { left: px - size - 48, top: py - (label.fontSize ?? 18) * 0.7 },
              size: { width: 40 },
              textAlign: 'right' as never,
              opacity: draw === undefined ? 1 : Math.max(0, draw * 2 - 1),
            }),
          );
      }
    return out;
  };
  return {
    width,
    height,
    toPoint,
    view: (...children) => box({ size: { width, height } }, [axisLines(), ...tickNodes(), ...children]),
    plot(fn, style = {}) {
      const [d0, d1] = style.domain ?? [x0, x1];
      const n = style.samples ?? Math.max(64, Math.ceil(width / 3));
      const p = new Path();
      let pen = false;
      for (let i = 0; i <= n; i++) {
        const x = d0 + ((d1 - d0) * i) / n;
        const y = fn(x);
        if (!Number.isFinite(y)) {
          pen = false;
          continue;
        }
        const pt = toPoint(x, Math.min(y1 + (y1 - y0), Math.max(y0 - (y1 - y0), y)));
        if (pen) p.lineTo(pt);
        else p.moveTo(pt);
        pen = true;
      }
      return path(p, {
        ...abs,
        size: { width, height },
        stroke: style.color ?? '#38bdf8',
        strokeWidth: style.strokeWidth ?? 4,
        strokeCap: 'round',
        strokeJoin: 'round',
        trim: style.draw === undefined ? undefined : { end: Math.min(1, Math.max(0, style.draw)) },
        overflow: 'hidden',
      });
    },
    dot(x, y, style = {}) {
      const r = style.radius ?? 8;
      const [px, py] = toPoint(x, y);
      return box({
        position: 'absolute',
        inset: { left: px - r, top: py - r },
        size: { width: r * 2, height: r * 2 },
        borderRadius: r,
        background: style.color ?? '#f472b6',
      });
    },
    line(a, b, style = {}) {
      const [ax, ay] = toPoint(a[0], a[1]),
        [bx, by] = toPoint(b[0], b[1]);
      let d = `M${ax} ${ay} L${bx} ${by}`;
      if (style.dashed) {
        const len = Math.hypot(bx - ax, by - ay),
          dash = 10;
        d = '';
        for (let s = 0; s < len; s += dash * 2) {
          const e = Math.min(len, s + dash);
          d += `M${ax + ((bx - ax) * s) / len} ${ay + ((by - ay) * s) / len} L${ax + ((bx - ax) * e) / len} ${ay + ((by - ay) * e) / len} `;
        }
      }
      return path(d, {
        ...abs,
        size: { width, height },
        stroke: style.color ?? color,
        strokeWidth: style.strokeWidth ?? 2,
        strokeCap: 'round',
        trim: style.draw === undefined ? undefined : { end: style.draw },
      });
    },
    vectorField(fn, style = {}) {
      const spacing = style.spacing ?? xs ?? (x1 - x0) / 10;
      const scale = style.scale ?? 0.4;
      const arrows: Child[] = [];
      for (let x = Math.ceil(x0 / spacing) * spacing; x <= x1 + 1e-9; x += spacing)
        for (let y = Math.ceil(y0 / spacing) * spacing; y <= y1 + 1e-9; y += spacing) {
          const [vx, vy] = fn(x, y);
          const len = Math.hypot(vx, vy);
          if (len < 1e-9) continue;
          const k = (Math.min(1, len) * spacing * scale) / len;
          const [px, py] = toPoint(x, y),
            [qx, qy] = toPoint(x + vx * k, y + vy * k);
          arrows.push(
            path(`M${px} ${py} L${qx} ${qy}`, {
              ...abs,
              size: { width, height },
              stroke: style.color ?? '#a78bfa',
              strokeWidth: 2,
              strokeCap: 'round',
              arrow: { end: 8 },
            }),
          );
        }
      return box({ position: 'absolute', inset: 0, size: { width, height } }, arrows);
    },
  };
}

/** A number line, like Manim's `NumberLine`: axes with only an x axis. */
export function numberLine(options: {
  range: Range;
  width: number;
  color?: Color;
  labels?: AxesOptions['labels'];
  draw?: number;
}): Axes {
  return axes({
    x: options.range,
    y: [-1, 1],
    width: options.width,
    height: 40,
    color: options.color,
    labels: options.labels,
    draw: options.draw,
  });
}

// Camera

export interface CameraState {
  /** The point at the center of the view, in the content's coordinates. */
  x: number;
  y: number;
  /** 2 is twice as close. Default 1. */
  zoom?: number;
  /** Degrees. */
  rotate?: number;
}

/**
 * Looks at `children` through a camera that pans, zooms and rotates. The view is the camera node's size; the
 * content uses its own coordinates. Animate the state to move the camera.
 */
export function camera(
  state: CameraState,
  viewport: { width: number; height: number },
  children: readonly Child[],
): SceneNode {
  const zoom = state.zoom ?? 1;
  return box({ size: { width: viewport.width, height: viewport.height }, overflow: 'hidden' }, [
    box(
      {
        position: 'absolute',
        inset: { left: 0, top: 0 },
        size: { width: viewport.width, height: viewport.height },
        transformOrigin: [0, 0],
        transform: [
          { translateX: viewport.width / 2, translateY: viewport.height / 2 },
          { scale: zoom, rotate: state.rotate ?? 0 },
          { translateX: -state.x, translateY: -state.y },
        ],
      },
      children as Child[],
    ),
  ]);
}

/** Camera state that frames a rectangle (in content coordinates) in the viewport, with `margin` pixels around it. */
export function fitCamera(
  rect: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  margin = 40,
): CameraState {
  const zoom = Math.min(
    (viewport.width - margin * 2) / Math.max(1, rect.width),
    (viewport.height - margin * 2) / Math.max(1, rect.height),
  );
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, zoom };
}

// Reveal helpers

/** Fades a node in while moving it from `shift` pixels away, over progress 0..1 (Manim's `FadeIn`). */
export function fadeIn(
  node: SceneNode,
  progress: number,
  options: { shift?: readonly [number, number] } = {},
): SceneNode {
  const p = Easing.smooth(Math.min(1, Math.max(0, progress)));
  const [dx, dy] = options.shift ?? [0, 20];
  const st = node.style;
  const extra = { translateX: dx * (1 - p), translateY: dy * (1 - p) };
  const transform =
    st.transform === undefined ? extra : Array.isArray(st.transform) ? [extra, ...st.transform] : [extra, st.transform];
  return { ...node, style: { ...st, opacity: (st.opacity ?? 1) * p, transform } } as SceneNode;
}

/** Briefly enlarges and recolors a node to draw attention, over progress 0..1 (Manim's `Indicate`). */
export function indicate(
  node: SceneNode,
  progress: number,
  options: { scale?: number; color?: Color } = {},
): SceneNode {
  const k = Easing.thereAndBack(Math.min(1, Math.max(0, progress)));
  const st = node.style;
  const extra = { scale: 1 + ((options.scale ?? 1.2) - 1) * k };
  const transform =
    st.transform === undefined ? extra : Array.isArray(st.transform) ? [...st.transform, extra] : [st.transform, extra];
  const layerStyle =
    options.color && k > 0.01
      ? { ...st.layerStyle, colorOverlay: { color: options.color, opacity: k } }
      : st.layerStyle;
  return { ...node, style: { ...st, transform, layerStyle } } as SceneNode;
}

/**
 * Draws a node on, over progress 0..1 (Manim's `Create`): paths are traced, text is typed, and anything else
 * fades in. Applies to the node and everything inside it.
 */
export function create(node: SceneNode, progress: number): SceneNode {
  const p = Math.min(1, Math.max(0, progress));
  const visit = (n: SceneNode): SceneNode => {
    const kids = n.children.map(visit);
    if (n.type === 'path') return { ...n, trim: { ...n.trim, end: (n.trim?.end ?? 1) * p }, children: kids };
    if (n.type === 'text') {
      const total = n.content.map((c) => (typeof c === 'string' ? c : c.text)).join('').length;
      return { ...n, text: { ...n.text, visibleGraphemes: Math.round(total * p) }, children: kids };
    }
    if (n.type === 'box') return { ...n, children: kids };
    return { ...n, style: { ...n.style, opacity: (n.style.opacity ?? 1) * p }, children: kids };
  };
  return visit(node);
}
