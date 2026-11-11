// Enum codes shared with the Rust core (see crates/skiamovin-core/src/convert.rs).

export const PaintStyle = Object.freeze({ Fill: 0, Stroke: 1, StrokeAndFill: 2 } as const);
export type PaintStyle = (typeof PaintStyle)[keyof typeof PaintStyle];

export const StrokeCap = Object.freeze({ Butt: 0, Round: 1, Square: 2 } as const);
export type StrokeCap = (typeof StrokeCap)[keyof typeof StrokeCap];

export const StrokeJoin = Object.freeze({ Miter: 0, Round: 1, Bevel: 2 } as const);
export type StrokeJoin = (typeof StrokeJoin)[keyof typeof StrokeJoin];

export const TileMode = Object.freeze({ Clamp: 0, Repeat: 1, Mirror: 2, Decal: 3 } as const);
export type TileMode = (typeof TileMode)[keyof typeof TileMode];

export const ClipOp = Object.freeze({ Difference: 0, Intersect: 1 } as const);
export type ClipOp = (typeof ClipOp)[keyof typeof ClipOp];

export const BlendMode = Object.freeze({
  Clear: 0,
  Src: 1,
  Dst: 2,
  SrcOver: 3,
  DstOver: 4,
  SrcIn: 5,
  DstIn: 6,
  SrcOut: 7,
  DstOut: 8,
  SrcATop: 9,
  DstATop: 10,
  Xor: 11,
  Plus: 12,
  Modulate: 13,
  Screen: 14,
  Overlay: 15,
  Darken: 16,
  Lighten: 17,
  ColorDodge: 18,
  ColorBurn: 19,
  HardLight: 20,
  SoftLight: 21,
  Difference: 22,
  Exclusion: 23,
  Multiply: 24,
  Hue: 25,
  Saturation: 26,
  Color: 27,
  Luminosity: 28,
} as const);
export type BlendMode = (typeof BlendMode)[keyof typeof BlendMode];

/** Maps CSS blend mode names to BlendMode. */
export const BLEND_MODE_NAMES: Record<string, BlendMode> = {
  normal: BlendMode.SrcOver,
  multiply: BlendMode.Multiply,
  screen: BlendMode.Screen,
  overlay: BlendMode.Overlay,
  darken: BlendMode.Darken,
  lighten: BlendMode.Lighten,
  'color-dodge': BlendMode.ColorDodge,
  'color-burn': BlendMode.ColorBurn,
  'hard-light': BlendMode.HardLight,
  'soft-light': BlendMode.SoftLight,
  difference: BlendMode.Difference,
  exclusion: BlendMode.Exclusion,
  hue: BlendMode.Hue,
  saturation: BlendMode.Saturation,
  color: BlendMode.Color,
  luminosity: BlendMode.Luminosity,
  plus: BlendMode.Plus,
  'plus-lighter': BlendMode.Plus,
  xor: BlendMode.Xor,
};

export const ColorType = Object.freeze({
  RGBA_8888: 0,
  BGRA_8888: 1,
  N32: 2,
  RGBA_F16: 3,
  RGBA_1010102: 4,
  Alpha_8: 5,
  Gray_8: 6,
  RGB_565: 7,
  RGBA_F32: 8,
} as const);
export type ColorType = (typeof ColorType)[keyof typeof ColorType];

export const AlphaType = Object.freeze({ Unknown: 0, Opaque: 1, Premul: 2, Unpremul: 3 } as const);
export type AlphaType = (typeof AlphaType)[keyof typeof AlphaType];

export const EncodedImageFormat = Object.freeze({ PNG: 0, JPEG: 1, WEBP: 2 } as const);
export type EncodedImageFormat = (typeof EncodedImageFormat)[keyof typeof EncodedImageFormat];

export const PathFillType = Object.freeze({ Winding: 0, EvenOdd: 1, InverseWinding: 2, InverseEvenOdd: 3 } as const);
export type PathFillType = (typeof PathFillType)[keyof typeof PathFillType];

export const PathOp = Object.freeze({ Difference: 0, Intersect: 1, Union: 2, XOR: 3, ReverseDifference: 4 } as const);
export type PathOp = (typeof PathOp)[keyof typeof PathOp];

export const PointMode = Object.freeze({ Points: 0, Lines: 1, Polygon: 2 } as const);
export type PointMode = (typeof PointMode)[keyof typeof PointMode];

export const VertexMode = Object.freeze({ Triangles: 0, TriangleStrip: 1, TriangleFan: 2 } as const);
export type VertexMode = (typeof VertexMode)[keyof typeof VertexMode];

export const FontEdging = Object.freeze({ Alias: 0, AntiAlias: 1, SubpixelAntiAlias: 2 } as const);
export type FontEdging = (typeof FontEdging)[keyof typeof FontEdging];

export const FontHinting = Object.freeze({ None: 0, Slight: 1, Normal: 2, Full: 3 } as const);
export type FontHinting = (typeof FontHinting)[keyof typeof FontHinting];

export const FontSlant = Object.freeze({ Upright: 0, Italic: 1, Oblique: 2 } as const);
export type FontSlant = (typeof FontSlant)[keyof typeof FontSlant];

export const BlurStyle = Object.freeze({ Normal: 0, Solid: 1, Outer: 2, Inner: 3 } as const);
export type BlurStyle = (typeof BlurStyle)[keyof typeof BlurStyle];

export const ColorChannel = Object.freeze({ R: 0, G: 1, B: 2, A: 3 } as const);
export type ColorChannel = (typeof ColorChannel)[keyof typeof ColorChannel];

/** Color spaces: legacy (none), sRGB, linear sRGB, Display P3, Rec.2020, linear Rec.2020, Rec.2020 PQ, Rec.2020 HLG. */
export const ColorSpace = Object.freeze({
  None: 0,
  SRGB: 1,
  LinearSRGB: 2,
  DisplayP3: 3,
  Rec2020: 4,
  LinearRec2020: 5,
  Rec2020PQ: 6,
  Rec2020HLG: 7,
} as const);
export type ColorSpace = (typeof ColorSpace)[keyof typeof ColorSpace];

export const PathEffectTrimMode = Object.freeze({ Normal: 0, Inverted: 1 } as const);

export const Path1DStyle = Object.freeze({ Translate: 0, Rotate: 1, Morph: 2 } as const);
export type Path1DStyle = (typeof Path1DStyle)[keyof typeof Path1DStyle];
