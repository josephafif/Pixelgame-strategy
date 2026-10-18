// Turns settlement layouts into render data:
//  - ground overlays (roads, plazas, fields, gardens, yards, cleared trees)
//    stamped into world-sized arrays that the chunk renderer reads
//  - a pre-rendered canvas with buildings, decoration, walls, piers and
//    fences, y-sorted, rebuilt only when the layout's version changes.

import { N, O } from '../../engine/settlement/terrain.js';
import { ROAD } from '../../engine/settlement/kinds.js';
import { layoutBounds } from '../../engine/settlement/planner.js';
import { B } from '../../engine/world/biomes.js';
import { G, RC, cropIndex, TILE } from './ground.js';
import { buildingSprite } from './buildings.js';
import { decorSprite, wallSprite, gateSprite, boatSprite } from './decor.js';
import { makeCanvas } from './pix.js';
import { ROADS } from './palette.js';

const GROUND_DECOR = { veg: G.VEG, flowers: G.FLOWERS, yardtree: G.YARD, herbbed: G.YARD_EARTH };

export function makeOverlays(world) {
  const n = world.width * world.height;
  return {
    road: new Uint8Array(n),
    ground: new Uint8Array(n),
    crop: new Uint8Array(n),
    cleared: new Uint8Array(n),
    worldRoad: new Uint8Array(n), // kingdom roads (1 dirt, 2 paved)
  };
}

function roadCode(L, cls, b) {
  if (b === B.MARSH && (cls !== ROAD.MAIN || L.style === 'stilt')) return RC.PLANK;
  if (L.style === 'stilt' && cls !== ROAD.MAIN) return RC.PLANK;
  if (cls === ROAD.PATH) return RC.PATH;
  if (cls === ROAD.MAIN) return L.stage >= 3 ? RC.COBBLE : L.style === 'adobe' ? RC.SAND : RC.DIRT;
  if (L.stage >= 4) return RC.COBBLE;
  return L.style === 'adobe' ? RC.SAND : RC.STREET;
}

/** Write one layout's ground data into the overlays. */
export function stampLayout(world, ov, L) {
  const W = world.width;
  const H = world.height;
  const put = (arr, x, y, v) => {
    if (x >= 0 && y >= 0 && x < W && y < H) arr[y * W + x] = v;
  };
  for (let ly = 0; ly < N; ly++) {
    for (let lx = 0; lx < N; lx++) {
      const l = ly * N + lx;
      const o = L.occ[l];
      if (o === O.FREE || o === O.APRON || o === O.RESERVE) continue;
      const x = L.ox + lx;
      const y = L.oy + ly;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      if (o === O.ROAD && L.road[l]) ov.road[i] = roadCode(L, L.road[l], world.biome[i]);
      if (o === O.PLAZA) ov.ground[i] = L.stage >= 2 ? G.PLAZA_PAVED : G.PLAZA_EARTH;
      if (o === O.BUILDING || o === O.DECOR) ov.ground[i] = ov.ground[i] || G.YARD_EARTH;
      ov.cleared[i] = 1;
    }
  }
  for (const d of L.decor) {
    const g = GROUND_DECOR[d.k];
    if (g) put(ov.ground, d.x, d.y, g);
  }
  for (const f of L.fields) {
    const code = cropIndex(f.crop) | (f.h > f.w ? 16 : 0);
    for (let y = f.y; y < f.y + f.h; y++) {
      for (let x = f.x; x < f.x + f.w; x++) {
        put(ov.ground, x, y, G.FIELD);
        put(ov.crop, x, y, code);
      }
    }
  }
  // Clear trees in a one-tile margin around buildings and walls.
  const margin = (x0, y0, w, h) => {
    for (let y = y0 - 1; y <= y0 + h; y++) for (let x = x0 - 1; x <= x0 + w; x++) put(ov.cleared, x, y, 1);
  };
  for (const b of L.buildings) margin(b.x, b.y, b.w, b.h);
  if (L.walls) for (const [x, y] of L.walls.cells) margin(x, y, 1, 1);
}

/**
 * Rebuild overlays inside a world rectangle from all layouts touching it
 * plus kingdom roads. Returns the rectangle.
 */
export function restampArea(world, ov, layouts, x0, y0, x1, y1) {
  const W = world.width;
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(W - 1, x1);
  y1 = Math.min(world.height - 1, y1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      ov.road[i] = ov.worldRoad[i] === 2 ? RC.COBBLE : ov.worldRoad[i] ? (world.biome[i] === B.MARSH ? RC.PLANK : RC.DIRT) : 0;
      ov.ground[i] = 0;
      ov.crop[i] = 0;
      ov.cleared[i] = ov.worldRoad[i] ? 1 : 0;
    }
  }
  for (const L of layouts) {
    if (L.ox > x1 || L.oy > y1 || L.ox + N < x0 || L.oy + N < y0) continue;
    stampLayout(world, ov, L);
  }
  return { x0, y0, x1, y1 };
}

function shadowRect(ctx, x, y, w, h) {
  ctx.fillRect(x, y, w, h);
}

/**
 * Pre-render a settlement's standing structures. Returns
 * { canvas, px, py } where (px, py) is the canvas' world-pixel origin.
 */
export function renderSettlementLayer(world, L, { color = '#c83a3a' } = {}) {
  const bb = layoutBounds(L);
  const tx0 = bb.x - 1;
  const ty0 = bb.y - 3;
  const tw = bb.w + 2;
  const th = bb.h + 4;
  const PX = tx0 * TILE;
  const PY = ty0 * TILE;
  const canvas = makeCanvas(tw * TILE, th * TILE);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Piers (flat, over water) and boats.
  for (const d of L.docks) {
    const horiz = d.dir === 0 || d.dir === 1;
    for (const [x, y] of d.cells) {
      const px = x * TILE - PX;
      const py = y * TILE - PY;
      ctx.fillStyle = ROADS.plank.edge;
      if (horiz) ctx.fillRect(px, py + 3, 16, 10);
      else ctx.fillRect(px + 3, py, 10, 16);
      ctx.fillStyle = ROADS.plank.base;
      if (horiz) for (let k = 0; k < 16; k += 3) ctx.fillRect(px + k, py + 4, 2, 8);
      else for (let k = 0; k < 16; k += 3) ctx.fillRect(px + 4, py + k, 8, 2);
      ctx.fillStyle = ROADS.plank.dark;
      if (horiz) {
        ctx.fillRect(px, py + 12, 16, 1);
        ctx.fillRect(px + 1, py + 13, 2, 2);
        ctx.fillRect(px + 12, py + 13, 2, 2);
      } else {
        ctx.fillRect(px + 12, py, 1, 16);
      }
    }
    const [ex, ey] = d.cells[d.cells.length - 1];
    const boat = boatSprite(d.id % 2);
    const bx = ex * TILE + (horiz ? 0 : 12) - PX;
    const by = ey * TILE + (horiz ? 12 : 2) - PY;
    ctx.drawImage(boat.canvas, bx - 1, by);
  }

  // Field fences.
  ctx.fillStyle = '#7a5632';
  for (const f of L.fields) {
    const x0 = f.x * TILE - PX;
    const y0 = f.y * TILE - PY;
    const w = f.w * TILE;
    const h = f.h * TILE;
    ctx.fillStyle = '#8f6a3e';
    ctx.fillRect(x0, y0 - 1, w, 1);
    ctx.fillRect(x0, y0 + h - 2, w, 1);
    ctx.fillRect(x0, y0, 1, h - 1);
    ctx.fillRect(x0 + w - 1, y0, 1, h - 1);
    ctx.fillStyle = '#5a3e24';
    for (let x = 0; x < w; x += 6) {
      ctx.fillRect(x0 + x, y0 - 3, 1, 3);
      ctx.fillRect(x0 + x, y0 + h - 4, 1, 4);
    }
    for (let y = 0; y < h; y += 6) {
      ctx.fillRect(x0, y0 + y - 2, 1, 3);
      ctx.fillRect(x0 + w - 1, y0 + y - 2, 1, 3);
    }
  }

  // Standing items, y-sorted by their base line.
  const items = [];
  const style = L.style;
  for (const b of L.buildings) {
    const spr = buildingSprite(b, style, color);
    items.push({ y: (b.y + b.h) * TILE, x: b.x * TILE, draw: () => ctx.drawImage(spr.canvas, b.x * TILE - spr.ox - PX, b.y * TILE - spr.oy - PY), shadow: [b.x * TILE + 2 - PX, (b.y + b.h) * TILE - 3 - PY, b.w * TILE + 1, 4] });
  }
  for (const d of L.decor) {
    if (GROUND_DECOR[d.k] && d.k !== 'yardtree') continue;
    const spr = decorSprite(d.k, color, style);
    const ax = d.x * TILE + 8;
    const ay = (d.y + 1) * TILE - 1;
    items.push({ y: ay, x: ax, draw: () => ctx.drawImage(spr.canvas, Math.round(ax - spr.w / 2) - PX, ay - spr.h + 1 + (d.plaza ? 0 : 1) - PY) });
  }
  if (L.walls) {
    const lvl = L.walls.level;
    const key = (x, y) => `${x},${y}`;
    const wallSet = new Set(L.walls.cells.map(([x, y]) => key(x, y)));
    const gateSet = new Set(L.walls.gates.map(([x, y]) => key(x, y)));
    const has = (x, y) => wallSet.has(key(x, y)) || gateSet.has(key(x, y));
    for (const [x, y] of L.walls.cells) {
      const n = has(x, y - 1);
      const e = has(x + 1, y);
      const s = has(x, y + 1);
      const w = has(x - 1, y);
      const corner = (n || s) && (e || w);
      const tower = corner || ((x * 7 + y * 3) % 9 === 0 && lvl >= 2);
      const spr = wallSprite(lvl, n, e, s, w, tower, style);
      items.push({ y: (y + 1) * TILE - 1, x: x * TILE, draw: () => ctx.drawImage(spr.canvas, x * TILE - 1 - PX, y * TILE - 17 - PY) });
    }
    for (const [x, y] of L.walls.gates) {
      const horizontal = wallSet.has(key(x - 1, y)) || wallSet.has(key(x + 1, y));
      const spr = gateSprite(lvl, horizontal, style);
      items.push({ y: (y + 1) * TILE - 1, x: x * TILE, draw: () => ctx.drawImage(spr.canvas, x * TILE - 1 - PX, (y + 1) * TILE - 1 - 34 - PY) });
    }
  }
  ctx.fillStyle = 'rgba(43,29,38,0.3)';
  for (const it of items) if (it.shadow) shadowRect(ctx, ...it.shadow);
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const it of items) it.draw();
  return { canvas, px: PX, py: PY, v: L.v };
}
