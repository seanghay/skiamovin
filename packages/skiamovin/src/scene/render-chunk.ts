// Renders a range of frames into an in-memory MP4. Runs in Node worker threads and in browser workers.
import { BufferTarget, Mp4OutputFormat, Output, Quality, VideoSample, VideoSampleSource } from 'mediabunny';
import type { Surface } from '../core/skia.ts';
import { videoSampleFromSurface } from '../media/index.ts';
import type { Composition } from './composition.ts';
import { FrameRenderer } from './renderer.ts';

/** High quality with a target bitrate, since Chrome's constant-quality mode can take seconds to start on macOS. */
export const DEFAULT_VIDEO_QUALITY = new Quality({ quality: 'high', preferBitrate: true });

export interface ChunkJob {
  /** Set when the worker loads the composition itself (Node, or the built-in browser worker). */
  moduleUrl?: string;
  exportName?: string;
  props?: Record<string, unknown>;
  width: number;
  height: number;
  fit?: 'fill' | 'contain' | 'cover';
  gpu?: string;
  codec: string;
  bitrate?: number | null;
  keyFrameInterval: number;
  bitrateMode?: 'variable' | 'constant';
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software';
  fps: number;
  /** Absolute composition time of frame 0 of the render (trim start). */
  start: number;
  firstFrame: number;
  endFrame: number;
}

/** Wraps the frame just rendered as a VideoSample. */
export function frameSample(
  renderer: FrameRenderer,
  surface: Surface,
  timestamp: number,
  duration: number,
): VideoSample {
  const bitmap = renderer.lastBitmap;
  if (bitmap) {
    renderer.lastBitmap = null;
    const sample = new VideoSample(
      new VideoFrame(bitmap, { timestamp: Math.round(timestamp * 1e6), duration: Math.round(duration * 1e6) }),
    );
    bitmap.close();
    return sample;
  }
  return videoSampleFromSurface(surface, { timestamp, duration }, { maxInFlight: renderer.maxInFlight });
}

export async function renderChunk(
  comp: Composition<any>,
  job: ChunkJob,
  onFrame: (frame: number) => void,
): Promise<ArrayBuffer> {
  const renderer = new FrameRenderer(comp, {
    width: job.width,
    height: job.height,
    fit: job.fit,
    gpu: job.gpu as never,
    props: job.props,
    encode: true,
  });
  await renderer.init();
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const src = new VideoSampleSource({
    codec: job.codec as never,
    bitrate: job.bitrate ?? DEFAULT_VIDEO_QUALITY,
    keyFrameInterval: job.keyFrameInterval,
    bitrateMode: job.bitrateMode,
    hardwareAcceleration: job.hardwareAcceleration,
    latencyMode: 'quality',
  });
  output.addVideoTrack(src, { frameRate: job.fps });
  await output.start();
  try {
    for (let i = job.firstFrame; i < job.endFrame; i++) {
      const surface = await renderer.renderFrame(job.start + i / job.fps);
      // Chunk-local timestamps; the main thread offsets them when joining.
      const sample = frameSample(renderer, surface, (i - job.firstFrame) / job.fps, 1 / job.fps);
      await src.add(sample);
      sample.close();
      onFrame(i);
    }
    src.close();
    await output.finalize();
  } finally {
    await renderer.dispose();
  }
  return target.buffer!;
}
