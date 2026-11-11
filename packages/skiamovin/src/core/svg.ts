import { N } from '../native/runtime.ts';
import { h, SkObject } from './object.ts';
import type { Canvas } from './skia.ts';
import type { FontMgr } from './text.ts';

/** A parsed SVG document (static SVG 1.1 / Tiny 1.2). */
class Dom extends SkObject {
  static fromBytes(bytes: Uint8Array, fontMgr?: FontMgr | null): Dom {
    return new Dom(N().svg_dom_from_bytes(bytes, h(fontMgr)));
  }
  static fromString(text: string, fontMgr?: FontMgr | null): Dom {
    return Dom.fromBytes(new TextEncoder().encode(text), fontMgr);
  }
  setContainerSize([w, hh]: readonly [number, number]): void {
    N().svg_dom_set_container_size(this.handle, w, hh);
  }
  render(canvas: Canvas): void {
    N().svg_dom_render(this.handle, canvas.handle);
  }
  /** Intrinsic `[width, height]`, and the viewBox `[x, y, w, h]` if present. */
  intrinsicSize(): { width: number; height: number; viewBox: [number, number, number, number] | null } {
    const v = N().svg_dom_intrinsic_size(this.handle);
    return { width: v[0]!, height: v[1]!, viewBox: v.length >= 6 ? [v[2]!, v[3]!, v[4]!, v[5]!] : null };
  }
}

export const svg = { Dom };
// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace svg {
  type Dom = InstanceType<typeof Dom>;
}
