// Paints one map chunk (32×32 tiles, 512×512 px): the terrain, then the
// town grid over it (streets, squares, fields, piers, trodden yards), then
// trees and buildings sorted from back to front with their shadows. The
// terrain without trees is the costly part and is kept per chunk.

import { renderChunk, TILE, CHUNK } from '../../client/render/ground.js';
import { natureSprite } from '../../client/render/nature.js';
import { makeCanvas } from '../../client/render/pix.js';
import { ROADS, CROPS } from '../../client/render/palette.js';
import { rgb, mix } from '../../client/render/color.js';
import { B, TREE_FEATURES } from '../../engine/world/biomes.js';
import { C, RD, CROP_KEYS, CHUNK_CELLS } from '../../engine/civ/town.js';
import { CLIMATE_KEYS } from '../../engine/civ/world.js';
import { buildingSprite, CELL } from './buildings.js';

const S = CHUNK * TILE;
const SHADOW_ALPHA = 0.36;
const BASES_MAX = 40;

function pack(c, a = 255) {
  const [r, g, b] = rgb(c);
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

const P = {};
function pc(c) {
  let v = P[c];
  if (v === undefined) v = P[c] = pack(c);
  return v;
}

function h2(x, y) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}

const DIRT = { base: '#b89a6a', dark: '#9e8159', light: '#c9ae80', edge: '#8a6f4e' };
const SAND = ROADS.sand;
const COBBLE = { base: '#a8a197', dark: '#837b73', light: '#c4bdb2', mortar: '#6e6660', edge: '#625a55' };
const PLANK = ROADS.plank;
const RAIL = { bed: '#857c72', bedDark: '#6c645c', sleeper: '#5a3f2a', rail: '#4a4a52', shine: '#a8a8b0' };
const YARD = { base: '#8d9a5c', dark: '#7a874f', earth: '#a08a62', earthDark: '#8a7552' };
const HEDGE = ['#4f6e34', '#5e7e3c', '#3f5a2c'];

export class Painter {
  constructor(world) {
    this.world = world;
    const n = world.width * world.height;
    const zero = new Uint8Array(n);
    this.ov = { road: zero, ground: zero, crop: zero, cleared: zero };
    this.bases = new Map();
    const th = world.thresholds;
    this.snowLine = th ? th.mountT + (th.peakT - th.mountT) * 0.65 : Infinity;
  }

  /** Terrain without trees for chunk (kx, ky), cached. */
  base(kx, ky) {
    const k = ky * 1000 + kx;
    let b = this.bases.get(k);
    if (b) {
      this.bases.delete(k);
      this.bases.set(k, b);
      return b;
    }
    b = renderChunk(this.world, kx, ky, this.ov, { noObjects: true });
    this.bases.set(k, b);
    if (this.bases.size > BASES_MAX) this.bases.delete(this.bases.keys().next().value);
    return b;
  }

  /**
   * data: { cells: Map(chunkKey -> { cell, aux, cleared }) for this chunk
   * and its eight neighbours, blds: [[id, kind, x, y, w, d, era, cl, v,
   * state, civ], ...] that may reach into it, colors: { civId: '#rrggbb' },
   * chunksX }
   */
  paint(kx, ky, data) {
    const world = this.world;
    const W = world.width;
    const H = world.height;
    const base = this.base(kx, ky);
    const canvas = makeCanvas(S, S);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(base, 0, 0);
    const CS = CHUNK_CELLS;
    const cx0 = kx * CS;
    const cy0 = ky * CS;
    const own = data.cells.get(ky * data.chunksX + kx);
    // Cell lookups across chunk borders.
    const cellAt = (cx, cy) => {
      const k = Math.floor(cy / CS) * data.chunksX + Math.floor(cx / CS);
      const ch = data.cells.get(k);
      if (!ch || cx < 0 || cy < 0) return 0;
      return ch.cell[(cy - Math.floor(cy / CS) * CS) * CS + (cx - Math.floor(cx / CS) * CS)];
    };
    const auxAt = (cx, cy) => {
      const k = Math.floor(cy / CS) * data.chunksX + Math.floor(cx / CS);
      const ch = data.cells.get(k);
      if (!ch || cx < 0 || cy < 0) return 0;
      return ch.aux[(cy - Math.floor(cy / CS) * CS) * CS + (cx - Math.floor(cx / CS) * CS)];
    };
    const clearedAt = (tx, ty) => {
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) return 0;
      const cx = tx * 2;
      const cy = ty * 2;
      const k = Math.floor(cy / CS) * data.chunksX + Math.floor(cx / CS);
      const ch = data.cells.get(k);
      if (!ch) return 0;
      const T = CS / 2;
      return ch.cleared[(ty - Math.floor(cy / CS) * T) * T + (tx - Math.floor(cx / CS) * T)];
    };
    if (own) {
      const img = ctx.getImageData(0, 0, S, S);
      const buf = new Uint32Array(img.data.buffer);
      const env = { world, cellAt, auxAt, buf, cx0, cy0, seed: world.seed | 0 };
      let any = false;
      for (let y = 0; y < CS; y++) {
        for (let x = 0; x < CS; x++) {
          const c = own.cell[y * CS + x];
          if (!c) continue;
          any = true;
          paintCell(env, cx0 + x, cy0 + y, c, own.aux[y * CS + x]);
        }
      }
      if (any) ctx.putImageData(img, 0, 0);
    }
    // Trees and buildings, back to front.
    const objs = [];
    const { biome, feature, height01 } = world;
    const tx0 = kx * CHUNK;
    const ty0 = ky * CHUNK;
    for (let ty = ty0 - 1; ty < ty0 + CHUNK + 3; ty++) {
      if (ty < 0 || ty >= H) continue;
      for (let tx = tx0 - 2; tx < tx0 + CHUNK + 2; tx++) {
        if (tx < 0 || tx >= W) continue;
        const i = ty * W + tx;
        const f = feature[i];
        if (!f || clearedAt(tx, ty)) continue;
        const b = biome[i];
        const h0 = hash3(tx, ty, (world.seed | 0) + 3);
        const snowy = b === B.MOUNTAIN && height01[i] > this.snowLine;
        const spr = natureSprite(f, h0, b, snowy);
        if (!spr) continue;
        const jx = ((h0 >>> 17) % 11) - 5;
        const jy = ((h0 >>> 21) % 7) - 4;
        objs.push({ tree: spr, x: tx * TILE + 8 + jx - kx * S, y: ty * TILE + 13 + jy - ky * S, key: ty * TILE + 13 + jy });
      }
    }
    void TREE_FEATURES;
    for (const b of data.blds) {
      const [, kind, x, y, w, d, era, cl, v, state, civ] = b;
      const ti = (y >> 1) * W + (x >> 1);
      const snow = world.temp[ti] < 0.17 || biome[ti] === B.SNOW;
      const spr = buildingSprite({ kind, w, d, era, climate: CLIMATE_KEYS[cl], v, color: data.colors[civ] || null, state: state === 1 ? 'ruin' : state === 2 ? 'build' : 'ok', snow });
      if (!spr) continue;
      const px = x * CELL - kx * S;
      const py = y * CELL - ky * S;
      if (px + spr.w + 40 < 0 || px - 40 > S || py - spr.h > S || py + d * CELL + 30 < 0) continue;
      objs.push({ bld: spr, x: px, y: py, key: (y + d) * CELL - 0.5 });
    }
    if (!objs.length) return canvas;
    // Shadows into one mask first, so overlaps do not stack.
    const mask = (this.mask ||= makeCanvas(S, S));
    const mctx = mask.getContext('2d');
    mctx.clearRect(0, 0, S, S);
    for (const o of objs) {
      if (o.tree) {
        const c = o.tree.cast;
        if (c) mctx.drawImage(c.canvas, o.x + c.x, o.y + c.y);
      } else if (o.bld.shadow) {
        const sh = o.bld.shadow;
        mctx.drawImage(sh.canvas, o.x - sh.ox, o.y - sh.oy);
      }
    }
    ctx.globalAlpha = SHADOW_ALPHA;
    ctx.drawImage(mask, 0, 0);
    ctx.globalAlpha = 1;
    objs.sort((p, q) => p.key - q.key || p.x - q.x);
    for (const o of objs) {
      if (o.tree) ctx.drawImage(o.tree.canvas, o.x - o.tree.ax, o.y - o.tree.ay);
      else ctx.drawImage(o.bld.canvas, o.x - o.bld.ox, o.y - o.bld.oy);
    }
    return canvas;
  }
}

function hash3(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// ---------------------------------------------------------------------------
// The ground of one town cell (8×8 px).

function paintCell(env, cx, cy, c, aux) {
  const { world, buf, cx0, cy0 } = env;
  const W = world.width;
  const ti = (cy >> 1) * W + (cx >> 1);
  const b = world.biome[ti];
  const ox = (cx - cx0) * CELL;
  const oy = (cy - cy0) * CELL;
  const set = (x, y, col) => {
    buf[(oy + y) * S + ox + x] = col;
  };
  const water = b <= B.LAKE;
  const river = b === B.RIVER;
  switch (c) {
    case C.ROAD:
      return paintRoad(env, cx, cy, aux, set, water || river, world.climate[ti]);
    case C.FIELD:
      return paintField(env, cx, cy, aux, set);
    case C.PLAZA:
      return paintPlaza(cx, cy, set);
    case C.DOCK:
      return paintDock(cx, cy, aux, set);
    case C.BLD:
    case C.YARD:
      if (!water && !river) paintYard(env, cx, cy, set);
      return undefined;
    default:
      return undefined;
  }
}

function isRoadish(c) {
  return c === C.ROAD || c === C.PLAZA;
}

function paintRoad(env, cx, cy, cls, set, bridge, climate) {
  const n = isRoadish(env.cellAt(cx, cy - 1));
  const s = isRoadish(env.cellAt(cx, cy + 1));
  const e = isRoadish(env.cellAt(cx + 1, cy));
  const w = isRoadish(env.cellAt(cx - 1, cy));
  if (cls === RD.RAIL) return paintRail(env, cx, cy, set, { n, s, e, w }, bridge);
  const paved = cls === RD.PAVED;
  const pal = paved ? COBBLE : climate === 1 ? { base: SAND.base, dark: SAND.dark, light: SAND.light, edge: SAND.edge } : DIRT;
  if (bridge) return paintBridge(cx, cy, set, { n, s, e, w }, paved);
  // Lanes are narrow; streets fill their cell.
  const lane = cls === RD.PATH;
  const lo = lane ? 2 : 0;
  const hi = lane ? 5 : 7;
  const base = pc(pal.base);
  const dark = pc(pal.dark);
  const light = pc(pal.light);
  const edge = pc(pal.edge);
  const mortar = paved ? pc(COBBLE.mortar) : 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      // Inside the lane (with arms towards connected neighbours)?
      const inX = x >= lo && x <= hi;
      const inY = y >= lo && y <= hi;
      let inside = (inX && inY) || (inX && ((y < lo && n) || (y > hi && s))) || (inY && ((x < lo && w) || (x > hi && e)));
      if (!lane) inside = true;
      if (!inside) continue;
      const hh = h2(cx * 8 + x, cy * 8 + y);
      // Ragged edges where the road meets grass.
      const atEdge = (!lane && ((y === 0 && !n) || (y === 7 && !s) || (x === 0 && !w) || (x === 7 && !e))) || (lane && ((x === lo && !(y < lo || y > hi) && !w) || (x === hi && !(y < lo || y > hi) && !e) || (y === lo && !(x < lo || x > hi) && !n) || (y === hi && !(x < lo || x > hi) && !s)));
      if (atEdge && (hh & 3) === 0) continue;
      let col = base;
      if (paved) {
        // Cobbles: 2×2 stones with mortar.
        const sx = (x + ((y >> 1) & 1)) & 1;
        const sy = y & 1;
        col = sx === 0 && sy === 0 ? mortar : (hh & 7) === 0 ? light : (hh & 7) === 1 ? dark : base;
      } else {
        col = (hh & 15) === 0 ? dark : (hh & 15) === 1 ? light : base;
        // Wheel ruts along the way.
        if (!lane && ((e || w) && !(n || s) ? y === 2 || y === 5 : (n || s) && !(e || w) ? x === 2 || x === 5 : false) && (hh & 3)) col = dark;
      }
      if (atEdge) col = edge;
      set(x, y, col);
    }
  }
}

function paintRail(env, cx, cy, set, dirs, bridge) {
  const horiz = (dirs.e || dirs.w) && !(dirs.n || dirs.s);
  const bed = pc(RAIL.bed);
  const bedD = pc(RAIL.bedDark);
  const sl = pc(RAIL.sleeper);
  const rl = pc(RAIL.rail);
  const sh = pc(RAIL.shine);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const a = horiz ? y : x; // across the track
      const l = horiz ? x : y; // along it
      if (a < 1 || a > 6) continue;
      const hh = h2(cx * 8 + x, cy * 8 + y);
      let col = bridge ? pc(PLANK.base) : (hh & 3) === 0 ? bedD : bed;
      if (l % 2 === 0 && a >= 1 && a <= 6) col = sl;
      if (a === 2 || a === 5) col = rl;
      if ((a === 2 || a === 5) && l % 4 === 1) col = sh;
      set(x, y, col);
    }
  }
}

function paintBridge(cx, cy, set, dirs, stone) {
  const horiz = (dirs.e || dirs.w) && !(dirs.n || dirs.s);
  const pal = stone ? COBBLE : PLANK;
  const base = pc(pal.base);
  const dark = pc(pal.dark);
  const light = pc(pal.light);
  const edge = pc(stone ? COBBLE.edge : PLANK.edge);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const a = horiz ? y : x;
      const l = horiz ? x : y;
      if (a === 0 || a === 7) {
        set(x, y, edge);
        continue;
      }
      let col = base;
      if (!stone && l % 3 === 2) col = dark;
      if (a === 1) col = light;
      if (stone && (l + a) % 4 === 0) col = dark;
      set(x, y, col);
    }
  }
}

const STAGES = 3;

function paintField(env, cx, cy, aux, set) {
  const crop = CROPS[CROP_KEYS[(aux & 7) - 1] || 'wheat'];
  const vertical = (aux & 8) !== 0;
  const tag = aux >> 4;
  const stage = (tag * 7 + 3) % STAGES; // patches are at different stages of the year
  const soil = pc(crop.soil);
  const soilD = pc(crop.soilDark);
  const plant = pc(crop.plant);
  const plantD = pc(crop.plantDark);
  const top = pc(crop.top);
  const young = pc(mix(crop.plant, '#7aa04a', 0.6));
  // Edges against other patches: a furrow or a hedge.
  const same = (x, y) => env.cellAt(x, y) === C.FIELD && env.auxAt(x, y) >> 4 === tag;
  const en = !same(cx, cy - 1);
  const es = !same(cx, cy + 1);
  const ew = !same(cx - 1, cy);
  const ee = !same(cx + 1, cy);
  const hedge = tag % 3 === 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const hh = h2(cx * 8 + x, cy * 8 + y);
      const row = vertical ? x : y;
      let col;
      if (stage === 0) col = row % 2 === 0 ? soilD : soil; // ploughed
      else if (stage === 1) col = row % 2 === 0 ? soil : (hh & 3) === 0 ? soilD : young; // sprouting
      else col = row % 2 === 0 ? plantD : (hh & 7) === 0 ? top : plant; // ripe
      const edge = (y === 0 && en) || (y === 7 && es) || (x === 0 && ew) || (x === 7 && ee);
      if (edge) col = hedge && (hh & 3) !== 0 ? pc(HEDGE[hh % 3]) : soilD;
      set(x, y, col);
    }
  }
}

function paintPlaza(cx, cy, set) {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const hh = h2(cx * 8 + x, cy * 8 + y);
      const sx = (x + ((y >> 1) & 1)) & 1;
      const sy = y & 1;
      let col = sx === 0 && sy === 0 ? pc('#9b948a') : (hh & 7) === 0 ? pc('#d4cdc0') : pc('#bdb6aa');
      if ((hh & 63) === 0) col = pc('#8a9a5a');
      set(x, y, col);
    }
  }
}

function paintDock(cx, cy, aux, set) {
  const horiz = aux === 1;
  const base = pc(PLANK.base);
  const dark = pc(PLANK.dark);
  const light = pc(PLANK.light);
  const edge = pc(PLANK.edge);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const a = horiz ? y : x;
      const l = horiz ? x : y;
      if (a < 1 || a > 6) {
        if ((l === 1 || l === 6) && (a === 0 || a === 7)) set(x, y, edge); // posts
        continue;
      }
      let col = l % 3 === 2 ? dark : base;
      if (a === 1) col = light;
      if (a === 6) col = edge;
      set(x, y, col);
    }
  }
}

function paintYard(env, cx, cy, set) {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const hh = h2(cx * 8 + x, cy * 8 + y);
      if ((hh & 3) !== 0) continue; // trodden patches, mostly grass shows
      set(x, y, (hh & 16) ? pc(YARD.earth) : pc(YARD.dark));
    }
  }
}
