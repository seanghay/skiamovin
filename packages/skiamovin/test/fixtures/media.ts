// Test output folder and the media files the tests read. Creating them needs ffmpeg.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const OUT = fileURLToPath(new URL('../../../../test-output/', import.meta.url));

const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);

/** Creates `test-output/` with a 3 s stereo tone (`tone.mp3`) and a 3 s 640x360 test video with sound (`clip.mp4`). */
export function prepareTestMedia(): void {
  mkdirSync(OUT, { recursive: true });
  if (!existsSync(`${OUT}tone.mp3`)) {
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ac', '2', '-ar', '44100', `${OUT}tone.mp3`]);
  }
  if (!existsSync(`${OUT}clip.mp4`)) {
    ffmpeg([
      ...['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=3'],
      ...['-f', 'lavfi', '-i', 'sine=frequency=880:duration=3'],
      ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-bf', '2', '-c:a', 'aac', '-shortest', `${OUT}clip.mp4`],
    ]);
  }
}
