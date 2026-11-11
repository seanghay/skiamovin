# `skiamovin/taffy`

```ts
import { TaffyTree, type Style, type Layout, type AvailableSpace } from 'skiamovin/taffy';
```

Bindings for [Taffy](https://github.com/DioxusLabs/taffy), a high-performance implementation of CSS **Flexbox**,
**Grid** and **Block** layout. The API mirrors the `taffy` crate's `TaffyTree`. Styles are plain objects that
use the crate's field names in camelCase. See the [Taffy guide](../guides/taffy.md).

It doesn't depend on Skia, so you can use it alone.

---

## `TaffyTree<Context = unknown>`

| Method | Description |
|---|---|
| `new TaffyTree<Context>()` |  |
| `newLeaf(style: Style): NodeId` |  |
| `newLeafWithContext(style: Style, context: Context): NodeId` | `context` is passed to your measure function, for example the text to measure |
| `newWithChildren(style: Style, children: NodeId[]): NodeId` |  |
| `addChild(parent, child)`, `insertChildAtIndex(parent, index, child)`, `setChildren(parent, children)` |  |
| `removeChild(parent, child)`, `removeChildAtIndex(parent, index)`, `replaceChildAtIndex(parent, index, child)` |  |
| `children(parent): NodeId[]`, `childCount(parent)`, `parent(child): NodeId \| null` |  |
| `remove(node): void`, `clear(): void` |  |
| `setStyle(node, style: Style)`, `style(node): Style` | Setting a style marks the node dirty |
| `setNodeContext(node, context \| null)`, `getNodeContext(node)` |  |
| `markDirty(node)`, `dirty(node): boolean` | Mark dirty when a measured leaf's content changes |
| `computeLayout(node, available: Size<AvailableSpace>): void` |  |
| `computeLayoutWithMeasure(node, available, measure: MeasureFunction<Context>): void` |  |
| `layout(node): Layout` | Valid after a compute call |
| `enableRounding()`, `disableRounding()` | Rounding is on by default. Turn it off for subpixel motion |
| `printTree(node): void` | Debug output |

`NodeId` is an opaque number.

### `AvailableSpace`

```ts
type AvailableSpace = number | 'min-content' | 'max-content';
// e.g. tree.computeLayout(root, { width: 1920, height: 1080 })
```

### `MeasureFunction`

```ts
type MeasureFunction<Context> = (
  knownDimensions: { width: number | null; height: number | null },
  availableSpace: Size<AvailableSpace>,
  nodeId: NodeId,
  context: Context | null,
  style: Style,
) => { width: number; height: number };
```

Called for leaves during layout. Must be synchronous and deterministic.

### `Layout`

```ts
interface Layout {
  order: number;
  location: { x: number; y: number }; // relative to the parent's border box
  size: { width: number; height: number };
  contentSize: { width: number; height: number };
  scrollbarSize: { width: number; height: number };
  border: Rect<number>; // { left, right, top, bottom }
  padding: Rect<number>;
  margin: Rect<number>;
}
```

---

## `Style`

Every field is optional and defaults to Taffy's `Style::default()`. Units:

| Taffy | JS value |
|---|---|
| `Dimension::Length(10.0)` / `LengthPercentage::Length` | `10` |
| `Dimension::Percent(0.5)` | `'50%'` |
| `Dimension::Auto` / `LengthPercentageAuto::Auto` | `'auto'` |

### Box

| Field | Type |
|---|---|
| `display` | `'flex' \| 'grid' \| 'block' \| 'none'` (default `'flex'`) |
| `boxSizing` | `'border-box' \| 'content-box'` |
| `position` | `'relative' \| 'absolute' \| 'static' \| 'fixed'` (default `'relative'`: every node is a containing block, as in Yoga) |
| `inset` | `Rect<LengthPercentageAuto>`, e.g. `{ left: 0, top: 0, right: 'auto', bottom: 'auto' }` |
| `size`, `minSize`, `maxSize` | `{ width: Dimension, height: Dimension }` |
| `aspectRatio` | `number \| null` |
| `margin` | `Rect<LengthPercentageAuto>` or a single value for all sides |
| `padding`, `border` | `Rect<LengthPercentage>` or a single value |
| `overflow` | `{ x, y }` of `'visible' \| 'clip' \| 'hidden' \| 'scroll'` |
| `scrollbarWidth` | `number` |

### Alignment

`alignItems`, `alignSelf`, `justifyItems`, `justifySelf`: `'start' | 'end' | 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'stretch'`

`alignContent`, `justifyContent`: `'start' | 'end' | 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'space-between' | 'space-evenly' | 'space-around'`

`gap`: `{ width: LengthPercentage, height: LengthPercentage }` or a single value

### Flexbox

`flexDirection` (`'row' | 'column' | 'row-reverse' | 'column-reverse'`), `flexWrap` (`'nowrap' | 'wrap' | 'wrap-reverse'`),
`flexBasis` (`Dimension`), `flexGrow` (`number`), `flexShrink` (`number`)

### Grid

| Field | Example |
|---|---|
| `gridTemplateColumns`, `gridTemplateRows` | `['200px', '1fr', 'minmax(100px, 2fr)', 'repeat(auto-fill, 120px)']` |
| `gridAutoColumns`, `gridAutoRows` | `['1fr']` |
| `gridAutoFlow` | `'row' \| 'column' \| 'row dense' \| 'column dense'` |
| `gridRow`, `gridColumn` | `{ start: 1, end: 'span 2' }`, or the CSS shorthand `'1 / span 2'` |
| `gridTemplateAreas` | `['header header', 'sidebar main']` |
| `gridArea` | `'main'` |

Bare numbers in track lists mean pixels: `[200, '1fr']` equals `['200px', '1fr']`.

### Block

`textAlign` (`'auto' | 'legacy-left' | 'legacy-right' | 'legacy-center'`), and the box fields above.
