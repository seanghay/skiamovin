// The composition. Imported by the page (for its size and frame rate) and by the worker (to render it).

import interRegular from '@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf?url';
import interBold from '@expo-google-fonts/inter/800ExtraBold/Inter_800ExtraBold.ttf?url';
import { UrlSource } from 'mediabunny';
import { box, Composition, Easing, FontAsset, interpolate, random, shader, spring, text } from 'skiamovin/scene';

export interface PromoProps {
  title: string;
  subtitle: string;
  accent: string;
  particles: number;
}

// Absolute URLs, so they resolve the same from the page and from the worker.
const abs = (u: string) => new URL(u, self.location.href).href;
const fonts = [
  new FontAsset(new UrlSource(abs(interBold)), { family: 'Inter' }),
  new FontAsset(new UrlSource(abs(interRegular)), { family: 'Inter' }),
];

const AURORA = `
  uniform float2 iResolution; uniform float iTime; uniform float3 accent;
  half4 main(float2 p) {
    float2 uv = p / iResolution;
    float w = sin(uv.x * 3.0 + iTime * 0.6) * 0.15 + sin(uv.x * 7.0 - iTime * 0.9) * 0.05;
    float band = exp(-pow((uv.y - 0.45 - w) * 5.0, 2.0));
    float3 base = mix(float3(0.02, 0.03, 0.08), float3(0.05, 0.04, 0.12), uv.y);
    return half4(half3(base + accent * band * 0.55), 1);
  }`;

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const promo = new Composition<PromoProps>({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 6,
  fonts,
  defaultProps: {
    title: 'Made with Skiamovin',
    subtitle: 'Rendered in your browser, on the GPU',
    accent: '#7c3aed',
    particles: 40,
  },
  render: ({ timestamp, props }) => {
    const words = props.title.split(/\s+/).filter(Boolean);
    const out = interpolate(timestamp, [5.3, 6], [1, 0], { easing: Easing.inCubic });
    return box(
      {
        size: { width: '100%', height: '100%' },
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        gap: 28,
      },
      [
        shader(AURORA, {
          position: 'absolute',
          inset: 0,
          size: { width: '100%', height: '100%' },
          uniforms: { accent: hexToRgb(props.accent) },
        }),
        ...Array.from({ length: props.particles }, (_, i) => {
          const s = spring({ timestamp, delay: 0.3 + 0.03 * i, damping: 14 });
          const size = 8 + random(`s${i}`) * 26;
          return box({
            position: 'absolute',
            inset: { left: random(`x${i}`) * 1900, top: random(`y${i}`) * 1060 },
            size: { width: size, height: size },
            borderRadius: size / 2,
            background: i % 3 ? '#ffffff' : props.accent,
            opacity: 0.35 * s * out,
            transform: { scale: s, translateY: Math.sin(timestamp * 1.5 + i) * 24 },
          });
        }),
        box(
          { flexDirection: 'row', gap: 28, flexWrap: 'wrap', justifyContent: 'center', size: { width: 1600 } },
          words.map((w, i) => {
            const s = spring({ timestamp, delay: 0.2 + i * 0.12, damping: 13 });
            return text(w, {
              fontFamily: 'Inter',
              fontWeight: 800,
              fontSize: 132,
              color: '#ffffff',
              opacity: s * out,
              transform: { translateY: (1 - s) * 80 },
              textShadow: { offset: [0, 8], blur: 30, color: 'rgba(0,0,0,0.5)' },
            });
          }),
        ),
        text(props.subtitle, {
          fontFamily: 'Inter',
          fontSize: 46,
          color: '#cbd5e1',
          opacity: interpolate(timestamp, [0.9, 1.5], [0, 1], { easing: Easing.outCubic }) * out,
          transform: { translateY: interpolate(timestamp, [0.9, 1.5], [30, 0], { easing: Easing.outCubic }) },
        }),
        box({
          size: { width: interpolate(timestamp, [1.2, 2.4], [0, 360], { easing: Easing.outCubic }), height: 8 },
          borderRadius: 4,
          background: props.accent,
          opacity: out,
        }),
      ],
    );
  },
});
