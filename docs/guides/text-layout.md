# Text and paragraphs

Skiamovin includes SkParagraph, Skia's text layout engine, with HarfBuzz shaping and ICU line breaking and bidi
compiled in. Complex scripts (Khmer, Arabic, Devanagari, Thai), emoji, ligatures, variable fonts and mixed-direction
text work the same on every platform.

There are two ways to use it:

- **Scene layer:** the `text` node. Layout, wrapping and sizing are handled for you.
- **Skia layer:** `textlayout.ParagraphBuilder` for full control.

## Fonts

Always ship your fonts with your project. System fonts differ between machines, and browsers don't expose them.

```ts
// composition layer: FontAssets over Mediabunny Sources, listed in `fonts`
import { FilePathSource } from 'mediabunny';
import { Composition, FontAsset } from 'skiamovin/scene';

const inter = new FontAsset(new FilePathSource('./fonts/Inter-Variable.ttf'), { family: 'Inter' });
const khmer = new FontAsset(new FilePathSource('./fonts/NotoSansKhmer.ttf'), { family: 'Noto Sans Khmer' });

const composition = new Composition({ /* ... */ fonts: [inter, khmer], render: /* ... */ });
```

```ts
// Skia layer
const provider = new textlayout.TypefaceFontProvider();
provider.registerTypeface(FontMgr.default().newFromData(bytes)!, 'Inter');

const fonts = new textlayout.FontCollection();
fonts.setAssetFontManager(provider);
fonts.setDefaultFontManager(FontMgr.default()); // fallback for missing glyphs
fonts.enableFontFallback();
```

**Fallback:** list several families and SkParagraph picks, for each character, the first family that has the
glyph:

```ts
text('Hello សួស្តី 👋', { fontFamily: ['Inter', 'Noto Sans Khmer', 'Noto Color Emoji'] });
```

## The `text` node

```ts
text('Programmatic video, at the speed of the GPU.', {
  fontFamily: 'Inter',
  fontSize: 64,
  fontWeight: 700,
  lineHeight: 1.1,
  color: '#f8fafc',
  textAlign: 'center',
  maxSize: { width: 1200 }, // wraps at 1200px
});
```

Text is a Taffy leaf with a measure function, so it behaves like CSS. In a column it wraps to the container's
width, and it gives its parent an intrinsic size.

### Rich text

```ts
text(
  [
    'Render ',
    span('everything', { color: '#a78bfa', fontWeight: 800 }),
    ' with ',
    span('Skia', { fontFamily: 'JetBrains Mono', textDecoration: 'underline' }),
    '.',
  ],
  { fontFamily: 'Inter', fontSize: 72, color: '#fff' },
);
```

### Typewriter

```ts
const msg = 'Hello, world';
text(msg, { fontSize: 80, visibleGraphemes: Math.floor(interpolate(timestamp, [0, 1.5], [0, msg.length])) });
```

`visibleGraphemes` counts grapheme clusters, not UTF-16 units, so emoji and combining marks in scripts like
Khmer reveal as whole characters. Layout is computed for the full string, so the visible text doesn't reflow
as it appears.

### Animating font axes

```ts
text('Variable', {
  fontFamily: 'Inter',
  fontSize: 140,
  fontVariations: { wght: interpolate(timestamp, [0, 2], [100, 900]) },
});
```

## The Skia layer: `ParagraphBuilder`

```ts
const base = new textlayout.TextStyle().setFontFamilies(['Inter']).setFontSize(48).setColor('#e2e8f0');
const accent = new textlayout.TextStyle()
  .setFontFamilies(['Inter'])
  .setFontSize(48)
  .setColor('#a78bfa')
  .setFontArguments({ variationDesignPosition: { wght: 800 } });

const paragraph = new textlayout.ParagraphBuilder(
  new textlayout.ParagraphStyle().setTextAlign(textlayout.TextAlign.Left).setMaxLines(3).setEllipsis('…'),
  fonts,
)
  .pushStyle(base)
  .addText('Text with ')
  .pushStyle(accent)
  .addText('style')
  .pop()
  .addText(' and wrapping across lines.')
  .build();

paragraph.layout(900);
paragraph.paint(canvas, [100, 100]);
```

## Per-word and per-glyph animation

Query the laid-out geometry to animate parts of a paragraph.

**Highlight a word (karaoke):**

```ts
const start = str.indexOf('style');
const [box] = paragraph.getRectsForRange([start, start + 5], RectHeightStyle.Tight, RectWidthStyle.Tight);
canvas.drawRRect(RRect.newRectXY(box.rect.withOutset([8, 4]), 8, 8), highlightPaint);
paragraph.paint(canvas, [0, 0]);
```

Ranges use JavaScript string indices (UTF-16). Skiamovin converts them for Skia.

**Animate each glyph:**

```ts
paragraph.visit((line, info) => {
  if (!info) return;
  info.glyphs.forEach((glyph, i) => {
    const [x, y] = info.positions[i];
    const t = spring({ timestamp, delay: info.utf16Starts[i] * 0.04 }); // 40 ms stagger per character
    canvas.save();
    canvas.translate([x, y + (1 - t) * 40]);
    canvas.drawGlyphsAt([glyph], [[0, 0]], [0, 0], info.font, glyphPaint.setAlphaf(t));
    canvas.restore();
  });
});
```

**Text as paths** (for stroke-draw reveals, or masks):

```ts
const outline = paragraph.getPath(0);
canvas.drawPath(outline, strokePaint.setPathEffect(pathEffects.trim(0, progress)));
```

## Performance tips

- Reuse one `FontCollection` for the whole render. Shaping results are cached per collection.
- For static text, build and lay out the paragraph once, outside the frame loop.
- The `text` node does this for you: it caches paragraphs by content and style.
