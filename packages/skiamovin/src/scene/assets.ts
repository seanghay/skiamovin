// Assets that load lazily from Mediabunny Sources.
import { AudioSampleSink, BufferSource, type Input, type InputAudioTrack, Source } from 'mediabunny';
import { AlphaType, ColorType, TileMode } from '../core/enums.ts';
import { SkiamovinError } from '../core/errors.ts';
import { Codec, Image, ImageInfo, images, type Shader } from '../core/skia.ts';
import { svg } from '../core/svg.ts';
import { FontMgr, type Typeface } from '../core/text.ts';
import { importNode } from '../native/node-import.ts';
import { type ParsedLut, parseCube } from './grading.ts';

export type AssetSource = Source | Uint8Array | ArrayBuffer | string | URL;

function toSource(src: AssetSource): Source {
  if (src instanceof Source) return src;
  if (src instanceof Uint8Array || src instanceof ArrayBuffer) return new BufferSource(src);
  throw new TypeError('expected a mediabunny Source or bytes');
}

/** Reads a whole Source into memory. */
export async function readSource(src: AssetSource): Promise<Uint8Array> {
  if (src instanceof Uint8Array) return src;
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  if (typeof src === 'string' || src instanceof URL) {
    const s = String(src);
    if (/^(https?|data|blob):/.test(s)) return new Uint8Array(await (await fetch(s)).arrayBuffer());
    const { readFile } = await importNode<typeof import('node:fs/promises')>('node:fs/promises');
    return new Uint8Array(await readFile(src instanceof URL ? src : s));
  }
  const source = toSource(src) as Source & { _read(start: number, end: number, min: number, max: number): any };
  const size = await source.getSize();
  if (size === 0) return new Uint8Array(0);
  const r = await source._read(0, size, 0, size);
  if (!r) throw new SkiamovinError('could not read asset source');
  return (r.bytes as Uint8Array).slice(-r.offset, size - r.offset);
}

abstract class Asset<T> {
  #source: AssetSource;
  #promise: Promise<T> | null = null;
  #value: T | null = null;
  constructor(source: AssetSource) {
    this.#source = source;
  }
  protected abstract decode(bytes: Uint8Array): T | Promise<T>;
  /** Loads the asset now (otherwise it loads on first use). */
  async load(): Promise<void> {
    await this._get();
  }
  /** @internal */
  _get(): Promise<T> {
    this.#promise ??= (async () => {
      const v = await this.decode(await readSource(this.#source));
      this.#value = v;
      return v;
    })();
    return this.#promise;
  }
  /** @internal synchronous access after loading */
  _loaded(): T | null {
    return this.#value;
  }
  dispose(): void {
    const v = this.#value as any;
    v?.delete?.();
    this.#value = null;
    this.#promise = null;
  }
}

interface LoadedImage {
  image: Image;
  /** Animated frames (GIF/WebP), with cumulative end times in seconds. */
  frames: { image: Image; end: number }[] | null;
  duration: number;
}

export class ImageAsset extends Asset<LoadedImage> {
  protected decode(bytes: Uint8Array): LoadedImage {
    const codec = Codec.fromData(bytes);
    if (codec && codec.frameCount() > 1) {
      const durs = codec.frameDurations();
      let t = 0;
      const frames = durs.map((d, i) => {
        t += Math.max(d, 10) / 1000;
        return { image: codec.getFrame(i), end: t };
      });
      codec.delete();
      return { image: frames[0]!.image, frames, duration: t };
    }
    codec?.delete();
    return { image: Image.fromEncoded(bytes), frames: null, duration: 0 };
  }
  async getDimensions(): Promise<{ width: number; height: number }> {
    const { image } = await this._get();
    return { width: image.width(), height: image.height() };
  }
  async getImage(): Promise<Image> {
    return (await this._get()).image;
  }
  /** @internal frame for a local time (animated images loop) */
  _frameAt(t: number): Image | null {
    const v = this._loaded();
    if (!v) return null;
    if (!v.frames) return v.image;
    const tt = v.duration > 0 ? ((t % v.duration) + v.duration) % v.duration : 0;
    return (v.frames.find((f) => tt < f.end) ?? v.frames[v.frames.length - 1]!).image;
  }
}

export interface FontAssetOptions {
  /** Family name to register under. Default: the font's own family name. */
  family?: string;
  weight?: number;
  style?: 'normal' | 'italic';
}

export class FontAsset extends Asset<Typeface> {
  readonly options: FontAssetOptions;
  constructor(source: AssetSource, options: FontAssetOptions = {}) {
    super(source);
    this.options = options;
  }
  protected decode(bytes: Uint8Array): Typeface {
    const tf = FontMgr.default().newFromData(bytes);
    if (!tf) throw new SkiamovinError('could not load font');
    return tf;
  }
  getTypeface(): Promise<Typeface> {
    return this._get();
  }
  async getFamilyName(): Promise<string> {
    return this.options.family ?? (await this._get()).familyName();
  }
}

export class SvgAsset extends Asset<{ text: string; dom: InstanceType<typeof svg.Dom> }> {
  protected decode(bytes: Uint8Array) {
    const text = new TextDecoder().decode(bytes);
    return { text, dom: svg.Dom.fromString(text, FontMgr.default()) };
  }
  async getDimensions(): Promise<{ width: number; height: number }> {
    const { dom } = await this._get();
    const s = dom.intrinsicSize();
    return { width: s.width || s.viewBox?.[2] || 0, height: s.height || s.viewBox?.[3] || 0 };
  }
  /** @internal DOM with attribute overrides applied (cached by overrides). */
  _domWith(attributes: Record<string, Record<string, string>> | undefined): InstanceType<typeof svg.Dom> | null {
    const v = this._loaded();
    if (!v) return null;
    if (!attributes || !Object.keys(attributes).length) return v.dom;
    const key = JSON.stringify(attributes);
    this.#variants ??= new Map();
    let d = this.#variants.get(key);
    if (!d) {
      let text = v.text;
      for (const [id, attrs] of Object.entries(attributes)) {
        const idRe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`<[^<>]*\\bid=["']${idRe}["'][^<>]*?(/?)>`);
        text = text.replace(re, (tag, selfClose: string) => {
          let t = tag.slice(0, tag.length - (selfClose ? 2 : 1));
          for (const k of Object.keys(attrs)) t = t.replace(new RegExp(`\\s${k}=("[^"]*"|'[^']*')`, 'g'), '');
          const extra = Object.entries(attrs)
            .map(([k, val]) => ` ${k}="${String(val).replace(/"/g, '&quot;')}"`)
            .join('');
          return `${t}${extra}${selfClose ? '/>' : '>'}`;
        });
      }
      d = svg.Dom.fromString(text, FontMgr.default());
      this.#variants.set(key, d);
    }
    return d;
  }
  #variants: Map<string, InstanceType<typeof svg.Dom>> | undefined;
}

/** Lottie animation. Not supported by the prebuilt binaries yet, so loading throws. */
export class LottieAsset extends Asset<never> {
  constructor(source: AssetSource, _options: { resources?: Record<string, Source> } = {}) {
    super(source);
  }
  protected decode(): never {
    throw new SkiamovinError('Lottie (Skottie) is not available in this build of Skiamovin.');
  }
  async getDuration(): Promise<number> {
    await this._get();
    return 0;
  }
  async getFrameRate(): Promise<number> {
    await this._get();
    return 0;
  }
  async getDimensions(): Promise<{ width: number; height: number }> {
    await this._get();
    return { width: 0, height: 0 };
  }
}

// Audio analysis

export interface AudioAnalysis {
  getRms(timestamp: number): number;
  getBands(timestamp: number): Float32Array;
}

/** Precomputes loudness and frequency bands for each frame, so visuals can react to audio. */
export async function analyzeAudio(
  media: Input | InputAudioTrack,
  options: { frameRate: number; bands?: number; minFrequency?: number; maxFrequency?: number },
): Promise<AudioAnalysis> {
  const track = 'getPrimaryAudioTrack' in media ? await media.getPrimaryAudioTrack() : media;
  if (!track) throw new SkiamovinError('no audio track');
  const nb = options.bands ?? 16;
  const fMin = options.minFrequency ?? 40;
  const fMax = options.maxFrequency ?? 16000;
  const fps = options.frameRate;
  const rms: number[] = [];
  const bands: Float32Array[] = [];
  const sr = await track.getSampleRate();
  const hop = sr / fps;
  const win = 2048;
  let mono = new Float32Array(0);
  for await (const s of new AudioSampleSink(track).samples()) {
    const ch = s.numberOfChannels;
    const buf = new Float32Array(s.numberOfFrames);
    const tmp = new Float32Array(s.numberOfFrames);
    for (let c = 0; c < ch; c++) {
      s.copyTo(tmp, { planeIndex: c, format: 'f32-planar' });
      for (let i = 0; i < tmp.length; i++) buf[i]! += tmp[i]! / ch;
    }
    const merged = new Float32Array(mono.length + buf.length);
    merged.set(mono);
    merged.set(buf, mono.length);
    mono = merged;
    s.close();
  }
  const frames = Math.ceil(mono.length / hop);
  for (let f = 0; f < frames; f++) {
    const center = Math.floor(f * hop);
    const a = Math.max(0, center - win / 2);
    const seg = mono.subarray(a, Math.min(mono.length, a + win));
    let e = 0;
    for (const v of seg) e += v * v;
    rms.push(Math.sqrt(e / Math.max(1, seg.length)));
    // Goertzel magnitudes at log-spaced frequencies.
    const out = new Float32Array(nb);
    for (let b = 0; b < nb; b++) {
      const freq = fMin * (fMax / fMin) ** ((b + 0.5) / nb);
      const w = (2 * Math.PI * freq) / sr;
      const coeff = 2 * Math.cos(w);
      let s1 = 0,
        s2 = 0;
      for (let i = 0; i < seg.length; i++) {
        const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (seg.length - 1));
        const s0 = seg[i]! * hann + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      const mag = Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2)) / (seg.length / 4);
      out[b] = Math.min(1, Math.max(0, (20 * Math.log10(mag + 1e-9) + 60) / 60));
    }
    bands.push(out);
  }
  const idx = (t: number) => Math.max(0, Math.min(frames - 1, Math.round(t * fps)));
  return {
    getRms: (t) => rms[idx(t)] ?? 0,
    getBands: (t) => bands[idx(t)] ?? new Float32Array(nb),
  };
}

/** A LUT loaded and packed for the GPU. */
interface LoadedLut {
  size: number;
  /** Tiles per row in the packed image. */
  cols: number;
  domainMin: [number, number, number];
  domainScale: [number, number, number];
  image: Image;
  shader: Shader;
}

export interface LutAssetOptions {
  /**
   * How LUT images are laid out: 'tiles' (a square grid of slices, like 512×512 with 64 slices), 'strip' (slices
   * side by side) or 'hald'. Default: 'strip' when the width is the height squared, otherwise 'tiles'.
   */
  layout?: 'tiles' | 'strip' | 'hald';
}

/** Converts a float to IEEE half precision bits. */
function toHalf(v: number): number {
  const f = new Float32Array([v]);
  const x = new Uint32Array(f.buffer)[0]!;
  const sign = (x >>> 16) & 0x8000;
  const exp = ((x >>> 23) & 0xff) - 127 + 15;
  const mant = x & 0x7fffff;
  if (exp <= 0) return sign;
  if (exp >= 31) return sign | 0x7c00;
  return sign | (exp << 10) | (mant >>> 13);
}

/** A color lookup table from a `.cube` file or a LUT image (PNG). Use with `lut()` in a node's `grade`. */
export class LutAsset extends Asset<LoadedLut> {
  readonly options: LutAssetOptions;
  constructor(source: AssetSource, options: LutAssetOptions = {}) {
    super(source);
    this.options = options;
  }
  protected decode(bytes: Uint8Array): LoadedLut {
    const isImage = (bytes[0] === 0x89 && bytes[1] === 0x50) || (bytes[0] === 0xff && bytes[1] === 0xd8);
    const lut = isImage ? this.#fromImage(bytes) : parseCube(new TextDecoder().decode(bytes));
    return pack(lut);
  }
  #fromImage(bytes: Uint8Array): ParsedLut {
    const img = Image.fromEncoded(bytes);
    if (!img) throw new SkiamovinError('LutAsset: could not decode the LUT image');
    const w = img.width(),
      h = img.height();
    const px = img.readPixels(0, 0, new ImageInfo(w, h, ColorType.RGBA_8888, AlphaType.Unpremul));
    img.delete();
    const layout = this.options.layout ?? (w === h * h ? 'strip' : 'tiles');
    let n: number;
    let at: (r: number, g: number, b: number) => number;
    if (layout === 'hald') {
      const level = Math.round(Math.cbrt(w));
      n = level * level;
      at = (r, g, b) => r + n * g + n * n * b;
      if (level ** 3 !== w || w !== h) throw new SkiamovinError('LutAsset: a Hald image must be level³ pixels square');
    } else if (layout === 'strip') {
      n = h;
      at = (r, g, b) => g * w + b * n + r;
    } else {
      // Square grid of slices: n³ = w·h, with sqrt(n) slices per row when n is a perfect square.
      n = Math.round(Math.cbrt(w * h));
      const cols = Math.round(w / n);
      at = (r, g, b) => (Math.floor(b / cols) * n + g) * w + (b % cols) * n + r;
      if (n ** 3 !== w * h) throw new SkiamovinError('LutAsset: the image size does not match a square LUT layout');
    }
    const data = new Float32Array(n * n * n * 3);
    for (let b = 0; b < n; b++)
      for (let g = 0; g < n; g++)
        for (let r = 0; r < n; r++) {
          const src = at(r, g, b) * 4,
            dst = (r + n * g + n * n * b) * 3;
          data[dst] = px[src]! / 255;
          data[dst + 1] = px[src + 1]! / 255;
          data[dst + 2] = px[src + 2]! / 255;
        }
    return { size: n, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
  }
}

/** Packs a cube into a half-float image of square tiles, one tile per blue slice. */
function pack(lut: ParsedLut): LoadedLut {
  const n = lut.size;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const w = n * cols,
    h = n * rows;
  const half = new Uint16Array(w * h * 4);
  for (let b = 0; b < n; b++) {
    const ox = (b % cols) * n,
      oy = Math.floor(b / cols) * n;
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        const src = (r + n * g + n * n * b) * 3;
        const dst = ((oy + g) * w + ox + r) * 4;
        half[dst] = toHalf(lut.data[src]!);
        half[dst + 1] = toHalf(lut.data[src + 1]!);
        half[dst + 2] = toHalf(lut.data[src + 2]!);
        half[dst + 3] = 0x3c00;
      }
  }
  const info = new ImageInfo(w, h, ColorType.RGBA_F16, AlphaType.Unpremul);
  const image = images.rasterFromPixels(info, new Uint8Array(half.buffer), w * 8);
  if (!image) throw new SkiamovinError('LutAsset: could not create the LUT image');
  const shader = image.makeShader(TileMode.Clamp, TileMode.Clamp, 'nearest');
  const scale = lut.domainMax.map((mx, i) => 1 / Math.max(1e-9, mx - lut.domainMin[i]!)) as [number, number, number];
  return { size: n, cols, domainMin: lut.domainMin, domainScale: scale, image, shader };
}
