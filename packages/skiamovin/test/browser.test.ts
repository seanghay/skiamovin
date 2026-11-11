// Runs test/browser/tests.js in headless Chrome against the WebAssembly build.

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { openTestPage, type TestPage } from './browser/session.ts';
import { OUT, prepareTestMedia } from './fixtures/media.ts';

prepareTestMedia();

let session: TestPage;

before(async () => {
  session = await openTestPage();
});

after(async () => {
  await session?.close();
});

const names = [
  'init',
  'raster',
  'webgl',
  'text',
  'taffy',
  'surfaceSourceWebCodecs',
  'renderComposition',
  'compositionSink',
  'player',
  'playerWorkerModule',
  'playerWorkerFactory',
  'renderWorker',
];
for (const name of names) {
  test(`browser: ${name}`, async () => {
    const r = await session.page.evaluate((n) => (window as any).runTest(n), name);
    if (!r.ok) {
      console.log(session.logs.slice(-20).join('\n'));
      assert.fail(r.error);
    }
    if (name === 'renderComposition') {
      writeFileSync(`${OUT}browser-render-frame.png`, Buffer.from(r.result.framePng, 'base64'));
      delete r.result.framePng;
    }
    console.log(`  ${name}:`, JSON.stringify(r.result));
  });
}
