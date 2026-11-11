// 05 — SkSL gallery: four runtime shaders in a CSS grid, one processing a rendered text subtree.
import { box, Composition, shader, text } from 'skiamovin/scene';
import { fonts } from './shared.ts';

const PLASMA = `uniform float2 iResolution; uniform float iTime;
half4 main(float2 p) { float2 uv = p / iResolution;
  float v = sin(uv.x*10+iTime*2)+sin(uv.y*8-iTime*1.5)+sin((uv.x+uv.y)*6+iTime);
  return half4(half3(0.5+0.5*cos(v+float3(0,2,4))),1); }`;
const RINGS = `uniform float2 iResolution; uniform float iTime;
half4 main(float2 p) { float2 uv = (p - iResolution*0.5) / iResolution.y;
  float d = length(uv); float r = sin(d*40 - iTime*6)*0.5+0.5;
  return half4(half3(r*float3(0.2,0.6,1.0) + (1-r)*float3(0.05,0.02,0.15)),1); }`;
const CELLS = `uniform float2 iResolution; uniform float iTime;
float2 h2(float2 p){ p = float2(dot(p,float2(127.1,311.7)), dot(p,float2(269.5,183.3))); return fract(sin(p)*43758.5453); }
half4 main(float2 p) { float2 uv = p / iResolution.y * 6; float2 i = floor(uv); float2 f = fract(uv); float m = 9;
  for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++) { float2 g = float2(x,y); float2 o = h2(i+g); o = 0.5+0.5*sin(iTime+6.2831*o);
    m = min(m, length(g+o-f)); }
  return half4(half3(m*float3(1.0,0.5,0.2) + (1-m)*float3(0.1,0.0,0.2)),1); }`;
const RIPPLE = `uniform shader content; uniform float2 iResolution; uniform float iTime;
half4 main(float2 p) { float2 c = iResolution*0.5; float d = distance(p,c);
  float2 off = normalize(p - c + 0.001) * sin(d*0.06 - iTime*5) * 10;
  return content.eval(p + off); }`;

const label = (s: string) =>
  text(s, {
    position: 'absolute',
    inset: { left: 24, bottom: 18 },
    fontFamily: 'Courier New',
    fontSize: 30,
    color: '#ffffff',
    textShadow: { offset: [0, 2], blur: 6, color: '#000000' },
  });
const tile = (children: any[]) =>
  box(
    { borderRadius: 24, overflow: 'hidden', shadow: { offset: [0, 12], blur: 30, color: 'rgba(0,0,0,0.5)' } },
    children,
  );
const fill = { position: 'absolute' as const, inset: 0, size: { width: '100%' as const, height: '100%' as const } };

export default new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 6,
  fonts: [fonts.arialBlack, fonts.courier],
  render: () =>
    box(
      {
        size: { width: '100%', height: '100%' },
        background: '#020617',
        display: 'grid',
        gridTemplateColumns: ['1fr', '1fr'],
        gridTemplateRows: ['1fr', '1fr'],
        gap: 30,
        padding: 50,
      },
      [
        tile([shader(PLASMA, fill), label('plasma')]),
        tile([shader(RINGS, fill), label('rings')]),
        tile([shader(CELLS, fill), label('voronoi')]),
        tile([
          shader(RIPPLE, {
            ...fill,
            children: {
              content: box(
                {
                  size: { width: '100%', height: '100%' },
                  background: '#fef3c7',
                  justifyContent: 'center',
                  alignItems: 'center',
                },
                [text('RIPPLE', { fontFamily: 'Arial Black', fontSize: 150, color: '#7c2d12' })],
              ),
            },
          }),
          label('shader over a subtree'),
        ]),
      ],
    ),
});
