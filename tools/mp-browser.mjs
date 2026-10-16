// Two browser clients play a multiplayer match on a local server.
// Usage: node tools/mp-browser.mjs outDir
import { mkdirSync } from 'node:fs';
import { createGameServer } from '../server/index.js';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs'));
}
const out = process.argv[2] || 'mp-shots';
mkdirSync(out, { recursive: true });
const srv = createGameServer({ log: (...a) => console.log('[server]', ...a) });
const port = await srv.listen(0, '127.0.0.1');
const browser = await chromium.launch();
const open = async (name) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.log(`[${name} pageerror]`, e.stack || e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[${name} console]`, m.text()); });
  await page.goto(`http://127.0.0.1:${port}/client/`);
  await page.click('text=Multiplayer');
  await page.fill('#f-name', name);
  return page;
};
const a = await open('Aster');
await a.click('text=Create room');
await a.waitForSelector('text=Room ');
const code = (await a.textContent('#modal h2')).replace('Room', '').trim();
console.log('room code', code);
const b = await open('Brann');
await b.fill('#f-code', code);
await b.click('text=Join room');
await a.waitForFunction(() => document.querySelectorAll('#modal table tr').length >= 3);
await a.fill('#o-ais', '2');
await a.fill('#o-place', '20');
await a.fill('#o-seed', '4242');
await a.selectOption('#o-size', 'small');
await a.screenshot({ path: `${out}/01-lobby.png` });
await a.click('text=Start match');
for (const p of [a, b]) await p.waitForFunction(() => window.__realm && window.__realm.cw && window.__realm.cw.snap, null, { timeout: 60000 });
await a.waitForTimeout(1000);
await b.screenshot({ path: `${out}/02-placement-b.png` });
// Each picks a different suggested site.
await a.evaluate(() => { const s = window.__realm.cw.init.startSites[0]; window.__realm.transport.command({ type: 'place', x: s.x, y: s.y }); });
await b.evaluate(() => { const sites = window.__realm.cw.init.startSites; const s0 = sites[0]; const s = sites.find((q) => Math.hypot(q.x - s0.x, q.y - s0.y) > 40) || sites[3]; window.__realm.transport.command({ type: 'place', x: s.x, y: s.y }); });
for (const p of [a, b]) await p.waitForFunction(() => window.__realm.cw.snap.phase === 'running', null, { timeout: 60000 });
await a.waitForTimeout(3000);
await a.screenshot({ path: `${out}/03-running-a.png` });
await b.screenshot({ path: `${out}/04-running-b.png` });
const sa = await a.evaluate(() => ({ you: window.__realm.cw.you, tick: window.__realm.cw.snap.tick, players: window.__realm.cw.snap.players.map((k) => k.name) }));
const sb = await b.evaluate(() => ({ you: window.__realm.cw.you, tick: window.__realm.cw.snap.tick, players: window.__realm.cw.snap.players.map((k) => k.name) }));
console.log(JSON.stringify(sa), JSON.stringify(sb));
await browser.close();
await srv.close();
