// Drive the civilization simulator in headless Chromium and take screenshots.
// Usage: node tools/civ-shot.mjs outDir [seed] [size] [seconds] [speed] [w] [h]
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
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
const [out = 'shots', seed = '3', size = 'small', secs = '20', speed = '25', vw = '1400', vh = '900'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const server = createServer(makeStaticHandler(root));
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: Number(vw), height: Number(vh) } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.stack || e.message));
await page.goto(`http://localhost:${port}/civ/?auto=1&seed=${seed}&size=${size}&speed=${speed}`);
await page.waitForFunction(() => window.annals?.mirror && window.annals.view, null, { timeout: 60000 });
const t0 = Date.now();
await page.waitForTimeout(Number(secs) * 1000);
const info = await page.evaluate(() => {
  const m = window.annals.mirror;
  return { year: m.year, realms: m.ranking().length, towns: [...m.towns.values()].filter((t) => t.alive).length, stepMs: m.stepMs, chunks: m.chunks.size };
});
console.log('after', ((Date.now() - t0) / 1000).toFixed(0), 's:', JSON.stringify(info));
await page.evaluate(() => window.annals.ui.setSpeed('0'));
await page.screenshot({ path: join(out, 'world.png') });
// Zoom to the biggest town at a few scales.
const town = await page.evaluate(() => {
  const ts = [...window.annals.mirror.towns.values()].filter((t) => t.alive).sort((a, b) => b.urban - a.urban);
  return ts[0];
});
for (const ppt of [2.5, 6, 16, 32]) {
  await page.evaluate(([x, y, p]) => {
    const v = window.annals.view;
    v.anim = null;
    v.ppt = p;
    v.cx = x + 0.5;
    v.cy = y + 0.5;
  }, [town.x, town.y, ppt]);
  await page.waitForTimeout(ppt >= 16 ? 6000 : 4000);
  // Frame times while panning slowly.
  const fps = await page.evaluate(() => new Promise((res) => {
    const v = window.annals.view;
    const times = [];
    let last = performance.now();
    const t0 = last;
    const step = (now) => {
      times.push(now - last);
      last = now;
      v.pan(2, 1);
      v.lastInput = now;
      if (now - t0 < 3000) requestAnimationFrame(step);
      else {
        times.sort((a, b) => a - b);
        res({ frames: times.length, median: +times[times.length >> 1].toFixed(1), p95: +times[Math.floor(times.length * 0.95)].toFixed(1) });
      }
    };
    requestAnimationFrame(step);
  }));
  console.log(`ppt ${ppt}:`, JSON.stringify(fps));
  await page.screenshot({ path: join(out, `town-${ppt}.png`) });
}
console.log('town', town.name, town.pop, town.urban);
await browser.close();
server.close();
