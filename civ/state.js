// The page's copy of the simulated world, kept up to date from the
// simulator's deltas. The renderer and the panels read it.

import { CHUNK_CELLS } from '../engine/civ/town.js';

export class Mirror {
  constructor(init) {
    this.world = init.world;
    this.W = init.world.width;
    this.H = init.world.height;
    this.CW = init.CW;
    this.CH = init.CH;
    this.chunksX = init.chunksX;
    this.chunksY = init.chunksY;
    this.opts = init.opts;
    this.settings = init.settings;
    this.seed = init.seed;
    this.year = init.opts.startYear;
    this.month = 0;
    this.civs = new Map();
    this.towns = new Map();
    this.owner = new Uint16Array(this.W * this.H);
    this.chunks = new Map(); // k -> { cell, aux, cleared, blds }
    this.chunkVer = new Uint32Array(this.chunksX * this.chunksY);
    this.armies = [];
    this.battles = [];
    this.routes = [];
    this.events = [];
    this.faiths = [null];
    this.history = null;
    this.ownerAll = true;
    this.ownerList = [];
    this.civVer = 0;
    this.townVer = 0;
    this.speed = 1;
    this.stepMs = 0;
    this.listeners = new Set();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  apply(d) {
    this.year = d.year;
    this.month = d.month;
    if (d.speed !== undefined) this.speed = d.speed;
    if (d.stepMs !== undefined) this.stepMs = d.stepMs;
    let colorChange = false;
    for (const c of d.civs) {
      const old = this.civs.get(c.id);
      if (old && old.color !== c.color) colorChange = true;
      this.civs.set(c.id, c);
    }
    if (d.civs.length) this.civVer++;
    for (const t of d.towns) {
      const old = this.towns.get(t.id);
      // A town that changes hands takes its land with it.
      if (old && old.civ !== t.civ) this.ownerAll = true;
      this.towns.set(t.id, t);
    }
    if (d.towns.length) this.townVer++;
    if (d.owner) {
      this.owner = d.owner;
      this.ownerAll = true;
    } else if (d.ownerIdx) {
      const { ownerIdx: idx, ownerVal: val } = d;
      for (let k = 0; k < idx.length; k++) {
        this.owner[idx[k]] = val[k];
        this.ownerList.push(idx[k]);
      }
    }
    if (colorChange) this.ownerAll = true;
    for (const ch of d.chunks) {
      this.chunks.set(ch.k, ch);
      // Buildings overhang into the chunks above and beside: those change too.
      const kx = ch.k % this.chunksX;
      const ky = (ch.k / this.chunksX) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = kx + dx;
          const y = ky + dy;
          if (x >= 0 && y >= 0 && x < this.chunksX && y < this.chunksY) this.chunkVer[y * this.chunksX + x]++;
        }
      }
    }
    this.armies = d.armies;
    this.battles = d.battles || [];
    if (d.events) {
      this.events.push(...d.events);
      if (this.events.length > 3000) this.events.splice(0, this.events.length - 2500);
    }
    if (d.routes) this.routes = d.routes;
    if (d.faiths) this.faiths = d.faiths;
    if (d.history) this.history = d.history;
    for (const fn of this.listeners) fn(d);
  }

  civAt(i) {
    const o = this.owner[i];
    if (!o) return 0;
    const t = this.towns.get(o);
    return t ? t.civ : 0;
  }

  colorOf(civId) {
    const c = this.civs.get(civId);
    return c ? c.color : '#888888';
  }

  /** Data a paint job for chunk k needs: its cells and its neighbours', and the buildings that reach into it. */
  chunkJob(k) {
    const kx = k % this.chunksX;
    const ky = (k / this.chunksX) | 0;
    const cells = [];
    const blds = [];
    const civs = new Set();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = kx + dx;
        const y = ky + dy;
        if (x < 0 || y < 0 || x >= this.chunksX || y >= this.chunksY) continue;
        const kk = y * this.chunksX + x;
        const ch = this.chunks.get(kk);
        if (!ch) continue;
        cells.push([kk, { cell: ch.cell, aux: ch.aux, cleared: ch.cleared }]);
        for (const b of ch.blds) {
          // Only buildings that can reach this chunk.
          const bx0 = b[2];
          const by0 = b[3];
          const cx0 = kx * CHUNK_CELLS;
          const cy0 = ky * CHUNK_CELLS;
          if (bx0 + b[4] + 8 < cx0 || bx0 - 8 > cx0 + CHUNK_CELLS) continue;
          if (by0 + b[5] + 6 < cy0 || by0 - 20 > cy0 + CHUNK_CELLS) continue;
          blds.push(b);
          civs.add(b[10]);
        }
      }
    }
    const colors = {};
    for (const id of civs) colors[id] = this.colorOf(id);
    return { kx, ky, cells, blds, colors, chunksX: this.chunksX };
  }

  /** Living realms, largest first. */
  ranking() {
    return [...this.civs.values()].filter((c) => c.alive).sort((a, b) => b.pop - a.pop);
  }

  player() {
    for (const c of this.civs.values()) if (c.player && c.alive) return c;
    return null;
  }
}
