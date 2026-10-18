// Screenshots of every menu and HUD state on a phone (touch emulation),
// portrait and landscape, plus a desktop reference. Taps go through real
// touch events. Usage: node tools/mobile-shots.mjs outDir [portrait|landscape|desktop|all]
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
const out = process.argv[2] || 'mobile-shots';
const which = process.argv[3] || 'all';
mkdirSync(out, { recursive: true });
const server = createServer(makeStaticHandler(root));
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch();
const errors = [];

const DEVICES = {
  portrait: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  landscape: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 } },
};

async function shoot(page, name) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/${name}.png` });
}

async function tap(page, selector) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible', timeout: 10000 });
  try {
    if (DEVICES[page.__dev].hasTouch) await el.tap({ timeout: 10000 });
    else await el.click({ timeout: 10000 });
  } catch (e) {
    throw new Error(`${page.__dev}: could not tap ${selector}: ${e.message.split('\n')[0]}`);
  }
}

/** Tap (or click) the map at a tile. */
async function tapTile(page, x, y) {
  const p = await page.evaluate(([tx, ty]) => window.__realm.renderer.tileToScreen(tx + 0.5, ty + 0.5), [x, y]);
  if (DEVICES[page.__dev].hasTouch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

/** Long-press (or right-click) the map at a tile. */
async function holdTile(page, x, y) {
  const p = await page.evaluate(([tx, ty]) => window.__realm.renderer.tileToScreen(tx + 0.5, ty + 0.5), [x, y]);
  if (!DEVICES[page.__dev].hasTouch) {
    await page.mouse.click(p.x, p.y, { button: 'right' });
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
  await page.waitForTimeout(650);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function run(dev) {
  const ctx = await browser.newContext(DEVICES[dev]);
  const page = await ctx.newPage();
  page.__dev = dev;
  page.on('pageerror', (e) => errors.push(`${dev}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${dev}: ${m.text()}`));
  await page.goto(`${base}/client/`);
  await page.waitForSelector('[data-go="single"]');
  await shoot(page, `${dev}-01-title`);
  await tap(page, '[data-go="single"]');
  await shoot(page, `${dev}-02-new-realm`);
  await tap(page, '[data-go="title"]');
  await tap(page, '[data-go="help"]');
  await shoot(page, `${dev}-03-help`);
  await tap(page, '[data-go="title"]');
  await tap(page, '[data-go="multi"]');
  await shoot(page, `${dev}-04-multiplayer`);
  await tap(page, '[data-go="title"]');
  // A game, started the way a player would.
  await tap(page, '[data-go="single"]');
  await page.fill('#f-seed', '7');
  await page.selectOption('#f-size', 'small');
  await page.selectOption('#f-ais', '6');
  await tap(page, '[data-go="start-single"]');
  await page.waitForFunction(() => window.__realm?.cw?.snap, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await shoot(page, `${dev}-05-choose-start`);
  const site = await page.evaluate(() => {
    const s = window.__realm.cw.init.startSites[0];
    window.__realm.renderer.flyTo(s.x, s.y);
    return s;
  });
  await page.waitForTimeout(600);
  await tapTile(page, site.x, site.y);
  await shoot(page, `${dev}-06-start-here`);
  await tap(page, '[data-spawn="go"]');
  await page.waitForFunction(() => window.__realm.cw.snap.phase === 'running', null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await shoot(page, `${dev}-07-running`);
  // Send riders onto the empty land next to us: pick the card, then tap where they go.
  const edge = await page.evaluate(() => {
    const cw = window.__realm.cw;
    for (let i = 0; i < cw.owner.length; i++) {
      if (cw.owner[i] !== -1 || !cw.land[i]) continue;
      const x = i % cw.W;
      if (cw.owner[i + 4] === cw.you || cw.owner[i - 4] === cw.you) return { x, y: (i / cw.W) | 0 };
    }
    return null;
  });
  await tap(page, '[data-unit="rider"]');
  await shoot(page, `${dev}-08a-armed`);
  await tapTile(page, edge.x, edge.y);
  await tap(page, '[data-unit="rider"]');
  await page.waitForTimeout(3000);
  await shoot(page, `${dev}-08-riders`);
  await tap(page, '#btn-board');
  await shoot(page, `${dev}-09-leaderboard`);
  await tap(page, '#btn-board');
  // A long press on a rival opens the small menu.
  await page.evaluate(() => window.__realm.transport.setSpeed(4));
  await page.waitForTimeout(8000);
  await page.evaluate(() => window.__realm.transport.setSpeed(1));
  const rival = await page.evaluate(() => {
    const cw = window.__realm.cw;
    const spot = cw.snap.labels.find((l, k) => l && k !== cw.you);
    window.__realm.renderer.centerOn(spot[0], spot[1], 4);
    return { x: spot[0], y: spot[1] };
  });
  await page.waitForTimeout(400);
  await holdTile(page, rival.x, rival.y);
  await shoot(page, `${dev}-10-rival-menu`);
  await tapTile(page, rival.x + 3, rival.y + 3);
  await page.evaluate(() => window.__realm.ui.closePopup());
  // Our own town: zoomed in, with its menu.
  const home = await page.evaluate(() => {
    const cw = window.__realm.cw;
    const s = cw.snap.structures.find((q) => q.owner === cw.you);
    window.__realm.renderer.centerOn(s.x, s.y, 16);
    return { x: s.x, y: s.y };
  });
  await page.waitForTimeout(2500);
  await holdTile(page, home.x, home.y);
  await shoot(page, `${dev}-11-town-menu`);
  await page.evaluate(() => window.__realm.ui.closePopup());
  await tap(page, '[data-build="town"]');
  await shoot(page, `${dev}-12-build-mode`);
  await tap(page, '[data-hint="cancel"]');
  await tap(page, '#btn-menu');
  await shoot(page, `${dev}-13-menu`);
  await ctx.close();
}

for (const dev of which === 'all' ? Object.keys(DEVICES) : [which]) await run(dev);
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
server.close();
