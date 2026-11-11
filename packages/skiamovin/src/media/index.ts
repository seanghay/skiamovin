// Connects Skia images and surfaces to Mediabunny.
import {
  type AudioCodec,
  AudioSample,
  CustomAudioDecoder,
  CustomAudioEncoder,
  CustomVideoDecoder,
  CustomVideoEncoder,
  EncodedPacket,
  type InputVideoTrack,
  registerDecoder,
  registerEncoder,
  type VideoCodec,
  type VideoEncodingConfig,
  VideoSample,
  VideoSampleColorSpace,
  type VideoSamplePixelFormat,
  VideoSampleResource,
  VideoSampleSink,
  VideoSampleSource,
} from 'mediabunny';
import { loadBindingSync, nativeCodecs, runtime } from '#loader';
import { AlphaType, ColorType } from '../core/enums.ts';
import { CodecError } from '../core/errors.ts';
import { Rect } from '../core/geometry.ts';
import { type DirectContext, gpu } from '../core/gpu.ts';
import { Image, ImageInfo, images, type Paint, type Surface, surfaces } from '../core/skia.ts';
import { hasBinding, N, setBinding } from '../native/runtime.ts';

if (runtime === 'node' && !hasBinding()) {
  try {
    setBinding(loadBindingSync());
  } catch {
    /* reported on first use */
  }
}

// Pixel helpers

/** Images behind samples created here, so the native encoder can read them directly. */
const sampleImages = new WeakMap<VideoSample, Image>();
/** Surfaces that samples point to without copying, for the native encoder. */
const sampleSurfaces = new WeakMap<VideoSample, { surface: Surface; maxInFlight: number }>();
/** Decoded frames that still live in the decoder's IOSurface. */
const sampleNativeFrames = new WeakMap<VideoSample, NativeSurfaceFrame>();

interface NativeSurfaceFrame {
  readonly width: number;
  readonly height: number;
  iosurface(): number;
  toBgra(): { data: Uint8Array; width: number; height: number; stride: number };
  release(): void;
}

/** Mediabunny clones samples before encoding, and clones share this resource, so lookups use it. */
function resourceOf(sample: VideoSample): unknown {
  return (sample as unknown as { _data?: unknown })._data;
}

/** A sample that reads a surface directly. Valid until the surface is drawn into again. */
class SkiaSurfaceResource extends VideoSampleResource {
  readonly #surface: Surface;
  maxInFlight = 0;
  get surface(): Surface {
    return this.#surface;
  }
  readonly #w: number;
  readonly #h: number;
  constructor(surface: Surface) {
    super();
    this.#surface = surface;
    this.#w = surface.width();
    this.#h = surface.height();
  }
  getFormat(): VideoSamplePixelFormat {
    return 'RGBA';
  }
  getCodedWidth(): number {
    return this.#w;
  }
  getCodedHeight(): number {
    return this.#h;
  }
  getSquarePixelWidth(): number {
    return this.#w;
  }
  getSquarePixelHeight(): number {
    return this.#h;
  }
  getColorSpace(): VideoSampleColorSpace {
    return new VideoSampleColorSpace({ primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true });
  }
  close(): void {}
  getDataPlanes() {
    const data = this.#surface.readPixels(
      0,
      0,
      new ImageInfo(this.#w, this.#h, ColorType.RGBA_8888, AlphaType.Unpremul),
    );
    return [{ data, stride: this.#w * 4 }];
  }
  toRgbSample(init: ConstructorParameters<typeof VideoSample>[1] & { timestamp: number }): VideoSample {
    const [plane] = this.getDataPlanes();
    return new VideoSample(plane!.data, { ...init, format: 'RGBA', codedWidth: this.#w, codedHeight: this.#h });
  }
}

/** A decoded frame still in the decoder's IOSurface; pixels are copied only if someone asks for them. */
class NativeFrameResource extends VideoSampleResource {
  readonly frame: NativeSurfaceFrame;
  constructor(frame: NativeSurfaceFrame) {
    super();
    this.frame = frame;
  }
  getFormat(): VideoSamplePixelFormat {
    return 'BGRA';
  }
  getCodedWidth(): number {
    return this.frame.width;
  }
  getCodedHeight(): number {
    return this.frame.height;
  }
  getSquarePixelWidth(): number {
    return this.frame.width;
  }
  getSquarePixelHeight(): number {
    return this.frame.height;
  }
  getColorSpace(): VideoSampleColorSpace {
    return new VideoSampleColorSpace({ primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true });
  }
  close(): void {
    this.frame.release();
  }
  getDataPlanes() {
    const f = this.frame.toBgra();
    return [
      { data: f.stride === f.width * 4 ? f.data : repack(f.data, f.stride, f.width, f.height), stride: f.width * 4 },
    ];
  }
  toRgbSample(init: ConstructorParameters<typeof VideoSample>[1] & { timestamp: number }): VideoSample {
    const [plane] = this.getDataPlanes();
    return new VideoSample(plane!.data, {
      ...init,
      format: 'BGRA',
      codedWidth: this.frame.width,
      codedHeight: this.frame.height,
    });
  }
}

class SkiaImageResource extends VideoSampleResource {
  #image: Image | null;
  readonly #w: number;
  readonly #h: number;
  constructor(image: Image) {
    super();
    this.#image = image;
    this.#w = image.width();
    this.#h = image.height();
  }
  get image(): Image | null {
    return this.#image;
  }
  getFormat(): VideoSamplePixelFormat {
    return 'RGBA';
  }
  getCodedWidth(): number {
    return this.#w;
  }
  getCodedHeight(): number {
    return this.#h;
  }
  getSquarePixelWidth(): number {
    return this.#w;
  }
  getSquarePixelHeight(): number {
    return this.#h;
  }
  getColorSpace(): VideoSampleColorSpace {
    return new VideoSampleColorSpace({ primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true });
  }
  close(): void {
    this.#image?.delete();
    this.#image = null;
  }
  getDataPlanes() {
    if (!this.#image) throw new CodecError('video sample has been closed');
    const data = this.#image.readPixels(0, 0, new ImageInfo(this.#w, this.#h, ColorType.RGBA_8888, AlphaType.Unpremul));
    return [{ data, stride: this.#w * 4 }];
  }
  toRgbSample(init: ConstructorParameters<typeof VideoSample>[1] & { timestamp: number }): VideoSample {
    const [plane] = this.getDataPlanes();
    return new VideoSample(plane!.data, { ...init, format: 'RGBA', codedWidth: this.#w, codedHeight: this.#h });
  }
}

/** Wraps a Skia image as a Mediabunny `VideoSample` (pixels are read lazily). The sample owns `image`. */
export function videoSampleFromImage(image: Image, init: { timestamp: number; duration?: number }): VideoSample {
  const res = new SkiaImageResource(image);
  const sample = new VideoSample(res, { timestamp: init.timestamp, duration: init.duration ?? 0 });
  sampleImages.set(sample, image);
  return sample;
}

export interface SurfaceSampleOptions {
  /**
   * For encoder-compatible surfaces on Node, how many frames may still be encoding after `add()` returns.
   * Default 0. When cycling through N surfaces, use N - 2.
   */
  maxInFlight?: number;
}

/**
 * Wraps the surface's current contents as a Mediabunny `VideoSample`. Encoder-compatible surfaces are not copied,
 * so wait until the sample is encoded before drawing into the surface again.
 */
export function videoSampleFromSurface(
  surface: Surface,
  init: { timestamp: number; duration?: number },
  options: SurfaceSampleOptions = {},
): VideoSample {
  if (registered && surface.isEncoderCompatible()) {
    const res = new SkiaSurfaceResource(surface);
    res.maxInFlight = options.maxInFlight ?? 0;
    const sample = new VideoSample(res, { timestamp: init.timestamp, duration: init.duration ?? 0 });
    sampleSurfaces.set(sample, { surface, maxInFlight: res.maxInFlight });
    return sample;
  }
  return videoSampleFromImage(surface.imageSnapshot(), init);
}

/**
 * @internal Like `imageFromVideoSample`, but the image may share the sample's GPU memory (`borrowed: true`).
 * In that case, keep the sample open while the image is in use.
 */
export async function borrowImageFromVideoSample(
  sample: VideoSample,
  context?: DirectContext | null,
): Promise<{ image: Image; borrowed: boolean }> {
  const data = resourceOf(sample);
  const nf = sampleNativeFrames.get(sample) ?? (data instanceof NativeFrameResource ? data.frame : undefined);
  if (nf && context && context.backend() === 'metal') {
    const hh = N().image_from_iosurface(context.handle, nf.iosurface(), nf.width, nf.height);
    if (hh) return { image: Image._fromHandle(hh), borrowed: true };
  }
  return { image: await imageFromVideoSample(sample, context), borrowed: false };
}

/** Reads a sample's pixels as BGRA or RGBA bytes (tightly packed). */
export async function samplePixels(
  sample: VideoSample,
): Promise<{ data: Uint8Array; colorType: ColorType; width: number; height: number }> {
  const width = sample.codedWidth;
  const height = sample.codedHeight;
  const fmt = sample.format;
  if (fmt === 'BGRA' || fmt === 'BGRX' || fmt === 'RGBA' || fmt === 'RGBX') {
    const data = new Uint8Array(sample.allocationSize());
    const layout = await sample.copyTo(data);
    const stride = layout[0]?.stride ?? width * 4;
    const packed = stride === width * 4 ? data : repack(data, stride, width, height);
    if (fmt.endsWith('X')) for (let i = 3; i < packed.length; i += 4) packed[i] = 255;
    return { data: packed, colorType: fmt.startsWith('B') ? ColorType.BGRA_8888 : ColorType.RGBA_8888, width, height };
  }
  const data = new Uint8Array(width * height * 4);
  await sample.copyTo(data, { format: 'RGBA' } as never);
  return { data, colorType: ColorType.RGBA_8888, width, height };
}

function repack(src: Uint8Array, stride: number, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) out.set(src.subarray(y * stride, y * stride + width * 4), y * width * 4);
  return out;
}

/**
 * Turns a Mediabunny `VideoSample` into a Skia `Image`. With a GPU `context` the image is uploaded to the GPU.
 * The image owns its pixels, so the sample can be closed afterwards.
 */
export async function imageFromVideoSample(sample: VideoSample, context?: DirectContext | null): Promise<Image> {
  const res = resourceOf(sample);
  const own = sampleImages.get(sample) ?? (res instanceof SkiaImageResource ? res.image : undefined);
  if (own && !own.isDeleted()) return context ? own.makeTextureImage(context) : own.makeRasterImage();
  const nf = sampleNativeFrames.get(sample) ?? (res instanceof NativeFrameResource ? res.frame : undefined);
  if (nf) {
    const f = nf.toBgra();
    const img = images.rasterFromPixels(
      new ImageInfo(f.width, f.height, ColorType.BGRA_8888, AlphaType.Premul),
      f.data,
      f.stride,
    );
    if (!img) throw new CodecError('could not create an image from the video sample');
    if (!context) return img;
    const tex = img.makeTextureImage(context);
    img.delete();
    return tex;
  }
  const { data, colorType, width, height } = await samplePixels(sample);
  const img = images.rasterFromPixels(new ImageInfo(width, height, colorType, AlphaType.Premul), data);
  if (!img) throw new CodecError('could not create an image from the video sample');
  if (!context) return img;
  const tex = img.makeTextureImage(context);
  img.delete();
  return tex;
}

// SurfaceSource

/** A Mediabunny video source that encodes a Skia surface on each `add(timestamp, duration)`, like `CanvasSource`. */
export class SurfaceSource extends VideoSampleSource {
  readonly #surface: Surface;
  constructor(surface: Surface, encodingConfig: VideoEncodingConfig) {
    super(encodingConfig);
    this.#surface = surface;
  }
  override add(
    timestampOrSample: number | VideoSample,
    durationOrOptions?: number | { keyFrame?: boolean },
    options?: { keyFrame?: boolean },
  ): Promise<void> {
    if (typeof timestampOrSample !== 'number') {
      return super.add(timestampOrSample, durationOrOptions as never);
    }
    const sample = videoSampleFromSurface(this.#surface, {
      timestamp: timestampOrSample,
      duration: (durationOrOptions as number | undefined) ?? 0,
    });
    return super.add(sample, options as never).finally(() => sample.close());
  }
}

// ImageSink

export interface WrappedImage {
  image: Image;
  timestamp: number;
  duration: number;
}

export interface ImageSinkOptions {
  context?: DirectContext | null;
  width?: number;
  height?: number;
  fit?: 'fill' | 'contain' | 'cover';
  /** Reuse this many surfaces in rotation. Default 0 (a new image per frame). */
  poolSize?: number;
}

/** Decodes a video track into Skia images. The Skia counterpart of Mediabunny's `CanvasSink`. */
export class ImageSink {
  readonly #sink: VideoSampleSink;
  readonly #opts: ImageSinkOptions;
  #pool: Surface[] = [];
  #poolIndex = 0;

  constructor(videoTrack: InputVideoTrack, options: ImageSinkOptions = {}) {
    this.#sink = new VideoSampleSink(videoTrack);
    this.#opts = options;
  }

  async #wrap(sample: VideoSample | null): Promise<WrappedImage | null> {
    if (!sample) return null;
    try {
      const { width, height, context } = this.#opts;
      const src = await imageFromVideoSample(sample, null);
      if (!width && !height && !context) return { image: src, timestamp: sample.timestamp, duration: sample.duration };
      const w = width ?? Math.round((height! * src.width()) / src.height());
      const hh = height ?? Math.round((w * src.height()) / src.width());
      const surface = this.#surface(w, hh);
      const c = surface.canvas();
      c.clear(0);
      drawFit(c, src, Rect.fromWH(w, hh), this.#opts.fit ?? 'fill');
      src.delete();
      const image = surface.imageSnapshot();
      if (!this.#opts.poolSize) surface.delete();
      return { image, timestamp: sample.timestamp, duration: sample.duration };
    } finally {
      sample.close();
    }
  }

  #surface(w: number, hh: number): Surface {
    const make = () => {
      const ctx = this.#opts.context;
      const s = ctx
        ? gpu.surfaces.renderTarget(ctx, gpu.Budgeted.Yes, ImageInfo.newN32Premul([w, hh]))
        : surfaces.rasterN32Premul([w, hh]);
      if (!s) throw new CodecError(`could not allocate a ${w}x${hh} surface`);
      return s;
    };
    const n = this.#opts.poolSize ?? 0;
    if (!n) return make();
    if (this.#pool.length < n) {
      const s = make();
      this.#pool.push(s);
      return s;
    }
    const s = this.#pool[this.#poolIndex]!;
    this.#poolIndex = (this.#poolIndex + 1) % n;
    return s;
  }

  async getImage(timestamp: number): Promise<WrappedImage | null> {
    return this.#wrap(await this.#sink.getSample(timestamp));
  }

  async *images(startTimestamp?: number, endTimestamp?: number): AsyncGenerator<WrappedImage> {
    for await (const sample of this.#sink.samples(startTimestamp, endTimestamp)) {
      yield (await this.#wrap(sample))!;
    }
  }

  async *imagesAtTimestamps(timestamps: Iterable<number> | AsyncIterable<number>): AsyncGenerator<WrappedImage | null> {
    for await (const sample of this.#sink.samplesAtTimestamps(timestamps)) {
      yield await this.#wrap(sample);
    }
  }
}

/** Draws `image` into `dst` with CSS object-fit semantics. */
export function drawFit(
  canvas: ReturnType<Surface['canvas']>,
  image: Image,
  dst: Rect,
  fit: 'fill' | 'contain' | 'cover' | 'none' | 'scale-down',
  position: readonly [number, number] = [0.5, 0.5],
  paint?: Paint | null,
  sampling: 'linear' | 'nearest' | 'mipmap' | 'cubic' = 'linear',
): void {
  const iw = image.width(),
    ih = image.height();
  const dw = dst.width(),
    dh = dst.height();
  let w = dw,
    hh = dh;
  if (fit === 'contain' || fit === 'cover' || fit === 'scale-down') {
    const s = fit === 'cover' ? Math.max(dw / iw, dh / ih) : Math.min(dw / iw, dh / ih);
    const k = fit === 'scale-down' ? Math.min(1, s) : s;
    w = iw * k;
    hh = ih * k;
  } else if (fit === 'none') {
    w = iw;
    hh = ih;
  }
  const x = dst.left + (dw - w) * position[0];
  const y = dst.top + (dh - hh) * position[1];
  const clip = fit === 'cover' || fit === 'none';
  if (clip) {
    canvas.save();
    canvas.clipRect(dst);
  }
  canvas.drawImageRectWithSamplingOptions(image, null, Rect.fromXYWH(x, y, w, hh), sampling, paint ?? null);
  if (clip) canvas.restore();
}

// Native codecs for Mediabunny (Node)

interface NativePacket {
  data: Uint8Array;
  timestamp: number;
  duration: number;
  key: boolean;
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}

/** RFC 6381 codec string from an avcC record. */
export function avcCodecString(avcC: Uint8Array): string {
  return `avc1.${hex2(avcC[1]!)}${hex2(avcC[2]!)}${hex2(avcC[3]!)}`;
}

/** RFC 6381 codec string from an hvcC record. */
export function hevcCodecString(hvcC: Uint8Array): string {
  const space = (hvcC[1]! >> 6) & 3;
  const tier = (hvcC[1]! >> 5) & 1;
  const idc = hvcC[1]! & 31;
  let compat = ((hvcC[2]! << 24) | (hvcC[3]! << 16) | (hvcC[4]! << 8) | hvcC[5]!) >>> 0;
  let rev = 0;
  for (let i = 0; i < 32; i++) {
    rev = ((rev << 1) | (compat & 1)) >>> 0;
    compat >>>= 1;
  }
  const level = hvcC[12]!;
  const constraints = [...hvcC.slice(6, 12)];
  while (constraints.length && constraints[constraints.length - 1] === 0) constraints.pop();
  const c = constraints.map((b) => b.toString(16).toUpperCase()).join('.');
  return `hvc1.${['', 'A', 'B', 'C'][space]}${idc}.${rev.toString(16).toUpperCase()}.${tier ? 'H' : 'L'}${level}${c ? `.${c}` : ''}`;
}

let registered = false;
let excludeSet = new Set<string>();
/** On macOS, decoded frames stay in GPU memory. Set SKIAMOVIN_ZERO_COPY_DECODE=0 to turn this off. */
const zeroCopyDecode = typeof process === 'undefined' || process.env?.SKIAMOVIN_ZERO_COPY_DECODE !== '0';

function caps(): { videoEncode: string[]; videoDecode: string[]; audioEncode: string[]; audioDecode: string[] } | null {
  try {
    return nativeCodecs()?.codec_capabilities?.() ?? null;
  } catch {
    return null;
  }
}
let capsCache: ReturnType<typeof caps> | undefined;
const getCaps = () => {
  if (capsCache === undefined) capsCache = caps();
  return capsCache;
};

class NativeVideoEncoder extends CustomVideoEncoder {
  #enc: any;
  #sentConfig = false;
  #frames = 0;

  static override supports(codec: VideoCodec, config: VideoEncoderConfig): boolean {
    return (
      !excludeSet.has(codec) &&
      !!getCaps()?.videoEncode.includes(codec) &&
      (config.alpha !== 'keep' || codec === 'hevc')
    );
  }
  init(): void {
    const N = nativeCodecs();
    const cfg = this.config;
    this.#enc = new N.NativeVideoEncoder({
      codec: this.codec,
      width: cfg.width,
      height: cfg.height,
      // Quality settings like QUALITY_HIGH have no bitrate, so pick one as Mediabunny does to keep files small.
      bitrate:
        typeof cfg.bitrate === 'number'
          ? cfg.bitrate
          : Math.round(cfg.width * cfg.height * (cfg.framerate ?? 30) * 0.1 * (this.codec === 'hevc' ? 0.65 : 1)),
      frameRate: cfg.framerate,
      keyFrameInterval: undefined,
      realtime: cfg.latencyMode === 'realtime',
      preferHardware: cfg.hardwareAcceleration !== 'prefer-software',
      alpha: cfg.alpha === 'keep',
    });
  }
  async encode(sample: VideoSample, options: VideoEncoderEncodeOptions): Promise<void> {
    const ts = Math.round(sample.timestamp * 1e6);
    const dur = Math.round(sample.duration * 1e6);
    const key = !!options?.keyFrame || this.#frames === 0;
    const data = resourceOf(sample);
    const live =
      sampleSurfaces.get(sample) ??
      (data instanceof SkiaSurfaceResource ? { surface: data.surface, maxInFlight: data.maxInFlight } : undefined);
    const img = sampleImages.get(sample) ?? (data instanceof SkiaImageResource ? data.image : undefined);
    if (
      live &&
      !live.surface.isDeleted() &&
      live.surface.width() === this.config.width &&
      live.surface.height() === this.config.height
    ) {
      this.#enc.encodeSurfaceZeroCopy(live.surface.handle, ts, dur, key, live.maxInFlight);
    } else if (img && !img.isDeleted() && img.width() === this.config.width && img.height() === this.config.height) {
      this.#enc.encodeImage(img.handle, ts, dur, key);
    } else {
      let { data, colorType, width } = await samplePixels(sample);
      if (colorType !== ColorType.BGRA_8888) data = swizzleRB(data);
      this.#enc.encodeBgra(data, width * 4, ts, dur, key);
    }
    this.#frames++;
    this.#drain();
  }
  #drain(): void {
    for (const p of this.#enc.takePackets() as NativePacket[]) {
      const packet = new EncodedPacket(p.data, p.key ? 'key' : 'delta', p.timestamp / 1e6, p.duration / 1e6);
      if (!this.#sentConfig) {
        const description: Uint8Array | null = this.#enc.description();
        if (!description) throw new CodecError('encoder produced a packet before its configuration');
        this.#sentConfig = true;
        this.onPacket(packet, {
          decoderConfig: {
            codec: this.codec === 'avc' ? avcCodecString(description) : hevcCodecString(description),
            codedWidth: this.config.width,
            codedHeight: this.config.height,
            description,
            colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
          },
        });
      } else {
        this.onPacket(packet);
      }
    }
  }
  flush(): void {
    this.#enc.flush();
    this.#drain();
  }
  close(): void {
    this.#enc = null;
  }
}

function swizzleRB(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i += 4) {
    out[i] = src[i + 2]!;
    out[i + 1] = src[i + 1]!;
    out[i + 2] = src[i]!;
    out[i + 3] = src[i + 3]!;
  }
  return out;
}

class NativeVideoDecoder extends CustomVideoDecoder {
  #dec: any;
  #zeroCopy = false;
  static override supports(codec: VideoCodec, config: VideoDecoderConfig): boolean {
    return !excludeSet.has(codec) && !!getCaps()?.videoDecode.includes(codec) && !!config.description;
  }
  init(): void {
    const N = nativeCodecs();
    const d = this.config.description!;
    const desc =
      d instanceof Uint8Array
        ? d
        : ArrayBuffer.isView(d)
          ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength)
          : new Uint8Array(d as ArrayBuffer);
    this.#dec = new N.NativeVideoDecoder(this.codec, desc, this.config.codedWidth ?? 0, this.config.codedHeight ?? 0);
    if (zeroCopyDecode && typeof this.#dec.setZeroCopy === 'function') {
      this.#dec.setZeroCopy(true);
      this.#zeroCopy = true;
    }
    if (typeof this.#dec.setAsync === 'function') this.#dec.setAsync(true);
  }
  decode(packet: EncodedPacket): void {
    this.#dec.decode(
      packet.data,
      Math.round(packet.timestamp * 1e6),
      Math.round(packet.duration * 1e6),
      packet.type === 'key',
    );
    // Let up to 4 frames decode at once.
    this.#dec.waitPending?.(4);
    this.#drain();
  }
  #drain(): void {
    if (this.#zeroCopy) {
      for (const f of this.#dec.takeSurfaces() as (NativeSurfaceFrame & { timestamp: number; duration: number })[]) {
        const sample = new VideoSample(new NativeFrameResource(f), {
          timestamp: f.timestamp / 1e6,
          duration: f.duration / 1e6,
        });
        sampleNativeFrames.set(sample, f);
        this.onSample(sample);
      }
      return;
    }
    for (const f of this.#dec.takeFrames() as {
      width: number;
      height: number;
      stride: number;
      data: Uint8Array;
      timestamp: number;
      duration: number;
    }[]) {
      const data = f.stride === f.width * 4 ? f.data : repack(f.data, f.stride, f.width, f.height);
      this.onSample(
        new VideoSample(data, {
          format: 'BGRA',
          codedWidth: f.width,
          codedHeight: f.height,
          timestamp: f.timestamp / 1e6,
          duration: f.duration / 1e6,
        }),
      );
    }
  }
  flush(): void {
    this.#dec.flush();
    this.#drain();
  }
  close(): void {
    this.#dec = null;
  }
}

class NativeAudioEncoder extends CustomAudioEncoder {
  #enc: any;
  #sentConfig = false;
  #priming = 0;
  static override supports(codec: AudioCodec, config: AudioEncoderConfig): boolean {
    return (
      codec === 'aac' &&
      !excludeSet.has(codec) &&
      !!getCaps()?.audioEncode.includes('aac') &&
      config.numberOfChannels <= 2
    );
  }
  init(): void {
    const N = nativeCodecs();
    this.#enc = new N.NativeAudioEncoder(
      this.config.sampleRate,
      this.config.numberOfChannels,
      this.config.bitrate ?? undefined,
    );
    this.#priming = this.#enc.primingFrames() / this.config.sampleRate;
  }
  async encode(sample: AudioSample): Promise<void> {
    const opts = { planeIndex: 0, format: 'f32' as const };
    const buf = new Float32Array(sample.allocationSize(opts) / 4);
    sample.copyTo(buf, opts);
    this.#enc.encode(buf, Math.round(sample.timestamp * 1e6));
    this.#drain();
  }
  #drain(): void {
    for (const p of this.#enc.takePackets() as NativePacket[]) {
      // Shift by the encoder delay so decoded audio lines up with its source timestamps.
      const packet = new EncodedPacket(p.data, 'key', p.timestamp / 1e6 - this.#priming, p.duration / 1e6);
      if (!this.#sentConfig) {
        this.#sentConfig = true;
        this.onPacket(packet, {
          decoderConfig: {
            codec: 'mp4a.40.2',
            sampleRate: this.config.sampleRate,
            numberOfChannels: this.config.numberOfChannels,
            description: this.#enc.description(),
          },
        });
      } else this.onPacket(packet);
    }
  }
  flush(): void {
    this.#enc.flush();
    this.#drain();
  }
  close(): void {
    this.#enc = null;
  }
}

class NativeAudioDecoder extends CustomAudioDecoder {
  #dec: any;
  static override supports(codec: AudioCodec, _config: AudioDecoderConfig): boolean {
    return (codec === 'aac' || codec === 'mp3') && !excludeSet.has(codec) && !!getCaps()?.audioDecode.includes(codec);
  }
  init(): void {
    const N = nativeCodecs();
    const d = this.config.description;
    const desc = d
      ? d instanceof Uint8Array
        ? d
        : ArrayBuffer.isView(d)
          ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength)
          : new Uint8Array(d as ArrayBuffer)
      : undefined;
    this.#dec = new N.NativeAudioDecoder(this.codec, this.config.sampleRate, this.config.numberOfChannels, desc);
  }
  decode(packet: EncodedPacket): void {
    this.#dec.decode(packet.data, Math.round(packet.timestamp * 1e6));
    this.#drain();
  }
  #drain(): void {
    for (const a of this.#dec.takeAudio() as {
      data: Float32Array;
      frames: number;
      channels: number;
      sampleRate: number;
      timestamp: number;
    }[]) {
      if (!a.frames) continue;
      this.onSample(
        new AudioSample({
          data: a.data,
          format: 'f32',
          numberOfChannels: a.channels,
          sampleRate: a.sampleRate,
          timestamp: a.timestamp / 1e6,
        }),
      );
    }
  }
  flush(): void {
    this.#dec.flush();
    this.#drain();
  }
  close(): void {
    this.#dec = null;
  }
}

export interface RegisterNativeCodecsOptions {
  prefer?: 'auto' | 'hardware' | 'software';
  /** Codecs to leave to Mediabunny's defaults. */
  exclude?: (VideoCodec | AudioCodec)[];
}

/** Registers Skiamovin's native encoders and decoders with Mediabunny on Node. Does nothing in the browser. */
export function registerNativeCodecs(options: RegisterNativeCodecsOptions = {}): void {
  excludeSet = new Set(options.exclude ?? []);
  if (registered || runtime !== 'node' || !getCaps()) return;
  registered = true;
  registerEncoder(NativeVideoEncoder);
  registerDecoder(NativeVideoDecoder);
  registerEncoder(NativeAudioEncoder);
  registerDecoder(NativeAudioDecoder);
}

/** Native codec support in this runtime (Node only; empty on the web). */
export function nativeCodecSupport(): {
  videoEncode: string[];
  videoDecode: string[];
  audioEncode: string[];
  audioDecode: string[];
} {
  return getCaps() ?? { videoEncode: [], videoDecode: [], audioEncode: [], audioDecode: [] };
}
