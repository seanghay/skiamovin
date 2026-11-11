import type { GeneratedBinding } from './generated.ts';

/** Functions that each runtime implements by hand (callbacks, codecs, platform specifics). */
export interface ManualBinding {
  taffy_compute_layout_with_measure(
    tree: number,
    node: number,
    availW: number,
    availH: number,
    measure: (node: number, knownW: number, knownH: number, availW: number, availH: number) => Float64Array,
  ): void;
  platform_info(): string;
}

export type Binding = GeneratedBinding & ManualBinding & { readonly runtime: 'node' | 'wasm' };
