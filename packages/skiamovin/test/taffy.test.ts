import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LayoutError } from 'skiamovin';
import { TaffyTree } from 'skiamovin/taffy';

test('flexbox row with grow, padding and gap', () => {
  const t = new TaffyTree();
  const a = t.newLeaf({ flexGrow: 1 });
  const b = t.newLeaf({ size: { width: 100, height: '50%' } });
  const root = t.newWithChildren({ size: { width: 400, height: 200 }, padding: 10, gap: 10 }, [a, b]);
  t.computeLayout(root, { width: 400, height: 200 });
  assert.deepEqual(t.layout(a).size, { width: 270, height: 180 });
  assert.deepEqual(t.layout(b).location, { x: 290, y: 10 });
  assert.equal(t.layout(b).size.height, 90);
  assert.deepEqual(t.children(root), [a, b]);
  assert.equal(t.parent(a), root);
});

test('column, centering, absolute', () => {
  const t = new TaffyTree();
  const c = t.newLeaf({ size: { width: 50, height: 50 } });
  const abs = t.newLeaf({ position: 'absolute', inset: { right: 0, bottom: 0 }, size: { width: 10, height: 10 } });
  const root = t.newWithChildren(
    { size: { width: 200, height: 100 }, flexDirection: 'column', justifyContent: 'center', alignItems: 'center' },
    [c, abs],
  );
  t.computeLayout(root);
  assert.deepEqual(t.layout(c).location, { x: 75, y: 25 });
  assert.deepEqual(t.layout(abs).location, { x: 190, y: 90 });
});

test('grid with repeat, fr, span and areas', () => {
  const t = new TaffyTree();
  const items = Array.from({ length: 5 }, (_, i) => t.newLeaf(i === 0 ? { gridColumn: 'span 2' } : {}));
  const root = t.newWithChildren(
    {
      display: 'grid',
      size: { width: 300, height: 200 },
      gridTemplateColumns: ['repeat(3, 1fr)'],
      gridAutoRows: [100],
      gap: 0,
    },
    items,
  );
  t.computeLayout(root);
  assert.deepEqual(t.layout(items[0]!).size, { width: 200, height: 100 });
  assert.deepEqual(t.layout(items[1]!).location, { x: 200, y: 0 });
  assert.deepEqual(t.layout(items[2]!).location, { x: 0, y: 100 });

  const t2 = new TaffyTree();
  const main = t2.newLeaf({ gridArea: 'main' });
  const side = t2.newLeaf({ gridArea: 'side' });
  const r2 = t2.newWithChildren(
    {
      display: 'grid',
      size: { width: 300, height: 100 },
      gridTemplateColumns: '100px 1fr',
      gridTemplateAreas: ['side main'],
    },
    [main, side],
  );
  t2.computeLayout(r2);
  assert.equal(t2.layout(side).location.x, 0);
  assert.equal(t2.layout(main).location.x, 100);
  assert.equal(t2.layout(main).size.width, 200);
});

test('measure function with context', () => {
  const t = new TaffyTree<{ text: string }>();
  const leaf = t.newLeafWithContext({}, { text: 'hello world' });
  const root = t.newWithChildren({ size: { width: 500, height: 'auto' }, flexDirection: 'column' }, [leaf]);
  let calls = 0;
  t.computeLayoutWithMeasure(root, { width: 500, height: 'max-content' }, (known, _avail, id, ctx) => {
    calls++;
    assert.equal(id, leaf);
    return { width: known.width ?? ctx!.text.length * 10, height: 24 };
  });
  assert.ok(calls > 0);
  assert.equal(t.layout(leaf).size.height, 24);
  assert.equal(t.layout(root).size.height, 24);
});

test('errors', () => {
  const t = new TaffyTree();
  assert.throws(() => t.newLeaf({ display: 'table' as never }), LayoutError);
  assert.throws(() => t.layout(999), LayoutError);
});

test('absolute children of stretched grid items resolve against the final size', () => {
  const t = new TaffyTree();
  const leaf = t.newLeaf({ position: 'absolute', inset: { left: 24, bottom: 18 }, size: { width: 120, height: 30 } });
  const fill = t.newLeaf({ position: 'absolute', inset: 0, size: { width: '100%', height: '100%' } });
  const item = t.newWithChildren({}, [fill, leaf]);
  const root = t.newWithChildren(
    { size: { width: 960, height: 540 }, display: 'grid', gridTemplateRows: ['1fr', '1fr'] },
    [item],
  );
  t.computeLayout(root);
  assert.equal(t.layout(item).size.height, 270);
  assert.equal(t.layout(leaf).location.y, 270 - 18 - 30);
  assert.deepEqual(t.layout(fill).size, { width: 960, height: 270 });
  // The original style is kept (the item is not pinned permanently).
  assert.deepEqual(t.style(item), {});
});

test('object margins default unspecified sides to 0', () => {
  const t = new TaffyTree();
  const a = t.newLeaf({ size: { width: 10, height: 10 }, margin: { top: 50 } });
  const root = t.newWithChildren(
    { size: { width: 100, height: 200 }, flexDirection: 'column', justifyContent: 'center' },
    [a],
  );
  t.computeLayout(root);
  assert.deepEqual(t.layout(a).margin, { left: 0, right: 0, top: 50, bottom: 0 });
  assert.equal(t.layout(a).location.y, 50 + (200 - 60) / 2);
});

test('every node is a containing block for absolute children (relative by default)', () => {
  const t = new TaffyTree();
  const leaf = t.newLeaf({ position: 'absolute', inset: 0, size: { width: '100%', height: '100%' } });
  const mid = t.newWithChildren({ size: { width: 600, height: 240 } }, [leaf]);
  const root = t.newWithChildren({ size: { width: 800, height: 600 }, padding: 40, flexDirection: 'column' }, [mid]);
  t.computeLayout(root);
  assert.deepEqual(t.layout(leaf).size, { width: 600, height: 240 });
  assert.deepEqual(t.layout(leaf).location, { x: 0, y: 0 });
});
