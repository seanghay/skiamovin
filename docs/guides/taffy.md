# Layout with Taffy

[Taffy](https://github.com/DioxusLabs/taffy) implements CSS **Flexbox**, **CSS Grid** and **Block** layout.
Skiamovin uses it for every scene, and you can also use it directly as `skiamovin/taffy`, for example to lay
out content you draw yourself with the Skia canvas.

## In the scene layer

Every node takes Taffy style properties. If you know CSS layout, you already know them:

```ts
box({ size: { width: '100%', height: '100%' }, flexDirection: 'column', padding: 80, gap: 24 }, [
  text('Quarterly report', { fontSize: 96, fontWeight: 800 }),
  box({ flexDirection: 'row', gap: 24, flexGrow: 1 }, [
    card('Revenue', '$4.2M', { flexGrow: 1 }),
    card('Users', '182k', { flexGrow: 1 }),
    card('NPS', '67', { flexGrow: 1 }),
  ]),
]);
```

### Grid

```ts
box(
  {
    display: 'grid',
    gridTemplateColumns: ['repeat(4, 1fr)'],
    gridAutoRows: [240],
    gap: 16,
    padding: 40,
    size: { width: '100%', height: '100%' },
  },
  photos.map((p, i) =>
    image(p, {
      fit: 'cover',
      gridColumn: i === 0 ? 'span 2' : undefined,
      gridRow: i === 0 ? 'span 2' : undefined,
      borderRadius: 16,
    }),
  ),
);
```

### Absolute positioning

```ts
box({ position: 'absolute', inset: { right: 40, bottom: 40, left: 'auto', top: 'auto' } }, [watermark]);
```

## Animating layout

You can animate layout properties, because Skiamovin runs layout on every frame:

```ts
box({ flexDirection: 'row', gap: interpolate(timestamp, [0, 1], [0, 32]) }, items);
box({ size: { width: `${interpolate(timestamp, [0, 2], [0, 100])}%`, height: 8 }, background: '#22c55e' }); // progress bar
```

Layout is cheap. Taffy is incremental, and Skiamovin caches text measurements, so a typical scene lays out in
microseconds. For motion that shouldn't push siblings around, use `transform`. It's applied after layout.

**Subpixel motion:** Taffy rounds layout to whole pixels by default, which can make slow layout-driven
animation step visibly. Compositions turn rounding off, so animated layout moves smoothly. When you use
`TaffyTree` directly, call `tree.disableRounding()` to get the same behavior.

## Using `TaffyTree` directly

```ts
import { TaffyTree } from 'skiamovin/taffy';

const tree = new TaffyTree();

const header = tree.newLeaf({ size: { width: '100%', height: 120 } });
const sidebar = tree.newLeaf({ size: { width: 320, height: 'auto' } });
const main = tree.newLeaf({ flexGrow: 1 });
const body = tree.newWithChildren({ flexDirection: 'row', flexGrow: 1, gap: 24 }, [sidebar, main]);
const root = tree.newWithChildren(
  { flexDirection: 'column', size: { width: 1920, height: 1080 }, padding: 40, gap: 24 },
  [header, body],
);

tree.computeLayout(root, { width: 1920, height: 1080 });

const { location, size } = tree.layout(main);
// location is relative to the parent. Add the parents' locations to get absolute coordinates.
```

### Measuring content: text

Leaves with intrinsic size, such as text and images, need a measure function. Attach context to the leaf and
measure it during layout:

```ts
type Ctx = { kind: 'text'; paragraph: textlayout.Paragraph };

const tree = new TaffyTree<Ctx>();
const label = tree.newLeafWithContext({ maxSize: { width: 600 } }, { kind: 'text', paragraph });

tree.computeLayoutWithMeasure(root, { width: 1920, height: 1080 }, (known, available, _id, ctx) => {
  if (ctx?.kind !== 'text') return { width: 0, height: 0 };
  const p = ctx.paragraph;
  const width =
    known.width ??
    (available.width === 'min-content'
      ? p.minIntrinsicWidth()
      : available.width === 'max-content'
        ? p.maxIntrinsicWidth()
        : Math.min(p.maxIntrinsicWidth(), available.width));
  p.layout(Math.ceil(width));
  return { width: Math.ceil(width), height: known.height ?? p.height() };
});
```

This is how the scene layer's `text` node works.

### Drawing a laid-out tree

```ts
function paint(node: NodeId, canvas: Canvas) {
  const { location, size } = tree.layout(node);
  canvas.save();
  canvas.translate([location.x, location.y]);
  drawNode(node, canvas, size);
  for (const child of tree.children(node)) paint(child, canvas);
  canvas.restore();
}
```

## Reference

All style properties and units are in the [`skiamovin/taffy` reference](../api/taffy.md#style).
