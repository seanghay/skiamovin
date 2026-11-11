// Scenes rendered by both builds (Node addon and WebAssembly) and compared pixel by pixel.
// Plain JavaScript so the browser test page can import it unchanged.
import { AlphaType, ColorType, ImageInfo, surfaces } from 'skiamovin';
import {
  box,
  Composition,
  CompositionSink,
  interpolate,
  linearGradient,
  morphPath,
  path,
  radialGradient,
  shader,
  spring,
  text,
} from 'skiamovin/scene';
import { TaffyTree } from 'skiamovin/taffy';

export const WIDTH = 256;
export const HEIGHT = 144;

const PLASMA = `
  uniform float2 iResolution; uniform float iTime;
  half4 main(float2 p) {
    float2 uv = p / iResolution;
    float v = sin(uv.x * 9 + iTime) + sin(uv.y * 7 - iTime * 1.3);
    return half4(half3(0.5 + 0.5 * cos(v + float3(0, 2, 4))), 1);
  }`;

/** @param {import('skiamovin/scene').FontAsset} font */
export function goldenScenes(font) {
  const base = { width: WIDTH, height: HEIGHT, frameRate: 30, duration: 2 };
  return [
    {
      name: 'shapes',
      times: [0, 0.5, 1.5],
      comp: new Composition({
        ...base,
        render: ({ timestamp }) =>
          box({ size: { width: '100%', height: '100%' }, background: linearGradient(135, ['#0f172a', '#4338ca']) }, [
            box({
              position: 'absolute',
              inset: { left: 20, top: 20 },
              size: { width: 60, height: 60 },
              borderRadius: 16,
              background: '#f59e0b',
              transform: { rotate: timestamp * 90, scale: spring({ timestamp }) },
              shadow: { offset: [0, 6], blur: 12, color: 'rgba(0,0,0,0.5)' },
            }),
            box({
              position: 'absolute',
              inset: { left: 140, top: 40 },
              size: { width: 80, height: 80 },
              borderRadius: 40,
              background: radialGradient(['#22d3ee', '#0e7490']),
              opacity: interpolate(timestamp, [0, 1], [0.2, 1]),
            }),
          ]),
      }),
    },
    {
      name: 'text',
      times: [0, 1],
      comp: new Composition({
        ...base,
        fonts: [font],
        render: ({ timestamp }) =>
          box(
            {
              size: { width: '100%', height: '100%' },
              background: '#ffffff',
              justifyContent: 'center',
              alignItems: 'center',
            },
            [text('Golden frames 123', { fontFamily: 'Arial', fontSize: 22 + timestamp * 4, color: '#111827' })],
          ),
      }),
    },
    {
      name: 'paths',
      times: [0.25, 1],
      comp: new Composition({
        ...base,
        render: ({ timestamp }) =>
          box({ size: { width: '100%', height: '100%' }, background: '#111827' }, [
            path('M10 20 C60 -10 100 120 150 60 S220 10 240 100', {
              stroke: '#38bdf8',
              strokeWidth: 3,
              strokeCap: 'round',
              trim: { end: timestamp / 1.5 },
              arrow: { end: true },
            }),
            box({ position: 'absolute', inset: { left: 150, top: 40 } }, [
              path(
                morphPath('M30 0 A30 30 0 1 1 30 60 A30 30 0 1 1 30 0 Z', 'M0 0 L60 0 L60 60 L0 60 Z', timestamp / 2),
                {
                  fill: '#f472b6',
                },
              ),
            ]),
          ]),
      }),
    },
    {
      name: 'shader',
      times: [0, 1.25],
      comp: new Composition({
        ...base,
        render: () => shader(PLASMA, { size: { width: '100%', height: '100%' } }),
      }),
    },
  ];
}

/** Renders every golden frame on the CPU and returns RGBA bytes per frame. */
export async function renderGolden(font) {
  const out = [];
  for (const scene of goldenScenes(font)) {
    const sink = new CompositionSink(scene.comp, { gpu: 'raster' });
    for (const t of scene.times) {
      const frame = await sink.getImage(t);
      const s = surfaces.rasterN32Premul([WIDTH, HEIGHT]);
      s.canvas().drawImage(frame.image, [0, 0]);
      out.push({
        name: `${scene.name}@${t}`,
        pixels: s.readPixels(0, 0, new ImageInfo(WIDTH, HEIGHT, ColorType.RGBA_8888, AlphaType.Premul)),
      });
      s.delete();
    }
    await sink.dispose();
  }
  return out;
}

/** A Taffy layout with flexbox, grid and absolute positioning, returned as plain numbers. */
export function goldenLayout() {
  const t = new TaffyTree();
  const items = Array.from({ length: 7 }, (_, i) =>
    t.newLeaf({ flexGrow: i % 3, size: { width: 13.3 + i, height: 7.7 * i } }),
  );
  const row = t.newWithChildren({ flexDirection: 'row', flexWrap: 'wrap', gap: 3.3, padding: 5.5 }, items.slice(0, 4));
  const grid = t.newWithChildren(
    { display: 'grid', gridTemplateColumns: ['1fr', '2fr', 'minmax(10px, 1fr)'], gap: 2.25 },
    items.slice(4),
  );
  const root = t.newWithChildren({ size: { width: 333.3, height: 222.2 }, flexDirection: 'column' }, [row, grid]);
  t.computeLayout(root);
  return [...items, row, grid, root].map((n) => {
    const l = t.layout(n);
    return [l.location.x, l.location.y, l.size.width, l.size.height];
  });
}
