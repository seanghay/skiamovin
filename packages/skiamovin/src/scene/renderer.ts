// Renders a composition frame: builds the node tree, lays it out with Taffy, and draws it with Skia.
import { type Input, type InputVideoTrack, type VideoSample, VideoSampleSink } from 'mediabunny';
import { type Color, toColor4f, toColorInt } from '../core/color.ts';
import { BLEND_MODE_NAMES, BlendMode, BlurStyle, ColorSpace, ColorType, PaintStyle, TileMode } from '../core/enums.ts';
import { M44, Matrix, Rect, RRect } from '../core/geometry.ts';
import { _sharedGlCanvas, type DirectContext, gpu } from '../core/gpu.ts';
import {
  type Canvas,
  type Image,
  type ImageFilter,
  ImageInfo,
  imageFilters,
  maskFilters,
  Paint,
  type Picture,
  PictureRecorder,
  RuntimeEffect,
  Shader,
  type Surface,
  surfaces,
} from '../core/skia.ts';
import { FontMgr, FontStyle, textlayout } from '../core/text.ts';
import { borrowImageFromVideoSample, drawFit } from '../media/index.ts';
import { type Style, TaffyTree } from '../taffy/index.ts';
import { FontAsset, ImageAsset, LottieAsset, SvgAsset } from './assets.ts';
import type { Composition } from './composition.ts';
import {
  type AudioClip,
  type Gradient,
  popScope,
  pushScope,
  type RenderContext,
  type SceneNode,
  type Shadow,
  type Span,
  type TextProps,
  type Transform,
} from './nodes.ts';

const LAYOUT_KEYS = new Set([
  'display',
  'boxSizing',
  'position',
  'inset',
  'size',
  'minSize',
  'maxSize',
  'aspectRatio',
  'margin',
  'padding',
  'border',
  'overflow',
  'scrollbarWidth',
  'alignItems',
  'alignSelf',
  'justifyItems',
  'justifySelf',
  'alignContent',
  'justifyContent',
  'gap',
  'rowGap',
  'columnGap',
  'flexDirection',
  'flexWrap',
  'flexBasis',
  'flexGrow',
  'flexShrink',
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridAutoColumns',
  'gridAutoRows',
  'gridAutoFlow',
  'gridRow',
  'gridColumn',
  'gridTemplateAreas',
  'gridArea',
  'textAlign',
]);

function layoutStyle(s: Record<string, unknown>): Style {
  const out: Record<string, unknown> = {};
  for (const k in s) if (LAYOUT_KEYS.has(k) && s[k] !== undefined) out[k] = s[k];
  return out as Style;
}

export type GpuChoice = 'auto' | 'metal' | 'vulkan' | 'd3d12' | 'webgpu' | 'webgl2' | 'raster';

export interface RendererOptions {
  /** Output size (defaults to the composition size). */
  width?: number;
  height?: number;
  fit?: 'fill' | 'contain' | 'cover';
  gpu?: GpuChoice;
  props?: Record<string, unknown>;
  /** Set when frames will be encoded, so on macOS the encoder can read them without copying. */
  encode?: boolean;
  /** Web: draw into the WebGL canvas and capture each frame as an ImageBitmap (`lastBitmap`). */
  capture?: boolean;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  /** content inset: left, top, right, bottom (padding + border) */
  inset: [number, number, number, number];
}

class LruCache<K, V extends { delete?(): void }> {
  #m = new Map<K, V>();
  constructor(readonly max: number) {}
  get(k: K): V | undefined {
    const v = this.#m.get(k);
    if (v !== undefined) {
      this.#m.delete(k);
      this.#m.set(k, v);
    }
    return v;
  }
  set(k: K, v: V): void {
    this.#m.set(k, v);
    while (this.#m.size > this.max) {
      const [fk, fv] = this.#m.entries().next().value as [K, V];
      this.#m.delete(fk);
      fv.delete?.();
    }
  }
  clear(): void {
    for (const v of this.#m.values()) v.delete?.();
    this.#m.clear();
  }
}

/** Decoded video frames as Skia images, at any timestamp. */
class VideoFrameProvider {
  #sink: VideoSampleSink;
  #iter: AsyncIterator<VideoSample> | null = null;
  #cur: { ts: number; end: number; image: Image; sample: VideoSample | null } | null = null;
  #pending: VideoSample | null = null;
  #ctx: DirectContext | null;
  constructor(track: InputVideoTrack, ctx: DirectContext | null) {
    this.#sink = new VideoSampleSink(track);
    this.#ctx = ctx;
  }
  async #take(s: VideoSample): Promise<void> {
    // The image may share the decoder's memory, so keep the sample open until it is replaced.
    const { image, borrowed } = await borrowImageFromVideoSample(s, this.#ctx);
    this.#cur?.image.delete();
    this.#cur?.sample?.close();
    this.#cur = { ts: s.timestamp, end: s.timestamp + (s.duration || 1 / 30), image, sample: borrowed ? s : null };
    if (!borrowed) s.close();
  }
  async imageAt(t: number): Promise<Image | null> {
    const eps = 1e-6;
    const cur = this.#cur;
    if (cur && t >= cur.ts - eps && t < cur.end - eps) return cur.image;
    if (!this.#iter || !cur || t < cur.ts - eps || t > cur.end + 2) {
      await this.#iter?.return?.();
      this.#pending?.close();
      this.#pending = null;
      this.#iter = this.#sink.samples(Math.max(0, t))[Symbol.asyncIterator]();
    }
    for (;;) {
      const s = this.#pending ?? (await this.#iter!.next()).value ?? null;
      this.#pending = null;
      if (!s) return this.#cur?.image ?? null; // past the end: hold the last frame
      const end = s.timestamp + (s.duration || 1 / 30);
      if (!this.#cur || end > t + eps || s.timestamp <= t + eps) {
        if (s.timestamp > t + eps && this.#cur && this.#cur.ts <= t) {
          // `s` is in the future; keep it for later and show the current frame.
          this.#pending = s;
          return this.#cur.image;
        }
        await this.#take(s);
        if (this.#cur!.end > t + eps) return this.#cur!.image;
      } else s.close();
    }
  }
  async dispose(): Promise<void> {
    await this.#iter?.return?.();
    this.#pending?.close();
    this.#cur?.image.delete();
    this.#cur?.sample?.close();
  }
}

function pct(v: number | string | undefined, ref: number, dflt: number): number {
  if (v === undefined) return dflt;
  if (typeof v === 'number') return v;
  if (v.endsWith('%')) return (parseFloat(v) / 100) * ref;
  return parseFloat(v);
}

export class FrameRenderer {
  readonly comp: Composition<any>;
  readonly props: any;
  readonly outWidth: number;
  readonly outHeight: number;
  readonly fit: 'fill' | 'contain' | 'cover';
  readonly gpuChoice: GpuChoice;
  context: DirectContext | null = null;
  surface: Surface | null = null;
  /** Output surfaces used in turn on macOS, so the encoder reads frames without copying. */
  #ring: Surface[] = [];
  #ringIndex = 0;
  readonly #encode: boolean;
  readonly #captureWanted: boolean;
  #glCanvas: OffscreenCanvas | null = null;
  /** Web capture mode: the frame just rendered, as an ImageBitmap. The caller takes ownership. */
  lastBitmap: ImageBitmap | null = null;
  duration = 0;

  #tree = new TaffyTree();
  #fonts = new textlayout.FontCollection();
  #provider = new textlayout.TypefaceFontProvider();
  #defaultFamily: string | null = null;
  #paragraphs = new LruCache<string, InstanceType<typeof textlayout.Paragraph>>(400);
  #effects = new Map<string, RuntimeEffect>();
  #pictures = new LruCache<string, Picture>(64);
  #videos = new Map<string, VideoFrameProvider>();
  #videoTracks = new Map<Input | InputVideoTrack, InputVideoTrack | null>();
  #videoCounter = new Map<InputVideoTrack, number>();
  #paint = new Paint();
  #initialized = false;

  constructor(comp: Composition<any>, options: RendererOptions = {}) {
    this.comp = comp;
    this.props = { ...comp.defaultProps, ...(options.props ?? {}) };
    this.outWidth = options.width ?? comp.width;
    this.outHeight = options.height ?? comp.height;
    this.fit = options.fit ?? 'fill';
    this.gpuChoice = options.gpu ?? 'auto';
    this.#encode = options.encode ?? false;
    this.#captureWanted = options.capture ?? options.encode ?? false;
    this.#tree.disableRounding();
  }

  get backend(): string {
    return this.context?.backend() ?? 'raster';
  }

  async init(): Promise<void> {
    if (this.#initialized) return;
    this.#initialized = true;
    this.duration = await this.comp.computeDuration(this.props);
    for (const f of this.comp.fonts) {
      const tf = await f.getTypeface();
      const fam = await f.getFamilyName();
      this.#provider.registerTypeface(tf, fam);
      this.#defaultFamily ??= fam;
    }
    this.#fonts.setAssetFontManager(this.#provider);
    this.#fonts.setDefaultFontManager(FontMgr.default());
    this.#fonts.enableFontFallback();
    if (this.gpuChoice !== 'raster') {
      this.context = gpu.directContexts.makeDefault();
    }
    if (this.#encode && this.context && this.context.backend() === 'metal') {
      for (let i = 0; i < FrameRenderer.RING; i++) {
        const s = gpu.surfaces.renderTarget(
          this.context,
          gpu.Budgeted.Yes,
          new ImageInfo(this.outWidth, this.outHeight, ColorType.N32, 2, colorSpaceCode(this.comp.colorSpace)),
          { encoderCompatible: true },
        );
        if (!s?.isEncoderCompatible()) {
          s?.delete();
          break;
        }
        this.#ring.push(s);
      }
      if (this.#ring.length < FrameRenderer.RING) {
        for (const s of this.#ring) s.delete();
        this.#ring = [];
      }
    }
    // On the web, draw straight into the WebGL canvas and pass frames on as ImageBitmaps.
    if (
      !this.#ring.length &&
      this.#captureWanted &&
      this.context?.backend() !== 'metal' &&
      this.context &&
      typeof OffscreenCanvas !== 'undefined'
    ) {
      const canvas = _sharedGlCanvas();
      if (canvas) {
        canvas.width = this.outWidth;
        canvas.height = this.outHeight;
        const s = gpu.surfaces._wrapCanvasFramebuffer(this.context, this.outWidth, this.outHeight);
        if (s) {
          this.#glCanvas = canvas;
          this.surface = s;
        }
      }
    }
    this.surface ??= this.#ring[0] ?? this.#makeSurface(this.outWidth, this.outHeight);
  }

  /** True when frames are captured as ImageBitmaps (web with WebGL). */
  get captures(): boolean {
    return this.#glCanvas !== null;
  }

  /** Number of output surfaces, so the encoder can work on some while the next is drawn. */
  static readonly RING = 8;
  /** For `videoSampleFromSurface`: how many frames may still be encoding when the next one is drawn. */
  get maxInFlight(): number {
    return this.#ring.length ? FrameRenderer.RING - 2 : 0;
  }

  #makeSurface(w: number, h: number): Surface {
    const cs = colorSpaceCode(this.comp.colorSpace);
    const info = new ImageInfo(w, h, ColorType.N32, 2, cs);
    const s = this.context
      ? gpu.surfaces.renderTarget(this.context, gpu.Budgeted.Yes, info, { sampleCount: 1 })
      : surfaces.raster(info);
    if (!s) throw new Error(`could not allocate a ${w}x${h} surface`);
    return s;
  }

  /** Runs the user's render function for `timestamp`. */
  buildTree(timestamp: number): SceneNode[] {
    const ctx: RenderContext = {
      timestamp,
      duration: this.duration,
      frame: Math.round(timestamp * this.comp.frameRate),
      frameRate: this.comp.frameRate,
      width: this.comp.width,
      height: this.comp.height,
      props: this.props,
    };
    pushScope({ ctx, absStart: 0, absEnd: this.duration });
    try {
      const out: SceneNode[] = [];
      const walk = (c: unknown) => {
        if (!c) return;
        if (Array.isArray(c)) c.forEach(walk);
        else out.push(c as SceneNode);
      };
      walk(this.comp.render(ctx));
      return out;
    } finally {
      popScope();
    }
  }

  /** Audible clips present at `timestamp`. */
  collectAudio(timestamp: number): AudioClip[] {
    const clips: AudioClip[] = [];
    const visit = (n: SceneNode) => {
      if (n.type === 'audio') clips.push(n.clip);
      if (n.type === 'video' && n.audio) clips.push(n.audio);
      n.children.forEach(visit);
      if (n.style.mask) visit(n.style.mask);
      if (n.type === 'shader')
        for (const c of Object.values(n.shaderChildren))
          if (c && typeof c === 'object' && 'type' in c) visit(c as SceneNode);
    };
    this.buildTree(timestamp).forEach(visit);
    return clips;
  }

  /** Renders one frame into `this.surface`. */
  async renderFrame(timestamp: number): Promise<Surface> {
    await this.init();
    const nodes = this.buildTree(timestamp);
    await this.#prepare(nodes);
    if (this.#ring.length) this.surface = this.#ring[this.#ringIndex++ % this.#ring.length]!;
    const glCanvas = this.#glCanvas;
    if (glCanvas && (glCanvas.width !== this.outWidth || glCanvas.height !== this.outHeight)) {
      // The canvas is shared per thread; another renderer may have resized it.
      glCanvas.width = this.outWidth;
      glCanvas.height = this.outHeight;
    }
    const canvas = this.surface!.canvas();
    canvas.clear(this.comp.background ?? 0);
    canvas.save();
    const sx = this.outWidth / this.comp.width,
      sy = this.outHeight / this.comp.height;
    if (this.fit === 'fill') canvas.scale([sx, sy]);
    else {
      const s = this.fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
      canvas.translate([(this.outWidth - this.comp.width * s) / 2, (this.outHeight - this.comp.height * s) / 2]);
      canvas.scale([s, s]);
    }
    const root: SceneNode = {
      type: 'box',
      style: { size: { width: this.comp.width, height: this.comp.height } },
      children: nodes,
    };
    this.#videoCounter.clear();
    await this.#paintTree(canvas, root, this.comp.width, this.comp.height);
    canvas.restore();
    this.surface!.flushAndSubmit();
    if (glCanvas) {
      // Synchronously after drawing, so no other renderer on this thread can touch the canvas in between.
      this.lastBitmap?.close();
      this.lastBitmap = glCanvas.transferToImageBitmap();
    }
    return this.surface!;
  }

  // Loading assets and video frames

  async #prepare(nodes: SceneNode[]): Promise<void> {
    const loads: Promise<unknown>[] = [];
    const visit = (n: SceneNode) => {
      if (n.type === 'image' && n.source instanceof ImageAsset && !n.source._loaded()) loads.push(n.source._get());
      if (n.type === 'svg' && !n.asset._loaded()) loads.push(n.asset._get());
      if (n.type === 'lottie') loads.push(n.asset._get());
      if (n.type === 'video' && !this.#videoTracks.has(n.media)) {
        const m = n.media as any;
        loads.push(
          (async () =>
            this.#videoTracks.set(
              n.media,
              typeof m.getPrimaryVideoTrack === 'function' ? await m.getPrimaryVideoTrack() : m,
            ))(),
        );
      }
      if (n.type === 'shader')
        for (const c of Object.values(n.shaderChildren)) {
          if (c instanceof ImageAsset && !c._loaded()) loads.push(c._get());
          else if (c && typeof c === 'object' && 'type' in c) visit(c as SceneNode);
        }
      if (n.style.mask) visit(n.style.mask);
      n.children.forEach(visit);
    };
    nodes.forEach(visit);
    await Promise.all(loads);
  }

  async #videoImage(media: Input | InputVideoTrack, t: number): Promise<Image | null> {
    const track = this.#videoTracks.get(media);
    if (!track) return null;
    const idx = this.#videoCounter.get(track) ?? 0;
    this.#videoCounter.set(track, idx + 1);
    const key = `${(track as any).id ?? 0}:${idx}:${this.#trackKey(track)}`;
    let p = this.#videos.get(key);
    if (!p) {
      p = new VideoFrameProvider(track, this.context);
      this.#videos.set(key, p);
    }
    return p.imageAt(t);
  }
  #trackIds = new WeakMap<object, number>();
  #trackCounter = 0;
  #trackKey(o: object): number {
    let v = this.#trackIds.get(o);
    if (v === undefined) {
      v = ++this.#trackCounter;
      this.#trackIds.set(o, v);
    }
    return v;
  }

  // Layout

  #paragraphFor(n: Extract<SceneNode, { type: 'text' }>): InstanceType<typeof textlayout.Paragraph> {
    const key = JSON.stringify([n.content, n.text, this.#defaultFamily], (_k, v) =>
      v && typeof v === 'object' && 'handle' in v ? `#${(v as { handle: number }).handle}` : v,
    );
    let p = this.#paragraphs.get(key);
    if (!p) {
      p = this.#buildParagraph(n.content, n.text);
      this.#paragraphs.set(key, p);
    }
    return p;
  }

  #textStyle(t: TextProps, hidden = false): InstanceType<typeof textlayout.TextStyle> {
    const s = new textlayout.TextStyle();
    const fams = t.fontFamily
      ? typeof t.fontFamily === 'string'
        ? [t.fontFamily]
        : [...t.fontFamily]
      : this.#defaultFamily
        ? [this.#defaultFamily]
        : [];
    if (fams.length) s.setFontFamilies(fams);
    s.setFontSize(t.fontSize ?? 16);
    const weight =
      t.fontWeight === 'bold' ? 700 : t.fontWeight === 'normal' || t.fontWeight === undefined ? 400 : t.fontWeight;
    s.setFontStyle(new FontStyle(weight, 5, t.fontStyle === 'italic' ? 1 : 0));
    const variations = { ...(t.fontWeight !== undefined ? { wght: weight } : {}), ...(t.fontVariations ?? {}) };
    if (Object.keys(variations).length) s.setFontArguments({ variationDesignPosition: variations });
    if (t.fontFeatures) s.setFontFeatures(t.fontFeatures);
    if (t.lineHeight !== undefined) s.setHeight(t.lineHeight);
    if (t.letterSpacing !== undefined) s.setLetterSpacing(t.letterSpacing);
    if (t.wordSpacing !== undefined) s.setWordSpacing(t.wordSpacing);
    if (t.locale) s.setLocale(t.locale);
    if (t.textDecoration && t.textDecoration !== 'none') {
      const bits = { underline: 1, overline: 2, 'line-through': 4 }[t.textDecoration];
      s.setDecoration(bits, 0, typeof t.color === 'number' || typeof t.color === 'string' ? t.color : 0xff000000);
    }
    if (t.textShadow) {
      const list = Array.isArray(t.textShadow) ? t.textShadow : [t.textShadow];
      s.setShadows(
        (list as Shadow[]).map((sh) => ({ color: sh.color, offset: sh.offset, blurSigma: (sh.blur ?? 0) / 2 })),
      );
    }
    const fg = new Paint().setAntiAlias(true);
    if (hidden) fg.setColor(0);
    else if (t.color instanceof Shader) fg.setShader(t.color);
    else fg.setColor((t.color as Color | undefined) ?? 0xff000000);
    if (t.stroke && !hidden) {
      // Draw the stroke together with the fill.
      fg.setStyle(PaintStyle.StrokeAndFill).setStrokeWidth(t.stroke.width);
    }
    s.setForegroundPaint(fg);
    return s;
  }

  #buildParagraph(content: (string | Span)[], t: TextProps): InstanceType<typeof textlayout.Paragraph> {
    const ps = new textlayout.ParagraphStyle();
    ps.setTextStyle(this.#textStyle(t));
    const align = { left: 0, right: 1, center: 2, justify: 3, start: 4, end: 5 }[t.textAlign ?? 'start'];
    ps.setTextAlign(align as 0);
    if (t.direction === 'rtl') ps.setTextDirection(1);
    if (this.comp.textRendering !== 'native') ps.turnHintingOff();
    if (t.maxLines) ps.setMaxLines(t.maxLines);
    if (t.ellipsis) ps.setEllipsis(t.ellipsis);
    ps.setApplyRoundingHack(false);
    const b = new textlayout.ParagraphBuilder(ps, this.#fonts);
    // For `visibleGraphemes`, lay out all the text and draw the hidden part transparent so nothing moves.
    let remaining = t.visibleGraphemes ?? Infinity;
    const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter() : null;
    const pushRun = (text: string, style: TextProps) => {
      if (remaining === Infinity) {
        b.pushStyle(this.#textStyle(style)).addText(text).pop();
        return;
      }
      const graphemes = seg ? [...seg.segment(text)].map((g) => g.segment) : [...text];
      const vis = graphemes.slice(0, Math.max(0, remaining)).join('');
      const hid = graphemes.slice(Math.max(0, remaining)).join('');
      remaining -= graphemes.length;
      if (vis) b.pushStyle(this.#textStyle(style)).addText(vis).pop();
      if (hid) b.pushStyle(this.#textStyle(style, true)).addText(hid).pop();
    };
    for (const c of content) {
      if (typeof c === 'string') pushRun(c, t);
      else pushRun(c.text, { ...t, ...c.style });
    }
    const p = b.build();
    b.delete();
    ps.delete();
    return p;
  }

  #intrinsic(n: SceneNode): [number, number] | null {
    if (n.type === 'image') {
      const img = n.source instanceof ImageAsset ? n.source._loaded()?.image : n.source;
      return img ? [img.width(), img.height()] : null;
    }
    if (n.type === 'svg') {
      const d = n.asset._loaded()?.dom.intrinsicSize();
      if (!d) return null;
      return [d.width || d.viewBox?.[2] || 0, d.height || d.viewBox?.[3] || 0];
    }
    if (n.type === 'video') {
      const tr = this.#videoTracks.get(n.media);
      return tr ? [tr.squarePixelWidth || tr.codedWidth, tr.squarePixelHeight || tr.codedHeight] : null;
    }
    return null;
  }

  /** Lays out `root` within w×h; returns boxes relative to each node's parent. */
  #layout(root: SceneNode, w: number, h: number): Map<SceneNode, Box> {
    const t = this.#tree;
    t.clear();
    const ids = new Map<SceneNode, number>();
    const build = (n: SceneNode): number => {
      const kids = n.children.map(build);
      const st = layoutStyle(n.style as Record<string, unknown>);
      const id = kids.length ? t.newWithChildren(st, kids) : t.newLeaf(st);
      if (n.type === 'text') t._setParagraphContext(id, this.#paragraphFor(n).handle);
      else if (!kids.length) {
        const s = this.#intrinsic(n);
        if (s) t._setIntrinsicContext(id, s[0], s[1]);
      }
      ids.set(n, id);
      return id;
    };
    const rootId = build(root);
    t.computeLayout(rootId, { width: w, height: h });
    if (typeof process !== 'undefined' && process.env?.SKIAMOVIN_DEBUG_LAYOUT) console.log(t.treeToString(rootId));
    const out = new Map<SceneNode, Box>();
    for (const [n, id] of ids) {
      const l = t.layout(id);
      out.set(n, {
        x: l.location.x,
        y: l.location.y,
        width: l.size.width,
        height: l.size.height,
        inset: [
          l.padding.left + l.border.left,
          l.padding.top + l.border.top,
          l.padding.right + l.border.right,
          l.padding.bottom + l.border.bottom,
        ],
      });
    }
    return out;
  }

  // Painting

  async #paintTree(canvas: Canvas, root: SceneNode, w: number, h: number): Promise<void> {
    const boxes = this.#layout(root, w, h);
    // Load video frames first so painting can run synchronously.
    const frames = new Map<SceneNode, Image | null>();
    const collect = async (n: SceneNode) => {
      if (n.type === 'video') frames.set(n, await this.#videoImage(n.media, n.sourceTime));
      for (const c of n.children) await collect(c);
    };
    await collect(root);
    // Offscreen content (shader children, masks) is rendered up front too.
    const offscreen = new Map<SceneNode, Image>();
    const pre = async (n: SceneNode) => {
      const b = boxes.get(n)!;
      if (n.type === 'shader') {
        for (const c of Object.values(n.shaderChildren)) {
          if (c && typeof c === 'object' && 'type' in c)
            offscreen.set(c as SceneNode, await this.#renderOffscreen(c as SceneNode, b.width, b.height));
        }
      }
      if (n.style.mask) offscreen.set(n.style.mask, await this.#renderOffscreen(n.style.mask, b.width, b.height));
      for (const c of n.children) await pre(c);
    };
    await pre(root);
    this.#paintNode(canvas, root, boxes, frames, offscreen);
  }

  async #renderOffscreen(node: SceneNode, w: number, h: number): Promise<Image> {
    const W = Math.max(1, Math.ceil(w)),
      H = Math.max(1, Math.ceil(h));
    const s = this.#makeSurface(W, H);
    const c = s.canvas();
    c.clear(0);
    const root: SceneNode = { type: 'box', style: { size: { width: W, height: H } }, children: [node] };
    await this.#paintTree(c, root, W, H);
    const img = s.imageSnapshot();
    s.delete();
    return img;
  }

  #paintNode(
    canvas: Canvas,
    n: SceneNode,
    boxes: Map<SceneNode, Box>,
    frames: Map<SceneNode, Image | null>,
    offscreen: Map<SceneNode, Image>,
  ): void {
    const b = boxes.get(n);
    if (!b || n.style.display === 'none') return;
    const st = n.style;
    const { width: w, height: h } = b;
    canvas.save();
    canvas.translate([b.x, b.y]);

    // Transforms apply after layout, so they don't move siblings.
    if (st.transform) this.#applyTransform(canvas, st.transform, st.transformOrigin, w, h);

    const rr = this.#rrect(st.borderRadius, w, h);
    const opacity = st.opacity ?? 1;

    // Backdrop blur: blur what's behind, inside the shape.
    if (st.backdropBlur) {
      canvas.save();
      canvas.clipRRect(rr);
      const bd = imageFilters.blur([st.backdropBlur, st.backdropBlur], TileMode.Clamp);
      canvas.saveLayer({ backdrop: bd });
      canvas.restore();
      canvas.restore();
      bd?.delete();
    }

    // Group effects need a layer.
    let layer = false;
    const filters: ImageFilter[] = [];
    if (opacity < 1 || st.blur || st.filter || st.colorFilter || st.blendMode || st.mask) {
      layer = true;
      const p = new Paint();
      if (opacity < 1) p.setAlphaf(Math.max(0, opacity));
      let f: ImageFilter | null = st.filter ?? null;
      if (st.blur) {
        const bl = imageFilters.blur([st.blur, st.blur], TileMode.Decal, f)!;
        filters.push(bl);
        f = bl;
      }
      if (f) p.setImageFilter(f);
      if (st.colorFilter) p.setColorFilter(st.colorFilter);
      if (st.blendMode !== undefined)
        p.setBlendMode(
          typeof st.blendMode === 'string' ? (BLEND_MODE_NAMES[st.blendMode] ?? BlendMode.SrcOver) : st.blendMode,
        );
      canvas.saveLayer({ paint: p });
      p.delete();
    }

    // Outer shadows
    const shadows = st.shadow ? ((Array.isArray(st.shadow) ? st.shadow : [st.shadow]) as Shadow[]) : [];
    for (const sh of shadows.filter((s) => !s.inset)) {
      const p = this.#paint.reset().setAntiAlias(true).setColor(sh.color);
      const blur = sh.blur ?? 0;
      const mf = blur > 0 ? maskFilters.blur(BlurStyle.Normal, blur / 2) : null;
      p.setMaskFilter(mf);
      const spread = sh.spread ?? 0;
      const [ox, oy] = sh.offset ?? [0, 0];
      canvas.drawRRect(this.#rrect(st.borderRadius, w + spread * 2, h + spread * 2, ox - spread, oy - spread), p);
      p.setMaskFilter(null);
      mf?.delete();
    }

    // Background
    if (st.background !== undefined) {
      const p = this.#paint.reset().setAntiAlias(true).setDither(true);
      let tmp: Shader | null = null;
      if (st.background instanceof Shader) p.setShader(st.background);
      else if (typeof st.background === 'object' && st.background !== null && '__gradient' in st.background) {
        tmp = this.#gradient(st.background as Gradient, w, h);
        p.setShader(tmp);
      } else p.setColor(st.background as Color);
      canvas.drawRRect(rr, p);
      p.setShader(null);
      tmp?.delete();
    }

    // Inset shadows
    for (const sh of shadows.filter((s) => s.inset)) {
      canvas.save();
      canvas.clipRRect(rr);
      const p = this.#paint.reset().setAntiAlias(true).setColor(sh.color);
      const blur = sh.blur ?? 0;
      const mf = blur > 0 ? maskFilters.blur(BlurStyle.Normal, blur / 2) : null;
      p.setMaskFilter(mf);
      const spread = sh.spread ?? 0;
      const [ox, oy] = sh.offset ?? [0, 0];
      const inner = this.#rrect(st.borderRadius, w - spread * 2, h - spread * 2, ox + spread, oy + spread);
      const outer = RRect.newRect(Rect.fromXYWH(-w - blur * 3, -h - blur * 3, w * 3 + blur * 6, h * 3 + blur * 6));
      canvas.drawDRRect(outer, inner, p);
      p.setMaskFilter(null);
      mf?.delete();
      canvas.restore();
    }

    // Border
    const borderW =
      typeof st.border === 'number'
        ? st.border
        : Array.isArray(st.border)
          ? Number(st.border[0])
          : typeof st.border === 'object' && st.border
            ? Number((st.border as { left?: number }).left ?? 0)
            : 0;
    if (borderW > 0 && st.borderColor !== undefined) {
      const p = this.#paint
        .reset()
        .setAntiAlias(true)
        .setStyle(PaintStyle.Stroke)
        .setStrokeWidth(borderW)
        .setColor(st.borderColor);
      canvas.drawRRect(this.#rrect(st.borderRadius, w - borderW, h - borderW, borderW / 2, borderW / 2), p);
    }

    // Clip children/content
    const ov = st.overflow;
    const clip =
      ov === 'hidden' || ov === 'clip' || (typeof ov === 'object' && ov && (ov.x === 'hidden' || ov.x === 'clip'));
    const contentClip = clip || st.borderRadius !== undefined;
    if (clip) canvas.clipRRect(rr);

    // Cached subtree
    if (st.cache) {
      const key = `${st.cache}:${w}x${h}`;
      let pic = this.#pictures.get(key);
      if (!pic) {
        const rec = new PictureRecorder();
        const rc = rec.beginRecording(Rect.fromWH(w, h));
        this.#paintContent(rc, n, b, boxes, frames, offscreen, contentClip ? rr : null);
        pic = rec.finishRecordingAsPicture()!;
        rec.delete();
        this.#pictures.set(key, pic);
      }
      canvas.drawPicture(pic);
    } else {
      this.#paintContent(canvas, n, b, boxes, frames, offscreen, contentClip ? rr : null);
    }

    // Mask
    if (st.mask) {
      const m = offscreen.get(st.mask);
      if (m) {
        const p = new Paint().setBlendMode(BlendMode.DstIn);
        canvas.drawImage(m, [0, 0], p);
        p.delete();
      }
    }

    if (layer) canvas.restore();
    for (const f of filters) f.delete();
    canvas.restore();
  }

  #paintContent(
    canvas: Canvas,
    n: SceneNode,
    b: Box,
    boxes: Map<SceneNode, Box>,
    frames: Map<SceneNode, Image | null>,
    offscreen: Map<SceneNode, Image>,
    clipRR: RRect | null,
  ): void {
    const { width: w, height: h } = b;
    const [il, it, ir, _ib] = b.inset;
    switch (n.type) {
      case 'text': {
        const p = this.#paragraphFor(n);
        p.layout(Math.max(0, w - il - ir));
        if (this.comp.textRendering === 'native' || !p.paintOutlines(canvas, [il, it])) p.paint(canvas, [il, it]);
        break;
      }
      case 'image': {
        const img = n.source instanceof ImageAsset ? n.source._frameAt(n.localTime) : n.source;
        if (img) this.#drawMedia(canvas, img, w, h, n.fit, n.objectPosition, clipRR, n.sampling as never);
        break;
      }
      case 'video': {
        const img = frames.get(n);
        if (img) this.#drawMedia(canvas, img, w, h, n.fit, undefined, clipRR);
        break;
      }
      case 'svg': {
        const dom = n.asset._domWith(n.attributes);
        if (dom) {
          const s = dom.intrinsicSize();
          const iw = s.width || s.viewBox?.[2] || w,
            ih = s.height || s.viewBox?.[3] || h;
          const sc =
            n.fit === 'fill'
              ? [w / iw, h / ih]
              : n.fit === 'cover'
                ? [Math.max(w / iw, h / ih)]
                : n.fit === 'none'
                  ? [1]
                  : [Math.min(w / iw, h / ih)];
          const sx = sc[0]!,
            sy = sc[1] ?? sc[0]!;
          canvas.save();
          if (clipRR) canvas.clipRRect(clipRR);
          canvas.translate([(w - iw * sx) / 2, (h - ih * sy) / 2]);
          canvas.scale([sx, sy]);
          dom.setContainerSize([iw, ih]);
          dom.render(canvas);
          canvas.restore();
        }
        break;
      }
      case 'shader': {
        const effect = typeof n.effect === 'string' ? this.#effect(n.effect) : n.effect;
        const kids: Record<string, Shader | null> = {};
        const temps: Shader[] = [];
        for (const [name, c] of Object.entries(n.shaderChildren)) {
          if (c instanceof Shader) kids[name] = c;
          else if (c instanceof ImageAsset) {
            const img = c._loaded()?.image;
            if (img) {
              const sh = img.makeShader(
                TileMode.Clamp,
                TileMode.Clamp,
                'linear',
                Matrix.scale(w / img.width(), h / img.height()),
              );
              temps.push(sh);
              kids[name] = sh;
            }
          } else {
            const img = offscreen.get(c as SceneNode);
            if (img) {
              const sh = img.makeShader(TileMode.Clamp, TileMode.Clamp, 'linear');
              temps.push(sh);
              kids[name] = sh;
            }
          }
        }
        const sh = effect.makeShader({ iResolution: [w, h], ...n.uniforms } as never, kids);
        const p = this.#paint.reset().setShader(sh);
        if (clipRR) canvas.drawRRect(clipRR, p);
        else canvas.drawRect(Rect.fromWH(w, h), p);
        p.setShader(null);
        sh.delete();
        for (const t of temps) t.delete();
        break;
      }
      case 'draw': {
        canvas.save();
        canvas.clipRect(Rect.fromWH(w, h));
        n.fn(canvas, { width: w, height: h }, n.ctx);
        canvas.restore();
        break;
      }
      case 'lottie':
        break;
    }
    const kids = [...n.children].sort((a, c) => (a.style.zIndex ?? 0) - (c.style.zIndex ?? 0));
    for (const c of kids) this.#paintNode(canvas, c, boxes, frames, offscreen);
  }

  #drawMedia(
    canvas: Canvas,
    img: Image,
    w: number,
    h: number,
    fit: string,
    pos: readonly [number | string, number | string] | undefined,
    clipRR: RRect | null,
    sampling?: 'linear' | 'nearest' | 'mipmap' | 'cubic',
  ): void {
    canvas.save();
    if (clipRR) canvas.clipRRect(clipRR);
    const px = pos ? pct(pos[0], 1, 0.5) : 0.5,
      py = pos ? pct(pos[1], 1, 0.5) : 0.5;
    drawFit(canvas, img, Rect.fromWH(w, h), fit as 'fill', [px, py], null, sampling ?? 'linear');
    canvas.restore();
  }

  #effect(sksl: string): RuntimeEffect {
    let e = this.#effects.get(sksl);
    if (!e) {
      e = RuntimeEffect.makeForShader(sksl);
      this.#effects.set(sksl, e);
    }
    return e;
  }

  #rrect(radius: number | readonly number[] | undefined, w: number, h: number, x = 0, y = 0): RRect {
    const r = Rect.fromXYWH(x, y, w, h);
    if (radius === undefined) return RRect.newRect(r);
    const max = Math.min(w, h) / 2;
    const v = typeof radius === 'number' ? [radius, radius, radius, radius] : radius;
    return RRect.fromRadii(
      r,
      v.map((x) => Math.max(0, Math.min(max, x))),
    );
  }

  #gradient(g: Gradient, w: number, h: number): Shader | null {
    // A stop is a color, or [color, position]. (A 4-number array is an RGBA color.)
    const stops = g.stops.map(
      (s) => (Array.isArray(s) && s.length === 2 ? s : [s, undefined]) as [Color, number | undefined],
    );
    const colors = stops.map((s) => s[0]);
    let positions: number[] | null = null;
    if (stops.some((s) => s[1] !== undefined)) {
      positions = stops.map((s, i) => s[1] ?? i / Math.max(1, stops.length - 1));
    }
    if (g.__gradient === 'linear') {
      const a = ((g.angle ?? 180) * Math.PI) / 180;
      const dx = Math.sin(a),
        dy = -Math.cos(a);
      const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
      const cx = w / 2,
        cy = h / 2;
      return Shader.linearGradient(
        [
          [cx - dx * half, cy - dy * half],
          [cx + dx * half, cy + dy * half],
        ],
        colors,
        positions,
        TileMode.Clamp,
      );
    }
    const cx = pct(g.center?.[0], w, w / 2),
      cy = pct(g.center?.[1], h, h / 2);
    const far = Math.max(
      Math.hypot(cx, cy),
      Math.hypot(w - cx, cy),
      Math.hypot(cx, h - cy),
      Math.hypot(w - cx, h - cy),
    );
    const r = g.radius === undefined ? far : pct(g.radius, Math.max(w, h), far);
    return Shader.radialGradient([cx, cy], r, colors, positions, TileMode.Clamp);
  }

  #applyTransform(
    canvas: Canvas,
    tf: Transform | readonly Transform[],
    origin: readonly [number | string, number | string] | undefined,
    w: number,
    h: number,
  ): void {
    const ox = pct(origin?.[0], w, w / 2),
      oy = pct(origin?.[1], h, h / 2);
    canvas.translate([ox, oy]);
    for (const t of (Array.isArray(tf) ? tf : [tf]) as Transform[]) {
      if (t.translate) canvas.translate([t.translate[0], t.translate[1]]);
      if (t.translateX || t.translateY) canvas.translate([t.translateX ?? 0, t.translateY ?? 0]);
      if (t.perspective || t.rotateX || t.rotateY) {
        let m = M44.identity();
        if (t.perspective) m = M44.cssPerspective(t.perspective);
        if (t.rotateX) m = m.concat(M44.rotate([1, 0, 0], (t.rotateX * Math.PI) / 180));
        if (t.rotateY) m = m.concat(M44.rotate([0, 1, 0], (t.rotateY * Math.PI) / 180));
        canvas.concat44(m);
      }
      if (t.rotate) canvas.rotate(t.rotate);
      if (t.scale !== undefined)
        canvas.scale(typeof t.scale === 'number' ? [t.scale, t.scale] : [t.scale[0], t.scale[1]]);
      if (t.skew) canvas.skew([Math.tan((t.skew[0] * Math.PI) / 180), Math.tan((t.skew[1] * Math.PI) / 180)]);
    }
    canvas.translate([-ox, -oy]);
  }

  async dispose(): Promise<void> {
    for (const v of this.#videos.values()) await v.dispose();
    this.#videos.clear();
    this.#paragraphs.clear();
    this.#pictures.clear();
    for (const e of this.#effects.values()) e.delete();
    this.#effects.clear();
    this.#tree.delete();
    this.#paint.delete();
    this.lastBitmap?.close();
    this.lastBitmap = null;
    if (this.#ring.length) {
      for (const s of this.#ring) s.delete();
    } else {
      this.surface?.delete();
    }
    this.#ring = [];
    this.surface = null;
    this.context?.delete();
    this.context = null;
  }
}

function colorSpaceCode(cs: string | undefined): ColorSpace {
  switch (cs) {
    case 'display-p3':
      return ColorSpace.DisplayP3;
    case 'rec2020-pq':
      return ColorSpace.Rec2020PQ;
    case 'rec2020-hlg':
      return ColorSpace.Rec2020HLG;
    default:
      return ColorSpace.SRGB;
  }
}

export { FontAsset, LottieAsset, SvgAsset, toColor4f, toColorInt };
