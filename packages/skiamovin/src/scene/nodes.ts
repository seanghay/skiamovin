// Scene nodes: plain objects describing one frame. Built inside `render(ctx)`.
import type { Input, InputAudioTrack, InputVideoTrack } from 'mediabunny';
import type { Color } from '../core/color.ts';
import { BlendMode } from '../core/enums.ts';
import {
  type Canvas,
  type ColorFilter,
  type Image,
  type ImageFilter,
  Path,
  type RuntimeEffect,
  type Shader,
} from '../core/skia.ts';
import type { Style } from '../taffy/index.ts';
import type { FontAsset, ImageAsset, LottieAsset, SvgAsset } from './assets.ts';
import type { Effect, GlassOptions, LayerStyle } from './effects.ts';
import type { Grade } from './grading.ts';
import type { SpringParams } from './physics.ts';
import { tw } from './tw.ts';

// Render context

export interface RenderContext<Props = any> {
  /** Seconds since the start of the composition (or the enclosing sequence). */
  timestamp: number;
  /** Duration in seconds of the composition (or the enclosing sequence). */
  duration: number;
  /** `Math.round(timestamp * frameRate)`. */
  frame: number;
  frameRate: number;
  width: number;
  height: number;
  props: Props;
  /** Named moments in composition time, from the composition's `events` (for example `composition.meta.json`). */
  events: Readonly<Record<string, number>>;
  /** 0 normally; rises from 0 to 1 during a sequence's `exit` time, after its end. */
  exit: number;
}

/** Timing of the current sequence, in composition time. */
export interface Scope {
  ctx: RenderContext;
  /** Composition time where this scope's local time is 0. */
  absStart: number;
  /** Composition time where this scope ends, or Infinity. */
  absEnd: number;
}

const scopes: Scope[] = [];

/** @internal */
export function pushScope(s: Scope): void {
  scopes.push(s);
}
/** @internal */
export function popScope(): void {
  scopes.pop();
}
/** @internal */
export function currentScope(): Scope {
  const s = scopes[scopes.length - 1];
  if (!s) throw new Error('Scene nodes can only be created inside a composition render function.');
  return s;
}

// Visual style

export interface Shadow {
  offset?: readonly [number, number];
  blur?: number;
  spread?: number;
  color: Color;
  inset?: boolean;
}

export interface Transform {
  translate?: readonly [number, number];
  translateX?: number;
  translateY?: number;
  scale?: number | readonly [number, number];
  rotate?: number;
  skew?: readonly [number, number];
  perspective?: number;
  rotateX?: number;
  rotateY?: number;
}

export interface Gradient {
  readonly __gradient: 'linear' | 'radial';
  readonly angle?: number;
  readonly stops: readonly (Color | readonly [Color, number])[];
  readonly center?: readonly [number | string, number | string];
  readonly radius?: number | string;
}

export interface VisualStyle {
  background?: Color | Shader | Gradient;
  borderRadius?: number | readonly [number, number, number, number];
  borderColor?: Color;
  opacity?: number;
  transform?: Transform | readonly Transform[];
  transformOrigin?: readonly [number | string, number | string];
  shadow?: Shadow | readonly Shadow[];
  blur?: number;
  backdropBlur?: number;
  filter?: ImageFilter;
  colorFilter?: ColorFilter;
  /** Color grading for this node and everything inside it, applied in order. See `lut`, `adjust`, `curves`. */
  grade?: Grade | readonly Grade[];
  /** Finishing effects for this node and everything inside it, applied in order. See `grain`, `glow`, `vignette`. */
  effects?: readonly Effect[];
  /** Frosted, light-bending glass made from what's behind the node, inside its rounded shape. */
  glass?: GlassOptions | true;
  blendMode?: BlendMode | string;
  zIndex?: number;
  mask?: SceneNode;
  /** How `mask` is read: its alpha (default) or its brightness, optionally inverted. */
  maskMode?: 'alpha' | 'luminance' | 'alpha-inverted' | 'luminance-inverted';
  /** Draws the node and its children in their own group, so blend modes inside only mix with each other. */
  isolate?: boolean;
  /**
   * Animates the node when its layout changes: it springs from where it was to where layout puts it. Nodes with
   * the same `layoutId` in different sequences morph into each other across a cut.
   */
  layoutId?: string;
  /** Spring for layout animation. Default `springs.smooth`. */
  layoutTransition?: SpringParams;
  /** Photoshop-style layer styles that follow the shape of the node's content. */
  layerStyle?: LayerStyle;
  /** Grades, effects or blur applied to everything drawn beneath the node, inside its shape. See `adjustmentLayer`. */
  backdrop?: { grade?: Grade | readonly Grade[]; effects?: readonly Effect[]; blur?: number };
  cache?: string;
}

export type NodeStyle = Style &
  VisualStyle & {
    /** Tailwind-style utility classes, such as `'flex items-center gap-4 p-8 rounded-2xl bg-slate-900'`. */
    class?: string;
  };

export type Fit = 'fill' | 'contain' | 'cover' | 'none' | 'scale-down';

export interface TextProps {
  fontFamily?: string | readonly string[];
  fontSize?: number;
  fontWeight?: number | 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  fontVariations?: Record<string, number>;
  fontFeatures?: Record<string, number>;
  color?: Color | Shader;
  letterSpacing?: number;
  wordSpacing?: number;
  lineHeight?: number;
  textAlign?: 'left' | 'right' | 'center' | 'justify' | 'start' | 'end';
  textDecoration?: 'underline' | 'line-through' | 'overline' | 'none';
  textShadow?: Shadow | readonly Shadow[];
  stroke?: { color: Color; width: number };
  maxLines?: number;
  ellipsis?: string;
  locale?: string;
  direction?: 'ltr' | 'rtl';
  visibleGraphemes?: number;
  /** Animates the text in pieces: characters, words or lines, each with its own look. See `textAnimator`. */
  split?: SplitText;
  /** Bends the text, as in Photoshop. `bend` is -1..1 and can be animated. */
  warp?: { style: 'arc' | 'arch' | 'bulge' | 'flag' | 'wave' | 'rise'; bend: number };
}

/** One piece of split text. */
export interface TextUnit {
  index: number;
  count: number;
  text: string;
  /** The text node's color, when it's a plain color. */
  color?: Color;
}

/** How one piece of split text looks. Offsets are in pixels, rotation in degrees. */
export interface UnitStyle {
  opacity?: number;
  x?: number;
  y?: number;
  scale?: number;
  rotate?: number;
  color?: Color;
}

export interface SplitText {
  /** Characters are grapheme clusters, so a letter with its marks moves as one. Words use the locale's rules. */
  by: 'chars' | 'words' | 'lines';
  style: (unit: TextUnit) => UnitStyle;
}

export interface Span {
  readonly __span: true;
  text: string;
  style: TextProps;
}

export type Child = SceneNode | null | undefined | false | readonly Child[];

interface Base {
  style: NodeStyle;
  children: SceneNode[];
}

export type SceneNode =
  | ({ type: 'box' } & Base)
  | ({ type: 'path'; path: Path } & PathStyle & Base)
  | ({ type: 'text'; content: (string | Span)[]; text: TextProps } & Base)
  | ({
      type: 'image';
      source: ImageAsset | Image;
      fit: Fit;
      objectPosition?: readonly [number | string, number | string];
      sampling?: string;
      localTime: number;
    } & Base)
  | ({
      type: 'video';
      media: Input | InputVideoTrack;
      fit: Fit;
      sourceTime: number;
      muted: boolean;
      audio?: AudioClip;
    } & Base)
  | ({ type: 'lottie'; asset: LottieAsset; fit: Fit; time: number; overrides?: unknown } & Base)
  | ({ type: 'svg'; asset: SvgAsset; fit: Fit; attributes?: Record<string, Record<string, string>> } & Base)
  | ({
      type: 'shader';
      effect: RuntimeEffect | string;
      uniforms: Record<string, number | readonly number[]>;
      shaderChildren: Record<string, Shader | ImageAsset | SceneNode>;
      /** Set for gl-transitions: the shader's source is loaded by name. */
      transition?: string;
    } & Base)
  | ({
      type: 'draw';
      fn: (canvas: Canvas, size: { width: number; height: number }, ctx: RenderContext) => void;
      ctx: RenderContext;
    } & Base)
  | ({ type: 'audio'; clip: AudioClip } & Base);

/** An audible clip, with times in composition seconds. */
export interface AudioClip {
  media: Input | InputAudioTrack | InputVideoTrack;
  /** Composition time at which source time `trimStart` plays. */
  absStart: number;
  /** Composition time at which the clip stops. */
  absEnd: number;
  trimStart: number;
  trimEnd: number;
  playbackRate: number;
  loop: boolean;
  volume: number | ((timestamp: number) => number);
}

// Builders

/** ∫₀ᵗ f with Simpson's rule, for speed ramps. */
function integrate(f: (t: number) => number, t: number): number {
  if (t <= 0) return 0;
  const n = Math.max(16, Math.ceil(t * 120)) * 2;
  const h = t / n;
  let sum = f(0) + f(t);
  for (let i = 1; i < n; i++) sum += f(i * h) * (i % 2 ? 4 : 2);
  return (sum * h) / 3;
}

/** Expands a `class` string into style; keys set directly in the style win over classes. */
function withClass<T extends NodeStyle>(style: T): T {
  if (!style.class) return style;
  const { class: classes, ...rest } = style;
  return { ...(tw(classes) as T), ...rest } as T;
}

function flatten(children: readonly Child[] | undefined, out: SceneNode[] = []): SceneNode[] {
  if (!children) return out;
  for (const c of children) {
    if (!c) continue;
    if (Array.isArray(c)) flatten(c, out);
    else out.push(c as SceneNode);
  }
  return out;
}

export function box(style: NodeStyle = {}, children?: readonly Child[]): SceneNode {
  style = withClass(style);
  return { type: 'box', style, children: flatten(children) };
}

export function span(content: string, style: TextProps = {}): Span {
  return { __span: true, text: content, style };
}

const TEXT_KEYS = new Set([
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariations',
  'fontFeatures',
  'color',
  'letterSpacing',
  'wordSpacing',
  'lineHeight',
  'textAlign',
  'textDecoration',
  'textShadow',
  'stroke',
  'maxLines',
  'ellipsis',
  'locale',
  'direction',
  'visibleGraphemes',
  'split',
  'warp',
]);

export function text(content: string | readonly (string | Span)[], style: NodeStyle & TextProps = {}): SceneNode {
  style = withClass(style);
  const t: TextProps = {};
  const s: NodeStyle = {};
  for (const [k, v] of Object.entries(style)) (TEXT_KEYS.has(k) ? (t as any) : (s as any))[k] = v;
  return {
    type: 'text',
    content: typeof content === 'string' ? [content] : [...content],
    text: t,
    style: s,
    children: [],
  };
}

export function image(
  source: ImageAsset | Image,
  style: NodeStyle & {
    fit?: Fit;
    objectPosition?: readonly [number | string, number | string];
    sampling?: 'linear' | 'nearest' | 'mipmap' | 'cubic';
  } = {},
): SceneNode {
  style = withClass(style);
  const { fit = 'fill', objectPosition, sampling, ...rest } = style;
  return {
    type: 'image',
    source,
    fit,
    objectPosition,
    sampling,
    localTime: currentScope().ctx.timestamp,
    style: rest,
    children: [],
  };
}

export interface VideoProps {
  fit?: Fit;
  /** Part of the source to play, in source seconds. */
  trim?: { start?: number; end?: number };
  playbackRate?: number;
  /**
   * Speed over time for ramps, freezes (0) and reverse (negative): `speed: (t) => (t < 1 ? 1 : 0.25)`. The
   * source position is the integral of the speed. Audio from a clip with `speed` is muted.
   */
  speed?: (t: number) => number;
  loop?: boolean;
  volume?: number | ((timestamp: number) => number);
  muted?: boolean;
}

export function video(media: Input | InputVideoTrack, style: NodeStyle & VideoProps = {}): SceneNode {
  style = withClass(style);
  const { fit = 'fill', trim, playbackRate = 1, loop = false, volume = 1, speed, muted: _muted, ...rest } = style;
  const muted = style.muted === true || speed !== undefined;
  const scope = currentScope();
  const start = trim?.start ?? 0;
  let sourceTime = start + (speed ? integrate(speed, scope.ctx.timestamp) : scope.ctx.timestamp * playbackRate);
  if (sourceTime < start) sourceTime = start;
  const end = trim?.end;
  if (end !== undefined && sourceTime >= end)
    sourceTime = loop ? start + ((sourceTime - start) % (end - start)) : end - 1e-6;
  const clip: AudioClip | undefined = muted
    ? undefined
    : {
        media,
        absStart: scope.absStart,
        absEnd: scope.absEnd,
        trimStart: start,
        trimEnd: end ?? Infinity,
        playbackRate,
        loop,
        volume,
      };
  return { type: 'video', media, fit, sourceTime, muted, audio: clip, style: rest, children: [] };
}

export function audio(
  media: Input | InputAudioTrack,
  options: {
    trim?: { start?: number; end?: number };
    volume?: number | ((timestamp: number) => number);
    playbackRate?: number;
    loop?: boolean;
  } = {},
): SceneNode {
  const scope = currentScope();
  const clip: AudioClip = {
    media,
    absStart: scope.absStart,
    absEnd: scope.absEnd,
    trimStart: options.trim?.start ?? 0,
    trimEnd: options.trim?.end ?? Infinity,
    playbackRate: options.playbackRate ?? 1,
    loop: options.loop ?? false,
    volume: options.volume ?? 1,
  };
  return { type: 'audio', clip, style: { display: 'none' }, children: [] };
}

export function lottie(
  asset: LottieAsset,
  style: NodeStyle & { fit?: Fit; time?: number; progress?: number; loop?: boolean; overrides?: unknown } = {},
): SceneNode {
  style = withClass(style);
  const { fit = 'contain', time, progress, loop, overrides, ...rest } = style;
  const scope = currentScope();
  let t = time ?? scope.ctx.timestamp;
  if (progress !== undefined) t = -1 - progress; // negative values encode progress, resolved when drawing
  return { type: 'lottie', asset, fit, time: loop ? -(1e9 + t) : t, overrides, style: rest, children: [] };
}

export function svg(
  asset: SvgAsset,
  style: NodeStyle & { fit?: Fit; attributes?: Record<string, Record<string, string>> } = {},
): SceneNode {
  style = withClass(style);
  const { fit = 'contain', attributes, ...rest } = style;
  return { type: 'svg', asset, fit, attributes, style: rest, children: [] };
}

export function shader(
  effect: RuntimeEffect | string,
  style: NodeStyle & {
    uniforms?: Record<string, number | readonly number[]>;
    children?: Record<string, Shader | ImageAsset | SceneNode>;
  } = {},
): SceneNode {
  style = withClass(style);
  const { uniforms = {}, children = {}, ...rest } = style;
  const scope = currentScope();
  const ctx = scope.ctx;
  const auto = {
    iTime: ctx.timestamp,
    iFrame: ctx.frame,
    iProgress: ctx.duration > 0 && Number.isFinite(ctx.duration) ? Math.min(1, ctx.timestamp / ctx.duration) : 0,
  };
  return {
    type: 'shader',
    effect,
    uniforms: { ...auto, ...uniforms },
    shaderChildren: children,
    style: rest,
    children: [],
  };
}

export function draw(
  fn: (canvas: Canvas, size: { width: number; height: number }, ctx: RenderContext) => void,
  style: NodeStyle = {},
): SceneNode {
  style = withClass(style);
  return { type: 'draw', fn, ctx: currentScope().ctx, style, children: [] };
}

export interface PathStyle {
  /** Fill color or gradient. Defaults to black when there's no stroke, like SVG, and to none when there is. */
  fill?: Color | Gradient | null;
  stroke?: Color | Gradient;
  /** Default 1. */
  strokeWidth?: number;
  strokeCap?: 'butt' | 'round' | 'square';
  strokeJoin?: 'miter' | 'round' | 'bevel';
  /**
   * Draws only part of the path, as fractions of its total length: `{ end: progress }` draws it on.
   * `offset` moves the drawn part along the path.
   */
  trim?: { start?: number; end?: number; offset?: number };
  /** Arrowheads at the ends of the (trimmed) path. `true` sizes them from the stroke width. */
  arrow?: { start?: boolean | number; end?: boolean | number };
}

const parsedPaths = new Map<string, Path>();

/** Parses SVG path data once and reuses it. */
export function pathFromSVG(d: string): Path {
  let p = parsedPaths.get(d);
  if (!p) {
    const parsed = Path.fromSVG(d);
    if (!parsed) throw new SyntaxError(`path: invalid SVG path data '${d.slice(0, 40)}'`);
    p = parsed;
    if (parsedPaths.size > 500) {
      const oldest = parsedPaths.keys().next().value!;
      parsedPaths.delete(oldest);
    }
    parsedPaths.set(d, p);
  }
  return p;
}

/**
 * A vector path, from SVG path data or a `Path`. Its coordinates are in the node's own space; the node's size
 * defaults to the right and bottom edges of the path.
 */
export function path(d: string | Path, style: NodeStyle & PathStyle = {}): SceneNode {
  style = withClass(style);
  const p = typeof d === 'string' ? pathFromSVG(d) : d;
  const { fill, stroke, strokeWidth, strokeCap, strokeJoin, trim, arrow, ...rest } = style;
  if (!rest.size) {
    const b = p.computeTightBounds();
    rest.size = { width: Math.max(0, b.right), height: Math.max(0, b.bottom) };
  }
  return {
    type: 'path',
    path: p,
    fill,
    stroke,
    strokeWidth,
    strokeCap,
    strokeJoin,
    trim,
    arrow,
    style: rest,
    children: [],
  };
}

/**
 * An adjustment layer: grades, effects or blur applied to everything beneath it (earlier siblings and what's
 * behind its parent), inside its own box. Full size by default.
 */
export function adjustmentLayer(
  adjust: { grade?: Grade | readonly Grade[]; effects?: readonly Effect[]; blur?: number },
  style: NodeStyle = {},
): SceneNode {
  return {
    type: 'box',
    style: { position: 'absolute', inset: 0, size: { width: '100%', height: '100%' }, ...style, backdrop: adjust },
    children: [],
  };
}

/**
 * A clipping mask, as in Photoshop: `layers` are drawn only where `base` is, keeping its shape. For a photo
 * inside text: `clipTo(text('SALE', ...), image(photo, ...))`.
 */
export function clipTo(base: SceneNode, ...layers: Child[]): SceneNode {
  const over = flatten(layers).map((l) => ({
    ...l,
    style: { position: 'absolute' as const, inset: 0, ...l.style, blendMode: BlendMode.SrcATop },
  }));
  return { type: 'box', style: { isolate: true }, children: [base, ...over] };
}

/** Shows content during `[start, end)` seconds with local time. */
export function sequence(
  range: {
    start: number;
    end?: number;
    /** Seconds the content stays after `end`, with `ctx.exit` rising from 0 to 1, for exit animations. */
    exit?: number;
    /** Maps time inside the sequence, for speed ramps, freezes or reverse: `(t) => t * 0.5`. */
    time?: (t: number) => number;
  },
  render: (ctx: RenderContext) => Child,
): SceneNode | null {
  const scope = currentScope();
  const t = scope.ctx.timestamp;
  const end = range.end ?? Infinity;
  const exitDur = Math.max(0, range.exit ?? 0);
  if (t < range.start || t >= end + exitDur) return null;
  const parentDur = scope.ctx.duration;
  const duration = Number.isFinite(end) ? end - range.start : parentDur - range.start;
  const localT = range.time ? range.time(t - range.start) : t - range.start;
  const local: RenderContext = {
    ...scope.ctx,
    timestamp: localT,
    frame: Math.round(localT * scope.ctx.frameRate),
    duration,
    exit: t >= end && exitDur > 0 ? Math.min(1, (t - end) / exitDur) : 0,
  };
  pushScope({
    ctx: local,
    absStart: scope.absStart + range.start,
    absEnd: Math.min(scope.absEnd, scope.absStart + end + exitDur),
  });
  try {
    const c = render(local);
    const nodes = flatten([c]);
    if (nodes.length === 1) return nodes[0]!;
    return {
      type: 'box',
      style: { position: 'absolute', inset: 0, size: { width: '100%', height: '100%' } },
      children: nodes,
    };
  } finally {
    popScope();
  }
}

export interface TransitionOptions {
  /** A transition name from gl-transitions, such as 'CrossZoom' or 'Dreamy'. See `listTransitions()`. */
  name: string;
  /** Seconds, centered on the cut. */
  duration: number;
  params?: Record<string, number | boolean | readonly number[]>;
  easing?: (t: number) => number;
}

/**
 * Blends from one scene to another with a gl-transitions shader. `progress` 0 shows `from`, 1 shows `to`.
 * Both scenes render at the node's size.
 */
export function transition(
  name: string,
  progress: number,
  from: Child,
  to: Child,
  options: {
    params?: Record<string, number | boolean | readonly number[]>;
    /** Extra images some transitions need, by name (see `TransitionInfo.textures`). */
    textures?: Record<string, ImageAsset | Shader | SceneNode>;
  } & NodeStyle = {},
): SceneNode {
  const { params = {}, textures = {}, ...style } = options;
  const uniforms: Record<string, number | readonly number[]> = { progress: Math.min(1, Math.max(0, progress)) };
  for (const [k, v] of Object.entries(params)) uniforms[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
  const full = { size: { width: '100%', height: '100%' } } as const;
  return {
    type: 'shader',
    effect: '',
    transition: name,
    uniforms,
    shaderChildren: { _from: box(full, [from]), _to: box(full, [to]), ...textures },
    style: { size: { width: '100%', height: '100%' }, ...style },
    children: [],
  };
}

/** One item of a `series`. */
export interface SeriesItem {
  duration: number;
  /** Negative overlaps the item with the previous one. */
  offset?: number;
  render: (ctx: RenderContext) => Child;
  /** A transition into the next item, centered on the cut. */
  transition?: TransitionOptions;
}

/** Plays items one after another. Negative `offset` overlaps an item with the previous one. */
export function series(ctx: RenderContext, items: readonly SeriesItem[]): SceneNode | null {
  let start = 0;
  const out: SceneNode[] = [];
  const starts: number[] = [];
  for (const item of items) {
    start += item.offset ?? 0;
    starts.push(start);
    start += item.duration;
  }
  // Inside a transition window, blend the two items around the cut.
  for (let i = 0; i < items.length - 1; i++) {
    const tr = items[i]!.transition;
    if (!tr || tr.duration <= 0) continue;
    const cut = starts[i]! + items[i]!.duration;
    const a = cut - tr.duration / 2,
      b = cut + tr.duration / 2;
    if (ctx.timestamp >= a && ctx.timestamp < b) {
      let p = (ctx.timestamp - a) / (b - a);
      if (tr.easing) p = tr.easing(p);
      const at = (k: number) => {
        const s = starts[k]!,
          d = items[k]!.duration;
        return sequence({ start: s, end: s + d + tr.duration }, (c) =>
          items[k]!.render({ ...c, timestamp: Math.min(Math.max(c.timestamp, 0), d) }),
        );
      };
      const from = at(i);
      const to = sequence({ start: starts[i + 1]! - tr.duration, end: starts[i + 1]! + items[i + 1]!.duration }, (c) =>
        items[i + 1]!.render({
          ...c,
          timestamp: Math.max(0, c.timestamp - tr.duration),
          duration: items[i + 1]!.duration,
        }),
      );
      return transition(tr.name, p, from, to, { params: tr.params, position: 'absolute', inset: 0 });
    }
  }
  for (let i = 0; i < items.length; i++) {
    const s = starts[i]!,
      end = s + items[i]!.duration;
    if (ctx.timestamp >= s && ctx.timestamp < end) {
      const n = sequence({ start: s, end }, items[i]!.render);
      if (n) out.push(n);
    }
  }
  if (!out.length) return null;
  if (out.length === 1) return out[0]!;
  return {
    type: 'box',
    style: { position: 'absolute', inset: 0, size: { width: '100%', height: '100%' } },
    children: out.map((n) => ({ ...n, style: { position: 'absolute', inset: 0, ...n.style } })),
  };
}

export function linearGradient(angleDeg: number, stops: readonly (Color | readonly [Color, number])[]): Gradient {
  return { __gradient: 'linear', angle: angleDeg, stops };
}

export function radialGradient(
  stops: readonly (Color | readonly [Color, number])[],
  options: { center?: readonly [number | string, number | string]; radius?: number | string } = {},
): Gradient {
  return { __gradient: 'radial', stops, center: options.center, radius: options.radius };
}

export type { FontAsset };
