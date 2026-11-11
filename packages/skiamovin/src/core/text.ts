import { N } from '../native/runtime.ts';
import { type Color, toColorInt } from './color.ts';
import { type FontEdging, type FontHinting, FontSlant } from './enums.ts';
import type { Point } from './geometry.ts';
import { Rect } from './geometry.ts';
import { h, SkObject } from './object.ts';
import { type Canvas, Paint, Path } from './skia.ts';

/** Packs a 4-character OpenType tag into a 32-bit number. */
export function tag(t: string): number {
  if (t.length !== 4) throw new TypeError(`OpenType tags have 4 characters: '${t}'`);
  return ((t.charCodeAt(0) << 24) | (t.charCodeAt(1) << 16) | (t.charCodeAt(2) << 8) | t.charCodeAt(3)) >>> 0;
}

function tagsAndValues(rec: Record<string, number> | undefined): [Uint32Array, Float32Array] {
  const entries = Object.entries(rec ?? {});
  return [new Uint32Array(entries.map(([k]) => tag(k))), new Float32Array(entries.map(([, v]) => v))];
}

export class FontStyle {
  constructor(
    public weight = 400,
    public width = 5,
    public slant: FontSlant = FontSlant.Upright,
  ) {}
  static normal(): FontStyle {
    return new FontStyle();
  }
  static bold(): FontStyle {
    return new FontStyle(700);
  }
  static italic(): FontStyle {
    return new FontStyle(400, 5, FontSlant.Italic);
  }
  static boldItalic(): FontStyle {
    return new FontStyle(700, 5, FontSlant.Italic);
  }
}

export class Typeface extends SkObject {
  familyName(): string {
    return N().typeface_family_name(this.handle);
  }
  fontStyle(): FontStyle {
    const [w, wd, s] = N().typeface_style(this.handle);
    return new FontStyle(w, wd, s as FontSlant);
  }
  variationAxes(): { tag: string; min: number; def: number; max: number }[] {
    return JSON.parse(N().typeface_variation_axes(this.handle));
  }
  /** A clone with variable-font axes set, e.g. `{ wght: 700 }`. */
  makeVariation(axes: Record<string, number>): Typeface {
    const [t, v] = tagsAndValues(axes);
    return new Typeface(N().typeface_make_variation(this.handle, t, v));
  }
}

export class FontMgr extends SkObject {
  static #default: FontMgr | null = null;
  /** The platform font manager (system fonts on Node; an empty manager on the web). */
  static default(): FontMgr {
    FontMgr.#default ??= new FontMgr(N().font_mgr_default());
    return FontMgr.#default;
  }
  countFamilies(): number {
    return N().font_mgr_count_families(this.handle);
  }
  familyNames(): string[] {
    return N().font_mgr_family_names(this.handle).split('\n').filter(Boolean);
  }
  newFromData(bytes: Uint8Array | ArrayBuffer, index = 0): Typeface | null {
    try {
      return new Typeface(
        N().font_mgr_new_from_data(this.handle, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), index),
      );
    } catch {
      return null;
    }
  }
  matchFamilyStyle(family: string, style: FontStyle = FontStyle.normal()): Typeface | null {
    const hh = N().font_mgr_match_family_style(this.handle, family, style.weight, style.width, style.slant);
    return hh ? new Typeface(hh) : null;
  }
  legacyMakeTypeface(family: string | null, style: FontStyle = FontStyle.normal()): Typeface | null {
    const hh = N().font_mgr_legacy_make_typeface(this.handle, family ?? '', style.weight, style.width, style.slant);
    return hh ? new Typeface(hh) : null;
  }
}

export interface FontMetrics {
  ascent: number;
  descent: number;
  leading: number;
  top: number;
  bottom: number;
  avgCharWidth: number;
  maxCharWidth: number;
  xHeight: number;
  capHeight: number;
  underlineThickness: number;
  underlinePosition: number;
}

export class Font extends SkObject {
  constructor(typeface: Typeface | null = null, size = 12, _handle?: number) {
    super(_handle ?? N().font_new(h(typeface), size));
  }
  setSize(size: number): this {
    N().font_set_size(this.handle, size);
    return this;
  }
  getSize(): number {
    return N().font_get_size(this.handle);
  }
  setTypeface(t: Typeface): this {
    N().font_set_typeface(this.handle, t.handle);
    return this;
  }
  setEdging(e: FontEdging): this {
    N().font_set_edging(this.handle, e);
    return this;
  }
  setSubpixel(v: boolean): this {
    N().font_set_subpixel(this.handle, v);
    return this;
  }
  setHinting(v: FontHinting): this {
    N().font_set_hinting(this.handle, v);
    return this;
  }
  setEmbolden(v: boolean): this {
    N().font_set_embolden(this.handle, v);
    return this;
  }
  setScaleX(v: number): this {
    N().font_set_scale_x(this.handle, v);
    return this;
  }
  setSkewX(v: number): this {
    N().font_set_skew_x(this.handle, v);
    return this;
  }
  /** `[advance, bounds]`. */
  measureStr(text: string, paint?: Paint | null): [number, Rect] {
    const [a, l, t, r, b] = N().font_measure_str(this.handle, text, h(paint));
    return [a!, new Rect(l!, t!, r!, b!)];
  }
  getMetrics(): FontMetrics {
    const m = N().font_metrics(this.handle);
    return {
      ascent: m[0]!,
      descent: m[1]!,
      leading: m[2]!,
      top: m[3]!,
      bottom: m[4]!,
      avgCharWidth: m[5]!,
      maxCharWidth: m[6]!,
      xHeight: m[7]!,
      capHeight: m[8]!,
      underlineThickness: m[9]!,
      underlinePosition: m[10]!,
    };
  }
  getGlyphIDs(text: string): Uint32Array {
    return N().font_get_glyphs(this.handle, text);
  }
  getGlyphWidths(glyphs: ArrayLike<number>): Float32Array {
    return N().font_get_widths(this.handle, new Uint32Array(glyphs));
  }
  getPath(glyph: number): Path | null {
    const hh = N().font_get_path(this.handle, glyph);
    return hh ? Path._wrap(hh) : null;
  }
}

export class TextBlob extends SkObject {
  static MakeFromText(text: string, font: Font): TextBlob | null {
    try {
      return new TextBlob(N().text_blob_from_str(text, font.handle));
    } catch {
      return null;
    }
  }
  static fromText(text: string, font: Font): TextBlob | null {
    return TextBlob.MakeFromText(text, font);
  }
  static fromPosGlyphs(glyphs: ArrayLike<number>, positions: readonly Point[], font: Font): TextBlob | null {
    try {
      return new TextBlob(
        N().text_blob_from_pos_glyphs(new Uint32Array(glyphs), new Float32Array(positions.flat()), font.handle),
      );
    } catch {
      return null;
    }
  }
  bounds(): Rect {
    const [l, t, r, b] = N().text_blob_bounds(this.handle);
    return new Rect(l!, t!, r!, b!);
  }
}

// Paragraph layout

const TextAlign = Object.freeze({ Left: 0, Right: 1, Center: 2, Justify: 3, Start: 4, End: 5 } as const);
type TextAlign = (typeof TextAlign)[keyof typeof TextAlign];
const TextDirection = Object.freeze({ LTR: 0, RTL: 1 } as const);
type TextDirection = (typeof TextDirection)[keyof typeof TextDirection];
const Decoration = Object.freeze({ None: 0, Underline: 1, Overline: 2, LineThrough: 4 } as const);
const DecorationStyle = Object.freeze({ Solid: 0, Double: 1, Dotted: 2, Dashed: 3, Wavy: 4 } as const);
const PlaceholderAlignment = Object.freeze({
  Baseline: 0,
  AboveBaseline: 1,
  BelowBaseline: 2,
  Top: 3,
  Bottom: 4,
  Middle: 5,
} as const);
const TextBaseline = Object.freeze({ Alphabetic: 0, Ideographic: 1 } as const);
const RectHeightStyle = Object.freeze({
  Tight: 0,
  Max: 1,
  IncludeLineSpacingMiddle: 2,
  IncludeLineSpacingTop: 3,
  IncludeLineSpacingBottom: 4,
  Strut: 5,
} as const);
const RectWidthStyle = Object.freeze({ Tight: 0, Max: 1 } as const);
const TextHeightBehavior = Object.freeze({
  All: 0,
  DisableFirstAscent: 1,
  DisableLastDescent: 2,
  DisableAll: 3,
} as const);

class TypefaceFontProvider extends SkObject {
  constructor() {
    super(N().typeface_font_provider_new());
  }
  /** Registers a typeface under `alias` (default: its own family name). */
  registerTypeface(typeface: Typeface, alias?: string): void {
    N().typeface_font_provider_register(this.handle, typeface.handle, alias ?? '');
  }
}

class FontCollection extends SkObject {
  constructor() {
    super(N().font_collection_new());
  }
  setDefaultFontManager(fontMgr: FontMgr, defaultFamily?: string): void {
    N().font_collection_set_default_font_manager(this.handle, fontMgr.handle, defaultFamily ?? '');
  }
  setDefaultFontManagerAndFamily(fontMgr: FontMgr, family: string): void {
    this.setDefaultFontManager(fontMgr, family);
  }
  setAssetFontManager(provider: TypefaceFontProvider): void {
    N().font_collection_set_asset_font_manager(this.handle, provider.handle);
  }
  setDynamicFontManager(provider: TypefaceFontProvider): void {
    N().font_collection_set_dynamic_font_manager(this.handle, provider.handle);
  }
  enableFontFallback(): void {
    N().font_collection_enable_font_fallback(this.handle, true);
  }
  disableFontFallback(): void {
    N().font_collection_enable_font_fallback(this.handle, false);
  }
  clearCaches(): void {
    N().font_collection_clear_caches(this.handle);
  }
}

export interface TextShadow {
  color: Color;
  offset?: Point;
  blurSigma?: number;
}

class TextStyle extends SkObject {
  constructor(_handle?: number) {
    super(_handle ?? N().text_style_new());
  }
  copy(): TextStyle {
    return new TextStyle(N().text_style_copy(this.handle));
  }
  setColor(c: Color): this {
    N().text_style_set_color(this.handle, toColorInt(c));
    return this;
  }
  setForegroundPaint(p: Paint | null): this {
    N().text_style_set_foreground_paint(this.handle, h(p));
    return this;
  }
  setBackgroundPaint(p: Paint | null): this {
    N().text_style_set_background_paint(this.handle, h(p));
    return this;
  }
  setFontFamilies(families: readonly string[]): this {
    N().text_style_set_font_families(this.handle, families.join('\n'));
    return this;
  }
  setFontSize(size: number): this {
    N().text_style_set_font_size(this.handle, size);
    return this;
  }
  setFontStyle(style: FontStyle): this {
    N().text_style_set_font_style(this.handle, style.weight, style.width, style.slant);
    return this;
  }
  /** Line height as a multiple of font size. */
  setHeight(height: number): this {
    N().text_style_set_height(this.handle, height, true);
    return this;
  }
  setHeightOverride(enabled: boolean, height = 1): this {
    N().text_style_set_height(this.handle, height, enabled);
    return this;
  }
  setHalfLeading(v: boolean): this {
    N().text_style_set_half_leading(this.handle, v);
    return this;
  }
  setLetterSpacing(v: number): this {
    N().text_style_set_letter_spacing(this.handle, v);
    return this;
  }
  setWordSpacing(v: number): this {
    N().text_style_set_word_spacing(this.handle, v);
    return this;
  }
  setDecoration(bits: number, style: number = DecorationStyle.Solid, color: Color = 0, thicknessMultiplier = 1): this {
    N().text_style_set_decoration(this.handle, bits, style, color === 0 ? 0 : toColorInt(color), thicknessMultiplier);
    return this;
  }
  setShadows(shadows: readonly TextShadow[]): this {
    N().text_style_set_shadows(
      this.handle,
      new Uint32Array(shadows.map((s) => toColorInt(s.color))),
      new Float32Array(shadows.flatMap((s) => [s.offset?.[0] ?? 0, s.offset?.[1] ?? 0, s.blurSigma ?? 0])),
    );
    return this;
  }
  setFontFeatures(features: Record<string, number>): this {
    const e = Object.entries(features);
    N().text_style_set_font_features(
      this.handle,
      new Uint32Array(e.map(([k]) => tag(k))),
      new Uint32Array(e.map(([, v]) => v)),
    );
    return this;
  }
  /** Variable font axes, e.g. `{ variationDesignPosition: { wght: 800 } }`. */
  setFontArguments(args: { variationDesignPosition?: Record<string, number> } | null): this {
    const [t, v] = tagsAndValues(args?.variationDesignPosition);
    N().text_style_set_font_variations(this.handle, t, v);
    return this;
  }
  setLocale(locale: string): this {
    N().text_style_set_locale(this.handle, locale);
    return this;
  }
  setBaselineShift(v: number): this {
    N().text_style_set_baseline_shift(this.handle, v);
    return this;
  }
}

class StrutStyle {
  enabled = true;
  fontFamilies: string[] = [];
  fontSize = 14;
  height = 0;
  leading = 0;
  forceStrutHeight = false;
}

class ParagraphStyle extends SkObject {
  constructor() {
    super(N().paragraph_style_new());
  }
  setTextStyle(s: TextStyle): this {
    N().paragraph_style_set_text_style(this.handle, s.handle);
    return this;
  }
  setTextAlign(a: TextAlign): this {
    N().paragraph_style_set_text_align(this.handle, a);
    return this;
  }
  setTextDirection(d: TextDirection): this {
    N().paragraph_style_set_text_direction(this.handle, d);
    return this;
  }
  setMaxLines(n: number | null): this {
    N().paragraph_style_set_max_lines(this.handle, n ?? 0);
    return this;
  }
  setEllipsis(e: string): this {
    N().paragraph_style_set_ellipsis(this.handle, e);
    return this;
  }
  setHeight(v: number): this {
    N().paragraph_style_set_height(this.handle, v);
    return this;
  }
  setTextHeightBehavior(b: number): this {
    N().paragraph_style_set_text_height_behavior(this.handle, b);
    return this;
  }
  setReplaceTabCharacters(v: boolean): this {
    N().paragraph_style_set_replace_tab_characters(this.handle, v);
    return this;
  }
  setApplyRoundingHack(v: boolean): this {
    N().paragraph_style_set_apply_rounding_hack(this.handle, v);
    return this;
  }
  setStrutStyle(s: StrutStyle): this {
    N().paragraph_style_set_strut(
      this.handle,
      s.enabled,
      s.fontFamilies.join('\n'),
      s.fontSize,
      s.height,
      s.leading,
      s.forceStrutHeight,
    );
    return this;
  }
}

class PlaceholderStyle {
  constructor(
    public width: number,
    public height: number,
    public alignment: number = PlaceholderAlignment.Baseline,
    public baseline: number = TextBaseline.Alphabetic,
    public baselineOffset = 0,
  ) {}
}

class ParagraphBuilder extends SkObject {
  constructor(style: ParagraphStyle, fontCollection: FontCollection) {
    super(N().paragraph_builder_new(style.handle, fontCollection.handle));
  }
  pushStyle(s: TextStyle): this {
    N().paragraph_builder_push_style(this.handle, s.handle);
    return this;
  }
  pop(): this {
    N().paragraph_builder_pop(this.handle);
    return this;
  }
  addText(text: string): this {
    N().paragraph_builder_add_text(this.handle, text);
    return this;
  }
  addPlaceholder(p: PlaceholderStyle): this {
    N().paragraph_builder_add_placeholder(this.handle, p.width, p.height, p.alignment, p.baseline, p.baselineOffset);
    return this;
  }
  build(): Paragraph {
    return new Paragraph(N().paragraph_builder_build(this.handle));
  }
  reset(): this {
    N().paragraph_builder_reset(this.handle);
    return this;
  }
}

export interface LineMetrics {
  startIndex: number;
  endIndex: number;
  endExcludingWhitespaces: number;
  endIncludingNewline: number;
  isHardBreak: boolean;
  ascent: number;
  descent: number;
  height: number;
  width: number;
  left: number;
  baseline: number;
  lineNumber: number;
}

export interface TextBox {
  rect: Rect;
  direction: TextDirection;
}

export interface GlyphRun {
  line: number;
  font: Font;
  glyphs: number[];
  positions: Point[];
  utf16Starts: number[];
  origin: Point;
  advanceX: number;
}

class Paragraph extends SkObject {
  layout(width: number): void {
    N().paragraph_layout(this.handle, width);
  }
  paint(canvas: Canvas, [x, y]: Point): void {
    N().paragraph_paint(this.handle, canvas.handle, x, y);
  }
  #m(i: number): number {
    return N().paragraph_metrics(this.handle)[i]!;
  }
  /** All scalar metrics in one call. */
  metrics() {
    const m = N().paragraph_metrics(this.handle);
    return {
      height: m[0]!,
      maxWidth: m[1]!,
      minIntrinsicWidth: m[2]!,
      maxIntrinsicWidth: m[3]!,
      longestLine: m[4]!,
      alphabeticBaseline: m[5]!,
      ideographicBaseline: m[6]!,
      didExceedMaxLines: m[7] === 1,
      lineNumber: m[8]!,
    };
  }
  getHeight(): number {
    return this.#m(0);
  }
  height(): number {
    return this.#m(0);
  }
  maxWidth(): number {
    return this.#m(1);
  }
  minIntrinsicWidth(): number {
    return this.#m(2);
  }
  maxIntrinsicWidth(): number {
    return this.#m(3);
  }
  longestLine(): number {
    return this.#m(4);
  }
  alphabeticBaseline(): number {
    return this.#m(5);
  }
  ideographicBaseline(): number {
    return this.#m(6);
  }
  didExceedMaxLines(): boolean {
    return this.#m(7) === 1;
  }
  lineNumber(): number {
    return this.#m(8);
  }
  getLineMetrics(): LineMetrics[] {
    const v = N().paragraph_line_metrics(this.handle);
    const out: LineMetrics[] = [];
    for (let i = 0; i < v.length; i += 12) {
      out.push({
        startIndex: v[i]!,
        endIndex: v[i + 1]!,
        endExcludingWhitespaces: v[i + 2]!,
        endIncludingNewline: v[i + 3]!,
        isHardBreak: v[i + 4] === 1,
        ascent: v[i + 5]!,
        descent: v[i + 6]!,
        height: v[i + 7]!,
        width: v[i + 8]!,
        left: v[i + 9]!,
        baseline: v[i + 10]!,
        lineNumber: v[i + 11]!,
      });
    }
    return out;
  }
  /** Boxes for a range of the text (JavaScript string indices). */
  getRectsForRange(
    [start, end]: readonly [number, number],
    heightStyle: number = RectHeightStyle.Tight,
    widthStyle: number = RectWidthStyle.Tight,
  ): TextBox[] {
    return boxes(N().paragraph_rects_for_range(this.handle, start, end, heightStyle, widthStyle));
  }
  getRectsForPlaceholders(): TextBox[] {
    return boxes(N().paragraph_rects_for_placeholders(this.handle));
  }
  getGlyphPositionAtCoordinate([x, y]: Point): { position: number; affinity: 'upstream' | 'downstream' } {
    const [p, a] = N().paragraph_glyph_position_at_coordinate(this.handle, x, y);
    return { position: p!, affinity: a === 1 ? 'downstream' : 'upstream' };
  }
  getWordBoundary(offset: number): [number, number] {
    const [s, e] = N().paragraph_word_boundary(this.handle, offset);
    return [s!, e!];
  }
  getFonts(): { start: number; end: number; family: string; size: number }[] {
    return JSON.parse(N().paragraph_fonts(this.handle));
  }
  /** Number of glyphs no font could render, or -1 if unknown (call after layout). */
  unresolvedGlyphs(): number {
    return N().paragraph_unresolved_glyphs(this.handle);
  }
  /** Outlines of line `lineNumber`. */
  getPath(lineNumber: number): Path {
    return Path._wrap(N().paragraph_get_path(this.handle, lineNumber));
  }
  /** Every glyph run with positions relative to the paragraph origin. Fonts are new objects you own. */
  visit(cb: (lineNumber: number, info: GlyphRun) => void): void {
    const runs = JSON.parse(N().paragraph_visit(this.handle)) as {
      line: number;
      font: number;
      glyphs: number[];
      positions: number[];
      utf16Starts: number[];
      origin: [number, number];
      advanceX: number;
    }[];
    for (const r of runs) {
      const positions: Point[] = [];
      for (let i = 0; i < r.positions.length; i += 2) positions.push([r.positions[i]!, r.positions[i + 1]!]);
      cb(r.line, {
        line: r.line,
        font: new Font(null, 0, r.font),
        glyphs: r.glyphs,
        positions,
        utf16Starts: r.utf16Starts,
        origin: r.origin,
        advanceX: r.advanceX,
      });
    }
  }
}

function boxes(v: Float32Array): TextBox[] {
  const out: TextBox[] = [];
  for (let i = 0; i < v.length; i += 5)
    out.push({ rect: new Rect(v[i]!, v[i + 1]!, v[i + 2]!, v[i + 3]!), direction: v[i + 4] as TextDirection });
  return out;
}

export const textlayout = {
  FontCollection,
  TypefaceFontProvider,
  TextStyle,
  ParagraphStyle,
  StrutStyle,
  ParagraphBuilder,
  Paragraph,
  PlaceholderStyle,
  TextAlign,
  TextDirection,
  Decoration,
  DecorationStyle,
  PlaceholderAlignment,
  TextBaseline,
  RectHeightStyle,
  RectWidthStyle,
  TextHeightBehavior,
};

// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace textlayout {
  type FontCollection = InstanceType<typeof FontCollection>;
  type TypefaceFontProvider = InstanceType<typeof TypefaceFontProvider>;
  type TextStyle = InstanceType<typeof TextStyle>;
  type ParagraphStyle = InstanceType<typeof ParagraphStyle>;
  type ParagraphBuilder = InstanceType<typeof ParagraphBuilder>;
  type Paragraph = InstanceType<typeof Paragraph>;
  type PlaceholderStyle = InstanceType<typeof PlaceholderStyle>;
  type StrutStyle = InstanceType<typeof StrutStyle>;
}

export { Paint };
