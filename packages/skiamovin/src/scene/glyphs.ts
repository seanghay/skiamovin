// Type as shapes and variable fonts over time, in the spirit of Coldtype.
import type { Color } from '../core/color.ts';
import type { Path } from '../core/skia.ts';
import type { FontAsset } from './assets.ts';
import {
  type Child,
  type Deferred,
  type NodeStyle,
  path,
  type SceneNode,
  type Span,
  span,
  type TextProps,
  type TextUnit,
  text,
} from './nodes.ts';
import { segmentUnits } from './text-effects.ts';

const TEXT_KEYS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariations',
  'fontFeatures',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'locale',
  'textAlign',
  'direction',
  'color',
] as const;

function splitProps<T extends object>(options: T): [TextProps, Omit<T, (typeof TEXT_KEYS)[number]>] {
  const t: Record<string, unknown> = {};
  const rest = { ...options } as Record<string, unknown>;
  for (const k of TEXT_KEYS)
    if (k in rest) {
      t[k] = rest[k];
      delete rest[k];
    }
  return [t as TextProps, rest as never];
}

/** One piece of text as a shape. */
export interface GlyphShape {
  /** The outline, in the text box's coordinates. Owned by the renderer: don't delete it. */
  path: Path;
  text: string;
  index: number;
  count: number;
  /** Center of the piece, for turning or scaling it in place (use as `transformOrigin`). */
  center: [number, number];
  color: Color;
}

export interface TextPathsOptions {
  /** Pieces to cut the text into. Default `'chars'` (grapheme clusters, so marks stay with their letter). */
  by?: 'chars' | 'words' | 'lines' | 'all';
  /** Wrap width in pixels. Default: no wrapping. */
  width?: number;
  /** Turns each piece into a node. Default: the piece filled with the text color. */
  each?: (glyph: GlyphShape) => Child;
}

interface PathsLayout {
  width: number;
  height: number;
  pieces: { path: Path; text: string; center: [number, number] }[];
}

/**
 * Text as vector shapes, one per character, word or line, so letters can be outlined, drawn on, distorted, filled
 * with shaders or morphed. Shaped and laid out like a text node, with the same fonts:
 *
 * ```ts
 * textPaths('Hello', { fontSize: 160, each: (g) => path(g.path, { stroke: '#fff', fill: null, trim: { end: t } }) })
 * ```
 */
export function textPaths(content: string, options: TextProps & NodeStyle & TextPathsOptions = {}): SceneNode {
  const { by = 'chars', width, each, ...rest } = options;
  const [props, style] = splitProps(rest);
  const color = (props.color as Color | undefined) ?? '#000000';
  const deferred: Deferred<PathsLayout> = {
    key: `paths:${JSON.stringify([content, props, by, width])}`,
    load: async () => {},
    layout: ({ paragraph }) => {
      const p = paragraph([content], props, width);
      let starts: number[];
      let texts: string[];
      if (by === 'all') {
        starts = [0];
        texts = [content];
      } else if (by === 'lines') {
        const lines = p.getLineMetrics();
        starts = lines.map((l) => l.startIndex);
        texts = lines.map((l) => content.slice(l.startIndex, l.endIndex));
      } else {
        const u = segmentUnits(content, by);
        starts = Array.from(u.starts);
        texts = u.texts;
      }
      const paths = p.unitPaths(starts);
      const pieces = paths.map((path, i) => {
        const b = path.computeTightBounds();
        return {
          path,
          text: texts[i] ?? '',
          center: [(b.left + b.right) / 2, (b.top + b.bottom) / 2] as [number, number],
        };
      });
      return { width: width ?? p.maxIntrinsicWidth(), height: p.height(), pieces };
    },
    build: (L) => {
      const full: NodeStyle = {
        position: 'absolute',
        inset: { left: 0, top: 0 },
        size: { width: L.width, height: L.height },
      };
      const children: SceneNode[] = [];
      L.pieces.forEach((piece, index) => {
        const g: GlyphShape = { ...piece, index, count: L.pieces.length, color };
        const made = each ? each(g) : path(piece.path, { ...full, fill: color });
        const visit = (c: Child) => {
          if (!c) return;
          if (Array.isArray(c)) c.forEach(visit);
          else {
            const n = c as SceneNode;
            // Pieces without their own placement cover the whole text box, where their paths belong.
            children.push(n.style.position === undefined ? { ...n, style: { ...full, ...n.style } } : n);
          }
        };
        visit(made);
      });
      return { width: L.width, height: L.height, children };
    },
    free: (L) => {
      for (const p of L.pieces) p.path.delete();
    },
  };
  return { type: 'box', style, children: [], deferred };
}

/** A font's variable axes, such as `wght` and `wdth`, once the font has loaded (composition fonts always have). */
export function fontAxes(font: FontAsset): { tag: string; min: number; def: number; max: number }[] {
  return font._loaded()?.variationAxes() ?? [];
}

/**
 * Text whose font axes change per character, for variable font animation:
 *
 * ```ts
 * variableText('Skiamovin', (u) => ({ wght: 300 + 600 * wave(t - u.index * 0.1) }), { fontSize: 120 })
 * ```
 *
 * Each character is shaped with its own axis values, so wider or bolder letters push the others along.
 */
export function variableText(
  content: string,
  axes: (unit: TextUnit) => Record<string, number>,
  options: TextProps & NodeStyle & { by?: 'chars' | 'words' } = {},
): SceneNode {
  const { by = 'chars', ...style } = options;
  const u = segmentUnits(content, by);
  const base = style.fontVariations ?? {};
  const spans: Span[] = [];
  const first = u.starts[0] ?? 0;
  if (first > 0) spans.push(span(content.slice(0, first)));
  for (let i = 0; i < u.texts.length; i++)
    spans.push(
      span(u.texts[i]!, {
        fontVariations: { ...base, ...axes({ index: i, count: u.texts.length, text: u.texts[i]!.trim() }) },
      }),
    );
  return text(spans, style);
}

/**
 * Text that fills `width` exactly by setting a variable font axis (`wdth` by default), as Coldtype's fit does.
 * The axis stays within `range`.
 */
export function fitText(
  content: string,
  options: TextProps & NodeStyle & { width: number; axis?: string; range: readonly [number, number] },
): SceneNode {
  const { width, axis = 'wdth', range, ...rest } = options;
  const [props, style] = splitProps(rest);
  const at = (v: number): TextProps => ({ ...props, fontVariations: { ...props.fontVariations, [axis]: v } });
  const deferred: Deferred<{ value: number; height: number }> = {
    key: `fit:${JSON.stringify([content, props, width, axis, range])}`,
    load: async () => {},
    layout: ({ measure, paragraph }) => {
      let [lo, hi] = range;
      // Width grows with the axis; bisect to the value that fits.
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (measure([content], at(mid)).width > width) hi = mid;
        else lo = mid;
      }
      return { value: lo, height: paragraph([content], at(lo)).height() };
    },
    build: (L) => ({
      width,
      height: L.height,
      children: [text(content, { ...at(L.value), size: { width: width + 1 }, maxLines: 1 })],
    }),
  };
  return { type: 'box', style, children: [], deferred };
}
