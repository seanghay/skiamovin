// End-to-end check of the demo in headless Chrome: node e2e.mjs [preview|dev]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const mode = process.argv[2] ?? 'preview';
const port = mode === 'dev' ? 5199 : 5198;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', mode === 'dev' ? 'dev' : 'preview', '--port', String(port), '--strictPort'],
  { stdio: ['ignore', 'pipe', 'inherit'] },
);
await new Promise((resolve) => server.stdout.on('data', (d) => String(d).includes('Local') && resolve()));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({
  executablePath: existsSync(CHROME) ? CHROME : undefined,
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));
page.on(
  'response',
  (r) => r.status() >= 400 && !r.url().endsWith('/favicon.ico') && errors.push(`${r.status()} ${r.url()}`),
);
mkdirSync('e2e-output', { recursive: true });
try {
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => window.studioReady || window.studioError, null, { timeout: 60000 });
  const err = await page.evaluate(() => window.studioError);
  if (err) throw new Error(err);
  console.log(`[${mode}] ready in ${Date.now() - t0} ms —`, await page.textContent('#status'));

  // Seek, edit props, and check the preview changes.
  await page.fill('#scrub', '2');
  await page.dispatchEvent('#scrub', 'input');
  await page.waitForTimeout(300);
  const before = await page.locator('#preview').screenshot();
  await page.fill('#title', 'Hello from Vite');
  await page.fill('#accent', '#10b981');
  await page.dispatchEvent('#accent', 'input');
  await page.waitForTimeout(400);
  const after = await page.locator('#preview').screenshot();
  if (before.equals(after)) throw new Error('preview did not change after editing props');
  writeFileSync(`e2e-output/${mode}-preview.png`, after);

  // Playback keeps the main thread responsive.
  await page.click('#play');
  const fps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let n = 0,
          worst = 0,
          last = performance.now();
        const start = last;
        const f = () => {
          const t = performance.now();
          worst = Math.max(worst, t - last);
          last = t;
          if (++n < 120) requestAnimationFrame(f);
          else resolve({ rafFps: Math.round(n / ((t - start) / 1000)), worstFrameMs: Math.round(worst) });
        };
        requestAnimationFrame(f);
      }),
  );
  await page.click('#play');
  console.log(`[${mode}] playing:`, JSON.stringify(fps));

  // Export 1080p.
  await page.selectOption('#size', '1920');
  await page.click('#export');
  await page.waitForFunction(() => window.lastExport, null, { timeout: 120000 });
  const exp = await page.evaluate(() => window.lastExport);
  if (exp.error) throw new Error(exp.error);
  console.log(`[${mode}] export:`, JSON.stringify(exp));
  const mp4 = await page.evaluate(async () => {
    const b = await (await fetch(document.getElementById('output').src)).arrayBuffer();
    return Array.from(new Uint8Array(b));
  });
  writeFileSync(`e2e-output/${mode}-export.mp4`, Buffer.from(mp4));
  await page.screenshot({ path: `e2e-output/${mode}-page.png` });
  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log(`[${mode}] OK`);
} finally {
  await browser.close();
  server.kill();
}
