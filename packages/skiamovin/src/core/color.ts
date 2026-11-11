/**
 * Colors: a number `0xAARRGGBB`, a CSS color string, a `Color4f`, or `[r, g, b, a]` with components 0–1.
 */
export type Color = number | string | Color4f | readonly [number, number, number, number];

export class Color4f {
  constructor(
    public r: number,
    public g: number,
    public b: number,
    public a = 1,
  ) {}
  static fromColor(c: Color): Color4f {
    const [r, g, b, a] = toColor4f(c);
    return new Color4f(r, g, b, a);
  }
  toArray(): [number, number, number, number] {
    return [this.r, this.g, this.b, this.a];
  }
  withAlpha(a: number): Color4f {
    return new Color4f(this.r, this.g, this.b, a);
  }
}

export const Color = {
  TRANSPARENT: 0x00000000,
  BLACK: 0xff000000,
  DARK_GRAY: 0xff444444,
  GRAY: 0xff888888,
  LIGHT_GRAY: 0xffcccccc,
  WHITE: 0xffffffff,
  RED: 0xffff0000,
  GREEN: 0xff00ff00,
  BLUE: 0xff0000ff,
  YELLOW: 0xffffff00,
  CYAN: 0xff00ffff,
  MAGENTA: 0xffff00ff,
  /** Packs 0–255 components. */
  argb(a: number, r: number, g: number, b: number): number {
    return (((a & 255) << 24) | ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)) >>> 0;
  },
  rgb(r: number, g: number, b: number): number {
    return Color.argb(255, r, g, b);
  },
} as const;

const NAMED: Record<string, number> = {
  transparent: 0x00000000,
  black: 0xff000000,
  white: 0xffffffff,
  red: 0xffff0000,
  lime: 0xff00ff00,
  green: 0xff008000,
  blue: 0xff0000ff,
  yellow: 0xffffff00,
  cyan: 0xff00ffff,
  aqua: 0xff00ffff,
  magenta: 0xffff00ff,
  fuchsia: 0xffff00ff,
  gray: 0xff808080,
  grey: 0xff808080,
  silver: 0xffc0c0c0,
  maroon: 0xff800000,
  olive: 0xff808000,
  purple: 0xff800080,
  teal: 0xff008080,
  navy: 0xff000080,
  orange: 0xffffa500,
  pink: 0xffffc0cb,
  brown: 0xffa52a2a,
  gold: 0xffffd700,
  indigo: 0xff4b0082,
  violet: 0xffee82ee,
  coral: 0xffff7f50,
  salmon: 0xfffa8072,
  crimson: 0xffdc143c,
  hotpink: 0xffff69b4,
  skyblue: 0xff87ceeb,
  steelblue: 0xff4682b4,
  royalblue: 0xff4169e1,
  tomato: 0xffff6347,
  turquoise: 0xff40e0d0,
  slategray: 0xff708090,
  darkgray: 0xffa9a9a9,
  lightgray: 0xffd3d3d3,
  whitesmoke: 0xfff5f5f5,
  rebeccapurple: 0xff663399,
};

const cache = new Map<string, number>();

function clamp01(v: number) {
  return v < 0 ? 0 : Math.min(v, 1);
}

function parseComponent(s: string, max: number): number {
  s = s.trim();
  if (s.endsWith('%')) return clamp01(parseFloat(s) / 100);
  return clamp01(parseFloat(s) / max);
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [r + m, g + m, b + m];
}

/** Parses a CSS color string into 0xAARRGGBB. */
export function parseCssColor(input: string): number {
  const hit = cache.get(input);
  if (hit !== undefined) return hit;
  const s = input.trim().toLowerCase();
  let out: number | undefined;
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    const n = (i: number, len: number) => parseInt(len === 1 ? hex[i]! + hex[i]! : hex.slice(i, i + 2), 16);
    if (hex.length === 3 || hex.length === 4) {
      const a = hex.length === 4 ? n(3, 1) : 255;
      out = Color.argb(a, n(0, 1), n(1, 1), n(2, 1));
    } else if (hex.length === 6 || hex.length === 8) {
      const a = hex.length === 8 ? n(6, 2) : 255;
      out = Color.argb(a, n(0, 2), n(2, 2), n(4, 2));
    }
  } else if (NAMED[s] !== undefined) {
    out = NAMED[s];
  } else {
    const m = /^(rgba?|hsla?)\((.*)\)$/.exec(s);
    if (m) {
      const parts = m[2]!.split(/[\s,/]+/).filter(Boolean);
      const alpha = parts[3] !== undefined ? parseComponent(parts[3], 1) : 1;
      let rgb: [number, number, number];
      if (m[1]!.startsWith('rgb')) {
        rgb = [parseComponent(parts[0]!, 255), parseComponent(parts[1]!, 255), parseComponent(parts[2]!, 255)];
      } else {
        rgb = hsl(parseFloat(parts[0]!), parseComponent(parts[1]!, 100), parseComponent(parts[2]!, 100));
      }
      out = Color.argb(
        Math.round(alpha * 255),
        Math.round(rgb[0] * 255),
        Math.round(rgb[1] * 255),
        Math.round(rgb[2] * 255),
      );
    }
  }
  if (out === undefined) throw new TypeError(`Invalid color: ${JSON.stringify(input)}`);
  cache.set(input, out);
  return out;
}

/** Converts any color to 0xAARRGGBB. */
export function toColorInt(c: Color): number {
  if (typeof c === 'number') return c >>> 0;
  if (typeof c === 'string') return parseCssColor(c);
  const [r, g, b, a] = c instanceof Color4f ? c.toArray() : c;
  return Color.argb(
    Math.round(clamp01(a) * 255),
    Math.round(clamp01(r) * 255),
    Math.round(clamp01(g) * 255),
    Math.round(clamp01(b) * 255),
  );
}

/** Converts any color to `[r, g, b, a]` floats. */
export function toColor4f(c: Color): [number, number, number, number] {
  if (c instanceof Color4f) return c.toArray();
  if (Array.isArray(c)) return [c[0], c[1], c[2], c[3]];
  const v = typeof c === 'number' ? c >>> 0 : parseCssColor(c as string);
  return [((v >>> 16) & 255) / 255, ((v >>> 8) & 255) / 255, (v & 255) / 255, ((v >>> 24) & 255) / 255];
}

export function colors4fArray(colors: readonly Color[]): Float32Array {
  const out = new Float32Array(colors.length * 4);
  for (let i = 0; i < colors.length; i++) out.set(toColor4f(colors[i]!), i * 4);
  return out;
}
