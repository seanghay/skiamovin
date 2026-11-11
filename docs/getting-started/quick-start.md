# Quick start

This page renders the same 3-second clip twice: first with the composition layer, then by hand with the Skia
canvas. If you've used Mediabunny, both will look familiar. The output side is an ordinary Mediabunny
`Output`, and times are in seconds.

## With a composition

```ts
// intro.ts
import { Output, Mp4OutputFormat, FilePathTarget, FilePathSource } from 'mediabunny';
import { Composition, Render, FontAsset, box, text, spring, interpolate, linearGradient } from 'skiamovin/scene';

const inter = new FontAsset(new FilePathSource('./fonts/Inter-Variable.ttf'), { family: 'Inter' });

export const intro = new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 3,
  fonts: [inter],
  defaultProps: { title: 'Skiamovin' },

  render: ({ timestamp, props }) => {
    const enter = spring({ timestamp, damping: 14 });
    const fadeOut = interpolate(timestamp, [2.3, 3], [1, 0]);

    return box(
      {
        size: { width: '100%', height: '100%' },
        justifyContent: 'center',
        alignItems: 'center',
        background: linearGradient(135, ['#0f172a', '#312e81']),
      },
      [
        text(props.title, {
          fontFamily: 'Inter',
          fontSize: 160,
          fontWeight: 800,
          color: '#ffffff',
          opacity: enter * fadeOut,
          transform: { translateY: (1 - enter) * 80, scale: 0.9 + enter * 0.1 },
        }),
      ],
    );
  },
});

const render = await Render.init({
  composition: intro,
  output: new Output({ format: new Mp4OutputFormat(), target: new FilePathTarget('intro.mp4') }),
});

render.onProgress = (progress) => process.stdout.write(`\r${Math.round(progress * 100)}%`);
await render.execute();
```

```sh
node intro.ts        # Node 23.6+ runs TypeScript directly; on older versions use `npx tsx intro.ts`
```

What happens:

1. `render(ctx)` returns a node tree for each timestamp. Layout comes from Taffy's Flexbox, the same model as CSS.
2. `spring` and `interpolate` are pure functions of `timestamp`, so any frame can render alone, in any order.
3. The font is a lazy asset built on a Mediabunny `Source`. It's read the first time it's needed.
4. `Render` works like Mediabunny's `Conversion`. It picks a codec the output format supports (H.264 here),
   draws each frame on a GPU surface, encodes it, and finalizes the `Output`.

There's no `init()` call: `Render`, `CompositionSink` and `Player` initialize Skiamovin on first use.

## With the Skia canvas

The same clip, drawn by hand with Mediabunny driving the output. `SurfaceSource` is the Skia counterpart of
Mediabunny's `CanvasSource`.

```ts
import { readFile } from 'node:fs/promises';
import { Output, Mp4OutputFormat, FilePathTarget, QUALITY_HIGH } from 'mediabunny';
import { init, gpu, Paint, Shader, TileMode, Color, ImageInfo, FontMgr, textlayout } from 'skiamovin';
import { SurfaceSource } from 'skiamovin/media';

await init(); // on Node: registers native codecs with Mediabunny

const width = 1920,
  height = 1080,
  frameRate = 30,
  duration = 3;

// 1. A GPU surface (Metal / Vulkan / D3D12, whichever is available)
const context = gpu.directContexts.makeDefault()!;
const surface = gpu.surfaces.renderTarget(context, gpu.Budgeted.Yes, ImageInfo.newN32Premul([width, height]), {
  sampleCount: 4,
})!;
const canvas = surface.canvas();

// 2. Text with SkParagraph
const fontMgr = FontMgr.default();
const provider = new textlayout.TypefaceFontProvider();
provider.registerTypeface(fontMgr.newFromData(await readFile('./fonts/Inter-Variable.ttf'))!, 'Inter');
const fonts = new textlayout.FontCollection();
fonts.setAssetFontManager(provider);
fonts.setDefaultFontManager(fontMgr);

const style = new textlayout.TextStyle()
  .setFontFamilies(['Inter'])
  .setFontSize(160)
  .setColor(Color.WHITE)
  .setFontArguments({ variationDesignPosition: { wght: 800 } });
const paragraphStyle = new textlayout.ParagraphStyle().setTextStyle(style).setTextAlign(textlayout.TextAlign.Center);
const paragraph = new textlayout.ParagraphBuilder(paragraphStyle, fonts).addText('Skiamovin').build();
paragraph.layout(width);

// 3. Paints
const background = new Paint().setDither(true).setShader(
  Shader.linearGradient(
    [
      [0, 0],
      [width, height],
    ],
    ['#0f172a', '#312e81'],
    null,
    TileMode.Clamp,
  ),
);

// 4. A Mediabunny output, with the surface as its video source
const output = new Output({ format: new Mp4OutputFormat(), target: new FilePathTarget('intro.mp4') });
const videoSource = new SurfaceSource(surface, { codec: 'avc', bitrate: QUALITY_HIGH });
output.addVideoTrack(videoSource, { frameRate });
await output.start();

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

for (let i = 0; i < duration * frameRate; i++) {
  const timestamp = i / frameRate;
  const enter = easeOut(Math.min(timestamp / 0.66, 1));
  const fadeOut = 1 - Math.max(0, Math.min((timestamp - 2.3) / 0.7, 1));

  canvas.drawPaint(background);
  canvas.saveLayerAlpha(null, Math.round(255 * enter * fadeOut));
  canvas.translate([0, height / 2 - paragraph.height() / 2 + (1 - enter) * 80]);
  paragraph.paint(canvas, [0, 0]);
  canvas.restore();

  await videoSource.add(timestamp, 1 / frameRate); // GPU texture → encoder, no CPU copy where supported
}

videoSource.close();
await output.finalize();
```

## In the browser

The composition runs unchanged in a browser. Only the `Target` and the font's `Source` change, the same way
they would in any Mediabunny code:

```ts
import { Output, Mp4OutputFormat, BufferTarget, UrlSource } from 'mediabunny';

const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
await (await Render.init({ composition: intro, output })).execute();

const blob = new Blob([output.target.buffer!], { type: 'video/mp4' });
```

Or preview it live:

```ts
import { Player } from 'skiamovin/scene';
const player = new Player(intro, { canvas: document.querySelector('canvas')!, loop: true, autoplay: true });
```

## Next

- [Compositions and animation](../guides/scenes.md): sequences, timelines, layout
- [Sources and sinks](../guides/mediabunny.md): how Skiamovin connects to Mediabunny
- [The Skia API](../guides/skia-basics.md): everything the canvas can do
- [Rendering compositions](../guides/rendering.md): codecs, quality, concurrency, stills
