# Shaders and effects

Skia offers three ways to change pixels: **shaders** (what color goes where), **color filters** (per-pixel
color math), and **image filters** (effects that read neighboring pixels, such as blur and shadows). With
**SkSL runtime effects** you can write your own of any of them.

## Gradients

```ts
const sky = Shader.linearGradient(
  [
    [0, 0],
    [0, H],
  ],
  ['#0b1026', '#2b1055', '#d76d77'],
  [0, 0.6, 1],
  TileMode.Clamp,
);
paint.setShader(sky).setDither(true); // dither: avoids banding after 8-bit encoding
```

In the scene layer:

```ts
box({ background: linearGradient(160, ['#0b1026', ['#2b1055', 0.6], '#d76d77']) });
```

## SkSL runtime effects

SkSL is Skia's shading language. It's GLSL-like and compiles to Metal, SPIR-V, HLSL, WGSL or GLSL depending on
the backend, so one shader runs everywhere.

```ts
const effect = RuntimeEffect.makeForShader(`
  uniform float2 iResolution;
  uniform float iTime;

  half4 main(float2 fragCoord) {
    float2 uv = fragCoord / iResolution;
    float3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + float3(0, 2, 4));
    return half4(half3(col), 1);
  }
`);

const shader = effect.makeShader({ iResolution: [W, H], iTime: timestamp });
canvas.drawPaint(new Paint().setShader(shader));
```

Compile errors throw a `SkiaError` with the line and message. Compile once and call `makeShader` every frame.
That's cheap.

### In a composition

```ts
const PLASMA = `...same SkSL...`; // declare iResolution / iTime / iFrame / iProgress to get them filled in

box({ size: { width: '100%', height: '100%' } }, [shader(PLASMA, { size: { width: '100%', height: '100%' } })]);
```

### Shading other content

A shader can sample _children_: images, other shaders, or (in the scene layer) a whole rendered subtree:

```ts
const RIPPLE = `
  uniform shader content;
  uniform float2 iResolution;
  uniform float iTime;
  half4 main(float2 p) {
    float2 c = iResolution * 0.5;
    float d = distance(p, c);
    float2 offset = normalize(p - c) * sin(d * 0.05 - iTime * 6.0) * 8.0;
    return content.eval(p + offset);
  }
`;

shader(RIPPLE, {
  size: { width: '100%', height: '100%' },
  children: {
    content: box({ justifyContent: 'center', alignItems: 'center', size: { width: '100%', height: '100%' } }, [
      text('Ripple', { fontSize: 200, color: '#fff' }),
    ]),
  },
});
```

At the Skia layer, pass any `Shader`, such as an image shader:

```ts
effect.makeShader({ iResolution: [W, H], iTime: t }, { content: image.makeShader() });
```

### Transitions

Runtime blenders and two-child shaders are a natural fit for transitions:

```ts
const CROSS_ZOOM = `
  uniform shader from; uniform shader to;
  uniform float progress; uniform float2 iResolution;
  half4 main(float2 p) { /* ... */ }
`;
```

`series` with a negative `offset` overlaps two scenes. Render them as children of a transition shader during
the overlap. See [Scenes → transitions](scenes.md#transitions).

## Image filters

```ts
paint.setImageFilter(imageFilters.blur([12, 12]));
paint.setImageFilter(imageFilters.dropShadow([0, 12], [24, 24], '#00000080'));
paint.setImageFilter(
  imageFilters.compose(imageFilters.colorFilter(colorFilters.matrix(saturationMatrix(0.2))), imageFilters.blur([4, 4])),
);
```

Scene-layer shorthands: `blur`, `shadow`, `backdropBlur`, `filter` and `colorFilter` on any node.

## Color filters

```ts
colorFilters.blend('#ff006680', BlendMode.Multiply);
colorFilters.matrix([...20 numbers...]);   // 4×5 RGBA matrix
colorFilters.lighting(mul, add);
colorFilters.table(lut);                    // per-channel 256-entry tables
RuntimeEffect.makeForColorFilter(`half4 main(half4 c) { return half4(c.rgb * c.a, c.a); }`).makeColorFilter({});
```

## Noise

`shaders.fractalNoise` and `shaders.turbulence` are Perlin noise generators that run on the GPU. For noise in
JavaScript (positions, wiggle), use the deterministic [`noise`](../api/scene.md#random-and-noise) from
`skiamovin/scene`.
