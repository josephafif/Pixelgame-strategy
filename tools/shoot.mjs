// Screenshot a page of the local client for visual inspection.
// Usage: node tools/shoot.mjs "<path?query>" out.png [width height]
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeStaticHandler } from '../server/static.js';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs'));
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [path, out, vw = '1280', vh = '800'] = process.argv.slice(2);
const server = createServer(makeStaticHandler(root));
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: Number(vw), height: Number(vh) } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
page.on('pageerror', (e) => { console.log('[pageerror]', e.stack || e.message); page.evaluate(() => { window.__failed = true; }).catch(() => {}); });
await page.goto(`http://localhost:${port}${path}`);
await page.waitForFunction(() => window.__done === true || window.__failed, null, { timeout: 120000 });
await page.screenshot({ path: out, fullPage: true });
const info = await page.evaluate(() => document.getElementById('info')?.textContent);
if (info) console.log(info);
await browser.close();
server.close();
