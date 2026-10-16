// Drives the real client in headless Chromium: starts a single-player game,
// places the capital, lets time pass and saves screenshots.
// Usage: node tools/play.mjs outDir [seed] [size] [seconds]
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
const [out = 'shots', seed = '7', size = 'small', secs = '60'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const server = createServer(makeStaticHandler(root));
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console]', m.text()); } });
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.stack || e.message); });
await page.goto(`http://localhost:${port}/client/?autostart=1&seed=${seed}&size=${size}&ais=3`);
await page.waitForFunction(() => window.__realm && window.__realm.cw && window.__realm.cw.snap, null, { timeout: 60000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/01-placement.png` });
// Start on the first suggested site.
await page.evaluate(() => {
  const s = window.__realm.cw.init.startSites[0];
  window.__realm.renderer.centerOn(s.x, s.y);
  window.__realm.ui.tapTile({ x: s.x + 0.5, y: s.y + 0.5 });
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/02-start-here.png` });
await page.evaluate(() => {
  const s = window.__realm.cw.init.startSites[0];
  window.__realm.transport.command({ type: 'place', x: s.x, y: s.y });
});
await page.waitForFunction(() => window.__realm.cw.snap.phase === 'running', null, { timeout: 30000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/03-start.png` });
// Play a little: claim the land around, and keep expanding while time passes.
const expand = () => page.evaluate(() => {
  const { cw, transport } = window.__realm;
  for (let i = 0; i < cw.owner.length; i++) {
    if (cw.owner[i] === -1 && cw.land[i] && (cw.owner[i + 1] === cw.you || cw.owner[i - 1] === cw.you)) {
      transport.command({ type: 'attack', x: i % cw.W, y: (i / cw.W) | 0, ratio: 0.4 });
      return;
    }
  }
});
await expand();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/03b-attack.png` });
await page.evaluate(() => window.__realm.transport.setSpeed(8));
const t0 = Date.now();
while (Date.now() - t0 < Number(secs) * 1000) {
  await page.waitForTimeout(3000);
  await expand();
}
await page.evaluate(() => window.__realm.transport.setSpeed(1));
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/04-later.png` });
await page.evaluate(() => { window.__realm.renderer.zoomTo(3); });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/05-strategic.png` });
const info = await page.evaluate(() => { const cw = window.__realm.cw; return { t: cw.snap.time, tiles: cw.me.tiles, pop: cw.me.pop, troops: cw.me.troops, gold: cw.me.gold, alive: cw.me.alive, chunks: window.__realm.renderer.chunks.size }; });
console.log(JSON.stringify(info), 'errors', errors.length);
await browser.close();
server.close();
