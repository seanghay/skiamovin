// Runs test/browser/tests.js in headless Chrome against the WebAssembly build.

import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page } from 'playwright-core';
import { startServer } from './browser/server.mjs';

const OUT = fileURLToPath(new URL('../../../test-output/', import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let server: any, browser: Browser, page: Page;
const logs: string[] = [];

before(async () => {
  server = await startServer();
  const { port } = server.address();
  browser = await chromium.launch({
    executablePath: existsSync(CHROME) ? CHROME : undefined,
    headless: true,
    args: ['--enable-unsafe-webgpu', '--use-angle=metal'],
  });
  page = await browser.newPage();
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/pkg/test/browser/index.html`);
  await page.waitForFunction(() => (window as any).ready === true, null, { timeout: 30000 });
});

after(async () => {
  await browser?.close();
  server?.close();
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
    const r = await page.evaluate((n) => (window as any).runTest(n), name);
    if (!r.ok) {
      console.log(logs.slice(-20).join('\n'));
      assert.fail(r.error);
    }
    if (name === 'renderComposition') {
      writeFileSync(`${OUT}browser-render-frame.png`, Buffer.from(r.result.framePng, 'base64'));
      delete r.result.framePng;
    }
    console.log(`  ${name}:`, JSON.stringify(r.result));
  });
}
