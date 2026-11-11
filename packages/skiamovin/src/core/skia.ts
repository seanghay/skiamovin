import { importNode } from '../native/node-import.ts';
import { N } from '../native/runtime.ts';
import { type Color, colors4fArray, toColor4f, toColorInt } from './color.ts';
import {
  AlphaType,
  BLEND_MODE_NAMES,
  BlendMode,
  type BlurStyle,
  ClipOp,
  type ColorChannel,
  ColorSpace,
  ColorType,
  EncodedImageFormat,
  type PaintStyle,
  type Path1DStyle,
  type PathFillType,
  type PathOp,
  type PointMode,
  type StrokeCap,
  type StrokeJoin,
  TileMode,
  type VertexMode,
} from './enums.ts';
import { SkiaError } from './errors.ts';
import {
  M44,
  Matrix,
  type MatrixLike,
  matrixArray,
  type Point,
  Rect,
  type RectLike,
  RRect,
  rectArray,
  toRect,
} from './geometry.ts';
import { EMPTY_F32, EMPTY_U32, h, SkObject } from './object.ts';

// Value types

/** Pixel format of a surface or image. */
export class ImageInfo {
  constructor(
    public width: number,
    public height: number,
    public colorType: ColorType = ColorType.N32,
    public alphaType: AlphaType = AlphaType.Premul,
    public colorSpace: ColorSpace = ColorSpace.SRGB,
  ) {}
  static newN32Premul([w, h]: Point, colorSpace: ColorSpace = ColorSpace.SRGB): ImageInfo {
    return new ImageInfo(w, h, ColorType.N32, AlphaType.Premul, colorSpace);
  }
  static new(
    [w, h]: Point,
    colorType: ColorType,
    alphaType: AlphaType,
    colorSpace: ColorSpace = ColorSpace.SRGB,
  ): ImageInfo {
    return new ImageInfo(w, h, colorType, alphaType, colorSpace);
  }
  bytesPerPixel(): number {
    switch (this.colorType) {
      case ColorType.Alpha_8:
      case ColorType.Gray_8:
        return 1;
      case ColorType.RGB_565:
        return 2;
      case ColorType.RGBA_F16:
        return 8;
      case ColorType.RGBA_F32:
        return 16;
      default:
        return 4;
    }
  }
  minRowBytes(): number {
    return this.width * this.bytesPerPixel();
  }
}

/** How images are sampled when scaled. */
export class SamplingOptions {
  constructor(readonly code: number) {}
  static nearest(): SamplingOptions {
    return new SamplingOptions(0);
  }
  static linear(): SamplingOptions {
    return new SamplingOptions(1);
  }
  static mipmap(): SamplingOptions {
    return new SamplingOptions(2);
  }
  /** Cubic resampling: `CubicResampler.mitchell()` or `CubicResampler.catmullRom()`. */
  static cubic(r: CubicResampler = CubicResampler.mitchell()): SamplingOptions {
    return new SamplingOptions(r.code);
  }
}

export class CubicResampler {
  private constructor(readonly code: number) {}
  static mitchell(): CubicResampler {
    return new CubicResampler(3);
  }
  static catmullRom(): CubicResampler {
    return new CubicResampler(4);
  }
}

export type Sampling = SamplingOptions | 'nearest' | 'linear' | 'mipmap' | 'cubic';

export function samplingCode(s: Sampling | undefined): number {
  if (s === undefined) return 1;
  if (s instanceof SamplingOptions) return s.code;
  return { nearest: 0, linear: 1, mipmap: 2, cubic: 3 }[s];
}

function blendCode(m: BlendMode | string): number {
  if (typeof m === 'number') return m;
  const v = BLEND_MODE_NAMES[m];
  if (v === undefined) throw new TypeError(`Unknown blend mode '${m}'`);
  return v;
}

function f32(v: ArrayLike<number>): Float32Array {
  return v instanceof Float32Array ? v : new Float32Array(v);
}

function flatPoints(pts: readonly Point[]): Float32Array {
  const out = new Float32Array(pts.length * 2);
  pts.forEach((p, i) => {
    out[i * 2] = p[0];
    out[i * 2 + 1] = p[1];
  });
  return out;
}

function _rrectArray(r: RRect | RectLike): Float32Array {
  return r instanceof RRect ? r.toArray() : RRect.newRect(r).toArray();
}

// Surface

/** Pixels in CPU memory (raster) or on the GPU, with a canvas to draw into them. */
export class Surface extends SkObject {
  #canvas: Canvas | null = null;

  /** @internal wraps an existing handle */
  static _wrap(handle: number): Surface {
    return new Surface(handle);
  }

  /** The canvas drawing into this surface. Always the same object. */
  canvas(): Canvas {
    this.#canvas ??= new Canvas(N().surface_canvas(this.handle));
    return this.#canvas;
  }
  width(): number {
    return N().surface_width(this.handle);
  }
  height(): number {
    return N().surface_height(this.handle);
  }
  imageInfo(): ImageInfo {
    const [ct, at] = N().surface_image_info(this.handle);
    return new ImageInfo(this.width(), this.height(), ct as ColorType, at as AlphaType);
  }
  isGpu(): boolean {
    return N().surface_is_gpu(this.handle);
  }
  /** True when a hardware encoder can read this surface without copying. */
  isEncoderCompatible(): boolean {
    return N().surface_iosurface(this.handle) !== 0;
  }
  /** Flushes GPU work and waits for it to finish. */
  flushSync(): void {
    N().surface_flush_sync(this.handle);
  }
  /** Immutable snapshot of the current contents. */
  imageSnapshot(): Image {
    return new Image(N().surface_image_snapshot(this.handle));
  }
  /** Reads pixels (default: the whole surface as RGBA8888 unpremultiplied). */
  readPixels(x = 0, y = 0, info?: ImageInfo): Uint8Array {
    const i = info ?? new ImageInfo(this.width(), this.height(), ColorType.RGBA_8888, AlphaType.Unpremul);
    return N().surface_read_pixels(this.handle, x, y, i.width, i.height, i.colorType, i.alphaType);
  }
  /** Reads pixels without blocking other JavaScript while GPU work finishes. */
  async readPixelsAsync(info?: ImageInfo): Promise<Uint8Array> {
    this.flushAndSubmit();
    return this.readPixels(0, 0, info);
  }
  writePixels(pixels: Uint8Array, info: ImageInfo, x = 0, y = 0): void {
    N().surface_write_pixels(this.handle, x, y, info.width, info.height, info.colorType, info.alphaType, pixels);
  }
  /** Encodes the current contents. */
  encodeToData(format: EncodedImageFormat = EncodedImageFormat.PNG, quality = 100): Uint8Array {
    return N().surface_encode(this.handle, format, quality);
  }
  flushAndSubmit(): void {
    N().surface_flush_and_submit(this.handle);
  }
  override delete(): void {
    this.#canvas = null;
    super.delete();
  }
}

/** CPU raster surfaces. For GPU surfaces see `gpu.surfaces`. */
export const surfaces = {
  raster(info: ImageInfo): Surface | null {
    try {
      return new Surface(N().surface_raster(info.width, info.height, info.colorType, info.alphaType, info.colorSpace));
    } catch {
      return null;
    }
  },
  rasterN32Premul([w, h]: Point): Surface | null {
    try {
      return new Surface(N().surface_raster_n32_premul(w, h));
    } catch {
      return null;
    }
  },
  null([w, h]: Point): Surface | null {
    try {
      return new Surface(N().surface_null(w, h));
    } catch {
      return null;
    }
  },
};

// Canvas

export interface SaveLayerRec {
  bounds?: RectLike | null;
  paint?: Paint | null;
  backdrop?: ImageFilter | null;
}

/** Draws into a surface, picture recorder or PDF page. Owned by its target; never delete it yourself. */
export class Canvas {
  readonly handle: number;
  constructor(handle: number) {
    this.handle = handle;
  }

  save(): number {
    return N().canvas_save(this.handle);
  }
  saveLayer(rec: SaveLayerRec = {}): number {
    return N().canvas_save_layer(this.handle, rectArray(rec.bounds), h(rec.paint), h(rec.backdrop));
  }
  saveLayerAlpha(bounds: RectLike | null, alpha: number): number {
    return N().canvas_save_layer_alpha(this.handle, rectArray(bounds), Math.max(0, Math.min(255, Math.round(alpha))));
  }
  restore(): void {
    N().canvas_restore(this.handle);
  }
  restoreToCount(count: number): void {
    N().canvas_restore_to_count(this.handle, count);
  }
  saveCount(): number {
    return N().canvas_save_count(this.handle);
  }

  translate([dx, dy]: Point): void {
    N().canvas_translate(this.handle, dx, dy);
  }
  scale([sx, sy]: Point): void {
    N().canvas_scale(this.handle, sx, sy);
  }
  rotate(degrees: number, pivot: Point = [0, 0]): void {
    N().canvas_rotate(this.handle, degrees, pivot[0], pivot[1]);
  }
  skew([kx, ky]: Point): void {
    N().canvas_skew(this.handle, kx, ky);
  }
  concat(m: MatrixLike): void {
    N().canvas_concat(this.handle, matrixArray(m));
  }
  concat44(m: M44 | ArrayLike<number>): void {
    N().canvas_concat44(this.handle, m instanceof M44 ? m.m : f32(m));
  }
  setMatrix(m: M44 | ArrayLike<number>): void {
    N().canvas_set_matrix(this.handle, m instanceof M44 ? m.m : f32(m));
  }
  resetMatrix(): void {
    N().canvas_reset_matrix(this.handle);
  }
  localToDevice(): M44 {
    return new M44(N().canvas_local_to_device(this.handle));
  }
  deviceClipBounds(): Rect {
    const [l, t, r, b] = N().canvas_device_clip_bounds(this.handle);
    return new Rect(l!, t!, r!, b!);
  }
  baseLayerSize(): [number, number] {
    const [w, hh] = N().canvas_size(this.handle);
    return [w!, hh!];
  }

  clipRect(rect: RectLike, op: ClipOp = ClipOp.Intersect, antiAlias = false): void {
    const r = toRect(rect);
    N().canvas_clip_rect(this.handle, r.left, r.top, r.right, r.bottom, op, antiAlias);
  }
  clipRRect(rrect: RRect, op: ClipOp = ClipOp.Intersect, antiAlias = true): void {
    N().canvas_clip_rrect(this.handle, rrect.toArray(), op, antiAlias);
  }
  clipPath(path: Path, op: ClipOp = ClipOp.Intersect, antiAlias = true): void {
    N().canvas_clip_path(this.handle, path.handle, op, antiAlias);
  }
  clipShader(shader: Shader, op: ClipOp = ClipOp.Intersect): void {
    N().canvas_clip_shader(this.handle, shader.handle, op);
  }

  clear(color: Color = 0): void {
    N().canvas_clear(this.handle, new Float32Array(toColor4f(color)));
  }
  drawColor(color: Color, mode: BlendMode | string = BlendMode.SrcOver): void {
    N().canvas_draw_color(this.handle, new Float32Array(toColor4f(color)), blendCode(mode));
  }
  drawPaint(paint: Paint): void {
    N().canvas_draw_paint(this.handle, paint.handle);
  }
  drawRect(rect: RectLike, paint: Paint): void {
    const r = toRect(rect);
    N().canvas_draw_rect(this.handle, r.left, r.top, r.right, r.bottom, paint.handle);
  }
  drawRRect(rrect: RRect, paint: Paint): void {
    N().canvas_draw_rrect(this.handle, rrect.toArray(), paint.handle);
  }
  drawDRRect(outer: RRect, inner: RRect, paint: Paint): void {
    N().canvas_draw_drrect(this.handle, outer.toArray(), inner.toArray(), paint.handle);
  }
  drawCircle([cx, cy]: Point, radius: number, paint: Paint): void {
    N().canvas_draw_circle(this.handle, cx, cy, radius, paint.handle);
  }
  drawOval(rect: RectLike, paint: Paint): void {
    const r = toRect(rect);
    N().canvas_draw_oval(this.handle, r.left, r.top, r.right, r.bottom, paint.handle);
  }
  drawArc(oval: RectLike, startAngle: number, sweepAngle: number, useCenter: boolean, paint: Paint): void {
    const r = toRect(oval);
    N().canvas_draw_arc(this.handle, r.left, r.top, r.right, r.bottom, startAngle, sweepAngle, useCenter, paint.handle);
  }
  drawLine([x0, y0]: Point, [x1, y1]: Point, paint: Paint): void {
    N().canvas_draw_line(this.handle, x0, y0, x1, y1, paint.handle);
  }
  drawPoints(mode: PointMode, points: readonly Point[], paint: Paint): void {
    N().canvas_draw_points(this.handle, mode, flatPoints(points), paint.handle);
  }
  drawPath(path: Path, paint: Paint): void {
    N().canvas_draw_path(this.handle, path.handle, paint.handle);
  }
  drawImage(image: Image, [x, y]: Point, paint?: Paint | null): void {
    N().canvas_draw_image(this.handle, image.handle, x, y, 1, h(paint));
  }
  drawImageWithSamplingOptions(image: Image, [x, y]: Point, sampling: Sampling, paint?: Paint | null): void {
    N().canvas_draw_image(this.handle, image.handle, x, y, samplingCode(sampling), h(paint));
  }
  drawImageRect(image: Image, src: RectLike | null, dst: RectLike, paint?: Paint | null, strict = false): void {
    N().canvas_draw_image_rect(this.handle, image.handle, rectArray(src), rectArray(dst), 1, h(paint), strict);
  }
  drawImageRectWithSamplingOptions(
    image: Image,
    src: RectLike | null,
    dst: RectLike,
    sampling: Sampling,
    paint?: Paint | null,
    strict = false,
  ): void {
    N().canvas_draw_image_rect(
      this.handle,
      image.handle,
      rectArray(src),
      rectArray(dst),
      samplingCode(sampling),
      h(paint),
      strict,
    );
  }
  drawImageNine(image: Image, center: RectLike, dst: RectLike, filterLinear = true, paint?: Paint | null): void {
    N().canvas_draw_image_nine(this.handle, image.handle, rectArray(center), rectArray(dst), filterLinear, h(paint));
  }
  drawStr(text: string, [x, y]: Point, font: Font, paint: Paint): void {
    N().canvas_draw_str(this.handle, text, x, y, font.handle, paint.handle);
  }
  drawTextBlob(blob: TextBlob, [x, y]: Point, paint: Paint): void {
    N().canvas_draw_text_blob(this.handle, blob.handle, x, y, paint.handle);
  }
  drawGlyphsAt(
    glyphs: ArrayLike<number>,
    positions: readonly Point[],
    [ox, oy]: Point,
    font: Font,
    paint: Paint,
  ): void {
    N().canvas_draw_glyphs_at(
      this.handle,
      new Uint32Array(glyphs),
      flatPoints(positions),
      ox,
      oy,
      font.handle,
      paint.handle,
    );
  }
  drawPicture(picture: Picture, matrix?: MatrixLike | null, paint?: Paint | null): void {
    N().canvas_draw_picture(this.handle, picture.handle, matrixArray(matrix), h(paint));
  }
  /** Draws sprites from `atlas`. `xforms` are [scos, ssin, tx, ty] per sprite. */
  drawAtlas(
    atlas: Image,
    xforms: readonly (readonly [number, number, number, number])[],
    tex: readonly RectLike[],
    colors: readonly Color[] | null,
    mode: BlendMode | string,
    sampling: Sampling = 'linear',
    paint?: Paint | null,
  ): void {
    N().canvas_draw_atlas(
      this.handle,
      atlas.handle,
      new Float32Array(xforms.flat()),
      new Float32Array(tex.flatMap((r) => toRect(r).toArray())),
      colors ? new Uint32Array(colors.map(toColorInt)) : EMPTY_U32,
      blendCode(mode),
      samplingCode(sampling),
      h(paint),
    );
  }
  drawVertices(
    mode: VertexMode,
    positions: readonly Point[],
    texCoords: readonly Point[] | null,
    colors: readonly Color[] | null,
    indices: readonly number[] | null,
    blend: BlendMode | string,
    paint: Paint,
  ): void {
    N().canvas_draw_vertices(
      this.handle,
      mode,
      flatPoints(positions),
      texCoords ? flatPoints(texCoords) : EMPTY_F32,
      colors ? new Uint32Array(colors.map(toColorInt)) : EMPTY_U32,
      indices ? new Uint32Array(indices) : EMPTY_U32,
      blendCode(blend),
      paint.handle,
    );
  }
  /** Draws a laid-out paragraph (same as `paragraph.paint(canvas, origin)`). */
  drawParagraph(paragraph: { paint(c: Canvas, o: Point): void }, origin: Point): void {
    paragraph.paint(this, origin);
  }
}

// Paint

/** How to draw: color or shader, style, stroke, filters and blending. Setters return `this`. */
export class Paint extends SkObject {
  /** @param _handle internal: adopt an existing native paint */
  constructor(color?: Color, _handle?: number) {
    super(_handle ?? N().paint_new());
    if (color !== undefined) this.setColor(color);
  }
  copy(): Paint {
    return new Paint(undefined, N().paint_copy(this.handle));
  }
  reset(): this {
    N().paint_reset(this.handle);
    return this;
  }
  setColor(color: Color): this {
    if (typeof color === 'number' || typeof color === 'string') N().paint_set_color(this.handle, toColorInt(color));
    else {
      const [r, g, b, a] = toColor4f(color);
      N().paint_set_color4f(this.handle, r, g, b, a, ColorSpace.SRGB);
    }
    return this;
  }
  setColor4f(color: Color, colorSpace: ColorSpace = ColorSpace.SRGB): this {
    const [r, g, b, a] = toColor4f(color);
    N().paint_set_color4f(this.handle, r, g, b, a, colorSpace);
    return this;
  }
  getColor4f(): [number, number, number, number] {
    const c = N().paint_get_color4f(this.handle);
    return [c[0]!, c[1]!, c[2]!, c[3]!];
  }
  setAlphaf(a: number): this {
    N().paint_set_alphaf(this.handle, a);
    return this;
  }
  getAlphaf(): number {
    return N().paint_get_alphaf(this.handle);
  }
  setAntiAlias(aa: boolean): this {
    N().paint_set_anti_alias(this.handle, aa);
    return this;
  }
  setDither(d: boolean): this {
    N().paint_set_dither(this.handle, d);
    return this;
  }
  setStyle(style: PaintStyle): this {
    N().paint_set_style(this.handle, style);
    return this;
  }
  setStrokeWidth(w: number): this {
    N().paint_set_stroke_width(this.handle, w);
    return this;
  }
  getStrokeWidth(): number {
    return N().paint_get_stroke_width(this.handle);
  }
  setStrokeCap(cap: StrokeCap): this {
    N().paint_set_stroke_cap(this.handle, cap);
    return this;
  }
  setStrokeJoin(join: StrokeJoin): this {
    N().paint_set_stroke_join(this.handle, join);
    return this;
  }
  setStrokeMiter(limit: number): this {
    N().paint_set_stroke_miter(this.handle, limit);
    return this;
  }
  setShader(shader: Shader | null): this {
    N().paint_set_shader(this.handle, h(shader));
    return this;
  }
  setColorFilter(f: ColorFilter | null): this {
    N().paint_set_color_filter(this.handle, h(f));
    return this;
  }
  setImageFilter(f: ImageFilter | null): this {
    N().paint_set_image_filter(this.handle, h(f));
    return this;
  }
  setMaskFilter(f: MaskFilter | null): this {
    N().paint_set_mask_filter(this.handle, h(f));
    return this;
  }
  setPathEffect(e: PathEffect | null): this {
    N().paint_set_path_effect(this.handle, h(e));
    return this;
  }
  setBlendMode(mode: BlendMode | string): this {
    N().paint_set_blend_mode(this.handle, blendCode(mode));
    return this;
  }
  setBlender(b: Blender | null): this {
    N().paint_set_blender(this.handle, h(b));
    return this;
  }
  /** The outline this paint would fill for `path` (e.g. a stroke turned into a fillable path). */
  getFillPath(path: Path, resScale = 1): Path {
    return Path._wrap(N().paint_get_fill_path(this.handle, path.handle, resScale));
  }
}

// Path

/** A mutable path. Methods that build return `this`; methods that derive return new paths. */
export class Path extends SkObject {
  constructor(handle?: number) {
    super(handle ?? N().path_new());
  }
  /** @internal */
  static _wrap(handle: number): Path {
    return new Path(handle);
  }
  static fromSVG(d: string): Path | null {
    try {
      return new Path(N().path_from_svg(d));
    } catch {
      return null;
    }
  }
  /** Interpolates: `weight` 1 gives `a`, 0 gives `b`. Null if the paths aren't compatible. */
  static interpolate(a: Path, b: Path, weight: number): Path | null {
    if (!N().path_is_interpolatable(a.handle, b.handle)) return null;
    return new Path(N().path_interpolate(a.handle, b.handle, weight));
  }
  static op(a: Path, b: Path, op: PathOp): Path | null {
    try {
      return new Path(N().path_op(a.handle, b.handle, op));
    } catch {
      return null;
    }
  }
  copy(): Path {
    return new Path(N().path_copy(this.handle));
  }
  toSVGString(): string {
    return N().path_to_svg(this.handle);
  }
  /**
   * The part between `start` and `end`, as fractions of the total length of all contours. `offset` shifts both
   * and wraps around, so a fixed-length piece can travel along the path.
   */
  trim(start: number, end: number, offset = 0): Path {
    return Path._wrap(N().path_trim(this.handle, start, end, offset));
  }
  /** `[x, y, tangentX, tangentY]` at `fraction` of the total length, or null for an empty path. */
  posTanAt(fraction: number): [number, number, number, number] | null {
    const v = N().path_pos_tan_at(this.handle, fraction);
    return v.length ? [v[0]!, v[1]!, v[2]!, v[3]!] : null;
  }
  /** Total length of all contours. */
  totalLength(): number {
    return N().path_total_length(this.handle);
  }
  reset(): this {
    N().path_reset(this.handle);
    return this;
  }
  moveTo([x, y]: Point): this {
    N().path_move_to(this.handle, x, y);
    return this;
  }
  lineTo([x, y]: Point): this {
    N().path_line_to(this.handle, x, y);
    return this;
  }
  quadTo([x1, y1]: Point, [x2, y2]: Point): this {
    N().path_quad_to(this.handle, x1, y1, x2, y2);
    return this;
  }
  conicTo([x1, y1]: Point, [x2, y2]: Point, w: number): this {
    N().path_conic_to(this.handle, x1, y1, x2, y2, w);
    return this;
  }
  cubicTo([x1, y1]: Point, [x2, y2]: Point, [x3, y3]: Point): this {
    N().path_cubic_to(this.handle, x1, y1, x2, y2, x3, y3);
    return this;
  }
  rMoveTo([dx, dy]: Point): this {
    N().path_r_move_to(this.handle, dx, dy);
    return this;
  }
  rLineTo([dx, dy]: Point): this {
    N().path_r_line_to(this.handle, dx, dy);
    return this;
  }
  /** Arc inside `oval` from `startAngle` sweeping `sweepAngle` degrees. */
  arcToOval(oval: RectLike, startAngle: number, sweepAngle: number, forceMoveTo = false): this {
    const r = toRect(oval);
    N().path_arc_to_oval(this.handle, r.left, r.top, r.right, r.bottom, startAngle, sweepAngle, forceMoveTo);
    return this;
  }
  /** Canvas2D-style tangent arc. */
  arcToTangent([x1, y1]: Point, [x2, y2]: Point, radius: number): this {
    N().path_arc_to_tangent(this.handle, x1, y1, x2, y2, radius);
    return this;
  }
  /** SVG-style elliptical arc. */
  arcToRotated([rx, ry]: Point, xAxisRotate: number, useSmallArc: boolean, isCCW: boolean, [x, y]: Point): this {
    N().path_arc_to_radius(this.handle, rx, ry, xAxisRotate, !useSmallArc, isCCW, x, y);
    return this;
  }
  close(): this {
    N().path_close(this.handle);
    return this;
  }
  addRect(rect: RectLike, isCCW = false): this {
    const r = toRect(rect);
    N().path_add_rect(this.handle, r.left, r.top, r.right, r.bottom, isCCW);
    return this;
  }
  addRRect(rrect: RRect, isCCW = false): this {
    N().path_add_rrect(this.handle, rrect.toArray(), isCCW);
    return this;
  }
  addOval(oval: RectLike, isCCW = false): this {
    const r = toRect(oval);
    N().path_add_oval(this.handle, r.left, r.top, r.right, r.bottom, isCCW);
    return this;
  }
  addCircle([cx, cy]: Point, radius: number, isCCW = false): this {
    N().path_add_circle(this.handle, cx, cy, radius, isCCW);
    return this;
  }
  addArc(oval: RectLike, startAngle: number, sweepAngle: number): this {
    const r = toRect(oval);
    N().path_add_arc(this.handle, r.left, r.top, r.right, r.bottom, startAngle, sweepAngle);
    return this;
  }
  addPoly(points: readonly Point[], close: boolean): this {
    N().path_add_poly(this.handle, flatPoints(points), close);
    return this;
  }
  addPath(other: Path, matrix?: MatrixLike | null): this {
    N().path_add_path(this.handle, other.handle, matrixArray(matrix));
    return this;
  }
  setFillType(ft: PathFillType): this {
    N().path_set_fill_type(this.handle, ft);
    return this;
  }
  transform(m: MatrixLike): this {
    N().path_transform(this.handle, matrixArray(m));
    return this;
  }
  offset([dx, dy]: Point): this {
    N().path_offset(this.handle, dx, dy);
    return this;
  }
  makeTransform(m: MatrixLike): Path {
    return new Path(N().path_make_transform(this.handle, matrixArray(m)));
  }
  simplify(): Path | null {
    try {
      return new Path(N().path_simplify(this.handle));
    } catch {
      return null;
    }
  }
  bounds(): Rect {
    const [l, t, r, b] = N().path_bounds(this.handle);
    return new Rect(l!, t!, r!, b!);
  }
  computeTightBounds(): Rect {
    const [l, t, r, b] = N().path_tight_bounds(this.handle);
    return new Rect(l!, t!, r!, b!);
  }
  contains([x, y]: Point): boolean {
    return N().path_contains(this.handle, x, y);
  }
  isEmpty(): boolean {
    return N().path_is_empty(this.handle);
  }
  countPoints(): number {
    return N().path_count_points(this.handle);
  }
  points(): Point[] {
    const p = N().path_points(this.handle);
    const out: Point[] = [];
    for (let i = 0; i < p.length; i += 2) out.push([p[i]!, p[i + 1]!]);
    return out;
  }
  verbs(): number[] {
    return [...N().path_verbs(this.handle)];
  }
  /** Total length of all contours. */
  length(): number {
    let total = 0;
    using it = new ContourMeasureIter(this, false);
    for (let m = it.next(); m; m = it.next()) {
      total += m.length();
      m.delete();
    }
    return total;
  }
}

/**
 * A prepared morph between two paths. Matching the paths happens once, here; `at(t)` is cheap, so build one
 * morph and call `at` every frame.
 */
export class PathMorph extends SkObject {
  constructor(from: Path, to: Path) {
    super(N().path_morph_new(from.handle, to.handle));
  }
  /** The shape at `t`: 0 is `from`, 1 is `to`. */
  at(t: number): Path {
    return Path._wrap(N().path_morph_at(this.handle, t));
  }
}

/** Measures contours of a path: length, position/tangent at a distance, sub-segments. */
export class ContourMeasureIter extends SkObject {
  constructor(path: Path, forceClosed = false, resScale = 1) {
    super(N().contour_measure_iter_new(path.handle, forceClosed, resScale));
  }
  next(): ContourMeasure | null {
    const hh = N().contour_measure_iter_next(this.handle);
    return hh ? new ContourMeasure(hh) : null;
  }
}

export class ContourMeasure extends SkObject {
  length(): number {
    return N().contour_measure_length(this.handle);
  }
  isClosed(): boolean {
    return N().contour_measure_is_closed(this.handle);
  }
  /** `[x, y, tangentX, tangentY]` at `distance`, or null. */
  getPosTan(distance: number): [number, number, number, number] | null {
    const v = N().contour_measure_pos_tan(this.handle, distance);
    return v.length ? [v[0]!, v[1]!, v[2]!, v[3]!] : null;
  }
  getSegment(start: number, stop: number, startWithMoveTo = true): Path {
    return Path._wrap(N().contour_measure_segment(this.handle, start, stop, startWithMoveTo));
  }
}

// Images

export class Image extends SkObject {
  /** @internal */
  static _fromHandle(handle: number): Image {
    return new Image(handle);
  }
  /** Node only: reads and decodes a file. */
  static async fromPath(path: string): Promise<Image> {
    const { readFile } = await importNode<typeof import('node:fs/promises')>('node:fs/promises');
    return Image.fromEncoded(await readFile(path));
  }
  /** Fetches and decodes. */
  static async fromUrl(url: string | URL): Promise<Image> {
    const res = await fetch(url);
    if (!res.ok) throw new SkiaError(`fetch ${url}: ${res.status}`);
    return Image.fromEncoded(new Uint8Array(await res.arrayBuffer()));
  }
  static fromEncoded(bytes: Uint8Array): Image {
    return new Image(N().image_decode(bytes));
  }
  width(): number {
    return N().image_width(this.handle);
  }
  height(): number {
    return N().image_height(this.handle);
  }
  dimensions(): [number, number] {
    return [this.width(), this.height()];
  }
  bounds(): Rect {
    return Rect.fromWH(this.width(), this.height());
  }
  imageInfo(): ImageInfo {
    const [ct, at] = N().image_info(this.handle);
    return new ImageInfo(this.width(), this.height(), ct as ColorType, at as AlphaType);
  }
  isTextureBacked(): boolean {
    return N().image_is_texture_backed(this.handle);
  }
  encodeToData(format: EncodedImageFormat = EncodedImageFormat.PNG, quality = 100): Uint8Array | null {
    try {
      return N().image_encode(this.handle, format, quality);
    } catch {
      return null;
    }
  }
  /** Reads pixels (default: whole image as RGBA8888 unpremultiplied). */
  readPixels(x = 0, y = 0, info?: ImageInfo): Uint8Array {
    const i = info ?? new ImageInfo(this.width(), this.height(), ColorType.RGBA_8888, AlphaType.Unpremul);
    return N().image_read_pixels(this.handle, x, y, i.width, i.height, i.colorType, i.alphaType);
  }
  makeShader(
    tmx: TileMode = TileMode.Clamp,
    tmy: TileMode = TileMode.Clamp,
    sampling?: Sampling,
    localMatrix?: MatrixLike | null,
  ): Shader {
    return new Shader(N().image_make_shader(this.handle, tmx, tmy, samplingCode(sampling), matrixArray(localMatrix)));
  }
  makeRasterImage(): Image {
    return new Image(N().image_make_raster(this.handle));
  }
  makeTextureImage(context: { handle: number }, mipmapped = false): Image {
    return new Image(N().image_make_texture(this.handle, context.handle, mipmapped));
  }
  makeSubset(rect: RectLike): Image {
    return new Image(N().image_make_subset(this.handle, rectArray(rect)));
  }
  makeWithFilter(filter: ImageFilter, subset?: RectLike | null): Image {
    return new Image(N().image_make_with_filter(this.handle, filter.handle, rectArray(subset)));
  }
}

export const images = {
  deferredFromEncodedData(bytes: Uint8Array | ArrayBuffer): Image | null {
    try {
      return new Image(N().image_decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
    } catch {
      return null;
    }
  },
  /** Copies raw pixels into a new raster image. */
  rasterFromPixels(info: ImageInfo, pixels: Uint8Array, rowBytes = info.minRowBytes()): Image | null {
    try {
      return new Image(
        N().image_from_pixels(
          info.width,
          info.height,
          info.colorType,
          info.alphaType,
          info.colorSpace,
          pixels,
          rowBytes,
        ),
      );
    } catch {
      return null;
    }
  },
  rasterFromData(info: ImageInfo, pixels: Uint8Array, rowBytes = info.minRowBytes()): Image | null {
    return images.rasterFromPixels(info, pixels, rowBytes);
  },
  textureFromImage(context: { handle: number }, image: Image, mipmapped = false): Image | null {
    try {
      return image.makeTextureImage(context, mipmapped);
    } catch {
      return null;
    }
  },
};

/** Decodes animated GIF / WebP frames. */
export class Codec extends SkObject {
  static fromData(bytes: Uint8Array): Codec | null {
    try {
      return new Codec(N().codec_new(bytes));
    } catch {
      return null;
    }
  }
  frameCount(): number {
    return N().codec_frame_count(this.handle);
  }
  /** Per-frame durations in milliseconds. */
  frameDurations(): number[] {
    return [...N().codec_frame_durations(this.handle)];
  }
  /** Loop count, or -1 if the file doesn't specify one. */
  repetitionCount(): number {
    return N().codec_repetition_count(this.handle);
  }
  dimensions(): [number, number] {
    const [w, hh] = N().codec_dimensions(this.handle);
    return [w!, hh!];
  }
  getFrame(index: number): Image {
    return new Image(N().codec_get_frame(this.handle, index));
  }
}

// Shaders, effects

export class Shader extends SkObject {
  static linearGradient(
    points: readonly [Point, Point],
    colors: readonly Color[],
    positions: readonly number[] | null,
    mode: TileMode = TileMode.Clamp,
    flags = 0,
    localMatrix?: MatrixLike | null,
  ): Shader | null {
    const [[x0, y0], [x1, y1]] = points;
    try {
      return new Shader(
        N().shader_linear_gradient(
          x0,
          y0,
          x1,
          y1,
          colors4fArray(colors),
          positions ? f32(positions) : EMPTY_F32,
          mode,
          flags,
          matrixArray(localMatrix),
        ),
      );
    } catch {
      return null;
    }
  }
  static radialGradient(
    [cx, cy]: Point,
    radius: number,
    colors: readonly Color[],
    positions: readonly number[] | null,
    mode: TileMode = TileMode.Clamp,
    flags = 0,
    localMatrix?: MatrixLike | null,
  ): Shader | null {
    try {
      return new Shader(
        N().shader_radial_gradient(
          cx,
          cy,
          radius,
          colors4fArray(colors),
          positions ? f32(positions) : EMPTY_F32,
          mode,
          flags,
          matrixArray(localMatrix),
        ),
      );
    } catch {
      return null;
    }
  }
  static twoPointConicalGradient(
    [sx, sy]: Point,
    startRadius: number,
    [ex, ey]: Point,
    endRadius: number,
    colors: readonly Color[],
    positions: readonly number[] | null,
    mode: TileMode = TileMode.Clamp,
    flags = 0,
    localMatrix?: MatrixLike | null,
  ): Shader | null {
    try {
      return new Shader(
        N().shader_two_point_conical_gradient(
          sx,
          sy,
          startRadius,
          ex,
          ey,
          endRadius,
          colors4fArray(colors),
          positions ? f32(positions) : EMPTY_F32,
          mode,
          flags,
          matrixArray(localMatrix),
        ),
      );
    } catch {
      return null;
    }
  }
  static sweepGradient(
    [cx, cy]: Point,
    colors: readonly Color[],
    positions: readonly number[] | null,
    mode: TileMode = TileMode.Clamp,
    angles: Point = [0, 360],
    flags = 0,
    localMatrix?: MatrixLike | null,
  ): Shader | null {
    try {
      return new Shader(
        N().shader_sweep_gradient(
          cx,
          cy,
          colors4fArray(colors),
          positions ? f32(positions) : EMPTY_F32,
          mode,
          angles[0],
          angles[1],
          flags,
          matrixArray(localMatrix),
        ),
      );
    } catch {
      return null;
    }
  }
  withLocalMatrix(m: MatrixLike): Shader {
    return new Shader(N().shader_with_local_matrix(this.handle, matrixArray(m)));
  }
  withColorFilter(cf: ColorFilter): Shader {
    return new Shader(N().shader_with_color_filter(this.handle, cf.handle));
  }
}

export const shaders = {
  color(c: Color): Shader {
    return new Shader(N().shader_color(new Float32Array(toColor4f(c))));
  },
  blend(mode: BlendMode | string, dst: Shader, src: Shader): Shader {
    return new Shader(N().shader_blend(blendCode(mode), dst.handle, src.handle));
  },
  fractalNoise([fx, fy]: Point, numOctaves: number, seed: number, tileSize?: Point): Shader | null {
    try {
      return new Shader(N().shader_fractal_noise(fx, fy, numOctaves, seed, tileSize?.[0] ?? 0, tileSize?.[1] ?? 0));
    } catch {
      return null;
    }
  },
  turbulence([fx, fy]: Point, numOctaves: number, seed: number, tileSize?: Point): Shader | null {
    try {
      return new Shader(N().shader_turbulence(fx, fy, numOctaves, seed, tileSize?.[0] ?? 0, tileSize?.[1] ?? 0));
    } catch {
      return null;
    }
  },
  image(
    image: Image,
    tmx: TileMode = TileMode.Clamp,
    tmy: TileMode = TileMode.Clamp,
    sampling?: Sampling,
    localMatrix?: MatrixLike | null,
  ): Shader {
    return image.makeShader(tmx, tmy, sampling, localMatrix);
  },
};

export class ColorFilter extends SkObject {}
export class ImageFilter extends SkObject {}
export class MaskFilter extends SkObject {}
export class PathEffect extends SkObject {}
export class Blender extends SkObject {}

export interface RuntimeUniform {
  name: string;
  offset: number;
  size: number;
  count: number;
  type: string;
  array: boolean;
}
export interface RuntimeChild {
  name: string;
  index: number;
  type: 'Shader' | 'ColorFilter' | 'Blender';
}

export type UniformValues = Record<string, number | readonly number[] | Float32Array> | Float32Array | Uint8Array;
export type RuntimeChildren =
  | Record<string, Shader | ColorFilter | Blender | null>
  | readonly (Shader | ColorFilter | Blender | null)[];

/** An SkSL program. Compile once, then make shaders/filters/blenders with different uniforms. */
export class RuntimeEffect extends SkObject {
  #uniforms: RuntimeUniform[] | null = null;
  #children: RuntimeChild[] | null = null;

  /** Compiles SkSL; throws `SkiaError` with the compiler message on failure. */
  static makeForShader(sksl: string): RuntimeEffect {
    return new RuntimeEffect(N().runtime_effect_make(0, sksl));
  }
  static makeForColorFilter(sksl: string): RuntimeEffect {
    return new RuntimeEffect(N().runtime_effect_make(1, sksl));
  }
  static makeForBlender(sksl: string): RuntimeEffect {
    return new RuntimeEffect(N().runtime_effect_make(2, sksl));
  }
  uniforms(): RuntimeUniform[] {
    this.#uniforms ??= JSON.parse(N().runtime_effect_uniforms(this.handle));
    return this.#uniforms!;
  }
  children(): RuntimeChild[] {
    this.#children ??= JSON.parse(N().runtime_effect_children(this.handle));
    return this.#children!;
  }
  uniformSize(): number {
    return N().runtime_effect_uniform_size(this.handle);
  }
  /** Packs uniform values (by name) into the byte layout the program expects. Unknown names are ignored. */
  packUniforms(values: UniformValues | undefined): Uint8Array {
    if (values instanceof Uint8Array) return values;
    const size = this.uniformSize();
    if (values instanceof Float32Array) return new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
    const buf = new ArrayBuffer(size);
    const fv = new Float32Array(buf);
    const iv = new Int32Array(buf);
    for (const u of this.uniforms()) {
      const v = values?.[u.name];
      if (v === undefined) continue;
      const arr = typeof v === 'number' ? [v] : v;
      const base = u.offset / 4;
      const n = Math.min(arr.length, u.size / 4);
      const isInt = u.type.startsWith('Int');
      for (let i = 0; i < n; i++) (isInt ? iv : fv)[base + i] = arr[i]!;
    }
    return new Uint8Array(buf);
  }
  #childHandles(children: RuntimeChildren | undefined): Uint32Array {
    const spec = this.children();
    const out = new Uint32Array(spec.length);
    if (!children) return out;
    if (Array.isArray(children)) for (let i = 0; i < children.length; i++) out[i] = h(children[i]);
    else for (const c of spec) out[c.index] = h((children as Record<string, SkObject | null>)[c.name]);
    return out;
  }
  makeShader(uniforms?: UniformValues, children?: RuntimeChildren, localMatrix?: MatrixLike | null): Shader {
    return new Shader(
      N().runtime_effect_make_shader(
        this.handle,
        this.packUniforms(uniforms),
        this.#childHandles(children),
        matrixArray(localMatrix),
      ),
    );
  }
  makeColorFilter(uniforms?: UniformValues, children?: RuntimeChildren): ColorFilter {
    return new ColorFilter(
      N().runtime_effect_make_color_filter(this.handle, this.packUniforms(uniforms), this.#childHandles(children)),
    );
  }
  makeBlender(uniforms?: UniformValues, children?: RuntimeChildren): Blender {
    return new Blender(
      N().runtime_effect_make_blender(this.handle, this.packUniforms(uniforms), this.#childHandles(children)),
    );
  }
}

function mk<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

export const imageFilters = {
  blur(
    [sx, sy]: Point,
    tileMode: TileMode = TileMode.Decal,
    input?: ImageFilter | null,
    cropRect?: RectLike | null,
  ): ImageFilter | null {
    return mk(() => new ImageFilter(N().image_filter_blur(sx, sy, tileMode, h(input), rectArray(cropRect))));
  },
  dropShadow(
    [dx, dy]: Point,
    [sx, sy]: Point,
    color: Color,
    input?: ImageFilter | null,
    cropRect?: RectLike | null,
  ): ImageFilter | null {
    return mk(
      () =>
        new ImageFilter(N().image_filter_drop_shadow(dx, dy, sx, sy, toColorInt(color), h(input), rectArray(cropRect))),
    );
  },
  dropShadowOnly(
    [dx, dy]: Point,
    [sx, sy]: Point,
    color: Color,
    input?: ImageFilter | null,
    cropRect?: RectLike | null,
  ): ImageFilter | null {
    return mk(
      () =>
        new ImageFilter(
          N().image_filter_drop_shadow_only(dx, dy, sx, sy, toColorInt(color), h(input), rectArray(cropRect)),
        ),
    );
  },
  colorFilter(cf: ColorFilter, input?: ImageFilter | null, cropRect?: RectLike | null): ImageFilter | null {
    return mk(() => new ImageFilter(N().image_filter_color_filter(cf.handle, h(input), rectArray(cropRect))));
  },
  compose(outer: ImageFilter, inner: ImageFilter): ImageFilter | null {
    return mk(() => new ImageFilter(N().image_filter_compose(outer.handle, inner.handle)));
  },
  merge(filters: readonly (ImageFilter | null)[], cropRect?: RectLike | null): ImageFilter | null {
    return mk(() => new ImageFilter(N().image_filter_merge(new Uint32Array(filters.map(h)), rectArray(cropRect))));
  },
  offset([dx, dy]: Point, input?: ImageFilter | null, cropRect?: RectLike | null): ImageFilter | null {
    return mk(() => new ImageFilter(N().image_filter_offset(dx, dy, h(input), rectArray(cropRect))));
  },
  matrixTransform(m: MatrixLike, sampling?: Sampling, input?: ImageFilter | null): ImageFilter | null {
    return mk(
      () => new ImageFilter(N().image_filter_matrix_transform(matrixArray(m), samplingCode(sampling), h(input))),
    );
  },
  displacementMap(
    channels: readonly [ColorChannel, ColorChannel],
    scale: number,
    displacement: ImageFilter | null,
    color?: ImageFilter | null,
    cropRect?: RectLike | null,
  ): ImageFilter | null {
    return mk(
      () =>
        new ImageFilter(
          N().image_filter_displacement_map(
            channels[0],
            channels[1],
            scale,
            h(displacement),
            h(color),
            rectArray(cropRect),
          ),
        ),
    );
  },
  dilate([rx, ry]: Point, input?: ImageFilter | null, cropRect?: RectLike | null): ImageFilter | null {
    return mk(() => new ImageFilter(N().image_filter_dilate(rx, ry, h(input), rectArray(cropRect))));
  },
  erode([rx, ry]: Point, input?: ImageFilter | null, cropRect?: RectLike | null): ImageFilter | null {
    return mk(() => new ImageFilter(N().image_filter_erode(rx, ry, h(input), rectArray(cropRect))));
  },
  shader(shader: Shader, dither = false, cropRect?: RectLike | null): ImageFilter | null {
    return mk(() => new ImageFilter(N().image_filter_shader(shader.handle, dither, rectArray(cropRect))));
  },
  image(image: Image, sampling?: Sampling): ImageFilter | null {
    return mk(() => new ImageFilter(N().image_filter_image(image.handle, samplingCode(sampling))));
  },
  blend(
    mode: BlendMode | string,
    background: ImageFilter | null,
    foreground: ImageFilter | null,
    cropRect?: RectLike | null,
  ): ImageFilter | null {
    return mk(
      () => new ImageFilter(N().image_filter_blend(blendCode(mode), h(background), h(foreground), rectArray(cropRect))),
    );
  },
  /** Runs `effect` as a filter, with `childName` bound to the input. */
  runtimeShader(
    effect: RuntimeEffect,
    childName: string,
    uniforms?: UniformValues,
    input?: ImageFilter | null,
  ): ImageFilter | null {
    return mk(
      () =>
        new ImageFilter(
          N().image_filter_runtime_shader(effect.handle, effect.packUniforms(uniforms), childName, h(input)),
        ),
    );
  },
};

export const colorFilters = {
  blend(color: Color, mode: BlendMode | string): ColorFilter | null {
    return mk(() => new ColorFilter(N().color_filter_blend(toColorInt(color), blendCode(mode))));
  },
  /** 4x5 row-major matrix (20 numbers); the 5th column is a bias in 0–1 units. */
  matrix(m: ArrayLike<number>): ColorFilter {
    return new ColorFilter(N().color_filter_matrix(f32(m)));
  },
  lighting(mul: Color, add: Color): ColorFilter | null {
    return mk(() => new ColorFilter(N().color_filter_lighting(toColorInt(mul), toColorInt(add))));
  },
  /** Per-channel lookup tables, 256 entries each (null = identity). */
  table(
    a: ArrayLike<number> | null,
    r: ArrayLike<number> | null,
    g: ArrayLike<number> | null,
    b: ArrayLike<number> | null,
  ): ColorFilter | null {
    const t = new Uint8Array(1024);
    [a, r, g, b].forEach((tab, i) => {
      for (let k = 0; k < 256; k++) t[i * 256 + k] = tab ? tab[k]! : k;
    });
    return mk(() => new ColorFilter(N().color_filter_table(t)));
  },
  compose(outer: ColorFilter, inner: ColorFilter): ColorFilter | null {
    return mk(() => new ColorFilter(N().color_filter_compose(outer.handle, inner.handle)));
  },
  srgbToLinearGamma(): ColorFilter {
    return new ColorFilter(N().color_filter_srgb_to_linear());
  },
  linearToSRGBGamma(): ColorFilter {
    return new ColorFilter(N().color_filter_linear_to_srgb());
  },
  luma(): ColorFilter {
    return new ColorFilter(N().color_filter_luma());
  },
  /** Saturation matrix (0 = grayscale, 1 = unchanged). */
  saturation(s: number): ColorFilter {
    const r = 0.2126,
      g = 0.7152,
      b = 0.0722;
    const m = [
      r + (1 - r) * s,
      g - g * s,
      b - b * s,
      0,
      0,
      r - r * s,
      g + (1 - g) * s,
      b - b * s,
      0,
      0,
      r - r * s,
      g - g * s,
      b + (1 - b) * s,
      0,
      0,
      0,
      0,
      0,
      1,
      0,
    ];
    return colorFilters.matrix(m);
  },
};

export const maskFilters = {
  blur(style: BlurStyle, sigma: number, respectCTM = true): MaskFilter | null {
    return mk(() => new MaskFilter(N().mask_filter_blur(style, sigma, respectCTM)));
  },
  shader(shader: Shader): MaskFilter {
    return new MaskFilter(N().mask_filter_shader(shader.handle));
  },
};

export const pathEffects = {
  dash(intervals: readonly number[], phase = 0): PathEffect | null {
    return mk(() => new PathEffect(N().path_effect_dash(f32(intervals), phase)));
  },
  corner(radius: number): PathEffect | null {
    return mk(() => new PathEffect(N().path_effect_corner(radius)));
  },
  discrete(segLength: number, deviation: number, seed = 0): PathEffect | null {
    return mk(() => new PathEffect(N().path_effect_discrete(segLength, deviation, seed)));
  },
  /** Keeps the part of each contour between `start` and `stop` (0–1). */
  trim(start: number, stop: number, inverted = false): PathEffect | null {
    return mk(() => new PathEffect(N().path_effect_trim(start, stop, inverted)));
  },
  compose(outer: PathEffect, inner: PathEffect): PathEffect {
    return new PathEffect(N().path_effect_compose(outer.handle, inner.handle));
  },
  sum(first: PathEffect, second: PathEffect): PathEffect {
    return new PathEffect(N().path_effect_sum(first.handle, second.handle));
  },
  path1D(path: Path, advance: number, phase: number, style: Path1DStyle): PathEffect | null {
    return mk(() => new PathEffect(N().path_effect_path_1d(path.handle, advance, phase, style)));
  },
};

export const blenders = {
  mode(mode: BlendMode | string): Blender {
    return new Blender(N().blender_mode(blendCode(mode)));
  },
  arithmetic(k1: number, k2: number, k3: number, k4: number, enforcePremul = true): Blender | null {
    return mk(() => new Blender(N().blender_arithmetic(k1, k2, k3, k4, enforcePremul)));
  },
};

// Pictures and PDF

export class Picture extends SkObject {
  static fromData(bytes: Uint8Array): Picture | null {
    return mk(() => new Picture(N().picture_from_data(bytes)));
  }
  serialize(): Uint8Array {
    return N().picture_serialize(this.handle);
  }
  cullRect(): Rect {
    const [l, t, r, b] = N().picture_cull_rect(this.handle);
    return new Rect(l!, t!, r!, b!);
  }
  approximateOpCount(): number {
    return N().picture_approximate_op_count(this.handle);
  }
}

export class PictureRecorder extends SkObject {
  constructor() {
    super(N().picture_recorder_new());
  }
  beginRecording(bounds: RectLike): Canvas {
    const r = toRect(bounds);
    return new Canvas(N().picture_recorder_begin(this.handle, r.left, r.top, r.right, r.bottom));
  }
  finishRecordingAsPicture(): Picture | null {
    return mk(() => new Picture(N().picture_recorder_finish(this.handle)));
  }
}

export class PdfDocument extends SkObject {
  beginPage(width: number, height: number): Canvas {
    return new Canvas(N().pdf_document_begin_page(this.handle, width, height));
  }
  endPage(): void {
    N().pdf_document_end_page(this.handle);
  }
  /** Finishes the document and returns the PDF bytes. */
  close(): Uint8Array {
    return N().pdf_document_close(this.handle);
  }
}

export const pdf = {
  newDocument(metadata: { title?: string; author?: string } = {}): PdfDocument {
    return new PdfDocument(N().pdf_document_new(metadata.title ?? '', metadata.author ?? ''));
  },
};

// Type-only import, used by Canvas signatures.
import type { Font, TextBlob } from './text.ts';

export { M44, Matrix, Rect, RRect };
