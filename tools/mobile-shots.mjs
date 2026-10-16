// Screenshots of every menu and panel on a phone (touch emulation), portrait
// and landscape, plus a desktop reference. Taps go through real touch events.
// Usage: node tools/mobile-shots.mjs outDir [portrait|landscape|desktop|all]
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
  // Locators re-resolve the element, so a panel redraw between finding and tapping is harmless.
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible', timeout: 10000 });
  try {
    if (DEVICES[page.__dev].hasTouch) await el.tap({ timeout: 10000 });
    else await el.click({ timeout: 10000 });
  } catch (e) {
    throw new Error(`${page.__dev}: could not tap ${selector}: ${e.message.split('\n')[0]}`);
  }
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
  // A game, started the same way a player would.
  await tap(page, '[data-go="single"]');
  await page.fill('#f-seed', '7');
  await page.selectOption('#f-size', 'small');
  await tap(page, '[data-go="start-single"]');
  await page.waitForFunction(() => window.__realm?.cw?.snap, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await shoot(page, `${dev}-05-placement`);
  await tap(page, '[data-act="site"]');
  await page.waitForTimeout(800);
  await shoot(page, `${dev}-06-placement-site`);
  await tap(page, '[data-act="place"]');
  await page.waitForFunction(() => window.__realm.cw.snap.phase === 'running', null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await shoot(page, `${dev}-07-town`);
  // Realm tabs: the bottom bar on phones, the tab strip on desktop.
  for (const [i, tab] of ['realm', 'trade', 'diplomacy', 'chronicle'].entries()) {
    const sel = await page.evaluate((t) => {
      for (const q of [`[data-dock="${t}"]`, `[data-tab="${t}"]`]) {
        const b = document.querySelector(q);
        if (b && b.offsetParent) return q;
      }
      return null;
    }, tab);
    if (!sel) continue;
    await tap(page, sel);
    await shoot(page, `${dev}-${String(8 + i).padStart(2, '0')}-${tab}`);
  }
  // Back to the town, with a section opened.
  if (await page.evaluate(() => !!document.querySelector('[data-dock="town"]')?.offsetParent)) {
    await tap(page, '[data-dock="town"]');
    await shoot(page, `${dev}-13-town-again`);
    await tap(page, '#left [data-grip]');
    await shoot(page, `${dev}-14-town-full`);
    await tap(page, '[data-act="mode-road"]');
    await shoot(page, `${dev}-15-road-mode`);
    const box = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    await page.touchscreen.tap(Math.round(box.w * 0.3), Math.round(box.h * 0.35));
    await shoot(page, `${dev}-16-road-preview`);
    await tap(page, '[data-hint="cancel"]');
  }
  // In-game menu.
  await tap(page, '#btn-menu');
  await shoot(page, `${dev}-12-menu`);
  await ctx.close();
}

for (const dev of which === 'all' ? Object.keys(DEVICES) : [which]) await run(dev);
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
server.close();
