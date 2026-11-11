# `skiamovin` › `textlayout`

```ts
import { textlayout } from 'skiamovin';
const {
  FontCollection,
  TypefaceFontProvider,
  ParagraphBuilder,
  ParagraphStyle,
  TextStyle,
  TextAlign,
  TextDirection,
  Decoration,
  PlaceholderStyle,
  RectHeightStyle,
  RectWidthStyle,
} = textlayout;
```

Bindings for SkParagraph (`skia_safe::textlayout`): HarfBuzz shaping, ICU bidi and line breaking, font
fallback, rich text, placeholders and per-glyph geometry. See the [text guide](../guides/text-layout.md).

## `FontCollection`

```ts
const fonts = new FontCollection();
fonts.setDefaultFontManager(FontMgr.default()); // system and fallback fonts
fonts.setAssetFontManager(provider); // your fonts, looked up first
fonts.enableFontFallback();
fonts.setDefaultFontManagerAndFamily(fontMgr, 'Inter');
```

Reuse one `FontCollection` for the whole render. It caches shaping results.

## `TypefaceFontProvider`

```ts
const provider = new TypefaceFontProvider();
provider.registerTypeface(typeface, 'Inter'); // alias is optional; defaults to the font's family name
```

## `ParagraphStyle`

Setters, all chainable: `setTextStyle`, `setTextAlign(TextAlign)`, `setTextDirection(TextDirection)`,
`setMaxLines(n)`, `setEllipsis(str)`, `setHeight(h)`, `setTextHeightBehavior(...)`, `setStrutStyle(StrutStyle)`,
`setReplaceTabCharacters(bool)`, `setApplyRoundingHack(bool)`, `turnHintingOff()` (unhinted advances, so line
breaks and positions match on every platform).

## `TextStyle`

Setters, all chainable: `setColor`, `setForegroundPaint(Paint)`, `setBackgroundPaint(Paint)`,
`setFontFamilies(string[])`, `setFontSize`, `setFontStyle(FontStyle)`, `setHeight`, `setHeightOverride(bool)`,
`setLetterSpacing`, `setWordSpacing`, `setDecoration(Decoration)`, `setDecorationStyle`, `setDecorationColor`,
`setShadows(TextShadow[])`, `addFontFeature(tag, value)`, `setFontArguments({ variationDesignPosition })`
(variable fonts), `setLocale`, `setBaselineShift`.

## `ParagraphBuilder`

```ts
const builder = new ParagraphBuilder(paragraphStyle, fontCollection);
builder
  .pushStyle(base)
  .addText('Render ')
  .pushStyle(bold)
  .addText('everything')
  .pop()
  .addPlaceholder(new PlaceholderStyle(64, 64, PlaceholderAlignment.Middle, TextBaseline.Alphabetic, 0))
  .pop();
const paragraph = builder.build();
```

`builder.reset()` lets you reuse a builder.

## `Paragraph`

| Member | Description |
|---|---|
| `layout(width: number): void` | Must be called before measuring or painting |
| `paint(canvas: Canvas, origin: [x, y]): void` | Draws with the platform's glyph rasterizer |
| `paintOutlines(canvas, origin): boolean` | Draws from glyph outlines, which look the same on every platform. Returns false, drawing nothing, for decorations, backgrounds or color emoji |
| `paintSplit(canvas, origin, unitStarts, styles, colors): void` | Draws the text in pieces, each with its own opacity, offset, scale, rotation and color |
| `height()`, `maxWidth()`, `minIntrinsicWidth()`, `maxIntrinsicWidth()`, `longestLine()` |  |
| `alphabeticBaseline()`, `ideographicBaseline()`, `didExceedMaxLines()`, `lineNumber()` |  |
| `getLineMetrics(): LineMetrics[]` | Per line: baseline, ascent, descent, width, start/end indices |
| `getRectsForRange(range: [start, end], h: RectHeightStyle, w: RectWidthStyle): TextBox[]` | Highlights, karaoke wipes |
| `getRectsForPlaceholders(): TextBox[]` | Where to draw inline images or icons |
| `getGlyphPositionAtCoordinate([x, y]): { position, affinity }` |  |
| `getWordBoundary(offset): [start, end]` |  |
| `getFonts(): { textRange, font }[]` |  |
| `visit((lineNumber, info: VisitorInfo \| null) => void)` | Every glyph run, for per-glyph animation. `info` is `{ font, glyphs: number[], positions: [x, y][], utf16Starts: number[], flags }`, with positions relative to the paragraph origin. `null` marks the end of a line |
| `getPath(lineNumber: number): Path` | Text outlines as a `Path` |
| `unitPaths(unitStarts: number[]): Path[]` | Outlines of the laid-out text, one path per unit starting at each UTF-16 offset. Made from the same outlines used for drawing, with overlapping contours merged |

## Indices

All ranges (`getRectsForRange`, `getLineMetrics`, `getWordBoundary`, …) use **UTF-16 code unit
indices**, the same as JavaScript string indices. `skia-safe` uses UTF-8 byte offsets. Skiamovin converts at the
boundary, so you can pass `str.indexOf(word)` directly.
