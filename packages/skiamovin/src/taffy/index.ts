// Flexbox, Grid and Block layout with Taffy.

import { loadBindingSync, runtime } from '#loader';
import { LayoutError } from '../core/errors.ts';
import { SkObject } from '../core/object.ts';
import { hasBinding, N, setBinding } from '../native/runtime.ts';

if (runtime === 'node' && !hasBinding()) {
  try {
    setBinding(loadBindingSync());
  } catch {
    /* reported on first use */
  }
}

export type NodeId = number;
export type Dimension =
  | number
  | `${number}%`
  | `${number}px`
  | 'auto'
  | 'min-content'
  | 'max-content'
  | 'fit-content'
  | 'stretch';
export type LengthPercentage = number | `${number}%` | `${number}px`;
export type LengthPercentageAuto = LengthPercentage | 'auto';
export type AvailableSpace = number | 'min-content' | 'max-content';

export interface Size<T> {
  width: T;
  height: T;
}
export interface Edges<T> {
  left: T;
  right: T;
  top: T;
  bottom: T;
}
export type EdgesInput<T> = T | Partial<Edges<T>> | readonly T[];

type Align = 'start' | 'end' | 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'stretch';
type AlignContent =
  | 'start'
  | 'end'
  | 'flex-start'
  | 'flex-end'
  | 'center'
  | 'stretch'
  | 'space-between'
  | 'space-evenly'
  | 'space-around';
type GridPlacement = number | string | { start?: number | string; end?: number | string };

/** Layout style. Field names follow the `taffy` crate in camelCase; values follow CSS. */
export interface Style {
  display?: 'flex' | 'grid' | 'block' | 'none';
  boxSizing?: 'border-box' | 'content-box';
  position?: 'relative' | 'absolute';
  inset?: EdgesInput<LengthPercentageAuto>;
  size?: Partial<Size<Dimension>> | Dimension;
  minSize?: Partial<Size<LengthPercentageAuto>> | LengthPercentageAuto;
  maxSize?: Partial<Size<LengthPercentageAuto>> | LengthPercentageAuto;
  aspectRatio?: number | null;
  margin?: EdgesInput<LengthPercentageAuto>;
  padding?: EdgesInput<LengthPercentage>;
  border?: EdgesInput<LengthPercentage>;
  overflow?: 'visible' | 'clip' | 'hidden' | 'scroll' | { x?: string; y?: string };
  scrollbarWidth?: number;
  alignItems?: Align;
  alignSelf?: Align;
  justifyItems?: Align;
  justifySelf?: Align;
  alignContent?: AlignContent;
  justifyContent?: AlignContent;
  gap?: Partial<Size<LengthPercentage>> | LengthPercentage;
  rowGap?: LengthPercentage;
  columnGap?: LengthPercentage;
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
  flexBasis?: Dimension;
  flexGrow?: number;
  flexShrink?: number;
  gridTemplateColumns?: readonly (string | number)[] | string;
  gridTemplateRows?: readonly (string | number)[] | string;
  gridAutoColumns?: readonly (string | number)[] | string;
  gridAutoRows?: readonly (string | number)[] | string;
  gridAutoFlow?: 'row' | 'column' | 'row dense' | 'column dense';
  gridRow?: GridPlacement;
  gridColumn?: GridPlacement;
  gridTemplateAreas?: readonly string[];
  gridArea?: string;
  textAlign?: 'auto' | 'legacy-left' | 'legacy-right' | 'legacy-center';
}

export interface Layout {
  order: number;
  location: { x: number; y: number };
  size: { width: number; height: number };
  contentSize: { width: number; height: number };
  scrollbarSize: { width: number; height: number };
  border: Edges<number>;
  padding: Edges<number>;
  margin: Edges<number>;
}

export type MeasureFunction<Context> = (
  knownDimensions: { width: number | null; height: number | null },
  availableSpace: Size<AvailableSpace>,
  nodeId: NodeId,
  context: Context | null,
  style: Style,
) => { width: number; height: number };

function availCode(a: AvailableSpace): number {
  return a === 'min-content' ? -1 : a === 'max-content' ? -2 : a;
}
function availFromCode(v: number): AvailableSpace {
  return v === -1 ? 'min-content' : v === -2 ? 'max-content' : v;
}

/** Serializes a style as JSON for the native layout engine. */
export function styleJson(style: Style | undefined): string {
  return style ? JSON.stringify(style) : '';
}

/** A tree of layout nodes. Mirrors `taffy::TaffyTree`. */
export class TaffyTree<Context = unknown> extends SkObject {
  #contexts = new Map<NodeId, Context>();
  #styles = new Map<NodeId, Style>();

  constructor() {
    super(N().taffy_tree_new());
  }

  #call<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      throw e instanceof LayoutError ? e : new LayoutError((e as Error).message);
    }
  }

  enableRounding(): void {
    N().taffy_enable_rounding(this.handle, true);
  }
  disableRounding(): void {
    N().taffy_enable_rounding(this.handle, false);
  }
  newLeaf(style: Style = {}): NodeId {
    const id = this.#call(() => N().taffy_new_leaf(this.handle, styleJson(style)));
    this.#styles.set(id, style);
    return id;
  }
  newLeafWithContext(style: Style, context: Context): NodeId {
    const id = this.newLeaf(style);
    this.setNodeContext(id, context);
    return id;
  }
  newWithChildren(style: Style, children: readonly NodeId[]): NodeId {
    const id = this.#call(() => N().taffy_new_with_children(this.handle, styleJson(style), new Uint32Array(children)));
    this.#styles.set(id, style);
    return id;
  }
  addChild(parent: NodeId, child: NodeId): void {
    this.#call(() => N().taffy_add_child(this.handle, parent, child));
  }
  insertChildAtIndex(parent: NodeId, index: number, child: NodeId): void {
    this.#call(() => N().taffy_insert_child_at_index(this.handle, parent, index, child));
  }
  setChildren(parent: NodeId, children: readonly NodeId[]): void {
    this.#call(() => N().taffy_set_children(this.handle, parent, new Uint32Array(children)));
  }
  removeChild(parent: NodeId, child: NodeId): void {
    this.#call(() => N().taffy_remove_child(this.handle, parent, child));
  }
  removeChildAtIndex(parent: NodeId, index: number): NodeId {
    return this.#call(() => N().taffy_remove_child_at_index(this.handle, parent, index));
  }
  replaceChildAtIndex(parent: NodeId, index: number, child: NodeId): NodeId {
    return this.#call(() => N().taffy_replace_child_at_index(this.handle, parent, index, child));
  }
  children(parent: NodeId): NodeId[] {
    return [...this.#call(() => N().taffy_children(this.handle, parent))];
  }
  childCount(parent: NodeId): number {
    return this.#call(() => N().taffy_child_count(this.handle, parent));
  }
  parent(child: NodeId): NodeId | null {
    return this.#call(() => N().taffy_parent(this.handle, child)) || null;
  }
  remove(node: NodeId): void {
    this.#call(() => N().taffy_remove(this.handle, node));
    this.#contexts.delete(node);
    this.#styles.delete(node);
  }
  clear(): void {
    this.#call(() => N().taffy_clear(this.handle));
    this.#contexts.clear();
    this.#styles.clear();
  }
  setStyle(node: NodeId, style: Style): void {
    this.#call(() => N().taffy_set_style(this.handle, node, styleJson(style)));
    this.#styles.set(node, style);
  }
  style(node: NodeId): Style {
    return this.#styles.get(node) ?? {};
  }
  setNodeContext(node: NodeId, context: Context | null): void {
    if (context === null || context === undefined) {
      this.#contexts.delete(node);
      this.#call(() => N().taffy_set_node_context(this.handle, node, 0, 0, 0, 0));
    } else {
      this.#contexts.set(node, context);
      this.#call(() => N().taffy_set_node_context(this.handle, node, 1, 0, 0, 0));
    }
  }
  getNodeContext(node: NodeId): Context | null {
    return this.#contexts.get(node) ?? null;
  }
  /** @internal measure a leaf with a native paragraph (scene layer) */
  _setParagraphContext(node: NodeId, paragraphHandle: number): void {
    this.#call(() => N().taffy_set_node_context(this.handle, node, 2, paragraphHandle, 0, 0));
  }
  /** @internal measure a leaf with a fixed intrinsic size, preserving aspect ratio */
  _setIntrinsicContext(node: NodeId, width: number, height: number): void {
    this.#call(() => N().taffy_set_node_context(this.handle, node, 3, 0, width, height));
  }
  markDirty(node: NodeId): void {
    this.#call(() => N().taffy_mark_dirty(this.handle, node));
  }
  dirty(node: NodeId): boolean {
    return this.#call(() => N().taffy_dirty(this.handle, node));
  }
  computeLayout(node: NodeId, available: Size<AvailableSpace> = { width: 'max-content', height: 'max-content' }): void {
    this.#call(() =>
      N().taffy_compute_layout(this.handle, node, availCode(available.width), availCode(available.height)),
    );
  }
  computeLayoutWithMeasure(node: NodeId, available: Size<AvailableSpace>, measure: MeasureFunction<Context>): void {
    const out = new Float64Array(2);
    this.#call(() =>
      N().taffy_compute_layout_with_measure(
        this.handle,
        node,
        availCode(available.width),
        availCode(available.height),
        (id, kw, kh, aw, ah) => {
          const r = measure(
            { width: Number.isNaN(kw) ? null : kw, height: Number.isNaN(kh) ? null : kh },
            { width: availFromCode(aw), height: availFromCode(ah) },
            id,
            this.#contexts.get(id) ?? null,
            this.#styles.get(id) ?? {},
          );
          out[0] = r.width;
          out[1] = r.height;
          return out;
        },
      ),
    );
  }
  layout(node: NodeId): Layout {
    const v = this.#call(() => N().taffy_layout(this.handle, node));
    const e = (i: number): Edges<number> => ({ left: v[i]!, right: v[i + 1]!, top: v[i + 2]!, bottom: v[i + 3]! });
    return {
      order: v[0]!,
      location: { x: v[1]!, y: v[2]! },
      size: { width: v[3]!, height: v[4]! },
      contentSize: { width: v[5]!, height: v[6]! },
      scrollbarSize: { width: v[7]!, height: v[8]! },
      border: e(9),
      padding: e(13),
      margin: e(17),
    };
  }
  /** Absolute boxes for a whole subtree in one call: Map<node, {x, y, width, height}>. */
  layoutTree(root: NodeId): Map<NodeId, { x: number; y: number; width: number; height: number }> {
    const v = this.#call(() => N().taffy_layout_tree(this.handle, root));
    const out = new Map<NodeId, { x: number; y: number; width: number; height: number }>();
    for (let i = 0; i < v.length; i += 5)
      out.set(v[i]!, { x: v[i + 1]!, y: v[i + 2]!, width: v[i + 3]!, height: v[i + 4]! });
    return out;
  }
  printTree(node: NodeId): void {
    console.log(N().taffy_print_tree(this.handle, node));
  }
  /** Debug dump as a string. */
  treeToString(node: NodeId): string {
    return N().taffy_print_tree(this.handle, node);
  }
}
