# Images and SVG

## Loading images

```ts
// composition layer: an ImageAsset over any Mediabunny Source
import { FilePathSource, UrlSource } from 'mediabunny';
import { ImageAsset, image } from 'skiamovin/scene';

const hero = new ImageAsset(new FilePathSource('./hero.jpg'));
const avatar = new ImageAsset(new UrlSource('https://example.com/avatar.png'));

render: () => image(hero, { fit: 'cover', size: { width: '100%', height: '100%' } }),
```

Assets load lazily, on first use, like a Mediabunny `Input`. To read the size ahead of time, call
`await hero.getDimensions()`.

```ts
// Skia layer
const img = await Image.fromPath('./hero.jpg'); // Node
const img2 = images.deferredFromEncodedData(new Uint8Array(await blob.arrayBuffer()))!; // anywhere
```

Supported formats: PNG, JPEG, WebP, GIF (first frame; see below for animation), BMP, ICO, WBMP and AVIF.
HEIF/HEIC is supported on macOS through the system decoder.

## Fitting and scaling

`fit` works like CSS `object-fit`. `objectPosition` sets the anchor:

```ts
image(portrait, { fit: 'cover', objectPosition: ['50%', '20%'], size: { width: 1080, height: 1920 } });
```

For downscaling by large factors, use `sampling: 'mipmap'`. For upscaling, use `'cubic'`.

## Ken Burns

```ts
const t = timestamp / duration; // from the render context
box({ size: { width: '100%', height: '100%' }, overflow: 'hidden' }, [
  image(photo, {
    fit: 'cover',
    size: { width: '100%', height: '100%' },
    transform: { scale: 1 + t * 0.15, translate: [t * -40, t * -20] },
  }),
]);
```

## Animated images

Animated GIF and WebP are decoded with `Codec`:

```ts
const codec = Codec.fromData(bytes)!;
codec.frameCount();
codec.frameInfo(); // per frame: duration (ms), disposal, blend
const frame = codec.getFrame(i); // Image
```

In the composition layer, `ImageAsset` detects animation and the `image` node plays it in sync with the
composition clock, as `video` does.

## SVG

```ts
// composition layer
const logo = new SvgAsset(new FilePathSource('./logo.svg'));
render: () => svg(logo, { size: { width: 400 }, attributes: { wordmark: { fill: '#ffffff' } } }),

// Skia layer
const dom = svg.Dom.fromString(svgText, FontMgr.default());
dom.setContainerSize([400, 120]);
dom.render(canvas);
```

SVG renders as vectors, so it stays sharp at any `scale` transform. SMIL animation and scripts are ignored.
Animate with `transform`, `attributes` and `opacity` from the scene layer instead.

### Drawing SVG paths

For line-draw effects, get the paths themselves:

```ts
const path = Path.fromSVG('M10 80 C 40 10, 65 10, 95 80 S 150 150, 180 80')!;
canvas.drawPath(path, stroke.setPathEffect(pathEffects.trim(0, progress)));
```
