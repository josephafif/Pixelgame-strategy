// Frame-time measurement while zooming and panning, the way a player does:
// eased zoom steps (wheel, double tap), a continuous pinch, and panning,
// after the realms have grown for a while. Reports frame intervals and how
// much of each frame the renderer itself used.
// Usage: node tools/perf-zoom.mjs [desktop|phone|both]
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
const which = process.argv[2] || 'both';
const server = createServer(makeStaticHandler(root));
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch();
const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

async function run(dev) {
  const ctx = await browser.newContext(DEVICES[dev]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${dev}] page error: ${e.message}`));
  await page.goto(`${base}/client/?autostart=1&seed=7&size=medium&ais=10`);
  await page.waitForFunction(() => window.__realm?.cw?.snap, null, { timeout: 60000 });
  await page.evaluate(() => {
    const s = window.__realm.cw.init.startSites[0];
    window.__realm.transport.command({ type: 'place', x: s.x, y: s.y });
  });
  await page.waitForFunction(() => window.__realm.cw.snap.phase === 'running', null, { timeout: 30000 });
  // Let the realms grow and fight for a while.
  await page.evaluate(() => window.__realm.transport.setSpeed(8));
  await page.waitForTimeout(25000);
  await page.evaluate(() => window.__realm.transport.setSpeed(1));
  const result = await page.evaluate(async () => {
    const r = window.__realm.renderer;
    const cw = window.__realm.cw;
    const acc = { work: 0, workMax: 0, slow: 0 };
    const origFrame = r.frame.bind(r);
    r.frame = (now) => {
      const t0 = performance.now();
      origFrame(now);
      const dt = performance.now() - t0;
      acc.work += dt;
      acc.workMax = Math.max(acc.workMax, dt);
      if (dt > 12) acc.slow++;
    };
    const home = cw.snap.structures.find((s) => s.owner === cw.you) || { x: cw.W / 2, y: cw.H / 2 };
    const times = [];
    let last = performance.now();
    const frames = (n, each) => new Promise((resolve) => {
      let i = 0;
      const tick = (now) => {
        times.push(now - last);
        last = now;
        if (i >= n) return resolve();
        each(i++);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const wait = (ms) => frames(Math.round(ms / 16.7), () => {});
    r.centerOn(home.x, home.y, 2);
    await wait(300);
    // Eased zoom steps in and out, as with the wheel or a double tap.
    for (let k = 0; k < 8; k++) {
      r.zoomStep(1, r.vw / 2, r.vh / 2);
      await wait(260);
    }
    for (let k = 0; k < 8; k++) {
      r.zoomStep(-1, r.vw * 0.3, r.vh * 0.6);
      await wait(260);
    }
    // A slow pinch from the whole map down to the towns and back.
    await frames(150, (i) => r.setPpt(r.cam.ppt * (i < 75 ? 1.04 : 1 / 1.04), r.vw * 0.55, r.vh * 0.45));
    r.settle();
    await wait(250);
    // Panning at three zooms.
    for (const ppt of [3, 8, 16]) {
      r.centerOn(home.x, home.y, ppt);
      await frames(120, () => {
        r.cam.x += 18 / r.cam.ppt;
        r.cam.y += 6 / r.cam.ppt;
        r.clampCam();
      });
    }
    times.shift();
    const sorted = [...times].sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    return {
      frames: times.length,
      p50: q(0.5),
      p95: q(0.95),
      p99: q(0.99),
      max: sorted[sorted.length - 1],
      over33: times.filter((t) => t > 33).length,
      over50: times.filter((t) => t > 50).length,
      renderAvg: acc.work / times.length,
      renderMax: acc.workMax,
      renderOver12ms: acc.slow,
      structures: cw.snap.structures.length,
      claimed: Math.round((cw.snap.players.reduce((t, p) => t + p.tiles, 0) / cw.init.landTotal) * 100),
    };
  });
  const f = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);
  console.log(`${dev}: ${Object.entries(result).map(([k, v]) => `${k} ${f(v)}`).join(' · ')}`);
  await ctx.close();
}

for (const dev of which === 'both' ? ['desktop', 'phone'] : [which]) await run(dev);
await browser.close();
server.close();
