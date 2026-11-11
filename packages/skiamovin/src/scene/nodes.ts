// Scene nodes: plain objects describing one frame. Built inside `render(ctx)`.
import type { Input, InputAudioTrack, InputVideoTrack } from 'mediabunny';
import type { Color } from '../core/color.ts';
import type { BlendMode } from '../core/enums.ts';
import type { Canvas, ColorFilter, Image, ImageFilter, RuntimeEffect, Shader } from '../core/skia.ts';
import type { Style } from '../taffy/index.ts';
import type { FontAsset, ImageAsset, LottieAsset, SvgAsset } from './assets.ts';

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
  blendMode?: BlendMode | string;
  zIndex?: number;
  mask?: SceneNode;
  cache?: string;
}

export type NodeStyle = Style & VisualStyle;

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
]);

export function text(content: string | readonly (string | Span)[], style: NodeStyle & TextProps = {}): SceneNode {
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
  trim?: { start?: number; end?: number };
  playbackRate?: number;
  loop?: boolean;
  volume?: number | ((timestamp: number) => number);
  muted?: boolean;
}

export function video(media: Input | InputVideoTrack, style: NodeStyle & VideoProps = {}): SceneNode {
  const { fit = 'fill', trim, playbackRate = 1, loop = false, volume = 1, muted = false, ...rest } = style;
  const scope = currentScope();
  const start = trim?.start ?? 0;
  let sourceTime = start + scope.ctx.timestamp * playbackRate;
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
  return { type: 'draw', fn, ctx: currentScope().ctx, style, children: [] };
}

/** Shows content during `[start, end)` seconds with local time. */
export function sequence(
  range: { start: number; end?: number },
  render: (ctx: RenderContext) => Child,
): SceneNode | null {
  const scope = currentScope();
  const t = scope.ctx.timestamp;
  const end = range.end ?? Infinity;
  if (t < range.start || t >= end) return null;
  const parentDur = scope.ctx.duration;
  const duration = Number.isFinite(end) ? end - range.start : parentDur - range.start;
  const local: RenderContext = {
    ...scope.ctx,
    timestamp: t - range.start,
    frame: Math.round((t - range.start) * scope.ctx.frameRate),
    duration,
  };
  pushScope({
    ctx: local,
    absStart: scope.absStart + range.start,
    absEnd: Math.min(scope.absEnd, scope.absStart + end),
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

/** Plays items one after another. Negative `offset` overlaps an item with the previous one. */
export function series(
  ctx: RenderContext,
  items: readonly { duration: number; offset?: number; render: (ctx: RenderContext) => Child }[],
): SceneNode | null {
  let start = 0;
  const out: SceneNode[] = [];
  for (const item of items) {
    start += item.offset ?? 0;
    const end = start + item.duration;
    if (ctx.timestamp >= start && ctx.timestamp < end) {
      const n = sequence({ start, end }, item.render);
      if (n) out.push(n);
    }
    start = end;
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
