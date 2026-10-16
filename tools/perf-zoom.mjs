// Frame-time measurement while zooming and panning, the way a player does.
// Plays a few minutes at high speed so towns exist, then runs a fixed camera
// script and reports frame times and where the time went.
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
  await page.goto(`${base}/client/?autostart=1&seed=7&size=medium&ais=4`);
  await page.waitForFunction(() => window.__realm?.cw?.snap, null, { timeout: 60000 });
  await page.evaluate(() => {
    const s = window.__realm.cw.init.startSites[0];
    window.__realm.transport.command({ type: 'place', x: s.x, y: s.y });
  });
  await page.waitForFunction(() => window.__realm.cw.snap.phase === 'running', null, { timeout: 30000 });
  // Let the realms grow for a while.
  await page.evaluate(() => window.__realm.transport.setSpeed(8));
  await page.waitForTimeout(25000);
  const result = await page.evaluate(async () => {
    const r = window.__realm.renderer;
    const cw = window.__realm.cw;
    const acc = { chunk: 0, chunkBuilt: 0, layer: 0, layerBuilt: 0, frame: 0 };
    const wrap = (name, countKey) => {
      const orig = r[name].bind(r);
      r[name] = (...a) => {
        const t0 = performance.now();
        const before = name === 'chunk' ? r.chunks.size : r.layers.size;
        const res = orig(...a);
        acc[name] += performance.now() - t0;
        if ((name === 'chunk' ? r.chunks.size : r.layers.size) !== before || (name === 'chunk' && cw.dirtyChunks.size === 0 && false)) acc[countKey]++;
        return res;
      };
    };
    wrap('chunk', 'chunkBuilt');
    wrap('layer', 'layerBuilt');
    const origFrame = r.frame.bind(r);
    acc.frameMax = 0;
    acc.slowWork = 0;
    r.frame = (now) => {
      const t0 = performance.now();
      origFrame(now);
      const dt = performance.now() - t0;
      acc.frame += dt;
      acc.frameMax = Math.max(acc.frameMax, dt);
      if (dt > 16) acc.slowWork++;
    };
    // Camera script: start at the capital, zoom out step by step, pan across
    // the map, zoom in somewhere else, pan, zoom out again.
    const cap = cw.settlement(cw.me.capital);
    const steps = [];
    const at = (x, y, ppt) => steps.push({ x, y, ppt });
    const pan = (x0, y0, x1, y1, ppt, n) => {
      for (let k = 0; k <= n; k++) at(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, ppt);
    };
    for (const ppt of [32, 24, 16, 12, 8, 6, 4, 3]) for (let k = 0; k < 8; k++) at(cap.x, cap.y, ppt);
    pan(cap.x, cap.y, cw.W * 0.75, cw.H * 0.5, 16, 90);
    for (const ppt of [12, 8, 12, 16, 24, 32]) for (let k = 0; k < 8; k++) at(cw.W * 0.75, cw.H * 0.5, ppt);
    pan(cw.W * 0.75, cw.H * 0.5, cw.W * 0.25, cw.H * 0.3, 12, 90);
    pan(cw.W * 0.25, cw.H * 0.3, cw.W * 0.4, cw.H * 0.7, 8, 60);
    const times = [];
    let last = performance.now();
    await new Promise((resolve) => {
      let i = 0;
      const tick = (now) => {
        times.push(now - last);
        last = now;
        if (i >= steps.length) return resolve();
        const s = steps[i++];
        r.centerOn(s.x, s.y, s.ppt);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    times.shift();
    const sorted = [...times].sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    return {
      frames: times.length,
      p50: q(0.5),
      p95: q(0.95),
      max: sorted[sorted.length - 1],
      over33: times.filter((t) => t > 33).length,
      over50: times.filter((t) => t > 50).length,
      over100: times.filter((t) => t > 100).length,
      totalMs: times.reduce((a, b) => a + b, 0),
      frameWork: acc.frame,
      frameWorkMax: acc.frameMax,
      framesOver16msWork: acc.slowWork,
      chunkMs: acc.chunk,
      chunksBuilt: acc.chunkBuilt,
      layerMs: acc.layer,
      layersBuilt: acc.layerBuilt,
      settlements: cw.snap.settlements.length,
    };
  });
  const f = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);
  console.log(`${dev}: ${Object.entries(result).map(([k, v]) => `${k} ${f(v)}`).join(' · ')}`);
  await ctx.close();
}

for (const dev of which === 'both' ? ['desktop', 'phone'] : [which]) await run(dev);
await browser.close();
server.close();
