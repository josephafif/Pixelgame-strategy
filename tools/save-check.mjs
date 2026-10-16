// Browser check of single-player persistence: play, save from the menu,
// reload the page, continue the saved realm and compare.
// Usage: node tools/save-check.mjs outDir
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { makeStaticHandler } from '../server/static.js';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs'));
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || 'shots';
mkdirSync(out, { recursive: true });
const server = createServer(makeStaticHandler(root));
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`http://localhost:${port}/client/?autostart=1&seed=12&size=small&ais=2`);
await page.waitForFunction(() => window.__realm?.cw?.snap, null, { timeout: 60000 });
await page.evaluate(() => {
  const s = window.__realm.cw.init.startSites[0];
  window.__realm.transport.command({ type: 'place', x: s.x, y: s.y });
});
await page.waitForFunction(() => window.__realm.cw.snap.phase === 'running', null, { timeout: 30000 });
await page.evaluate(() => window.__realm.transport.setSpeed(8));
await page.waitForTimeout(12000);
// Open the menu (pauses) and save.
await page.click('#btn-menu');
await page.waitForSelector('[data-go="save"]');
const before = await page.evaluate(() => {
  const cw = window.__realm.cw;
  return { time: cw.snap.time, towns: cw.snap.structures.filter((s) => s.owner === cw.you).map((s) => s.name).sort(), tiles: cw.me.tiles };
});
await page.click('[data-go="save"]');
await page.waitForFunction(() => localStorage.getItem('realmwright:save:single:info'), null, { timeout: 10000 });
await page.screenshot({ path: `${out}/save-01-menu.png` });
// A fresh page: the title offers to continue.
await page.goto(`http://localhost:${port}/client/`);
await page.waitForSelector('[data-go="continue"]', { timeout: 10000 });
await page.screenshot({ path: `${out}/save-02-title.png` });
const label = await page.textContent('[data-go="continue"]');
await page.click('[data-go="continue"]');
await page.waitForFunction(() => window.__realm?.cw?.snap?.phase === 'running', null, { timeout: 60000 });
await page.waitForTimeout(1500);
const after = await page.evaluate(() => {
  const cw = window.__realm.cw;
  return { time: cw.snap.time, towns: cw.snap.structures.filter((s) => s.owner === cw.you).map((s) => s.name).sort(), tiles: cw.me.tiles };
});
await page.screenshot({ path: `${out}/save-03-continued.png` });
console.log('continue button:', label.replace(/\s+/g, ' ').trim());
console.log('before', JSON.stringify(before));
console.log('after ', JSON.stringify(after));
const ok = after.time >= before.time && after.time < before.time + 5 && JSON.stringify(after.towns) === JSON.stringify(before.towns);
console.log(ok ? 'SAVE/CONTINUE OK' : 'MISMATCH', errors.length ? `errors: ${errors.join(' | ')}` : 'no page errors');
await browser.close();
server.close();
process.exit(ok && !errors.length ? 0 : 1);
