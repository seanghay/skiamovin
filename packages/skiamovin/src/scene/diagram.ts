// Mermaid diagrams: laid out by Pele, measured with the renderer's own text layout, and turned into scene nodes so
// every node and edge can be styled and animated.
import { parseCssColor } from '../core/color.ts';
import { Path } from '../core/skia.ts';
import { Easing } from './animation.ts';
import {
  box,
  type Deferred,
  type MeasureText,
  type NodeStyle,
  type SceneNode,
  type Span,
  span,
  type TextProps,
  text,
} from './nodes.ts';

export interface DiagramTheme {
  background: string;
  foreground: string;
  muted: string;
  line: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  accent: string;
  /** Corner radius of boxes, in pixels. */
  radius: number;
  /** Multiplies every line width. */
  lineWidth: number;
  /** Colors for charts (pie slices, series), in order. */
  series: readonly string[];
}

export const diagramThemes: { readonly dark: DiagramTheme; readonly light: DiagramTheme } = {
  dark: {
    background: '#0b1120',
    foreground: '#e2e8f0',
    muted: '#94a3b8',
    line: '#64748b',
    surface: '#1e293b',
    surfaceAlt: '#334155',
    border: '#475569',
    accent: '#38bdf8',
    radius: 10,
    lineWidth: 1.5,
    series: ['#38bdf8', '#a78bfa', '#f472b6', '#fb923c', '#facc15', '#4ade80', '#2dd4bf', '#f87171'],
  },
  light: {
    background: '#ffffff',
    foreground: '#0f172a',
    muted: '#64748b',
    line: '#475569',
    surface: '#f1f5f9',
    surfaceAlt: '#e2e8f0',
    border: '#cbd5e1',
    accent: '#2563eb',
    radius: 10,
    lineWidth: 1.5,
    series: ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#ca8a04', '#16a34a', '#0d9488', '#dc2626'],
  },
};

export interface DiagramOptions {
  /** `'dark'` (default), `'light'`, or a theme. Missing theme fields come from the dark theme. */
  theme?: 'dark' | 'light' | Partial<DiagramTheme>;
  /** Base text size in pixels. Default 20. */
  fontSize?: number;
  /** Font family for labels. Default: the composition's first font. */
  fontFamily?: string;
  /** Font family for code and monospace labels. */
  monoFamily?: string;
  /**
   * Draws the diagram on, from 0 (nothing) to 1 (all of it): nodes appear in order and each edge is traced from
   * the node it leaves to the node it enters.
   */
  draw?: number;
  /** Style for nodes and edges by their id (the Mermaid node id, or the edge id Pele gives it). */
  styles?: Readonly<Record<string, NodeStyle>>;
}

interface DiagramSpec {
  source: string;
  theme: DiagramTheme;
  fontSize: number;
  fontFamily?: string;
  monoFamily?: string;
  draw?: number;
  styles?: Readonly<Record<string, NodeStyle>>;
}

/**
 * A Mermaid diagram, such as `diagram('flowchart LR\n  A[Idea] --> B[Video]')`. Pele lays it out (flowcharts,
 * sequence, class, state, ER, pie, Gantt, mind maps and more), text is measured with the composition's fonts, and
 * the result is drawn with scene nodes, so `draw` can reveal it and `styles` can highlight any part.
 */
export function diagram(source: string, options: DiagramOptions & NodeStyle = {}): SceneNode {
  const { theme, fontSize = 20, fontFamily, monoFamily, draw, styles, ...style } = options;
  const t = typeof theme === 'string' ? diagramThemes[theme] : { ...diagramThemes.dark, ...theme };
  const spec: DiagramSpec = { source, theme: t, fontSize, fontFamily, monoFamily, draw, styles };
  const deferred: Deferred<DiagramLayout> = {
    key: `diagram:${JSON.stringify([source, t, fontSize, fontFamily, monoFamily])}`,
    load: () => loadDiagram(source),
    layout: (measure) => layoutDiagram(spec, measure),
    build: (layout) => ({ width: layout.width, height: layout.height, children: diagramNodes(layout, spec) }),
    free: freeDiagram,
  };
  return { type: 'box', style, children: [], deferred };
}

// Loading Pele

type Pele = typeof import('pele/lazy');
let pele: Pele | null = null;
let peleLoading: Promise<Pele> | null = null;
const loadedSources = new Set<string>();

/** Loads Pele and the code for the diagram's type. */
async function loadDiagram(source: string): Promise<void> {
  peleLoading ??= import('pele/lazy').then((m) => {
    pele = m;
    return m;
  });
  const m = await peleLoading;
  const type = m.detectType(source);
  if (type) await m.load(type);
  if (loadedSources.size > 256) loadedSources.clear();
  loadedSources.add(source);
}

// Layout

type Kind = 'node' | 'edge' | 'label' | 'other';

interface Shape {
  path: Path;
  fill: number | null;
  stroke: number | null;
  strokeWidth: number;
  dash?: number[];
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
  marker: boolean;
}

interface TextPiece {
  left: number;
  top: number;
  width: number;
  content: Span[];
  /** Set when the text is rotated or scaled. */
  transform?: Affine;
}

interface Item {
  id: string | null;
  kind: Kind;
  shapes: Shape[];
  texts: TextPiece[];
  bounds: [number, number, number, number] | null;
  slot: number;
}

/** A diagram converted to shapes and text. */
interface DiagramLayout {
  width: number;
  height: number;
  items: Item[];
  slots: number;
}

type Affine = [number, number, number, number, number, number];

interface El {
  tag: string;
  attrs: Record<string, string>;
  children: (El | string)[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#')
      return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e] ?? m;
  });
}

function parseSvg(svg: string): El {
  const root: El = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<([/!?]?)([\w:-]+)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  for (const m of svg.matchAll(re)) {
    const top = stack[stack.length - 1]!;
    if (m[5] !== undefined) {
      top.children.push(decode(m[5]));
      continue;
    }
    if (m[1] === undefined) continue;
    if (m[1] === '/') {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (m[1]) continue;
    const attrs: Record<string, string> = {};
    for (const a of m[3]!.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]!] = decode(a[2]!);
    const el: El = { tag: m[2]!, attrs, children: [] };
    top.children.push(el);
    if (!m[4]) stack.push(el);
  }
  return root.children.find((c): c is El => typeof c !== 'string' && c.tag === 'svg') ?? root;
}

function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out;
}

/** Replaces `var(--x, fallback)` with values from `vars`, innermost first. */
function resolveVars(value: string, vars: Map<string, string>, depth = 0): string {
  if (depth > 16 || !value.includes('var(')) return value;
  const i = value.lastIndexOf('var(');
  let d = 0,
    j = i + 4;
  for (; j < value.length; j++) {
    if (value[j] === '(') d++;
    else if (value[j] === ')') {
      if (d === 0) break;
      d--;
    }
  }
  const [name, ...rest] = splitArgs(value.slice(i + 4, j));
  const found = vars.get(name!);
  const sub = found !== undefined ? resolveVars(found, vars, depth + 1) : rest.join(',');
  return resolveVars(value.slice(0, i) + sub + value.slice(j + 1), vars, depth + 1);
}

function argb(c: number): [number, number, number, number] {
  return [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
}

function toColor(value: string | undefined): number | null {
  if (value === undefined) return null;
  const v = value.trim();
  if (!v || v === 'none' || v === 'transparent') return null;
  const mix = /^color-mix\(\s*in\s+srgb\s*,(.*)\)$/i.exec(v);
  if (mix) {
    const parts = splitArgs(mix[1]!).map((p) => {
      const pm = /^(.*?)\s+([\d.]+)%$/.exec(p);
      return pm ? { c: toColor(pm[1]), w: Number(pm[2]) / 100 } : { c: toColor(p), w: Number.NaN };
    });
    const [a, b] = parts;
    if (!a || !b || a.c === null || b.c === null) return a?.c ?? b?.c ?? null;
    let wa = a.w,
      wb = b.w;
    if (Number.isNaN(wa) && Number.isNaN(wb)) wa = wb = 0.5;
    else if (Number.isNaN(wa)) wa = 1 - wb;
    else if (Number.isNaN(wb)) wb = 1 - wa;
    const [aa, ar, ag, ab] = argb(a.c),
      [ba, br, bg, bb] = argb(b.c);
    const k = wa + wb || 1;
    const ch = (x: number, y: number) => Math.round((x * wa + y * wb) / k);
    return ((ch(aa, ba) << 24) | (ch(ar, br) << 16) | (ch(ag, bg) << 8) | ch(ab, bb)) >>> 0;
  }
  if (v.startsWith('url(')) return null;
  try {
    return parseCssColor(v) >>> 0;
  } catch {
    return null;
  }
}

function withAlpha(c: number | null, alpha: number): number | null {
  if (c === null) return null;
  if (alpha >= 1) return c;
  const a = Math.round(((c >>> 24) & 255) * Math.max(0, alpha));
  return ((a << 24) | (c & 0xffffff)) >>> 0;
}

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

function multiply(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function parseTransform(s: string): Affine {
  let m = IDENTITY;
  for (const t of s.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = t[2]!
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    let n: Affine = IDENTITY;
    switch (t[1]) {
      case 'translate':
        n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case 'scale':
        n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const r = ((a[0] ?? 0) * Math.PI) / 180;
        const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
        const c = Math.cos(r),
          sn = Math.sin(r);
        n = [c, sn, -sn, c, cx - c * cx + sn * cy, cy - sn * cx - c * cy];
        break;
      }
      case 'matrix':
        if (a.length === 6) n = a as Affine;
        break;
    }
    m = multiply(m, n);
  }
  return m;
}

const toMatrix = (m: Affine) => [m[0], m[2], m[4], m[1], m[3], m[5], 0, 0, 1];
const isTranslation = (m: Affine) => m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1;

interface State {
  m: Affine;
  vars: Map<string, string>;
  fill: string;
  stroke: string;
  strokeWidth: string;
  dash: string;
  cap: string;
  join: string;
  opacity: number;
  fillOpacity: number;
  strokeOpacity: number;
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  fontFamily: string;
  anchor: string;
  decoration: string;
}

/** Presentation attributes and `style` declarations of an element (the style wins). */
function declarations(el: El): Map<string, string> {
  const d = new Map<string, string>();
  for (const [k, v] of Object.entries(el.attrs)) d.set(k, v);
  const st = el.attrs.style;
  if (st)
    for (const decl of splitDecls(st)) {
      const i = decl.indexOf(':');
      if (i > 0) d.set(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
    }
  return d;
}

function splitDecls(s: string): string[] {
  const out: string[] = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ';' && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.filter((x) => x.trim());
}

function length(v: string | undefined, em: number, fallback: number): number {
  if (v === undefined) return fallback;
  const m = /^(-?[\d.]+(?:e-?\d+)?)(px|em)?$/i.exec(v.trim());
  if (!m) return fallback;
  return Number(m[1]) * (m[2]?.toLowerCase() === 'em' ? em : 1);
}

function themeVars(theme: DiagramTheme, fontFamily?: string, monoFamily?: string): Map<string, string> {
  const vars = new Map<string, string>([
    ['--pele-bg', theme.background],
    ['--pele-fg', theme.foreground],
    ['--pele-muted', theme.muted],
    ['--pele-line', theme.line],
    ['--pele-surface', theme.surface],
    ['--pele-surface-alt', theme.surfaceAlt],
    ['--pele-border', theme.border],
    ['--pele-accent', theme.accent],
    ['--pele-radius', `${theme.radius}px`],
    ['--pele-fg-on-light', '#0f172a'],
    ['--pele-fg-on-dark', '#f8fafc'],
  ]);
  theme.series.forEach((c, i) => {
    vars.set(`--pele-series-${i + 1}`, c);
  });
  vars.set('--pele-font', fontFamily ?? '');
  vars.set('--pele-font-mono', monoFamily ?? 'monospace');
  return vars;
}

function kindOf(cls: string): Kind {
  const c = ` ${cls} `;
  if (c.includes(' pele-edge-label ')) return 'label';
  if (c.includes(' pele-edge ') || c.includes(' pele-relation ') || c.includes(' pele-message ')) return 'edge';
  if (c.includes(' pele-cluster')) return 'other';
  return 'node';
}

/** Lays out a diagram with Pele and converts it to shapes and text, or null before `loadDiagram`. */
function layoutDiagram(spec: DiagramSpec, measure: MeasureText): DiagramLayout | null {
  if (!pele || !loadedSources.has(spec.source)) return null;
  const { theme, fontSize } = spec;
  const mono = spec.monoFamily;
  const props = (size: number, style: number): TextProps => ({
    fontSize: size,
    fontWeight: style & 1 ? 'bold' : undefined,
    fontStyle: style & 2 ? 'italic' : undefined,
    fontFamily: style & 4 && mono ? mono : spec.fontFamily,
  });
  pele.forgetTextWidths();
  const result = pele.render(spec.source, {
    now: 0,
    fontSize,
    links: false,
    images: false,
    measurer: { width: (s, size, style) => measure([s], props(size, style)).width },
  });
  pele.forgetTextWidths();
  const svg = parseSvg(result.svg);
  const items: Item[] = [];
  let current: Item | null = null;
  const itemFor = (id: string | null, kind: Kind): Item => {
    if (!current || current.id !== id || current.kind !== kind) {
      current = { id, kind, shapes: [], texts: [], bounds: null, slot: 0 };
      items.push(current);
    }
    return current;
  };
  const grow = (item: Item, l: number, t: number, r: number, b: number) => {
    const bb = item.bounds;
    item.bounds = bb ? [Math.min(bb[0], l), Math.min(bb[1], t), Math.max(bb[2], r), Math.max(bb[3], b)] : [l, t, r, b];
  };

  const root: State = {
    m: IDENTITY,
    vars: themeVars(theme, spec.fontFamily, mono),
    fill: '#000',
    stroke: 'none',
    strokeWidth: '1',
    dash: 'none',
    cap: 'butt',
    join: 'miter',
    opacity: 1,
    fillOpacity: 1,
    strokeOpacity: 1,
    fontSize,
    fontWeight: 'normal',
    fontStyle: 'normal',
    fontFamily: '',
    anchor: 'start',
    decoration: 'none',
  };

  const inherit = (el: El, parent: State): State => {
    const d = declarations(el);
    const s: State = { ...parent };
    let vars = parent.vars;
    for (const [k, v] of d)
      if (k.startsWith('--')) {
        if (vars === parent.vars) vars = new Map(parent.vars);
        // Theme values win over the defaults Pele writes on its root.
        if (!(k.startsWith('--pele-') && parent.vars.has(k))) vars.set(k, v);
      }
    s.vars = vars;
    const get = (k: string) => {
      const v = d.get(k);
      return v === undefined ? undefined : resolveVars(v, vars);
    };
    if (get('font-size') !== undefined) s.fontSize = length(get('font-size'), parent.fontSize, parent.fontSize);
    const font = get('font');
    if (font) {
      const fm = /([\d.]+)px/.exec(font);
      if (fm) s.fontSize = Number(fm[1]);
    }
    const map: [string, keyof State][] = [
      ['fill', 'fill'],
      ['stroke', 'stroke'],
      ['stroke-width', 'strokeWidth'],
      ['stroke-dasharray', 'dash'],
      ['stroke-linecap', 'cap'],
      ['stroke-linejoin', 'join'],
      ['font-weight', 'fontWeight'],
      ['font-style', 'fontStyle'],
      ['font-family', 'fontFamily'],
      ['text-anchor', 'anchor'],
      ['text-decoration', 'decoration'],
    ];
    for (const [attr, key] of map) {
      const v = get(attr);
      if (v !== undefined && v !== 'inherit') (s as unknown as Record<string, unknown>)[key] = v;
    }
    const num = (k: string) => {
      const v = get(k);
      return v === undefined ? 1 : Math.min(1, Math.max(0, Number.parseFloat(v)));
    };
    s.fillOpacity = d.has('fill-opacity') ? num('fill-opacity') : parent.fillOpacity;
    s.strokeOpacity = d.has('stroke-opacity') ? num('stroke-opacity') : parent.strokeOpacity;
    s.opacity = parent.opacity * (d.has('opacity') ? num('opacity') : 1);
    if (el.attrs.transform) s.m = multiply(parent.m, parseTransform(el.attrs.transform));
    return s;
  };

  const addShape = (item: Item, el: El, s: State, p: Path) => {
    p.transform(toMatrix(s.m));
    const fill = withAlpha(toColor(s.fill), s.fillOpacity * s.opacity);
    const stroke = withAlpha(toColor(s.stroke), s.strokeOpacity * s.opacity);
    if (fill === null && stroke === null) {
      p.delete();
      return;
    }
    const scale = Math.sqrt(Math.abs(s.m[0] * s.m[3] - s.m[1] * s.m[2])) || 1;
    const dash =
      s.dash && s.dash !== 'none'
        ? s.dash
            .split(/[\s,]+/)
            .map((x) => length(x, s.fontSize, 0) * scale)
            .filter((x) => x >= 0)
        : undefined;
    const sw = length(s.strokeWidth, s.fontSize, 1) * scale * theme.lineWidth;
    const cap = (['butt', 'round', 'square'].includes(s.cap) ? s.cap : 'butt') as Shape['cap'];
    const join = (['miter', 'round', 'bevel'].includes(s.join) ? s.join : 'miter') as Shape['join'];
    item.shapes.push({
      path: p,
      fill,
      stroke,
      strokeWidth: sw,
      dash: dash?.some((x) => x > 0) ? dash : undefined,
      cap,
      join,
      marker: ` ${el.attrs.class ?? ''} `.includes(' pele-marker'),
    });
    const b = p.computeTightBounds();
    const pad = stroke === null ? 0 : sw / 2;
    grow(item, b.left - pad, b.top - pad, b.right + pad, b.bottom + pad);
  };

  const textProps = (s: State): TextProps => {
    const w = s.fontWeight;
    const weight = w === 'bold' || w === 'bolder' ? 'bold' : /^\d+$/.test(w) ? Number(w) : undefined;
    const family = s.fontFamily.trim();
    const isMono = /mono/i.test(family) || family === mono;
    const fill = withAlpha(toColor(s.fill), s.fillOpacity * s.opacity);
    return {
      fontSize: s.fontSize,
      fontWeight: weight,
      fontStyle: s.fontStyle === 'italic' ? 'italic' : undefined,
      fontFamily: isMono && mono ? mono : spec.fontFamily,
      color: fill ?? 0,
      textDecoration: s.decoration.includes('underline')
        ? 'underline'
        : s.decoration.includes('line-through')
          ? 'line-through'
          : undefined,
    };
  };

  const addText = (item: Item, el: El, s: State) => {
    interface Piece {
      x: number;
      y: number;
      anchor: string;
      m: Affine;
      spans: Span[];
    }
    const pieces: Piece[] = [];
    let pen = { x: 0, y: 0 };
    let piece: Piece | null = null;
    const finish = () => {
      if (!piece || piece.spans.length === 0) return;
      const t0 = piece.spans[0]!.style;
      const { width, baseline } = measure(piece.spans, t0);
      pieces.push(piece);
      const k = piece.anchor === 'middle' ? 0.5 : piece.anchor === 'end' ? 1 : 0;
      const left = piece.x - width * k;
      const pad = (t0.fontSize ?? fontSize) * 2;
      // A wider box, centered on the text, so the renderer's layout never wraps it.
      const tp: TextPiece = {
        left: left - pad,
        top: piece.y - baseline,
        width: width + pad * 2,
        content: piece.spans,
      };
      if (isTranslation(piece.m)) {
        tp.left += piece.m[4];
        tp.top += piece.m[5];
      } else tp.transform = piece.m;
      item.texts.push(tp);
      const [l, t, r, b] = [left, piece.y - baseline, left + width, piece.y + (t0.fontSize ?? fontSize) * 0.3];
      if (isTranslation(piece.m)) grow(item, l + piece.m[4], t + piece.m[5], r + piece.m[4], b + piece.m[5]);
      pen = { x: left + width, y: piece.y };
      piece = null;
    };
    const visit = (node: El, st: State, first: boolean) => {
      const a = node.attrs;
      const positioned = first || a.x !== undefined || a.y !== undefined || a.dx !== undefined || a.dy !== undefined;
      if (positioned) {
        finish();
        const x = a.x !== undefined ? length(a.x.split(/[\s,]+/)[0], st.fontSize, 0) : pen.x;
        const y = a.y !== undefined ? length(a.y.split(/[\s,]+/)[0], st.fontSize, 0) : pen.y;
        pen = { x: x + length(a.dx, st.fontSize, 0), y: y + length(a.dy, st.fontSize, 0) };
        piece = { x: pen.x, y: pen.y, anchor: st.anchor, m: st.m, spans: [] };
      }
      for (const c of node.children) {
        if (typeof c === 'string') {
          if (!c) continue;
          piece ??= { x: pen.x, y: pen.y, anchor: st.anchor, m: st.m, spans: [] };
          piece.spans.push(span(c, textProps(st)));
        } else if (c.tag === 'tspan') visit(c, inherit(c, st), false);
      }
    };
    visit(el, s, true);
    finish();
  };

  const walk = (el: El, s: State, id: string | null, kind: Kind) => {
    const cls = el.attrs.class ?? '';
    if (el.tag === 'defs' || el.tag === 'foreignObject' || el.tag === 'image' || el.tag === 'title') return;
    if (el.attrs['data-id'] !== undefined && (el.tag === 'g' || el.tag === 'a')) {
      id = el.attrs['data-id'];
      kind = kindOf(cls);
    }
    const a = el.attrs;
    const n = (k: string, f = 0) => length(a[k] === undefined ? undefined : resolveVars(a[k]!, s.vars), s.fontSize, f);
    switch (el.tag) {
      case 'svg':
      case 'g':
      case 'a':
        for (const c of el.children) if (typeof c !== 'string') walk(c, inherit(c, s), id, kind);
        return;
      case 'text':
        addText(itemFor(id, kind), el, s);
        return;
      case 'path': {
        const p = a.d ? Path.fromSVG(a.d) : null;
        if (p) addShape(itemFor(id, kind), el, s, p);
        return;
      }
      case 'rect': {
        const w = n('width'),
          h = n('height');
        if (w <= 0 || h <= 0) return;
        const d = declarations(el);
        const rxv = d.get('rx') ?? d.get('ry');
        const ryv = d.get('ry') ?? d.get('rx');
        const rx = Math.min(w / 2, length(rxv && resolveVars(rxv, s.vars), s.fontSize, 0));
        const ry = Math.min(h / 2, length(ryv && resolveVars(ryv, s.vars), s.fontSize, 0));
        const p = new Path();
        if (rx > 0 || ry > 0) {
          const k = 0.5523;
          const [x, y] = [n('x'), n('y')];
          p.moveTo([x + rx, y])
            .lineTo([x + w - rx, y])
            .cubicTo([x + w - rx + rx * k, y], [x + w, y + ry - ry * k], [x + w, y + ry])
            .lineTo([x + w, y + h - ry])
            .cubicTo([x + w, y + h - ry + ry * k], [x + w - rx + rx * k, y + h], [x + w - rx, y + h])
            .lineTo([x + rx, y + h])
            .cubicTo([x + rx - rx * k, y + h], [x, y + h - ry + ry * k], [x, y + h - ry])
            .lineTo([x, y + ry])
            .cubicTo([x, y + ry - ry * k], [x + rx - rx * k, y], [x + rx, y])
            .close();
        } else p.addRect([n('x'), n('y'), n('x') + w, n('y') + h]);
        addShape(itemFor(id, kind), el, s, p);
        return;
      }
      case 'circle': {
        const r = n('r');
        if (r > 0) addShape(itemFor(id, kind), el, s, new Path().addCircle([n('cx'), n('cy')], r));
        return;
      }
      case 'ellipse': {
        const rx = n('rx'),
          ry = n('ry');
        if (rx > 0 && ry > 0)
          addShape(
            itemFor(id, kind),
            el,
            s,
            new Path().addOval([n('cx') - rx, n('cy') - ry, n('cx') + rx, n('cy') + ry]),
          );
        return;
      }
      case 'line':
        addShape(itemFor(id, kind), el, s, new Path().moveTo([n('x1'), n('y1')]).lineTo([n('x2'), n('y2')]));
        return;
      case 'polygon':
      case 'polyline': {
        const v = (a.points ?? '')
          .trim()
          .split(/[\s,]+/)
          .map(Number);
        const pts: [number, number][] = [];
        for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i]!, v[i + 1]!]);
        if (pts.length > 1) addShape(itemFor(id, kind), el, s, new Path().addPoly(pts, el.tag === 'polygon'));
        return;
      }
    }
  };
  walk(svg, inherit(svg, root), null, 'other');
  assignSlots(items);
  const slots = items.reduce((m, it) => Math.max(m, it.slot + 1), 0);
  return { width: result.width, height: result.height, items, slots };
}

/** Orders the reveal: each node appears, and each edge is traced just before the node it leads to. */
function assignSlots(items: Item[]): void {
  const nodes = items.filter((i) => i.kind === 'node');
  const edges = items.filter((i) => i.kind === 'edge');
  const nodeIds: (string | null)[] = [];
  for (const n of nodes) if (!nodeIds.includes(n.id)) nodeIds.push(n.id);
  const boundsOf = new Map<string | null, [number, number, number, number]>();
  for (const n of nodes) {
    const b = n.bounds;
    if (!b) continue;
    const o = boundsOf.get(n.id);
    boundsOf.set(
      n.id,
      o ? [Math.min(o[0], b[0]), Math.min(o[1], b[1]), Math.max(o[2], b[2]), Math.max(o[3], b[3])] : b,
    );
  }
  const nearest = (x: number, y: number): string | null | undefined => {
    let best: string | null | undefined;
    let bestD = 40;
    for (const [id, b] of boundsOf) {
      const dx = Math.max(b[0] - x, 0, x - b[2]),
        dy = Math.max(b[1] - y, 0, y - b[3]);
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  };
  const ends = new Map<Item, [string | null | undefined, string | null | undefined]>();
  for (const e of edges) {
    const line = e.shapes.find((s) => !s.marker) ?? e.shapes[0];
    const a = line?.path.posTanAt(0),
      b = line?.path.posTanAt(1);
    ends.set(e, [a ? nearest(a[0], a[1]) : undefined, b ? nearest(b[0], b[1]) : undefined]);
  }
  const placed = new Set<string | null>();
  const slotOfNode = new Map<string | null, number>();
  const done = new Set<Item>();
  let slot = 0;
  for (const id of nodeIds) {
    const incoming = edges.filter((e) => {
      const [from, to] = ends.get(e)!;
      return !done.has(e) && to === id && from !== id && (from === undefined || placed.has(from));
    });
    if (incoming.length) {
      for (const e of incoming) {
        e.slot = slot;
        done.add(e);
      }
      slot++;
    }
    slotOfNode.set(id, slot++);
    placed.add(id);
    const back = edges.filter((e) => {
      const [from, to] = ends.get(e)!;
      return !done.has(e) && from === id && (to === id || (to !== undefined && placed.has(to)));
    });
    if (back.length) {
      for (const e of back) {
        e.slot = slot;
        done.add(e);
      }
      slot++;
    }
  }
  for (const e of edges) if (!done.has(e)) e.slot = slot++;
  for (const n of nodes) n.slot = slotOfNode.get(n.id) ?? 0;
  for (const l of items)
    if (l.kind === 'label')
      l.slot = edges.find((e) => e.id === l.id)?.slot ?? nodes.find((n) => n.id === l.id)?.slot ?? 0;
}

/** Frees a layout's paths. */
function freeDiagram(layout: DiagramLayout): void {
  for (const it of layout.items) for (const s of it.shapes) s.path.delete();
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function decompose(m: Affine) {
  const sx = Math.hypot(m[0], m[1]);
  const rotate = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  const det = m[0] * m[3] - m[1] * m[2];
  return [
    { translate: [m[4], m[5]] as [number, number] },
    { rotate },
    { scale: [sx, det / (sx || 1)] as [number, number] },
  ];
}

/** Scene nodes for a laid-out diagram at a reveal progress. */
function diagramNodes(layout: DiagramLayout, spec: DiagramSpec): SceneNode[] {
  const draw = spec.draw === undefined ? 1 : clamp01(spec.draw);
  const lag = 0.5;
  const span = 1 + Math.max(0, layout.slots - 1) * lag;
  const full: NodeStyle = {
    position: 'absolute',
    inset: { left: 0, top: 0 },
    size: { width: layout.width, height: layout.height },
  };
  const out: SceneNode[] = [];
  for (const it of layout.items) {
    const p = draw >= 1 ? 1 : clamp01(draw * span - it.slot * lag);
    if (p <= 0) continue;
    const e = Easing.smooth(p);
    const children: SceneNode[] = [];
    for (const s of it.shapes) {
      const traced = it.kind === 'edge' && !s.marker;
      const opacity = it.kind === 'edge' && s.marker ? clamp01((p - 0.8) / 0.2) : 1;
      if (opacity <= 0) continue;
      children.push({
        type: 'path',
        path: s.path,
        fill: traced && p < 1 ? null : s.fill,
        stroke: s.stroke ?? undefined,
        strokeWidth: s.strokeWidth,
        strokeCap: s.cap,
        strokeJoin: s.join,
        dash: s.dash,
        trim: traced && p < 1 ? { end: e } : undefined,
        style: { ...full, opacity },
        children: [],
      } as SceneNode);
    }
    for (const t of it.texts) {
      const node = text(t.content, {
        position: 'absolute',
        inset: { left: t.left, top: t.top },
        size: { width: t.width },
        textAlign: 'center',
        maxLines: 1,
      });
      children.push(
        t.transform ? box({ ...full, transformOrigin: [0, 0], transform: decompose(t.transform) }, [node]) : node,
      );
    }
    const b = it.bounds ?? [0, 0, layout.width, layout.height];
    const style: NodeStyle = { ...full };
    if (p < 1) {
      if (it.kind === 'node') {
        style.opacity = e;
        style.transformOrigin = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
        style.transform = { scale: 0.85 + 0.15 * e };
      } else if (it.kind === 'label') style.opacity = clamp01((p - 0.5) / 0.5);
      else if (it.kind === 'other') style.opacity = e;
    }
    const extra = it.id !== null ? spec.styles?.[it.id] : undefined;
    if (extra) {
      if (extra.transform && extra.transformOrigin === undefined)
        style.transformOrigin = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
      Object.assign(style, extra, extra.opacity !== undefined ? { opacity: (style.opacity ?? 1) * extra.opacity } : {});
    }
    out.push(box(style, children));
  }
  return out;
}
