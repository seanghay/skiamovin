// Tailwind-style utility classes turned into node style, using Tailwind's default theme.
import { linearGradient, type NodeStyle, type Shadow, type TextProps } from './nodes.ts';
import { tailwindTheme as theme } from './tailwind-theme.ts';

type Style = NodeStyle & TextProps & Record<string, unknown>;

const cache = new Map<string, Style>();

const FRACTION = /^(\d+)\/(\d+)$/;
const NUMBER = /^-?\d+(\.\d+)?$/;

/** An arbitrary value in brackets, such as `[13px]` or `[#ff8800]`, with underscores read as spaces. */
function arbitrary(v: string): string | null {
  return v.startsWith('[') && v.endsWith(']') ? v.slice(1, -1).replace(/_/g, ' ') : null;
}

function length(v: string, allowAuto = false): number | string | null {
  const arb = arbitrary(v);
  if (arb !== null) {
    const m = /^(-?[\d.]+)(px|rem|%)?$/.exec(arb);
    if (!m) return null;
    return m[2] === '%' ? `${m[1]}%` : m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1]);
  }
  if (v === 'px') return 1;
  if (v === 'full') return '100%';
  if (allowAuto && v === 'auto') return 'auto';
  const f = FRACTION.exec(v);
  if (f) return `${(Number(f[1]) / Number(f[2])) * 100}%`;
  if (NUMBER.test(v)) return Number(v) * theme.spacing;
  return null;
}

function colorOf(v: string): string | null {
  const [name, op] = v.split('/');
  let c: string | null = null;
  const arb = arbitrary(name!);
  if (arb !== null) c = arb;
  else if (name === 'transparent') c = 'rgba(0,0,0,0)';
  else if (name === 'black' || name === 'white') c = theme.colors[name];
  else {
    const m = /^([a-z]+)-(\d+)$/.exec(name!);
    const palette = m ? (theme.colors as Record<string, unknown>)[m[1]!] : undefined;
    if (m && palette && typeof palette === 'object') c = (palette as Record<string, string>)[m[2]!] ?? null;
  }
  if (!c || op === undefined) return c;
  const alpha = Number(op) / 100;
  if (Number.isNaN(alpha)) return null;
  const hex = /^#([0-9a-f]{6})$/i.exec(c);
  if (!hex) return c;
  const n = parseInt(hex[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const ALIGN: Record<string, string> = {
  start: 'flex-start',
  end: 'flex-end',
  center: 'center',
  baseline: 'baseline',
  stretch: 'stretch',
};
const JUSTIFY: Record<string, string> = {
  start: 'flex-start',
  end: 'flex-end',
  center: 'center',
  between: 'space-between',
  around: 'space-around',
  evenly: 'space-evenly',
  stretch: 'stretch',
};
const GRADIENT_DIR: Record<string, number> = { t: 0, tr: 45, r: 90, br: 135, b: 180, bl: 225, l: 270, tl: 315 };
const ORIGIN: Record<string, [string, string]> = {
  center: ['50%', '50%'],
  top: ['50%', '0%'],
  bottom: ['50%', '100%'],
  left: ['0%', '50%'],
  right: ['100%', '50%'],
  'top-left': ['0%', '0%'],
  'top-right': ['100%', '0%'],
  'bottom-left': ['0%', '100%'],
  'bottom-right': ['100%', '100%'],
};
const BLEND = new Set([
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'plus-lighter',
]);

function radius(v: string | undefined): number | null {
  if (v === undefined) return theme.radius.sm ?? 4;
  if (v === 'none') return 0;
  if (v === 'full') return 9999;
  const arb = arbitrary(v);
  if (arb !== null) return Number.parseFloat(arb);
  return (theme.radius as Record<string, number>)[v] ?? null;
}

/** Sets `target[key]` unless the value is missing; reports whether it did. */
function assign(target: Record<string, unknown>, key: string, value: unknown): boolean {
  if (value === null || value === undefined) return false;
  target[key] = value;
  return true;
}

/**
 * Turns Tailwind utility classes into node style, with Tailwind's default colors, spacing, type scale, radii and
 * shadows: `tw('flex items-center gap-4 p-8 rounded-2xl bg-slate-900 text-white text-4xl font-bold')`. Unknown
 * classes throw, so typos don't pass silently. Text classes apply to text nodes.
 */
export function tw(classes: string): Style {
  const hit = cache.get(classes);
  if (hit) return hit;
  const s: Style = {};
  const size: Record<string, unknown> = {},
    minSize: Record<string, unknown> = {},
    maxSize: Record<string, unknown> = {};
  const padding: Record<string, unknown> = {},
    margin: Record<string, unknown> = {},
    inset: Record<string, unknown> = {};
  const corners: (number | null)[] = [null, null, null, null];
  const transform: Record<string, number> = {};
  let gradient: { angle: number; from?: string; via?: string; to?: string } | null = null;
  let tracking: number | null = null;
  let leading: { mult?: number; px?: number } | null = null;
  const unknown: string[] = [];

  const edges = (target: Record<string, unknown>, side: string, value: unknown) => {
    const keys: Record<string, string[]> = {
      '': ['left', 'right', 'top', 'bottom'],
      x: ['left', 'right'],
      y: ['top', 'bottom'],
      t: ['top'],
      r: ['right'],
      b: ['bottom'],
      l: ['left'],
      s: ['left'],
      e: ['right'],
    };
    for (const k of keys[side] ?? []) target[k] = value;
  };

  for (const raw of classes.split(/\s+/).filter(Boolean)) {
    const neg = raw.startsWith('-');
    const cls = neg ? raw.slice(1) : raw;
    const sign = (v: number | string | null) => (v === null ? null : neg ? (typeof v === 'number' ? -v : `-${v}`) : v);
    const ok = (() => {
      switch (cls) {
        case 'flex':
          s.display = 'flex';
          return true;
        case 'grid':
          s.display = 'grid';
          return true;
        case 'block':
          s.display = 'block';
          return true;
        case 'hidden':
          s.display = 'none';
          return true;
        case 'absolute':
        case 'relative':
          s.position = cls;
          return true;
        case 'flex-row':
        case 'flex-col':
        case 'flex-row-reverse':
        case 'flex-col-reverse':
          s.flexDirection = cls.replace('flex-', '').replace('col', 'column') as NodeStyle['flexDirection'];
          return true;
        case 'flex-wrap':
        case 'flex-nowrap':
        case 'flex-wrap-reverse':
          s.flexWrap = cls.replace('flex-', '') as NodeStyle['flexWrap'];
          return true;
        case 'flex-1':
          Object.assign(s, { flexGrow: 1, flexShrink: 1, flexBasis: '0%' });
          return true;
        case 'flex-auto':
          Object.assign(s, { flexGrow: 1, flexShrink: 1, flexBasis: 'auto' });
          return true;
        case 'flex-none':
          Object.assign(s, { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' });
          return true;
        case 'grow':
          s.flexGrow = 1;
          return true;
        case 'grow-0':
          s.flexGrow = 0;
          return true;
        case 'shrink':
          s.flexShrink = 1;
          return true;
        case 'shrink-0':
          s.flexShrink = 0;
          return true;
        case 'italic':
          s.fontStyle = 'italic';
          return true;
        case 'not-italic':
          s.fontStyle = 'normal';
          return true;
        case 'underline':
        case 'line-through':
          s.textDecoration = cls as TextProps['textDecoration'];
          return true;
        case 'no-underline':
          s.textDecoration = 'none';
          return true;
        case 'overflow-hidden':
          s.overflow = 'hidden';
          return true;
        case 'isolate':
          s.isolate = true;
          return true;
        case 'border':
          s.border = 1;
          return true;
        case 'rounded':
          corners.fill(radius(undefined));
          return true;
        case 'shadow':
          s.shadow = theme.shadow.sm as unknown as Shadow[];
          return true;
        case 'shadow-none':
          s.shadow = [];
          return true;
      }
      const rules: [RegExp, (m: RegExpExecArray) => boolean][] = [
        [/^items-(\w+)$/, (m) => assign(s, 'alignItems', ALIGN[m[1]!])],
        [/^self-(\w+)$/, (m) => assign(s, 'alignSelf', ALIGN[m[1]!])],
        [/^justify-(\w+)$/, (m) => assign(s, 'justifyContent', JUSTIFY[m[1]!])],
        [/^content-(\w+)$/, (m) => assign(s, 'alignContent', JUSTIFY[m[1]!])],
        [/^justify-items-(\w+)$/, (m) => assign(s, 'justifyItems', ALIGN[m[1]!])],
        [
          /^gap-(x-|y-)?(.+)$/,
          (m) => assign(s, m[1] === 'x-' ? 'columnGap' : m[1] === 'y-' ? 'rowGap' : 'gap', length(m[2]!)),
        ],
        [/^basis-(.+)$/, (m) => assign(s, 'flexBasis', length(m[1]!, true))],
        [
          /^grid-(cols|rows)-(\d+)$/,
          (m) => assign(s, m[1] === 'cols' ? 'gridTemplateColumns' : 'gridTemplateRows', [`repeat(${m[2]}, 1fr)`]),
        ],
        [
          /^(col|row)-span-(\d+|full)$/,
          (m) => assign(s, m[1] === 'col' ? 'gridColumn' : 'gridRow', m[2] === 'full' ? '1 / -1' : `span ${m[2]}`),
        ],
        [
          /^(w|h|size)-(.+)$/,
          (m) => {
            const v = length(m[2]!, true);
            if (v === null) return false;
            if (m[1] !== 'h') size.width = v;
            if (m[1] !== 'w') size.height = v;
            return true;
          },
        ],
        [
          /^(min|max)-(w|h)-(.+)$/,
          (m) => assign(m[1] === 'min' ? minSize : maxSize, m[2] === 'w' ? 'width' : 'height', length(m[3]!, true)),
        ],
        [
          /^aspect-(.+)$/,
          (m) => {
            const named: Record<string, number> = { square: 1, video: 16 / 9 };
            const arb = arbitrary(m[1]!);
            const f = arb ? /^([\d.]+)\s*\/\s*([\d.]+)$/.exec(arb) : null;
            return assign(s, 'aspectRatio', named[m[1]!] ?? (f ? Number(f[1]) / Number(f[2]) : null));
          },
        ],
        [
          /^(p|m)([xytrblse]?)-(.+)$/,
          (m) => {
            const v = sign(length(m[3]!, m[1] === 'm'));
            if (v === null) return false;
            edges(m[1] === 'p' ? padding : margin, m[2]!, v);
            return true;
          },
        ],
        [
          /^(inset(?:-x|-y)?|top|right|bottom|left)-(.+)$/,
          (m) => {
            const v = sign(length(m[2]!, true));
            if (v === null) return false;
            const side = m[1] === 'inset' ? '' : m[1] === 'inset-x' ? 'x' : m[1] === 'inset-y' ? 'y' : m[1]![0]!;
            edges(inset, side, v);
            return true;
          },
        ],
        [/^z-(\d+)$/, (m) => assign(s, 'zIndex', Number(m[1]) * (neg ? -1 : 1))],
        [/^opacity-(\d+)$/, (m) => assign(s, 'opacity', Number(m[1]) / 100)],
        [/^text-(left|center|right|justify|start|end)$/, (m) => assign(s, 'textAlign', m[1])],
        [
          /^text-(.+)$/,
          (m) => {
            const named = (theme.fontSize as Record<string, readonly [number, number]>)[m[1]!];
            if (named) {
              s.fontSize = named[0];
              s.lineHeight = named[1];
              return true;
            }
            const arb = arbitrary(m[1]!);
            if (arb && /^[\d.]+(px|rem)?$/.test(arb)) return assign(s, 'fontSize', length(m[1]!));
            return assign(s, 'color', colorOf(m[1]!));
          },
        ],
        [
          /^font-(.+)$/,
          (m) => {
            const arb = arbitrary(m[1]!);
            const w =
              (theme.fontWeight as Record<string, number>)[m[1]!] ?? (arb && NUMBER.test(arb) ? Number(arb) : null);
            return assign(s, 'fontWeight', w);
          },
        ],
        [
          /^tracking-(.+)$/,
          (m) => {
            const t = (theme.tracking as Record<string, number>)[m[1]!];
            if (t === undefined) return false;
            tracking = neg ? -t : t;
            return true;
          },
        ],
        [
          /^leading-(.+)$/,
          (m) => {
            const named = (theme.leading as Record<string, number>)[m[1]!] ?? (m[1] === 'none' ? 1 : undefined);
            if (named !== undefined) {
              leading = { mult: named };
              return true;
            }
            const v = length(m[1]!);
            if (typeof v !== 'number') return false;
            leading = { px: v };
            return true;
          },
        ],
        [
          /^rounded(?:-(t|r|b|l|tl|tr|br|bl))?(?:-(.+))?$/,
          (m) => {
            const r = radius(m[2]);
            if (r === null) return false;
            const which: Record<string, number[]> = {
              t: [0, 1],
              r: [1, 2],
              b: [2, 3],
              l: [0, 3],
              tl: [0],
              tr: [1],
              br: [2],
              bl: [3],
            };
            for (const i of m[1] ? which[m[1]]! : [0, 1, 2, 3]) corners[i] = r;
            return true;
          },
        ],
        [/^border-(\d+)$/, (m) => assign(s, 'border', Number(m[1]))],
        [/^border-(.+)$/, (m) => assign(s, 'borderColor', colorOf(m[1]!))],
        [/^shadow-(.+)$/, (m) => assign(s, 'shadow', (theme.shadow as Record<string, unknown>)[m[1]!])],
        [
          /^(backdrop-)?blur(?:-(.+))?$/,
          (m) => {
            const arb = m[2] === undefined ? null : arbitrary(m[2]);
            const v =
              m[2] === undefined
                ? 8
                : m[2] === 'none'
                  ? 0
                  : ((theme.blur as Record<string, number>)[m[2]] ?? (arb ? Number.parseFloat(arb) : null));
            return assign(s, m[1] ? 'backdropBlur' : 'blur', v);
          },
        ],
        [/^mix-blend-(.+)$/, (m) => assign(s, 'blendMode', BLEND.has(m[1]!) || m[1] === 'normal' ? m[1] : null)],
        [
          /^bg-(?:linear|gradient)-to-(\w+)$/,
          (m) => {
            const angle = GRADIENT_DIR[m[1]!];
            if (angle === undefined) return false;
            gradient = { ...(gradient as object | null), angle };
            return true;
          },
        ],
        [
          /^bg-linear-(\d+)$/,
          (m) => {
            gradient = { ...(gradient as object | null), angle: Number(m[1]) * (neg ? -1 : 1) };
            return true;
          },
        ],
        [
          /^(from|via|to)-(.+)$/,
          (m) => {
            const c = colorOf(m[2]!);
            if (!c) return false;
            gradient = { angle: 180, ...(gradient as object | null), [m[1]!]: c };
            return true;
          },
        ],
        [/^bg-(.+)$/, (m) => assign(s, 'background', colorOf(m[1]!))],
        [
          /^scale-(x-|y-)?(\d+)$/,
          (m) => assign(transform, m[1] === 'x-' ? 'scaleX' : m[1] === 'y-' ? 'scaleY' : 'scale', Number(m[2]) / 100),
        ],
        [
          /^rotate-(.+)$/,
          (m) => {
            const arb = arbitrary(m[1]!);
            const v = arb ? Number.parseFloat(arb) : Number(m[1]);
            return assign(transform, 'rotate', Number.isNaN(v) ? null : neg ? -v : v);
          },
        ],
        [
          /^translate-(x|y)-(.+)$/,
          (m) => {
            const v = sign(length(m[2]!));
            return assign(transform, m[1] === 'x' ? 'translateX' : 'translateY', typeof v === 'number' ? v : null);
          },
        ],
        [/^origin-(.+)$/, (m) => assign(s, 'transformOrigin', ORIGIN[m[1]!])],
      ];
      for (const [re, apply] of rules) {
        const m = re.exec(cls);
        if (m) return apply(m);
      }
      return false;
    })();
    if (!ok) unknown.push(raw);
  }
  if (unknown.length)
    throw new TypeError(
      `tw: unknown class${unknown.length > 1 ? 'es' : ''} ${unknown.map((c) => `'${c}'`).join(', ')}`,
    );
  if (Object.keys(size).length) s.size = size as never;
  if (Object.keys(minSize).length) s.minSize = minSize as never;
  if (Object.keys(maxSize).length) s.maxSize = maxSize as never;
  if (Object.keys(padding).length) s.padding = padding as never;
  if (Object.keys(margin).length) s.margin = margin as never;
  if (Object.keys(inset).length) s.inset = inset as never;
  if (corners.some((c) => c !== null)) {
    const c = corners.map((v) => v ?? 0);
    s.borderRadius = c.every((v) => v === c[0]) ? c[0]! : (c as [number, number, number, number]);
  }
  if (Object.keys(transform).length) s.transform = transform;
  const g = gradient as { angle: number; from?: string; via?: string; to?: string } | null;
  if (g && (g.from || g.to)) {
    const stops = [g.from ?? 'rgba(0,0,0,0)', ...(g.via ? [g.via] : []), g.to ?? 'rgba(0,0,0,0)'];
    s.background = linearGradient(g.angle, stops);
  }
  const fontSize = (s.fontSize as number | undefined) ?? 16;
  if (tracking !== null) s.letterSpacing = tracking * fontSize;
  const l = leading as { mult?: number; px?: number } | null;
  if (l) s.lineHeight = l.mult ?? l.px! / fontSize;
  if (cache.size > 1000) cache.delete(cache.keys().next().value!);
  cache.set(classes, Object.freeze(s) as Style);
  return s;
}
