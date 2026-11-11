// Ready-made animated backgrounds. Each is a full-size shader node that moves with the composition's time.
import { type Color, toColor4f } from '../core/color.ts';
import { type NodeStyle, type SceneNode, shader } from './nodes.ts';

const full: NodeStyle = { position: 'absolute', inset: 0, size: { width: '100%', height: '100%' } };

const flat = (colors: readonly Color[], n: number) => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = toColor4f(colors[i % colors.length]!);
    out.push(c[0], c[1], c[2]);
  }
  return out;
};

const MESH = `
  uniform float2 iResolution; uniform float iTime; uniform float speed; uniform float3 c0, c1, c2, c3;
  float3 toLin(float3 c) { return pow(c, float3(2.2)); }
  float3 toSrgb(float3 c) { return pow(c, float3(1 / 2.2)); }
  half4 main(float2 p) {
    float2 uv = p / iResolution;
    float t = iTime * speed;
    // Four color points drifting on slow loops, blended by inverse distance in linear light.
    float2 q[4];
    q[0] = float2(0.2 + 0.15 * sin(t * 0.7), 0.25 + 0.2 * cos(t * 0.5));
    q[1] = float2(0.8 + 0.12 * cos(t * 0.6), 0.2 + 0.15 * sin(t * 0.8));
    q[2] = float2(0.25 + 0.18 * cos(t * 0.45), 0.8 + 0.12 * sin(t * 0.65));
    q[3] = float2(0.75 + 0.15 * sin(t * 0.55), 0.75 + 0.18 * cos(t * 0.4));
    float2 w = uv + 0.04 * float2(sin(uv.y * 6 + t), cos(uv.x * 5 - t));
    float3 col = float3(0); float total = 0;
    for (int i = 0; i < 4; i++) {
      float d = length((w - q[i]) * float2(iResolution.x / iResolution.y, 1));
      float k = 1 / pow(d + 0.08, 2.5);
      float3 c = i == 0 ? c0 : i == 1 ? c1 : i == 2 ? c2 : c3;
      col += toLin(c) * k; total += k;
    }
    return half4(half3(toSrgb(col / total)), 1);
  }`;

const AURORA = `
  uniform float2 iResolution; uniform float iTime; uniform float speed; uniform float3 base, a, b;
  half4 main(float2 p) {
    float2 uv = p / iResolution;
    float t = iTime * speed;
    float3 col = base;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float wave = sin(uv.x * (2.5 + fi) + t * (0.5 + 0.2 * fi) + fi * 1.7) * 0.12 + sin(uv.x * 7 - t * 0.8 + fi) * 0.03;
      float band = exp(-pow((uv.y - 0.35 - fi * 0.12 - wave) * (7 - fi), 2));
      col += mix(a, b, fi / 2) * band * (0.55 - fi * 0.12);
    }
    return half4(half3(col), 1);
  }`;

const NOISE = `
  uniform float2 iResolution; uniform float iTime; uniform float speed; uniform float scale; uniform float3 from, to;
  float h(float2 p) { return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }
  float n(float2 p) {
    float2 i = floor(p), f = fract(p); f = f * f * (3 - 2 * f);
    return mix(mix(h(i), h(i + float2(1, 0)), f.x), mix(h(i + float2(0, 1)), h(i + float2(1, 1)), f.x), f.y);
  }
  half4 main(float2 p) {
    float2 q = p / iResolution.y * scale + iTime * speed * 0.2;
    float v = 0.5 * n(q) + 0.25 * n(q * 2.1 + 3.1) + 0.125 * n(q * 4.3 - 1.7);
    return half4(half3(mix(from, to, smoothstep(0.2, 0.8, v / 0.875))), 1);
  }`;

const PATTERN = `
  uniform float2 iResolution; uniform float spacing, size; uniform float3 bg, fg; uniform int dots; uniform float fade;
  half4 main(float2 p) {
    float2 g = mod(p, spacing) - spacing * 0.5;
    float d = dots == 1 ? length(g) - size : min(abs(g.x), abs(g.y)) - size * 0.5;
    float ink = 1 - smoothstep(-0.75, 0.75, d);
    float2 uv = p / iResolution - 0.5;
    ink *= mix(1, clamp(1 - length(uv) * 1.6, 0, 1), fade);
    return half4(half3(mix(bg, fg, ink)), 1);
  }`;

export const backgrounds = Object.freeze({
  /** Soft color fields drifting into each other. Give four colors (fewer repeat). */
  mesh(
    colors: readonly Color[] = ['#4f46e5', '#ec4899', '#06b6d4', '#f59e0b'],
    options: { speed?: number } & NodeStyle = {},
  ): SceneNode {
    const { speed = 0.6, ...style } = options;
    const [c0, c1, c2, c3] = [0, 1, 2, 3].map((i) => flat([colors[i % colors.length]!], 1));
    return shader(MESH, { ...full, ...style, uniforms: { speed, c0: c0!, c1: c1!, c2: c2!, c3: c3! } });
  },
  /** Ribbons of light over a dark sky. */
  aurora(options: { base?: Color; colors?: readonly [Color, Color]; speed?: number } & NodeStyle = {}): SceneNode {
    const { base = '#050816', colors = ['#22d3ee', '#a855f7'], speed = 0.5, ...style } = options;
    return shader(AURORA, {
      ...full,
      ...style,
      uniforms: { speed, base: flat([base], 1), a: flat([colors[0]], 1), b: flat([colors[1]], 1) },
    });
  },
  /** Smooth flowing noise between two colors. */
  noise(options: { from?: Color; to?: Color; scale?: number; speed?: number } & NodeStyle = {}): SceneNode {
    const { from = '#0f172a', to = '#334155', scale = 3, speed = 0.4, ...style } = options;
    return shader(NOISE, { ...full, ...style, uniforms: { speed, scale, from: flat([from], 1), to: flat([to], 1) } });
  },
  /** A dot grid that fades toward the edges. */
  dots(
    options: { background?: Color; color?: Color; spacing?: number; size?: number; fade?: number } & NodeStyle = {},
  ): SceneNode {
    const { background = '#0b0d12', color = '#1f2937', spacing = 28, size = 1.6, fade = 0.6, ...style } = options;
    return shader(PATTERN, {
      ...full,
      ...style,
      uniforms: { spacing, size, bg: flat([background], 1), fg: flat([color], 1), dots: 1, fade },
    });
  },
  /** A line grid that fades toward the edges. */
  grid(
    options: { background?: Color; color?: Color; spacing?: number; width?: number; fade?: number } & NodeStyle = {},
  ): SceneNode {
    const { background = '#0b0d12', color = '#1f2937', spacing = 48, width = 1, fade = 0.6, ...style } = options;
    return shader(PATTERN, {
      ...full,
      ...style,
      uniforms: { spacing, size: width, bg: flat([background], 1), fg: flat([color], 1), dots: 0, fade },
    });
  },
});
