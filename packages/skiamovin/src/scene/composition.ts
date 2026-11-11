import type { Color } from '../core/color.ts';
import type { FontAsset } from './assets.ts';
import type { Child, RenderContext } from './nodes.ts';

export interface CompositionOptions<Props> {
  width: number;
  height: number;
  /** Frames per second. */
  frameRate: number;
  /** In seconds. A function lets the duration depend on props or media. */
  duration: number | ((props: Props) => number | Promise<number>);
  background?: Color;
  colorSpace?: 'srgb' | 'display-p3' | 'rec2020-pq' | 'rec2020-hlg';
  /** Fonts available to `text` nodes, by family name. */
  fonts?: FontAsset[];
  defaultProps?: Props;
  /** Must be pure and synchronous. */
  render: (ctx: RenderContext<Props>) => Child;
}

/** A video described as a pure function of time. */
export class Composition<Props = Record<string, unknown>> {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly background: Color | undefined;
  readonly colorSpace: CompositionOptions<Props>['colorSpace'];
  readonly fonts: FontAsset[];
  readonly defaultProps: Props;
  readonly render: (ctx: RenderContext<Props>) => Child;
  readonly #duration: CompositionOptions<Props>['duration'];

  constructor(options: CompositionOptions<Props>) {
    if (!(options.width > 0 && options.height > 0))
      throw new RangeError('Composition: width and height must be positive');
    if (!(options.frameRate > 0)) throw new RangeError('Composition: frameRate must be positive');
    this.width = options.width;
    this.height = options.height;
    this.frameRate = options.frameRate;
    this.background = options.background;
    this.colorSpace = options.colorSpace;
    this.fonts = options.fonts ?? [];
    this.defaultProps = (options.defaultProps ?? {}) as Props;
    this.render = options.render;
    this.#duration = options.duration;
  }

  /** Resolves the duration in seconds for the given props. */
  async computeDuration(props?: Partial<Props>): Promise<number> {
    const d = this.#duration;
    const v = typeof d === 'function' ? await d({ ...this.defaultProps, ...props } as Props) : d;
    if (!(v > 0) || !Number.isFinite(v)) throw new RangeError(`Composition: invalid duration ${v}`);
    return v;
  }
}

/** A reference to a composition by module, for multi-worker rendering. */
export class CompositionModule {
  readonly url: string;
  readonly exportName: string;
  constructor(url: string | URL, exportName = 'default') {
    this.url = String(url);
    this.exportName = exportName;
  }
  async load(): Promise<Composition<any>> {
    const mod = await import(/* @vite-ignore */ this.url);
    const c = mod[this.exportName];
    if (!(c instanceof Composition))
      throw new TypeError(`${this.url} does not export a Composition as '${this.exportName}'`);
    return c;
  }
}
