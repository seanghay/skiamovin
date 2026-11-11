// Node worker thread that renders a range of frames into an MP4 in memory.
import { parentPort, workerData } from 'node:worker_threads';
import { init } from '../index.ts';
import { CompositionModule } from './composition.ts';
import { type ChunkJob, renderChunk } from './render-chunk.ts';

export type { ChunkJob };

async function run(job: ChunkJob): Promise<ArrayBuffer> {
  await init();
  const comp = await new CompositionModule(job.moduleUrl!, job.exportName).load();
  return renderChunk(comp, job, (frame) => parentPort!.postMessage({ type: 'progress', frame }));
}

run(workerData as ChunkJob).then(
  (buffer) => parentPort!.postMessage({ type: 'done', buffer }, [buffer]),
  (e) => parentPort!.postMessage({ type: 'error', message: String((e as Error)?.stack ?? e) }),
);
