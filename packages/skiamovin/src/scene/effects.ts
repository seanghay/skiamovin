// Finishing effects applied to a node and everything inside it, and a glass material for what's behind a node.
// Each function returns a plain description; the renderer builds the Skia filters.
import { type Color, toColor4f, toColorInt } from '../core/color.ts';
import { BlendMode, TileMode } from '../core/enums.ts';
import { colorFilters, type ImageFilter, imageFilters, RuntimeEffect, type Shader } from '../core/skia.ts';
import type { Gradient } from './nodes.ts';

export type Effect =
  | { kind: 'grain'; amount: number; size: number; seed: number; animated: boolean }
  | { kind: 'glow'; radius: number; intensity: number; threshold: number }
  | { kind: 'chromaticAberration'; amount: number }
  | { kind: 'vignette'; amount: number; softness: number; color: Color }
  | { kind: 'halftone'; size: number; angle: number }
  | { kind: 'pixelate'; size: number }
  | { kind: 'sharpen'; amount: number }
  | { kind: 'lensDistortion'; amount: number };

/** Film grain. `amount` 0..1 (default 0.03), `size` in pixels. New grain every frame unless `animated: false`. */
export function grain(options: { amount?: number; size?: number; seed?: number; animated?: boolean } = {}): Effect {
  return {
    kind: 'grain',
    amount: options.amount ?? 0.03,
    size: options.size ?? 1,
    seed: options.seed ?? 0,
    animated: options.animated ?? true,
  };
}
/** A soft glow around bright parts. */
export function glow(options: { radius?: number; intensity?: number; threshold?: number } = {}): Effect {
  return {
    kind: 'glow',
    radius: options.radius ?? 16,
    intensity: options.intensity ?? 0.6,
    threshold: options.threshold ?? 0.6,
  };
}
/** Color fringes toward the edges, like a lens. `amount` in pixels at the corners. */
export function chromaticAberration(options: { amount?: number } = {}): Effect {
  return { kind: 'chromaticAberration', amount: options.amount ?? 3 };
}
/** Barrel (positive) or pincushion (negative) distortion, like a wide or long lens. `amount` about -0.5..0.5. */
export function lensDistortion(options: { amount?: number } = {}): Effect {
  return { kind: 'lensDistortion', amount: options.amount ?? 0.15 };
}
/** Darkens the corners. */
export function vignette(options: { amount?: number; softness?: number; color?: Color } = {}): Effect {
  return {
    kind: 'vignette',
    amount: options.amount ?? 0.35,
    softness: options.softness ?? 0.6,
    color: options.color ?? '#000000',
  };
}
/** Print-style dots, bigger where it's darker. */
export function halftone(options: { size?: number; angle?: number } = {}): Effect {
  return { kind: 'halftone', size: options.size ?? 6, angle: options.angle ?? 45 };
}
export function pixelate(options: { size?: number } = {}): Effect {
  return { kind: 'pixelate', size: options.size ?? 8 };
}
export function sharpen(options: { amount?: number } = {}): Effect {
  return { kind: 'sharpen', amount: options.amount ?? 0.5 };
}

const HASH = `
  float hash(float2 p, float s) {
    float3 q = fract(float3(p.xyx) * 0.1031 + s * 0.0731);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }`;

const SOURCES: Record<string, string> = {
  grain: `${HASH}
    uniform shader src; uniform float amount, size, seed;
    half4 main(float2 p) {
      half4 c = src.eval(p);
      float n = hash(floor(p / size), seed) - 0.5;
      float y = dot(float3(c.rgb), float3(0.2126, 0.7152, 0.0722));
      // Grain shows most in the midtones, like film.
      float w = 4 * y * (1 - y) + 0.15;
      return half4(clamp(c.rgb + half3(n * amount * w * 2) * c.a, 0, c.a), c.a);
    }`,
  chromaticAberration: `
    uniform shader src; uniform float2 size; uniform float amount;
    half4 main(float2 p) {
      float2 d = (p - size * 0.5) / (size * 0.5);
      float2 o = d * amount;
      half4 c = src.eval(p);
      return half4(src.eval(p + o).r, c.g, src.eval(p - o).b, c.a);
    }`,
  lensDistortion: `
    uniform shader src; uniform float2 size; uniform float amount;
    half4 main(float2 p) {
      float2 d = (p - size * 0.5) / (size * 0.5);
      float r2 = dot(d, d);
      // Pull the edges in for barrel distortion, scaled so the corners stay in frame.
      float2 q = d * (1 + amount * r2) / (1 + max(amount, 0) * 2);
      return src.eval(q * size * 0.5 + size * 0.5);
    }`,
  vignette: `
    uniform shader src; uniform float2 size; uniform float amount, softness; uniform half4 color;
    half4 main(float2 p) {
      half4 c = src.eval(p);
      float2 d = (p - size * 0.5) / (size * 0.5);
      float r = length(d) / 1.41421356;
      float v = smoothstep(1 - softness, 1.0, r * 1.2) * amount;
      return half4(mix(c.rgb, color.rgb * c.a, half(v)), c.a);
    }`,
  halftone: `
    uniform shader src; uniform float size, angle;
    half4 main(float2 p) {
      float s = sin(angle), co = cos(angle);
      float2x2 rot = float2x2(co, -s, s, co);
      float2 q = rot * p;
      float2 cell = floor(q / size) * size + size * 0.5;
      float2 center = float2x2(co, s, -s, co) * cell;
      half4 c = src.eval(center);
      float y = dot(float3(unpremul(c).rgb), float3(0.2126, 0.7152, 0.0722));
      float r = size * 0.5 * sqrt(1 - y) * 1.4;
      float d = length(q - cell);
      float ink = 1 - smoothstep(r - 0.75, r + 0.75, d);
      return half4(half3(mix(unpremul(c).rgb * 1.15, float3(0.05), ink)) * c.a, c.a);
    }`,
  pixelate: `
    uniform shader src; uniform float size;
    half4 main(float2 p) { return src.eval(floor(p / size) * size + size * 0.5); }`,
  sharpen: `
    uniform shader src; uniform float amount;
    half4 main(float2 p) {
      half4 c = src.eval(p);
      half4 n = src.eval(p + float2(1, 0)) + src.eval(p - float2(1, 0)) + src.eval(p + float2(0, 1)) + src.eval(p - float2(0, 1));
      half4 o = c + (c * 4 - n) * half(amount);
      return half4(clamp(o.rgb, 0, o.a), c.a);
    }`,
  brightPass: `
    uniform float threshold;
    half4 main(half4 c) {
      half3 u = unpremul(c).rgb;
      float y = dot(float3(u), float3(0.2126, 0.7152, 0.0722));
      float k = smoothstep(threshold, threshold + 0.2, y);
      return half4(u * k * c.a, c.a * k);
    }`,
  glass: `
    uniform shader src; uniform float2 size; uniform float radius, refraction, highlight, edge, dispersion; uniform half4 tint;
    float sd(float2 p, float2 b, float r) { float2 q = abs(p) - b + r; return min(max(q.x, q.y), 0) + length(max(q, 0)) - r; }
    half4 main(float2 p) {
      float2 c = size * 0.5, d = p - c;
      float dist = sd(d, c, radius);
      float2 n = normalize(float2(sd(d + float2(1, 0), c, radius) - sd(d - float2(1, 0), c, radius),
                                  sd(d + float2(0, 1), c, radius) - sd(d - float2(0, 1), c, radius)) + 1e-5);
      // Bend light near the edge, most at the rim and none deep inside, like a thick lens.
      float k = 1 - clamp(-dist / edge, 0, 1);
      float2 o = -n * k * k * refraction * edge;
      half4 col = half4(src.eval(p + o * (1 + dispersion)).r, src.eval(p + o).g, src.eval(p + o * (1 - dispersion)).b, 1);
      col.rgb = mix(col.rgb, tint.rgb, tint.a);
      float rim = 1 - clamp(-dist / 1.5, 0, 1);
      float light = max(0, dot(n, normalize(float2(-0.6, -1))));
      col.rgb += half(highlight * (rim * 0.9 + k * k * 0.25) * light);
      return half4(clamp(col.rgb, 0, 1), 1);
    }`,
};

const compiled = new Map<string, RuntimeEffect>();
function program(name: string, kind: 'shader' | 'colorFilter' = 'shader'): RuntimeEffect {
  let e = compiled.get(name);
  if (!e) {
    e =
      kind === 'shader'
        ? RuntimeEffect.makeForShader(SOURCES[name]!)
        : RuntimeEffect.makeForColorFilter(SOURCES[name]!);
    compiled.set(name, e);
  }
  return e;
}

/**
 * Builds the image filter for `effects` on a node of size `w`×`h` at `frame`, applied in order. Returns the
 * filter and every intermediate filter so the caller can free them. @internal
 */
export function buildEffects(
  effects: readonly Effect[],
  w: number,
  h: number,
  frame: number,
  input: ImageFilter | null = null,
): { filter: ImageFilter | null; temps: ImageFilter[] } {
  const temps: ImageFilter[] = [];
  let f: ImageFilter | null = input;
  const keep = (x: ImageFilter | null) => {
    if (x) temps.push(x);
    return x;
  };
  for (const e of effects) {
    switch (e.kind) {
      case 'grain':
        f = keep(
          imageFilters.runtimeShader(
            program('grain'),
            'src',
            { amount: e.amount, size: Math.max(1, e.size), seed: e.seed + (e.animated ? frame * 7.31 : 0) },
            f,
          ),
        );
        break;
      case 'chromaticAberration':
        f = keep(
          imageFilters.runtimeShader(program('chromaticAberration'), 'src', { size: [w, h], amount: e.amount }, f),
        );
        break;
      case 'lensDistortion':
        f = keep(imageFilters.runtimeShader(program('lensDistortion'), 'src', { size: [w, h], amount: e.amount }, f));
        break;
      case 'vignette':
        f = keep(
          imageFilters.runtimeShader(
            program('vignette'),
            'src',
            { size: [w, h], amount: e.amount, softness: e.softness, color: toColor4f(e.color) },
            f,
          ),
        );
        break;
      case 'halftone':
        f = keep(
          imageFilters.runtimeShader(
            program('halftone'),
            'src',
            { size: Math.max(2, e.size), angle: (e.angle * Math.PI) / 180 },
            f,
          ),
        );
        break;
      case 'pixelate':
        f = keep(imageFilters.runtimeShader(program('pixelate'), 'src', { size: Math.max(1, e.size) }, f));
        break;
      case 'sharpen':
        f = keep(imageFilters.runtimeShader(program('sharpen'), 'src', { amount: e.amount }, f));
        break;
      case 'glow': {
        const bright = program('brightPass', 'colorFilter').makeColorFilter({ threshold: e.threshold });
        const scale = colorFilters.matrix([
          e.intensity,
          0,
          0,
          0,
          0,
          0,
          e.intensity,
          0,
          0,
          0,
          0,
          0,
          e.intensity,
          0,
          0,
          0,
          0,
          0,
          e.intensity,
          0,
        ]);
        const pass = keep(imageFilters.colorFilter(bright, f));
        const blurred = keep(imageFilters.blur([e.radius / 2, e.radius / 2], TileMode.Decal, pass));
        const scaled = keep(imageFilters.colorFilter(scale, blurred));
        f = keep(imageFilters.blend(BlendMode.Plus, f, scaled));
        break;
      }
    }
  }
  return { filter: f, temps };
}

export interface GlassOptions {
  /** Frost: how much the background is blurred, in pixels. Default 14. */
  blur?: number;
  /** How strongly the edges bend the background. Default 0.6. */
  refraction?: number;
  /** Width of the bending edge, in pixels. Default 24. */
  edge?: number;
  /** Rim light. Default 0.35. */
  highlight?: number;
  /** Color fringing at the edges. Default 0.08. */
  dispersion?: number;
  /** A color laid over the glass; its alpha sets how much. Default a faint white. */
  tint?: Color;
}

/** The backdrop filter for glass on a `w`×`h` node with corner radius `radius`. @internal */
export function buildGlass(
  o: GlassOptions,
  w: number,
  h: number,
  radius: number,
): { filter: ImageFilter | null; temps: ImageFilter[] } {
  const temps: ImageFilter[] = [];
  const blur = o.blur ?? 14;
  const blurred = blur > 0 ? imageFilters.blur([blur / 2, blur / 2], TileMode.Clamp) : null;
  if (blurred) temps.push(blurred);
  const filter = imageFilters.runtimeShader(
    program('glass'),
    'src',
    {
      size: [w, h],
      radius: Math.min(radius, w / 2, h / 2),
      refraction: o.refraction ?? 0.6,
      edge: Math.max(1, o.edge ?? 24),
      highlight: o.highlight ?? 0.35,
      dispersion: o.dispersion ?? 0.08,
      tint: toColor4f(o.tint ?? 'rgba(255,255,255,0.08)'),
    },
    blurred,
  );
  if (filter) temps.push(filter);
  return { filter, temps };
}

export interface LayerStyle {
  /** A shadow shaped like the content (text, paths, images with transparency). */
  dropShadow?: { color?: Color; offset?: readonly [number, number]; blur?: number };
  /** A soft glow outside the content. */
  outerGlow?: { color?: Color; size?: number; opacity?: number };
  /** A soft glow inside the content's edges. */
  innerGlow?: { color?: Color; size?: number; opacity?: number };
  /** An outline around the content. */
  stroke?: { color?: Color; width?: number };
  /** Fills the content with a color, keeping its shape. */
  colorOverlay?: { color: Color; opacity?: number };
  /** Fills the content with a gradient, keeping its shape. */
  gradientOverlay?: { gradient: Gradient; opacity?: number };
}

function tinted(color: Color, opacity: number): ReturnType<typeof colorFilters.matrix> {
  // Replace color, keep alpha scaled by opacity.
  const [r, g, b, a] = toColor4f(color);
  const k = a * opacity;
  return colorFilters.matrix([0, 0, 0, 0, r, 0, 0, 0, 0, g, 0, 0, 0, 0, b, 0, 0, 0, k, 0]);
}

/** Builds the image filter for a layer style, in Photoshop's order. @internal */
export function buildLayerStyle(
  style: LayerStyle,
  gradientShader: (g: Gradient) => Shader | null,
): { filter: ImageFilter | null; temps: ImageFilter[] } {
  const temps: ImageFilter[] = [];
  const keep = (x: ImageFilter | null) => {
    if (x) temps.push(x);
    return x;
  };
  let content: ImageFilter | null = null;
  if (style.colorOverlay) {
    const { color, opacity = 1 } = style.colorOverlay;
    const fill = keep(imageFilters.colorFilter(tinted(color, opacity), null));
    content = keep(imageFilters.blend(BlendMode.SrcOver, null, keep(imageFilters.blend(BlendMode.SrcIn, null, fill))));
  }
  if (style.gradientOverlay) {
    const sh = gradientShader(style.gradientOverlay.gradient);
    if (sh) {
      const fill = keep(imageFilters.shader(sh));
      const masked = keep(imageFilters.blend(BlendMode.SrcIn, null, fill));
      const alpha = style.gradientOverlay.opacity ?? 1;
      const faded =
        alpha < 1
          ? keep(
              imageFilters.colorFilter(
                colorFilters.matrix([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, alpha, 0]),
                masked,
              ),
            )
          : masked;
      content = keep(imageFilters.blend(BlendMode.SrcOver, content, faded));
    }
  }
  if (style.innerGlow) {
    const { color = '#ffffff', size = 8, opacity = 0.75 } = style.innerGlow;
    // Glow from the edges inward: blur the inverted shape, keep it inside the shape.
    const [r, g, b, a] = toColor4f(color);
    const inverted = keep(
      imageFilters.colorFilter(
        colorFilters.matrix([0, 0, 0, 0, r, 0, 0, 0, 0, g, 0, 0, 0, 0, b, 0, 0, 0, -a * opacity, a * opacity]),
        null,
      ),
    );
    const blurred = keep(imageFilters.blur([size / 2, size / 2], TileMode.Decal, inverted));
    const inside = keep(imageFilters.blend(BlendMode.SrcIn, null, blurred));
    content = keep(imageFilters.blend(BlendMode.SrcOver, content, inside));
  }
  const under: (ImageFilter | null)[] = [];
  if (style.dropShadow) {
    const { color = 'rgba(0,0,0,0.5)', offset = [0, 4], blur = 8 } = style.dropShadow;
    under.push(
      keep(imageFilters.dropShadowOnly([offset[0], offset[1]], [blur / 2, blur / 2], toColorInt(color), null)),
    );
  }
  if (style.outerGlow) {
    const { color = '#ffffff', size = 12, opacity = 0.75 } = style.outerGlow;
    under.push(
      keep(
        imageFilters.blur(
          [size / 2, size / 2],
          TileMode.Decal,
          keep(imageFilters.colorFilter(tinted(color, opacity), null)),
        ),
      ),
    );
  }
  if (style.stroke) {
    const { color = '#000000', width = 2 } = style.stroke;
    under.push(keep(imageFilters.colorFilter(tinted(color, 1), keep(imageFilters.dilate([width, width], null)))));
  }
  if (!content && !under.length) return { filter: null, temps };
  const filter = keep(imageFilters.merge([...under, content]));
  return { filter, temps };
}
