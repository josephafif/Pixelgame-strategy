// Reproducible settlement scenarios rendered with the game's renderer.
// ?seed=1&sites=0,1,2&houses=40&stage=3&walls=2&scale=1&view=34
// or ?seed=1&styles=farm,timber,... to pick sites by architectural style.
import { generateWorld, WORLD_SIZES } from '../../engine/world/worldgen.js';
import { pickStartSites, pickTradeHubs, canFoundAt } from '../../engine/world/sites.js';
import { styleForSite } from '../../engine/settlement/styles.js';
import { growDemo } from '../../engine/settlement/demo.js';
import { validateLayout } from '../../engine/settlement/validate.js';
import { renderChunk, CHUNK, TILE } from '../render/ground.js';
import { makeOverlays, restampArea, renderSettlementLayer } from '../render/settlement-layer.js';

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed') || 1);
const world = generateWorld({ seed, ...WORLD_SIZES[q.get('size') || 'medium'] });
const houses = Number(q.get('houses') || 40);
const stage = Number(q.get('stage') || 3);
const walls = Number(q.get('walls') || 0);
const scale = Number(q.get('scale') || 1);
const view = Number(q.get('view') || 36);
const kind = q.get('kind') || 'capital';

function findStyleSite(style) {
  for (let y = 30; y < world.height - 30; y += 3) {
    for (let x = 30; x < world.width - 30; x += 3) {
      if (!canFoundAt(world, x, y) || styleForSite(world, x, y) !== style) continue;
      let ok = 0;
      for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) if (canFoundAt(world, x + dx, y + dy)) ok++;
      if (ok >= 90) return { x, y, title: style };
    }
  }
  return null;
}

const sites = [];
if (q.get('styles')) {
  for (const st of q.get('styles').split(',')) {
    const s = findStyleSite(st);
    if (s) sites.push(s);
  }
} else {
  const all = pickStartSites(world, 10, pickTradeHubs(world, 3));
  for (const k of (q.get('sites') || '0').split(',')) sites.push(all[Number(k)]);
}

const ov = makeOverlays(world);
const layouts = [];
const report = [];
for (const site of sites) {
  const t0 = performance.now();
  const { L, failures } = growDemo(world, site, { houses, stage, walls, kind });
  const ms = performance.now() - t0;
  const v = validateLayout(world, L);
  layouts.push(L);
  report.push(`${site.title}/${L.style}: ${L.buildings.length} buildings, valid=${v.ok}${v.ok ? '' : ' ' + JSON.stringify(v.errors.slice(0, 3))}, ${ms.toFixed(0)}ms${failures.length ? ' fail:' + failures.join(',') : ''}`);
}
for (const L of layouts) restampArea(world, ov, layouts, L.ox, L.oy, L.ox + 48, L.oy + 48);

const chunkCache = new Map();
function chunk(kx, ky) {
  const k = kx + ',' + ky;
  if (!chunkCache.has(k)) chunkCache.set(k, renderChunk(world, kx, ky, ov));
  return chunkCache.get(k);
}

const grid = document.getElementById('grid');
layouts.forEach((L, idx) => {
  const x0 = L.cx - (view >> 1);
  const y0 = L.cy - (view >> 1);
  const cv = document.createElement('canvas');
  cv.width = view * TILE * scale;
  cv.height = view * TILE * scale;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.scale(scale, scale);
  for (let ky = Math.floor(y0 / CHUNK); ky <= Math.floor((y0 + view) / CHUNK); ky++) {
    for (let kx = Math.floor(x0 / CHUNK); kx <= Math.floor((x0 + view) / CHUNK); kx++) {
      ctx.drawImage(chunk(kx, ky), (kx * CHUNK - x0) * TILE, (ky * CHUNK - y0) * TILE);
    }
  }
  const layer = renderSettlementLayer(world, L, { color: ['#d23c3c', '#3a68d8', '#e6b422', '#8e44c4'][idx % 4] });
  ctx.drawImage(layer.canvas, layer.px - x0 * TILE, layer.py - y0 * TILE);
  const cell = document.createElement('div');
  cell.className = 'cell';
  cell.appendChild(cv);
  const cap = document.createElement('div');
  cap.className = 'cap';
  cap.textContent = report[idx];
  cell.appendChild(cap);
  grid.appendChild(cell);
});
document.getElementById('info').textContent = `seed ${seed}: ${report.length} settlements`;
window.__report = report;
window.__done = true;
