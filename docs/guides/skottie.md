# Skottie (Lottie)

> **Status:** not available in the current build. The prebuilt Skia binaries for macOS and WebAssembly don't
> include Skottie, so `LottieAsset` throws. This guide describes the planned API. See [status](../status.md).

[Skottie](https://skia.org/docs/user/modules/skottie/) is Skia's native Lottie renderer. It plays Bodymovin
exports from After Effects (and from tools like LottieFiles, Rive's Lottie export, or Figma plugins) with
frame-accurate seeking. A Lottie's own frame rate doesn't need to match your video's.

## In a composition

```ts
import { FilePathSource } from 'mediabunny';
import { Composition, LottieAsset, box, lottie } from 'skiamovin/scene';

const confetti = new LottieAsset(new FilePathSource('./confetti.json'));

const composition = new Composition({
  width: 1080,
  height: 1080,
  frameRate: 60,
  duration: () => confetti.getDuration(),
  render: () =>
    box({ size: { width: '100%', height: '100%' } }, [
      lottie(confetti, { fit: 'cover', size: { width: '100%', height: '100%' } }),
    ]),
});
```

By default the node plays the animation in real time, starting with its sequence: local timestamp `t` shows
Lottie time `t`, whatever the Lottie's own frame rate. To control it yourself:

```ts
lottie(logo, { progress: spring({ timestamp }) }); // drive with a spring
lottie(loader, { time: timestamp * 0.5, loop: true }); // half speed
```

## Templating with overrides

Name layers in After Effects, then change colors and text for each render:

```ts
lottie(lowerThird, {
  overrides: {
    texts: { Name: props.name, Title: { text: props.title, size: 36 } },
    colors: { 'Accent.Fill 1.Color': props.brandColor },
  },
});
```

To find the keys, log the property tree once:

```ts
const props = new skottie.PropertyManager();
new skottie.AnimationBuilder().setPropertyObserver(props).make(json);
console.log(
  props.getColorProps().map((p) => p.key),
  props.getTextProps().map((p) => p.key),
);
```

## Fonts and images

Text layers use the fonts listed in the composition's `fonts`, matched by family name. Images that the Lottie
file references by path (`assets[].p`) are mapped to Mediabunny `Source`s:

```ts
const title = new LottieAsset(new FilePathSource('./title.json'), {
  resources: {
    'img_0.png': new FilePathSource('./title-assets/img_0.png'),
    'img_1.png': new FilePathSource('./title-assets/img_1.png'),
  },
});
```

Images embedded as data URIs need no mapping.

At the Skia layer, pass a font manager and resource provider:

```ts
const anim = new skottie.AnimationBuilder()
  .setFontManager(fontMgrWithMyFonts)
  .setResourceProvider(skottie.ResourceProvider.fromDirectory('./title-assets/'))
  .make(json);
```

## The Skia layer

```ts
const anim = skottie.Animation.fromString(await readFile('confetti.json', 'utf8'));
const dst = Rect.fromWH(1080, 1080);

for (let frame = 0; frame < total; frame++) {
  canvas.clear(Color.TRANSPARENT);
  const timestamp = frame / frameRate;
  anim.seekFrameTime(timestamp);
  anim.render(canvas, dst);
  await videoSource.add(timestamp, 1 / frameRate);
}
```

## Support notes

Skottie supports nearly all of Bodymovin: shapes, masks and mattes, trim paths, repeaters, text animators,
gradients, 3D layers (camera and perspective), most AE effects (Fill, Tint, Gaussian Blur, Drop Shadow, Levels,
Venetian Blinds, …) and expressions-free motion. **Expressions are not supported.** Bake them in After
Effects (_Animation → Keyframe Assistant → Convert Expression to Keyframes_) before exporting.
