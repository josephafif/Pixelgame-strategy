// Frame times on a phone profile (390×844 at 3x, CPU slowed down) in a
// realistic mid-game: a match is played headless for a while (player 0 as an
// AI, then handed to the human), loaded in the browser as a saved realm, and
// measured at several zooms, still and panning. Reports frames per second,
// frame intervals, the renderer's own time and draw calls per frame.
// Usage: node tools/perf-mobile.mjs [size=large] [minutes=10] [throttle=4] [dpr=2|auto]
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeStaticHandler } from '../server/static.js';
import { Match } from '../engine/sim/match.js';
import { saveMatch, describeSave } from '../engine/sim/persist.js';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs'));
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [size = 'large', minutes = '10', throttle = '4', dpr = '2'] = process.argv.slice(2);
const AIS = { small: 6, medium: 10, large: 15, huge: 23 };

const t0 = performance.now();
const players = Array.from({ length: (AIS[size] || 15) + 1 }, (_, i) => ({ ai: true, name: i === 0 ? 'Tester' : undefined, personality: ['builder', 'merchant', 'warlord'][i % 3] }));
const m = new Match({ seed: 11, size, placementTime: 0.2, timeLimit: 60 * 60, players });
for (let i = 0; i < Number(minutes) * 600; i++) m.step();
m.state.players[0].ai = false;
const data = saveMatch(m);
const save = JSON.stringify({ data, info: describeSave(data) });
console.log(`${size}: ${minutes} min played in ${((performance.now() - t0) / 1000).toFixed(0)} s; ${m.state.squads.length} squads, ${m.state.structures.length} towns/ports/outposts`);

const server = createServer(makeStaticHandler(root));
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript((s) => {
  if (window.sessionStorage.getItem('seeded')) return;
  const { data: d, info } = JSON.parse(s);
  window.localStorage.setItem('realmwright:save:single', JSON.stringify(d));
  window.localStorage.setItem('realmwright:save:single:info', JSON.stringify({ ...info, at: Date.now() }));
  window.sessionStorage.setItem('seeded', '1');
}, save);
await page.goto(`http://localhost:${server.address().port}/client/${dpr === 'auto' ? '' : `?dpr=${dpr}`}`);
await page.click('[data-go="continue"]');
await page.waitForFunction(() => window.__realm?.cw?.snap?.phase === 'running' && window.__realm.renderer, null, { timeout: 120000 });
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(throttle) });
await page.evaluate(() => {
  const s = window.__realm;
  const P = (window.__perf = { frames: [], render: 0, n: 0, draws: 0 });
  const c2d = s.renderer.ctx;
  const draw = c2d.drawImage.bind(c2d);
  c2d.drawImage = (...a) => {
    P.draws++;
    return draw(...a);
  };
  const frame = s.renderer.frame.bind(s.renderer);
  s.renderer.frame = (now) => {
    const a = performance.now();
    frame(now);
    P.render += performance.now() - a;
    P.n++;
  };
  let last = 0;
  const tick = (t) => {
    if (last) P.frames.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

async function scenario(name, setup, pan = null) {
  await page.evaluate(setup);
  await page.waitForTimeout(1500);
  await page.evaluate(() => Object.assign(window.__perf, { frames: [], render: 0, n: 0, draws: 0 }));
  const start = Date.now();
  while (Date.now() - start < 5000) {
    if (pan) await page.evaluate(pan);
    await page.waitForTimeout(50);
  }
  const r = await page.evaluate(() => {
    const P = window.__perf;
    const f = [...P.frames].sort((a, b) => a - b);
    const q = (p) => f[Math.min(f.length - 1, Math.floor(f.length * p))] || 0;
    const avg = P.frames.reduce((a, b) => a + b, 0) / Math.max(1, P.frames.length);
    return `fps ${(1000 / avg).toFixed(0).padStart(2)} · p50 ${q(0.5).toFixed(1)} · p95 ${q(0.95).toFixed(1)} ms · render ${(P.render / Math.max(1, P.n)).toFixed(1)} ms · ${Math.round(P.draws / Math.max(1, P.n))} draws/frame · dpr ${window.__realm.renderer.dpr}`;
  });
  console.log(`${name.padEnd(10)} ${r}`);
}
const home = await page.evaluate(() => {
  const cw = window.__realm.cw;
  const s = cw.snap.structures.find((q) => q.owner === cw.you && q.capital) || cw.snap.structures.find((q) => q.owner === cw.you);
  return { x: s.x, y: s.y };
});
const at = (ppt) => `(() => { const r = window.__realm.renderer; r.anim = null; r.centerOn(${home.x}, ${home.y}, ${ppt}); })()`;
await scenario('whole', () => {
  const r = window.__realm.renderer;
  r.anim = null;
  r.centerOn(r.cw.W / 2, r.cw.H / 2, r.minPpt);
});
for (const ppt of [2, 3, 6, 8, 16, 24]) await scenario(`ppt ${ppt}`, at(ppt));
await scenario('pan 4', at(4), () => {
  const r = window.__realm.renderer;
  r.cam.x += 1.2;
  r.clampCam();
});
await scenario('pan 8', at(8), () => {
  const r = window.__realm.renderer;
  r.cam.y += 0.6;
  r.clampCam();
});
console.log(errors.length ? `errors: ${errors.slice(0, 5).join(' | ')}` : 'no page errors');
await browser.close();
server.close();
