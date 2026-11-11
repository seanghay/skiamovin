// Opens the browser test page in headless Chrome.
import { existsSync } from 'node:fs';
import { type Browser, chromium, type Page } from 'playwright-core';
import { startServer } from './server.mjs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export interface TestPage {
  page: Page;
  logs: string[];
  close(): Promise<void>;
}

export async function openTestPage(): Promise<TestPage> {
  const server = await startServer();
  const { port } = server.address();
  const browser: Browser = await chromium.launch({
    executablePath: existsSync(CHROME) ? CHROME : undefined,
    headless: true,
    args: ['--enable-unsafe-webgpu', '--use-angle=metal'],
  });
  const page = await browser.newPage();
  const logs: string[] = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/pkg/test/browser/index.html`);
  await page.waitForFunction(() => (window as any).ready === true, null, { timeout: 30000 });
  return {
    page,
    logs,
    async close() {
      await browser.close();
      server.close();
    },
  };
}
