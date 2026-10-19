// Towns on the ground. Every map tile is split into 2×2 cells (8 px each);
// towns grow on this grid as their people do: a green with a well, streets
// that branch and lengthen, houses on lots along the streets (packed into
// rows in the old centre, with gardens on the outskirts), temples, markets,
// palaces and harbours, walls with gates, and fields with farmsteads round
// about. Buildings keep the age they were built in and are rebuilt little
// by little in newer styles, so old quarters keep their look. Towns that
// shrink leave ruins; sacked towns burn.
//
// The client paints exactly this grid, so everything here is deterministic.

import { Rng, hash } from '../core/rng.js';
import { B } from '../world/biomes.js';
import { ERAS, has } from './tech.js';
import { CLIMATE_KEYS } from './world.js';

/** Cell codes. */
export const C = Object.freeze({ FREE: 0, ROAD: 1, BLD: 2, FIELD: 3, PLAZA: 4, YARD: 5, DOCK: 6 });
/** Road classes (aux of road cells). */
export const RD = Object.freeze({ PATH: 1, STREET: 2, MAIN: 3, PAVED: 4, RAIL: 5 });
/** Building states. */
export const ST = Object.freeze({ OK: 0, RUIN: 1, BUILD: 2 });
/**
 * Crops (aux of field cells: bits 0-2 the crop, bit 3 set when the rows run
 * north-south, bits 4-7 tell neighbouring patches apart).
 */
export const CROP_KEYS = ['wheat', 'barley', 'corn', 'cabbage', 'turnip', 'rice', 'millet'];
const CROPS_BY_CLIMATE = [
  ['wheat', 'wheat', 'barley', 'cabbage', 'turnip'],
  ['millet', 'wheat', 'millet', 'barley'],
  ['barley', 'turnip', 'barley', 'cabbage'],
  ['rice', 'corn', 'rice', 'millet'],
  ['rice', 'rice', 'corn'],
];

export const CHUNK_CELLS = 64; // cells per chunk side (32 tiles)

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

/** Footprints by kind (cells), as the planner places them. */
const FOOT = {
  well: [1, 1],
  temple: [[4, 4], [5, 5], [6, 6], [6, 8]],
  palace: [[5, 4], [6, 5], [7, 6], [8, 7]],
  market: [[4, 3], [5, 4]],
  granary: [[3, 2], [3, 3]],
  workshop: [[3, 2]],
  harbor: [[3, 3], [4, 3]],
  lighthouse: [[2, 2]],
  monument: [[3, 3], [4, 4]],
  amphitheater: [[6, 6]],
  windmill: [[2, 2]],
  university: [[5, 4]],
  factory: [[5, 4], [6, 5]],
  station: [[6, 5]],
  farm: [[4, 3]],
};

export class Towns {
  constructor(sim) {
    this.sim = sim;
    const { W, H } = sim;
    this.CW = W * 2;
    this.CH = H * 2;
    const n = this.CW * this.CH;
    this.cell = new Uint8Array(n);
    this.aux = new Uint8Array(n);
    this.bref = new Int32Array(n).fill(-1);
    this.cleared = new Uint8Array(W * H); // tiles whose trees are gone
    this.blds = [];
    this.free = [];
    this.lay = new Map(); // town id -> layout state
    this.dirty = new Set(); // chunk keys
    this.chunksX = Math.ceil(this.CW / CHUNK_CELLS);
    this.chunksY = Math.ceil(this.CH / CHUNK_CELLS);
    this.cursor = 1;
  }

  // -------------------------------------------------------------------------
  // Grid helpers

  touch(cx, cy) {
    this.dirty.add(((cy / CHUNK_CELLS) | 0) * this.chunksX + ((cx / CHUNK_CELLS) | 0));
  }

  touchRect(x, y, w, d) {
    // Sprites overhang their footprint upwards: mark the chunks they reach.
    for (const [px, py] of [[x, y], [x + w - 1, y], [x, y + d - 1], [x + w - 1, y + d - 1], [x, y - 6], [x + w - 1, y - 6]]) {
      if (px >= 0 && py >= 0 && px < this.CW && py < this.CH) this.touch(px, py);
    }
  }

  tileOf(ci) {
    const cx = ci % this.CW;
    const cy = (ci / this.CW) | 0;
    return (cy >> 1) * this.sim.W + (cx >> 1);
  }

  /** Can a building stand on this cell? */
  buildable(cx, cy, { marsh = true, steep = false } = {}) {
    if (cx < 0 || cy < 0 || cx >= this.CW || cy >= this.CH) return false;
    const ci = cy * this.CW + cx;
    if (this.cell[ci] !== C.FREE) return false;
    const b = this.sim.world.biome[(cy >> 1) * this.sim.W + (cx >> 1)];
    if (b <= B.RIVER || b === B.PEAK) return false;
    if (b === B.MOUNTAIN && !steep) return false;
    if (b === B.MARSH && !marsh) return false;
    return true;
  }

  fits(x, y, w, d, o) {
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) if (!this.buildable(x + i, y + j, o)) return false;
    return true;
  }

  setCell(cx, cy, code, aux = 0) {
    const ci = cy * this.CW + cx;
    this.cell[ci] = code;
    this.aux[ci] = aux;
    if (code !== C.FREE) this.cleared[(cy >> 1) * this.sim.W + (cx >> 1)] = 1;
    this.touch(cx, cy);
  }

  // -------------------------------------------------------------------------
  // Buildings

  add(t, kind, x, y, w, d, era, { v = null, state = ST.OK } = {}) {
    const id = this.free.length ? this.free.pop() : this.blds.length;
    const ti = (y >> 1) * this.sim.W + (x >> 1);
    const b = {
      id,
      town: t ? t.id : 0,
      kind,
      x,
      y,
      w,
      d,
      era,
      cl: this.sim.world.climate[ti],
      v: v ?? (hash(x, y, id, this.sim.seed) & 63),
      state,
      born: this.sim.year,
      civ: t ? t.civ : 0,
    };
    this.blds[id] = b;
    for (let j = 0; j < d; j++) {
      for (let i = 0; i < w; i++) {
        const ci = (y + j) * this.CW + x + i;
        this.cell[ci] = C.BLD;
        this.aux[ci] = 0;
        this.bref[ci] = id;
        this.cleared[((y + j) >> 1) * this.sim.W + ((x + i) >> 1)] = 1;
      }
    }
    this.touchRect(x, y, w, d);
    if (t) {
      const L = this.lay.get(t.id);
      if (L) {
        L.blds.add(id);
        if (isHouse(kind)) L.houses++;
        else if (kind !== 'wall' && kind !== 'tower' && kind !== 'gate') L.marks.set(kind, (L.marks.get(kind) || 0) + 1);
      }
    }
    return b;
  }

  remove(id, leave = C.FREE) {
    const b = this.blds[id];
    if (!b) return;
    for (let j = 0; j < b.d; j++) {
      for (let i = 0; i < b.w; i++) {
        const ci = (b.y + j) * this.CW + b.x + i;
        if (this.bref[ci] !== id) continue;
        this.bref[ci] = -1;
        this.cell[ci] = leave;
        this.aux[ci] = 0;
      }
    }
    this.touchRect(b.x, b.y, b.w, b.d);
    const L = this.lay.get(b.town);
    if (L) {
      L.blds.delete(id);
      if (isHouse(b.kind)) L.houses--;
      else if (L.marks.has(b.kind)) L.marks.set(b.kind, L.marks.get(b.kind) - 1);
    }
    this.blds[id] = null;
    this.free.push(id);
  }

  setState(b, state) {
    if (b.state === state) return;
    b.state = state;
    b.born = this.sim.year;
    this.touchRect(b.x, b.y, b.w, b.d);
  }

  // -------------------------------------------------------------------------
  // Founding

  found(t) {
    if (this.lay.has(t.id)) return;
    const cx = t.x * 2;
    const cy = t.y * 2;
    const L = { cx, cy, houses: 0, marks: new Map(), blds: new Set(), roads: [], tips: [], fields: 0, patches: [], wall: null, wallAt: 0, wallTry: 0, fail: {}, last: this.sim.year - 1 };
    this.lay.set(t.id, L);
    // A green with a well, if the ground allows.
    if (this.fits(cx - 1, cy - 1, 2, 2)) {
      for (let j = -1; j <= 0; j++) for (let i = -1; i <= 0; i++) this.setCell(cx + i, cy + j, C.PLAZA, 0);
      this.cell[(cy - 1) * this.CW + cx - 1] = C.FREE;
      this.add(t, 'well', cx - 1, cy - 1, 1, 1, this.civEra(t));
    }
    this.update(t, 1);
  }

  civEra(t) {
    return this.sim.civs[t.civ].era;
  }

  /** Re-colour a town's flags when it changes hands. */
  retag(t) {
    const L = this.lay.get(t.id);
    if (!L) return;
    for (const id of L.blds) {
      const b = this.blds[id];
      if (!b) continue;
      b.civ = t.civ;
      if (!isHouse(b.kind)) this.touchRect(b.x, b.y, b.w, b.d);
    }
  }

  // -------------------------------------------------------------------------
  // Monthly scheduling: each town is laid out about once a year.

  month() {
    const sim = this.sim;
    const n = sim.towns.length - 1;
    if (n <= 0) return;
    const per = Math.max(1, Math.ceil(n / 12));
    for (let k = 0; k < per; k++) {
      if (this.cursor > n) this.cursor = 1;
      const t = sim.towns[this.cursor++];
      const L = this.lay.get(t.id);
      if (!L) continue;
      if (t.alive) this.update(t, Math.max(1, sim.year - L.last));
      else this.decay(t, L);
      L.last = sim.year;
    }
  }

  // -------------------------------------------------------------------------
  // Growth

  targets(t) {
    const civ = this.sim.civs[t.civ];
    const era = ERAS[civ.era];
    // A sprite stands for a household at first, for many families later.
    const houses = Math.min(1200, Math.round(1.6 * Math.pow(Math.max(1, t.urban) / era.perHouse, 0.62)) + 1);
    const rural = Math.max(0, t.pop - t.urban);
    const perField = [70, 90, 110, 130, 150, 190, 330, 650][civ.era];
    const fields = Math.min(900, Math.round(rural / perField));
    return { houses, fields };
  }

  update(t, years) {
    const L = this.lay.get(t.id);
    if (!L) return;
    const sim = this.sim;
    const civ = sim.civs[t.civ];
    const rng = new Rng(hash(sim.seed, t.id, sim.year, L.houses));
    L.rngObj = rng;
    const { houses, fields } = this.targets(t);
    const era = civ.era;
    // Streets ahead of the houses (stone-age villages have none).
    if (era >= 1) {
      if (!L.tips.length && !L.roads.length) this.startStreets(t, L, rng);
      this.resume(L);
      const want = Math.min(6, 1 + Math.floor((houses - L.houses) / 6));
      for (let k = 0; k < want * years && k < 12; k++) this.growStreet(t, L, rng);
    }
    // Houses.
    const add = Math.min(houses - L.houses, (3 + Math.ceil(houses * 0.06)) * years, 40);
    for (let k = 0; k < add; k++) if (!this.placeHouse(t, L, rng)) break;
    if (L.houses > houses * 1.2 + 2) this.shrink(t, L, rng, Math.ceil((L.houses - houses) * 0.08));
    // Landmarks of the age.
    this.landmarks(t, L, civ, rng);
    // Walls.
    if (t.walls && !L.wall && L.houses >= 20 && this.sim.year >= L.wallTry) {
      this.buildWalls(t, L, civ);
      if (!L.wall) L.wallTry = this.sim.year + 15;
    }
    else if (L.wall && (era >= 6 || (L.houses > L.wallAt * 2.4 && era >= 2))) this.razeWalls(t, L, era < 6 && L.houses < 900);
    // Fields and farmsteads.
    this.farmland(t, L, civ, fields, rng, years);
    // Rebuilding in the styles of a newer age; ruins cleared or rebuilt.
    this.renew(t, L, civ, rng, years);
  }

  // Streets ------------------------------------------------------------------

  /** How far (in cells) the town's streets may reach from its centre. */
  reach(L) {
    return 5 + Math.sqrt(L.houses + 4) * 1.9;
  }

  startStreets(t, L, rng) {
    const sim = this.sim;
    // Arteries towards the neighbouring towns, the shore and open land.
    const dirs = [];
    const near = sim.townsNear(t.x, t.y, 30).filter((o) => o !== t).slice(0, 3);
    for (const o of near) {
      const dx = o.x - t.x;
      const dy = o.y - t.y;
      dirs.push(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 1) : dy > 0 ? 2 : 3);
    }
    while (dirs.length < 2) dirs.push(rng.int(0, 3));
    if (rng.chance(0.6)) dirs.push(rng.int(0, 3));
    const seen = new Set();
    for (const d of dirs) {
      if (seen.has(d)) continue;
      seen.add(d);
      const sx = L.cx + (DX[d] > 0 ? 1 : DX[d] < 0 ? -2 : DY[d] ? 0 : 0);
      const sy = L.cy + (DY[d] > 0 ? 1 : DY[d] < 0 ? -2 : 0);
      L.tips.push({ x: sx, y: sy, d, cls: RD.MAIN, left: 8 + rng.int(0, 6), main: true });
    }
  }

  growStreet(t, L, rng) {
    if (!L.tips.length) {
      // New side streets from existing ones.
      this.branch(t, L, rng);
      if (!L.tips.length) return;
    }
    const k = rng.int(0, L.tips.length - 1);
    const tip = L.tips[k];
    const civ = this.sim.civs[t.civ];
    const planned = civ.era === 3 || civ.era >= 5;
    let steps = tip.main ? 4 : 3;
    let x = tip.x;
    let y = tip.y;
    let d = tip.d;
    const R = this.reach(L) * (tip.main ? 1.25 : 1);
    while (steps-- > 0 && tip.left > 0) {
      if (Math.hypot(x + DX[d] - L.cx, y + DY[d] - L.cy) > R) {
        tip.left = 0;
        tip.paused = true;
        break;
      }
      if (!planned && !tip.main && rng.chance(0.12)) {
        // Old towns' lanes wander.
        const turn = DY[d] ? rng.int(0, 1) : rng.int(2, 3);
        if (this.roadOk(x + DX[turn], y + DY[turn], turn)) d = turn;
      }
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < 1 || ny < 1 || nx >= this.CW - 1 || ny >= this.CH - 1) {
        tip.left = 0;
        break;
      }
      const ci = ny * this.CW + nx;
      if (this.cell[ci] === C.ROAD) {
        tip.left = 0; // joined another street
        break;
      }
      if (!this.roadOk(nx, ny, d)) {
        tip.left = 0;
        break;
      }
      this.setCell(nx, ny, C.ROAD, tip.cls);
      L.roads.push(ci);
      x = nx;
      y = ny;
      tip.left--;
    }
    tip.x = x;
    tip.y = y;
    tip.d = d;
    if (tip.left <= 0) {
      L.tips.splice(k, 1);
      // Main roads wait at the edge of town and go on as it grows.
      if (tip.main) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (this.roadOk(nx, ny, d)) (L.waiting ||= []).push({ ...tip, left: 6 + rng.int(0, 6), paused: false });
      }
    }
  }

  /** Main roads that reached the edge of town resume when it has grown. */
  resume(L) {
    if (!L.waiting || !L.waiting.length) return;
    const R = this.reach(L) * 1.25;
    const keep = [];
    for (const tip of L.waiting) {
      if (Math.hypot(tip.x - L.cx, tip.y - L.cy) < R - 1) L.tips.push(tip);
      else keep.push(tip);
    }
    L.waiting = keep;
  }

  /** May a road run onto this cell (heading d) without crowding a parallel street? */
  roadOk(x, y, d) {
    if (x < 1 || y < 1 || x >= this.CW - 1 || y >= this.CH - 1) return false;
    const ci = y * this.CW + x;
    const c = this.cell[ci];
    if (c === C.ROAD) return true;
    if (c !== C.FREE && c !== C.FIELD) return false;
    const b = this.sim.world.biome[(y >> 1) * this.sim.W + (x >> 1)];
    if (b === B.SEA || b === B.DEEP || b === B.LAKE || b === B.PEAK) return false;
    // Keep blocks at least two lots deep: no road right beside a road
    // running the same way (except where streets meet).
    const sx = DY[d] ? 1 : 0;
    const sy = DX[d] ? 1 : 0;
    for (const s of [1, -1, 2, -2]) {
      const ax = x + sx * s;
      const ay = y + sy * s;
      const a = ay * this.CW + ax;
      if (this.cell[a] === C.ROAD) {
        const bx = ax - DX[d];
        const by = ay - DY[d];
        if (this.cell[by * this.CW + bx] === C.ROAD) return false;
      }
    }
    return true;
  }

  branch(t, L, rng) {
    if (!L.roads.length) return;
    const civ = this.sim.civs[t.civ];
    const spacing = civ.era === 3 || civ.era >= 5 ? 5 : 4 + rng.int(0, 2);
    const R = this.reach(L);
    for (let tries = 0; tries < 12; tries++) {
      const ci = L.roads[rng.int(0, L.roads.length - 1)];
      const x = ci % this.CW;
      const y = (ci / this.CW) | 0;
      if (Math.hypot(x - L.cx, y - L.cy) > R - 2) continue;
      const horiz = this.cell[ci - 1] === C.ROAD || this.cell[ci + 1] === C.ROAD;
      const d = horiz ? (rng.chance(0.5) ? 2 : 3) : rng.chance(0.5) ? 0 : 1;
      // Not too close to an existing side street on the same road.
      let crowded = false;
      for (let s = -spacing + 1; s < spacing; s++) {
        if (!s) continue;
        const ax = horiz ? x + s : x;
        const ay = horiz ? y : y + s;
        const bx = ax + DX[d];
        const by = ay + DY[d];
        if (bx < 0 || by < 0 || bx >= this.CW || by >= this.CH) continue;
        if (this.cell[by * this.CW + bx] === C.ROAD) {
          crowded = true;
          break;
        }
      }
      if (crowded || !this.roadOk(x + DX[d], y + DY[d], d)) continue;
      const dist = Math.hypot(x - L.cx, y - L.cy);
      L.tips.push({ x, y, d, cls: dist < 10 ? RD.STREET : RD.PATH, left: 5 + rng.int(0, 7), main: false });
      return;
    }
  }

  // Houses ---------------------------------------------------------------------

  houseKind(t, civ, dist, rng) {
    const era = civ.era;
    const L = this.lay.get(t.id);
    const core = Math.max(4, Math.sqrt(L.houses) * 1.3);
    const inner = dist < core;
    if (era === 0) return ['hut', 1, 1];
    if (era === 1 && rng.chance(0.35)) return ['hut', 1, 1];
    if (era >= 6 && inner && L.houses > 60) return rng.chance(0.25) ? ['apartment', 3, 2] : ['apartment', 2, 2];
    if (era >= 3 && inner && L.houses > 20) return rng.chance(0.5) ? ['rowhouse', 1, 2] : ['rowhouse', 2, 2];
    if (era >= 2 && rng.chance(0.2)) return rng.chance(0.5) ? ['house', 3, 2] : ['house', 2, 3];
    return ['house', 2, 2];
  }

  placeHouse(t, L, rng) {
    const civ = this.sim.civs[t.civ];
    if (civ.era === 0 || !L.roads.length) return this.placeHut(t, L, rng);
    const R = this.reach(L) + 2;
    let best = null;
    let bs = Infinity;
    const tries = Math.min(28, 8 + L.roads.length);
    for (let k = 0; k < tries; k++) {
      // Favour streets near the centre.
      const ci = L.roads[Math.floor(Math.pow(rng.next(), 1.6) * L.roads.length)];
      const rx = ci % this.CW;
      const ry = (ci / this.CW) | 0;
      const dist = Math.hypot(rx - L.cx, ry - L.cy);
      if (dist > R) continue;
      const [kind, w0, d0] = this.houseKind(t, civ, dist, rng);
      const dense = kind === 'rowhouse' || kind === 'apartment';
      for (const side of [0, 1, 2, 3]) {
        const w = side < 2 ? w0 : d0;
        const d = side < 2 ? d0 : w0;
        // side 0: north of the road; 1: south; 2: west; 3: east.
        let x;
        let y;
        if (side === 0) {
          x = rx - rng.int(0, w - 1);
          y = ry - d;
        } else if (side === 1) {
          x = rx - rng.int(0, w - 1);
          y = ry + 1;
        } else if (side === 2) {
          x = rx - w;
          y = ry - rng.int(0, d - 1);
        } else {
          x = rx + 1;
          y = ry - rng.int(0, d - 1);
        }
        if (!this.fits(x, y, w, d, { marsh: civ.era <= 3 || this.sim.world.climate[this.tileOf(ci)] === 4 })) continue;
        if (!dense && this.crowded(x, y, w, d)) continue;
        const s = Math.hypot(x + w / 2 - L.cx, y + d / 2 - L.cy) + rng.next() * 3 + (side === 1 || side === 3 ? 0.5 : 0);
        if (s < bs) {
          bs = s;
          best = { kind, x, y, w, d };
        }
      }
    }
    if (!best) return false;
    const b = this.add(t, best.kind, best.x, best.y, best.w, best.d, civ.era, { state: ST.BUILD });
    b.until = this.sim.year + 1;
    return true;
  }

  /** A detached house wants a little room round it (a garden). */
  crowded(x, y, w, d) {
    for (let i = -1; i <= w; i++) {
      for (const j of [-1, d]) if (this.isBld(x + i, y + j)) return true;
    }
    for (let j = 0; j < d; j++) for (const i of [-1, w]) if (this.isBld(x + i, y + j)) return true;
    return false;
  }

  isBld(x, y) {
    if (x < 0 || y < 0 || x >= this.CW || y >= this.CH) return false;
    return this.cell[y * this.CW + x] === C.BLD;
  }

  /** Stone-age villages: huts in a loose cluster, no streets. */
  placeHut(t, L, rng) {
    const r = 2 + Math.sqrt(L.houses + 1) * 1.6;
    for (let k = 0; k < 30; k++) {
      const a = rng.next() * Math.PI * 2;
      const d = Math.sqrt(rng.next()) * r;
      const x = Math.round(L.cx + Math.cos(a) * d);
      const y = Math.round(L.cy + Math.sin(a) * d);
      if (!this.fits(x, y, 1, 1)) continue;
      if (this.crowded(x, y, 1, 1) && rng.chance(0.8)) continue;
      this.add(t, 'hut', x, y, 1, 1, this.civEra(t));
      return true;
    }
    return false;
  }

  shrink(t, L, rng, n) {
    // Outlying houses fall empty first.
    const hs = [...L.blds].map((id) => this.blds[id]).filter((b) => b && isHouse(b.kind) && b.state === ST.OK);
    hs.sort((a, b) => Math.hypot(b.x - L.cx, b.y - L.cy) - Math.hypot(a.x - L.cx, a.y - L.cy));
    for (let k = 0; k < Math.min(n, hs.length); k++) {
      const b = hs[Math.floor(Math.pow(rng.next(), 2) * hs.length)];
      if (b && b.state === ST.OK) {
        this.setState(b, ST.RUIN);
        L.houses--;
        b.ruinHouse = true;
      }
    }
  }

  // Landmarks ------------------------------------------------------------------

  landmarks(t, L, civ, rng) {
    const era = civ.era;
    const h = L.houses;
    const want = [];
    const has0 = (k) => (L.marks.get(k) || 0) > 0;
    if (t.capital && h >= 6 && !has0('palace')) want.push('palace');
    if ((civ.religion || era === 0) && h >= (era === 0 ? 14 : 10) && !has0('temple')) want.push('temple');
    if (h >= 14 && has(civ, 'pottery') && !has0('granary')) want.push('granary');
    if (era >= 1 && h >= 22 && !has0('market')) want.push('market');
    if (era >= 1 && (L.marks.get('workshop') || 0) < Math.floor(h / 30)) want.push('workshop');
    if (t.port && h >= 8 && !has0('harbor')) want.push('harbor');
    if (t.port && era >= 3 && h >= 45 && !has0('lighthouse')) want.push('lighthouse');
    if (t.capital && era >= 1 && h >= 70 && !has0('monument')) want.push('monument');
    if (era === 3 && h >= 90 && !has0('amphitheater')) want.push('amphitheater');
    if (era >= 4 && era <= 6 && L.fields >= 50 && (L.marks.get('windmill') || 0) < Math.min(4, Math.floor(L.fields / 60))) want.push('windmill');
    if (era >= 5 && h >= 120 && !has0('university')) want.push('university');
    if (era >= 6 && (L.marks.get('factory') || 0) < Math.floor(h / 70)) want.push('factory');
    if (era >= 6 && h >= 80 && has(civ, 'railways') && !has0('station')) want.push('station');
    if (era >= 4 && h >= 140 && (L.marks.get('temple') || 0) < 2) want.push('temple');
    // Old palaces are replaced when the age has moved on far enough.
    if (has0('palace') && rng.chance(0.1)) {
      for (const id of L.blds) {
        const b = this.blds[id];
        if (!b || b.kind !== 'palace' || b.state !== ST.OK) continue;
        if ((era - b.era >= 2 && rng.chance(0.5)) || (!t.capital && rng.chance(0.1))) {
          this.remove(id);
          if (t.capital && !want.includes('palace')) want.push('palace');
        }
        break;
      }
    }
    let tried = 0;
    for (const kind of want) {
      if ((L.fail[kind] || 0) > this.sim.year) continue;
      if (!this.placeLandmark(t, L, civ, kind, rng)) L.fail[kind] = this.sim.year + 6 + rng.int(0, 8);
      if (++tried >= 2) break;
    }
  }

  placeLandmark(t, L, civ, kind, rng) {
    const sizes = FOOT[kind];
    const big = L.houses > 120 ? 2 : L.houses > 50 ? 1 : 0;
    const opts = Array.isArray(sizes[0]) ? sizes.slice(0, Math.min(sizes.length, big + 1 + (kind === 'temple' && civ.era >= 4 && L.houses > 140 ? 1 : 0))).reverse() : [sizes];
    if (kind === 'harbor') return this.placeHarbor(t, L, civ, rng);
    if (kind === 'lighthouse') return this.placeLighthouse(t, L, civ);
    if (kind === 'windmill' || kind === 'farm') return this.placeRural(t, L, civ, kind, rng);
    const maxR = 6 + Math.sqrt(L.houses) * 2.2;
    for (const [w, d] of opts) {
      let best = null;
      let bs = Infinity;
      // Search a ring of positions round the centre; houses may be cleared
      // (the town is rebuilt round its great buildings).
      const step = 1;
      for (let r = 0; r <= maxR; r += step) {
        const n = Math.max(1, Math.round(r * 3));
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + rng.next() * 0.3;
          const x = Math.round(L.cx + Math.cos(a) * r - w / 2);
          const y = Math.round(L.cy + Math.sin(a) * r - d / 2);
          const cost = this.clearCost(x, y, w, d);
          if (cost === Infinity) continue;
          if (!this.nearRoad(x, y, w, d) && L.roads.length) continue;
          const s = r + cost * 1.5;
          if (s < bs) {
            bs = s;
            best = { x, y };
          }
        }
        if (best && bs < r) break;
      }
      if (!best) continue;
      this.clear(best.x, best.y, w, d);
      const b = this.add(t, kind, best.x, best.y, w, d, civ.era, { state: ST.BUILD });
      b.until = this.sim.year + 2 + Math.floor(w * d / 8);
      if (kind === 'palace' || kind === 'temple' || kind === 'monument') {
        this.sim.log('build', `${t.name} raised ${article(kind, civ.era)}.`, { x: t.x, y: t.y, civs: [t.civ], weight: kind === 'monument' ? 1 : 0 });
      }
      return b;
    }
    return null;
  }

  /** What it takes to clear a footprint: Infinity if roads, water or landmarks are in the way. */
  clearCost(x, y, w, d) {
    let cost = 0;
    for (let j = 0; j < d; j++) {
      for (let i = 0; i < w; i++) {
        const cx = x + i;
        const cy = y + j;
        if (cx < 0 || cy < 0 || cx >= this.CW || cy >= this.CH) return Infinity;
        const ci = cy * this.CW + cx;
        const c = this.cell[ci];
        const b = this.sim.world.biome[(cy >> 1) * this.sim.W + (cx >> 1)];
        if (b <= B.RIVER || b === B.PEAK || b === B.MOUNTAIN) return Infinity;
        if (c === C.FREE || c === C.FIELD || c === C.YARD) continue;
        if (c === C.BLD) {
          const bl = this.blds[this.bref[ci]];
          if (!bl || !isHouse(bl.kind)) return Infinity;
          cost += 1;
          continue;
        }
        return Infinity;
      }
    }
    return cost;
  }

  clear(x, y, w, d) {
    for (let j = 0; j < d; j++) {
      for (let i = 0; i < w; i++) {
        const ci = (y + j) * this.CW + x + i;
        if (this.cell[ci] === C.BLD) this.remove(this.bref[ci]);
        this.cell[ci] = C.FREE;
        this.aux[ci] = 0;
      }
    }
  }

  nearRoad(x, y, w, d) {
    for (let i = -1; i <= w; i++) {
      for (const j of [-1, d]) {
        const cx = x + i;
        const cy = y + j;
        if (cx >= 0 && cy >= 0 && cx < this.CW && cy < this.CH) {
          const c = this.cell[cy * this.CW + cx];
          if (c === C.ROAD || c === C.PLAZA) return true;
        }
      }
    }
    for (let j = 0; j < d; j++) {
      for (const i of [-1, w]) {
        const cx = x + i;
        const cy = y + j;
        if (cx >= 0 && cy >= 0 && cx < this.CW && cy < this.CH) {
          const c = this.cell[cy * this.CW + cx];
          if (c === C.ROAD || c === C.PLAZA) return true;
        }
      }
    }
    return false;
  }

  /** A harbour on the shore, with piers out into the water. */
  placeHarbor(t, L, civ, rng) {
    const sim = this.sim;
    const W = sim.W;
    let best = null;
    let bs = Infinity;
    for (let dy = -10; dy <= 10; dy++) {
      for (let dx = -10; dx <= 10; dx++) {
        const tx = t.x + dx;
        const ty = t.y + dy;
        if (tx < 1 || ty < 1 || tx >= W - 1 || ty >= sim.H - 1) continue;
        if (sim.world.coast[ty * W + tx] !== 1) continue;
        // Which side is the water?
        for (let k = 0; k < 4; k++) {
          const wx = tx + DX[k];
          const wy = ty + DY[k];
          const wb = sim.world.biome[wy * W + wx];
          if (wb !== B.SEA && wb !== B.DEEP) continue;
          const w = 3;
          const d = 3;
          // Footprint on the land tile, against the water side.
          let x = tx * 2 + (DX[k] > 0 ? 2 - w : DX[k] < 0 ? 0 : -1);
          let y = ty * 2 + (DY[k] > 0 ? 2 - d : DY[k] < 0 ? 0 : -1);
          if (DX[k] > 0) x = tx * 2 + 2 - w;
          if (DY[k] > 0) y = ty * 2 + 2 - d;
          const cost = this.clearCost(x, y, w, d);
          if (cost === Infinity) continue;
          const s = Math.hypot(dx, dy) + cost;
          if (s < bs) {
            bs = s;
            best = { x, y, w, d, k, tx, ty };
          }
        }
      }
    }
    if (!best) return null;
    this.clear(best.x, best.y, best.w, best.d);
    const b = this.add(t, 'harbor', best.x, best.y, best.w, best.d, civ.era, { state: ST.BUILD });
    b.until = sim.year + 2;
    // Piers: two lines of cells out over the water.
    const k = best.k;
    for (const off of [0, 2]) {
      let px = DX[k] ? (DX[k] > 0 ? best.x + best.w : best.x - 1) : best.x + off;
      let py = DY[k] ? (DY[k] > 0 ? best.y + best.d : best.y - 1) : best.y + off;
      for (let s = 0; s < 3 + rng.int(0, 2); s++) {
        if (px < 0 || py < 0 || px >= this.CW || py >= this.CH) break;
        const bb = sim.world.biome[(py >> 1) * W + (px >> 1)];
        const ci = py * this.CW + px;
        if (this.cell[ci] !== C.FREE) break;
        if (bb !== B.SEA && bb !== B.DEEP && bb !== B.LAKE) {
          px += DX[k];
          py += DY[k];
          continue;
        }
        this.setCell(px, py, C.DOCK, DX[k] ? 1 : 2);
        px += DX[k];
        py += DY[k];
      }
    }
    return b;
  }

  placeLighthouse(t, L, civ) {
    const sim = this.sim;
    const W = sim.W;
    let best = null;
    let bs = -Infinity;
    for (let dy = -12; dy <= 12; dy++) {
      for (let dx = -12; dx <= 12; dx++) {
        const tx = t.x + dx;
        const ty = t.y + dy;
        if (tx < 1 || ty < 1 || tx >= W - 1 || ty >= sim.H - 1) continue;
        const i = ty * W + tx;
        if (sim.world.coast[i] !== 1) continue;
        // Out on a point: count water round about.
        let water = 0;
        for (let yy = -2; yy <= 2; yy++) for (let xx = -2; xx <= 2; xx++) if (sim.world.biome[(ty + yy) * W + tx + xx] <= B.LAKE) water++;
        const s = water - Math.hypot(dx, dy) * 0.4;
        if (s > bs && this.clearCost(tx * 2, ty * 2, 2, 2) === 0) {
          bs = s;
          best = { x: tx * 2, y: ty * 2 };
        }
      }
    }
    if (!best) return null;
    const b = this.add(t, 'lighthouse', best.x, best.y, 2, 2, civ.era, { state: ST.BUILD });
    b.until = sim.year + 2;
    return b;
  }

  /** Windmills and farmsteads among the fields. */
  placeRural(t, L, civ, kind, rng) {
    const [w, d] = kind === 'windmill' ? [2, 2] : FOOT.farm[0];
    for (let k = 0; k < 20; k++) {
      if (!L.patches.length) return null;
      const p = L.patches[rng.int(0, L.patches.length - 1)];
      const x = p.x + rng.int(-w, p.w);
      const y = p.y + rng.int(-d, p.h);
      if (!this.fits(x, y, w, d, { marsh: false })) continue;
      if (this.crowded(x, y, w, d)) continue;
      return this.add(t, kind, x, y, w, d, civ.era);
    }
    return null;
  }

  // Walls --------------------------------------------------------------------

  buildWalls(t, L, civ) {
    // The outline of the built-up area in 24 directions, smoothed.
    const n = 24;
    const rad = new Float32Array(n);
    for (const id of L.blds) {
      const b = this.blds[id];
      if (!b || b.kind === 'farm' || b.kind === 'windmill' || b.kind === 'lighthouse') continue;
      for (const [px, py] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.d], [b.x + b.w, b.y + b.d]]) {
        const dx = px - L.cx;
        const dy = py - L.cy;
        const k = ((Math.round((Math.atan2(dy, dx) / (Math.PI * 2)) * n) % n) + n) % n;
        rad[k] = Math.max(rad[k], Math.hypot(dx, dy));
      }
    }
    const sm = new Float32Array(n);
    for (let k = 0; k < n; k++) sm[k] = Math.max(rad[k], (rad[(k + 1) % n] + rad[(k + n - 1) % n]) / 2, 4) + 2;
    const pts = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      pts.push([Math.round(L.cx + Math.cos(a) * sm[k]), Math.round(L.cy + Math.sin(a) * sm[k])]);
    }
    // Rasterise the ring as a 4-connected line of cells.
    const ring = [];
    const seen = new Set();
    for (let k = 0; k < n; k++) {
      const [x0, y0] = pts[k];
      const [x1, y1] = pts[(k + 1) % n];
      let x = x0;
      let y = y0;
      const push = () => {
        const key = y * this.CW + x;
        if (!seen.has(key)) {
          seen.add(key);
          ring.push(key);
        }
      };
      push();
      while (x !== x1 || y !== y1) {
        if (Math.abs(x1 - x) * Math.abs(y1 - y0 || 1) >= Math.abs(y1 - y) * Math.abs(x1 - x0 || 1)) x += Math.sign(x1 - x);
        else y += Math.sign(y1 - y);
        push();
      }
    }
    const cells = [];
    for (const ci of ring) {
      const x = ci % this.CW;
      const y = (ci / this.CW) | 0;
      if (x < 0 || y < 0 || x >= this.CW || y >= this.CH) continue;
      const c = this.cell[ci];
      const b = this.sim.world.biome[(y >> 1) * this.sim.W + (x >> 1)];
      if (b <= B.LAKE || b === B.PEAK) continue;
      if (c === C.ROAD) cells.push({ ci, gate: true });
      else if (c === C.FREE || c === C.FIELD || c === C.YARD) cells.push({ ci, gate: false });
    }
    if (cells.length < 8) return;
    const set = new Set(cells.map((c) => c.ci));
    const linkOf = (ci) => {
      let m = 0;
      if (set.has(ci - this.CW)) m |= 1;
      if (set.has(ci + 1)) m |= 2;
      if (set.has(ci + this.CW)) m |= 4;
      if (set.has(ci - 1)) m |= 8;
      return m;
    };
    let k = 0;
    const ids = [];
    for (const c of cells) {
      const x = c.ci % this.CW;
      const y = (c.ci / this.CW) | 0;
      const m = linkOf(c.ci);
      if (c.gate) {
        // The road keeps its cell; the gate sits on it.
        const b = this.add(t, 'gate', x, y, 1, 1, civ.era, { v: m });
        this.cell[c.ci] = C.ROAD;
        ids.push(b.id);
      } else {
        const tower = k % 7 === 0 || m === 3 || m === 6 || m === 12 || m === 9;
        const b = this.add(t, tower ? 'tower' : 'wall', x, y, 1, 1, civ.era, { v: m });
        ids.push(b.id);
      }
      k++;
    }
    L.wall = ids;
    L.wallAt = L.houses;
    this.sim.log('walls', `${t.name} was ringed with ${civ.era <= 1 ? 'a palisade' : 'walls'}.`, { x: t.x, y: t.y, civs: [t.civ], weight: 0 });
  }

  /** Walls come down when a town outgrows them or cannon make them useless. */
  razeWalls(t, L, rebuild) {
    for (const id of L.wall) {
      const b = this.blds[id];
      if (!b) continue;
      const kind = b.kind;
      const x = b.x;
      const y = b.y;
      this.remove(id);
      // The old wall line becomes a ring road.
      if (kind !== 'gate') this.setCell(x, y, C.ROAD, RD.MAIN);
      else this.setCell(x, y, C.ROAD, RD.MAIN);
      L.roads.push(y * this.CW + x);
    }
    L.wall = null;
    if (!rebuild) this.sim.towns[t.id].walls = 0;
  }

  // Fields ---------------------------------------------------------------------

  farmland(t, L, civ, target, rng, years) {
    const sim = this.sim;
    const W = sim.W;
    if (L.fields < target) {
      const climate = sim.world.climate[t.i];
      const crops = CROPS_BY_CLIMATE[climate];
      const r0 = 4 + Math.sqrt(L.houses) * 1.1;
      let added = 0;
      let misses = 0;
      for (let tries = 0; tries < 16 * Math.min(years, 4) && L.fields < target && added < 8 * years && misses < 12; tries++) {
        const a = rng.next() * Math.PI * 2;
        const dist = r0 + Math.pow(rng.next(), 0.8) * (10 + Math.sqrt(target) * 1.6);
        const pw = rng.int(3, 6);
        const ph = rng.int(2, 4);
        const x = Math.round(L.cx + Math.cos(a) * dist - pw / 2);
        const y = Math.round(L.cy + Math.sin(a) * dist - ph / 2);
        if (!this.arable(x, y, pw, ph, t, civ)) {
          misses++;
          continue;
        }
        const crop = CROP_KEYS.indexOf(crops[rng.int(0, crops.length - 1)]) + 1;
        const tag = (L.patches.length * 5 + 3) & 15;
        for (let j = 0; j < ph; j++) for (let i = 0; i < pw; i++) this.setCell(x + i, y + j, C.FIELD, (tag << 4) | crop | (pw < ph ? 8 : 0));
        L.patches.push({ x, y, w: pw, h: ph });
        L.fields += pw * ph;
        added++;
      }
      // A farmstead for every few fields.
      const farms = L.marks.get('farm') || 0;
      if (civ.era >= 1 && farms < Math.floor(L.patches.length / 7)) this.placeRural(t, L, civ, 'farm', rng);
    } else if (L.fields > target * 1.3 + 12 && L.patches.length) {
      // Fields fall fallow, the farthest first.
      L.patches.sort((p, q) => Math.hypot(p.x - L.cx, p.y - L.cy) - Math.hypot(q.x - L.cx, q.y - L.cy));
      const p = L.patches.pop();
      for (let j = 0; j < p.h; j++) {
        for (let i = 0; i < p.w; i++) {
          const ci = (p.y + j) * this.CW + p.x + i;
          if (this.cell[ci] === C.FIELD) {
            this.cell[ci] = C.FREE;
            this.aux[ci] = 0;
            L.fields--;
          }
        }
      }
      this.touchRect(p.x, p.y, p.w, p.h);
    }
    void W;
  }

  arable(x, y, w, h, t, civ) {
    const sim = this.sim;
    const W = sim.W;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const cx = x + i;
        const cy = y + j;
        if (cx < 0 || cy < 0 || cx >= this.CW || cy >= this.CH) return false;
        if (this.cell[cy * this.CW + cx] !== C.FREE) return false;
        const ti = (cy >> 1) * W + (cx >> 1);
        if (sim.owner[ti] !== t.id) return false;
        const b = sim.world.biome[ti];
        if (sim.world.food[ti] < 0.35) return false;
        if ((b === B.FOREST || b === B.TAIGA) && civ.era < 2) return false;
        if (b === B.MARSH || b === B.MOUNTAIN || b <= B.RIVER) return false;
      }
    }
    return true;
  }

  // Renewal and decay --------------------------------------------------------

  renew(t, L, civ, rng, years) {
    const sim = this.sim;
    const era = civ.era;
    let rebuilt = 0;
    const budget = Math.ceil(L.blds.size * 0.03 * years) + 1;
    for (const id of L.blds) {
      const b = this.blds[id];
      if (!b) continue;
      if (b.state === ST.BUILD && sim.year >= (b.until || 0)) {
        this.setState(b, ST.OK);
        continue;
      }
      if (b.state === ST.RUIN) {
        // Ruins are rebuilt when the town needs room, cleared after a while.
        const age = sim.year - b.born;
        if (b.ruinHouse && L.houses < this.targets(t).houses && rng.chance(0.25)) {
          b.era = era;
          b.ruinHouse = false;
          L.houses++;
          this.setState(b, ST.BUILD);
          b.until = sim.year + 1;
        } else if (age > 40 && rng.chance(0.05)) {
          if (b.ruinHouse) L.houses++;
          this.remove(id);
        } else if (!b.ruinHouse && age > 3 && rng.chance(0.35)) {
          // Burnt landmarks and houses are rebuilt.
          b.era = Math.max(b.era, era);
          this.setState(b, ST.BUILD);
          b.until = sim.year + 2;
        }
        continue;
      }
      if (rebuilt >= budget) continue;
      if (b.kind === 'hut' && era >= 2 && rng.chance(0.06 * years)) {
        // Huts give way to houses along the streets.
        this.remove(id);
        rebuilt++;
        continue;
      }
      if (b.era < era && isHouse(b.kind) && b.kind !== 'hut' && rng.chance(0.08 * years)) {
        // A house rebuilt in the new style.
        b.era = era;
        b.v = (b.v + 1) & 63;
        if (b.kind === 'rowhouse' && era >= 6 && Math.hypot(b.x - L.cx, b.y - L.cy) < Math.sqrt(L.houses) * 1.1) b.kind = 'apartment';
        this.setState(b, ST.BUILD);
        b.until = sim.year + 1;
        rebuilt++;
      }
    }
  }

  /** A dead town: its buildings fall to ruin and are slowly cleared. */
  decay(t, L) {
    const sim = this.sim;
    const rng = new Rng(hash(sim.seed, t.id, sim.year, 77));
    for (const id of [...L.blds]) {
      const b = this.blds[id];
      if (!b) continue;
      if (b.state !== ST.RUIN) {
        if (rng.chance(0.3)) this.setState(b, ST.RUIN);
      } else if (sim.year - b.born > 60 && rng.chance(0.08)) this.remove(id);
    }
  }

  /** Damage: a share of a town's buildings burn or crumble. */
  damage(t, share, fire = false) {
    const L = this.lay.get(t.id);
    if (!L) return;
    const rng = new Rng(hash(this.sim.seed, t.id, this.sim.year, fire ? 5 : 9));
    for (const id of L.blds) {
      const b = this.blds[id];
      if (!b || b.state === ST.RUIN || b.kind === 'wall' || b.kind === 'tower' || b.kind === 'gate') continue;
      if (rng.next() < share) {
        if (isHouse(b.kind)) {
          b.ruinHouse = false;
        }
        this.setState(b, ST.RUIN);
      }
    }
  }

  /** Trade roads: draw them across the cells (through the tiles' corner cells). */
  roads(tiles) {
    const sim = this.sim;
    const W = sim.W;
    for (const i of tiles) {
      const tx = i % W;
      const ty = (i / W) | 0;
      const lv = sim.road[i];
      const cls = lv === 3 ? RD.RAIL : lv === 2 ? RD.PAVED : RD.PATH;
      const put = (cx, cy) => {
        const ci = cy * this.CW + cx;
        const c = this.cell[ci];
        if (c === C.BLD || c === C.PLAZA || c === C.DOCK) return;
        if (c === C.ROAD && this.aux[ci] >= cls && this.aux[ci] !== RD.RAIL) return;
        if (c === C.ROAD && this.aux[ci] !== RD.PATH && this.aux[ci] !== RD.PAVED && this.aux[ci] !== RD.RAIL && cls !== RD.RAIL) return;
        this.setCell(cx, cy, C.ROAD, cls);
      };
      put(tx * 2, ty * 2);
      // Join towards road neighbours to the east and south.
      if (tx + 1 < W && sim.road[i + 1]) put(tx * 2 + 1, ty * 2);
      if (ty + 1 < sim.H && sim.road[i + W]) put(tx * 2, ty * 2 + 1);
      if (tx > 0 && sim.road[i - 1]) put(tx * 2 - 1, ty * 2);
      if (ty > 0 && sim.road[i - W]) put(tx * 2, ty * 2 - 1);
    }
  }

  // -------------------------------------------------------------------------
  // For the client

  /** Buildings whose footprint origin lies in chunk k. */
  chunkBuildings(k) {
    const x0 = (k % this.chunksX) * CHUNK_CELLS;
    const y0 = ((k / this.chunksX) | 0) * CHUNK_CELLS;
    const out = [];
    for (let y = y0; y < Math.min(this.CH, y0 + CHUNK_CELLS); y++) {
      for (let x = x0; x < Math.min(this.CW, x0 + CHUNK_CELLS); x++) {
        const id = this.bref[y * this.CW + x];
        if (id < 0) continue;
        const b = this.blds[id];
        if (b && b.x === x && b.y === y) out.push(b);
      }
    }
    return out;
  }

  climateKey(b) {
    return CLIMATE_KEYS[b.cl];
  }
}

export function isHouse(kind) {
  return kind === 'hut' || kind === 'house' || kind === 'rowhouse' || kind === 'apartment';
}

function article(kind, era) {
  if (kind === 'palace') return era === 4 ? 'a castle' : era >= 6 ? 'a town hall' : 'a palace';
  if (kind === 'temple') return era === 0 ? 'a ring of standing stones' : era === 4 ? 'a great church' : 'a temple';
  if (kind === 'monument') return era <= 2 ? 'a great monument' : 'a monument';
  return `a ${kind}`;
}
