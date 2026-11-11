// Runs the browser benchmarks in headless Chrome: node test/browser/bench-run.mjs
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer } from './server.mjs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const server = await startServer();
const browser = await chromium.launch({
  executablePath: existsSync(CHROME) ? CHROME : undefined,
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => m.type() === 'error' && console.log('[page]', m.text()));
await page.goto(`http://127.0.0.1:${server.address().port}/pkg/test/browser/bench.html`);
await page.waitForFunction(() => window.benchReady === true);
const gl = await page.evaluate(() => {
  const c = new OffscreenCanvas(1, 1).getContext('webgl2');
  const d = c.getExtension('WEBGL_debug_renderer_info');
  return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log('WebGL renderer:', gl);
for (const [w, h] of [
  [1920, 1080],
  [1280, 720],
]) {
  console.log('export', JSON.stringify(await page.evaluate(([w, h]) => window.benchExport(w, h), [w, h])));
}
console.log('export raster', JSON.stringify(await page.evaluate(() => window.benchExport(1920, 1080, 'raster'))));
for (const [w, h] of [
  [1920, 1080],
  [1280, 720],
]) {
  console.log('player', JSON.stringify(await page.evaluate(([w, h]) => window.benchPlayer(w, h), [w, h])));
}
await browser.close();
server.close();
