// The civilization simulator: peoples who farm the land, grow into towns,
// learn, trade, worship, quarrel and go to war, over thousands of years.
//
// Time runs in months. Every month armies march and fight; every year each
// town grows or shrinks towards what its land can feed, each realm studies,
// decides and keeps (or loses) its people's loyalty. The work of a year is
// spread over its twelve months (a twelfth of the towns and realms each
// month), so no single month is slow.
//
// Everything is deterministic from the seed and the commands given.

import { Rng } from '../core/rng.js';
import { MinHeap } from '../core/heap.js';
import { B } from '../world/biomes.js';
import { makeWorld, isSea, isOpen } from './world.js';
import { ERAS, TECH, available, eraOf, has } from './tech.js';
import { CULTURES, cultureFor, townName, peopleName, realmName, nameRng, GOV } from './names.js';
import { Towns } from './town.js';
import { War } from './war.js';
import { Trade } from './trade.js';
import { Faith } from './religion.js';
import { Fate } from './fate.js';
import { decide } from './ai.js';

export const PEOPLE_PER_FOOD = 300;

export const DEFAULTS = {
  growth: 1, // population growth
  tech: 1, // pace of learning
  aggression: 1, // how readily realms go to war
  disasters: 1, // plagues, famines, quakes
  newPeoples: true, // new tribes appear on empty land
};

/** Year → "3200 BCE" / "1243 CE". */
export function yearText(y) {
  return y < 0 ? `${-y} BCE` : `${y} CE`;
}

const COLORS = ['#d24a3c', '#3c6fd2', '#e0b030', '#8e4cc4', '#22a68c', '#e07a2a', '#d85a9a', '#6c8a2a', '#3cb4e6', '#a05a32', '#5a5ad8', '#c83a6a', '#2a8a4a', '#b8a03a', '#7a3a9a', '#e05050', '#3a9ab8', '#9ab83a', '#d8883a', '#5a3a8a', '#3ab87a', '#b83a3a', '#6a8ad8', '#c8a07a'];

export class CivSim {
  /**
   * opts: { seed, size, peoples (number of starting tribes), startYear,
   * landFraction, settings }
   */
  constructor(opts = {}) {
    this.seed = opts.seed ?? 1;
    this.opts = { size: 'medium', peoples: 14, startYear: -4000, landFraction: 0.42, ...opts };
    this.settings = { ...DEFAULTS, ...(opts.settings || {}) };
    this.world = opts.world || makeWorld({ seed: this.seed, size: this.opts.size, landFraction: this.opts.landFraction });
    const { width: W, height: H } = this.world;
    this.W = W;
    this.H = H;
    this.rng = new Rng(this.seed ^ 0x51a7c0de);
    this.year = this.opts.startYear;
    this.month = 0;
    this.tick = 0;
    this.civs = [null];
    this.towns = [null];
    this.owner = new Uint16Array(W * H); // town id per tile, 0 = wild
    this.road = new Uint8Array(W * H); // 1 track, 2 paved road, 3 railway
    this.yieldMod = new Float32Array(W * H).fill(1); // droughts and blights
    this.events = [];
    this.eventSeq = 0;
    this.history = { years: [], world: [] };
    this.dirtyTowns = new Set();
    this.townsVer = 0;
    this.dirtyCivs = new Set();
    this.territoryDirty = true;
    this.territoryTimer = 0;
    this.ownerChanged = [];
    this.contacts = new Map(); // civ id -> Set(civ id)
    this.grid = new Map(); // spatial buckets of towns
    this.layout = new Towns(this);
    this.war = new War(this);
    this.trade = new Trade(this);
    this.faith = new Faith(this);
    this.fate = new Fate(this);
    this.siteList = this.buildSiteList();
    if (!opts.empty) this.populate(this.opts.peoples);
    this.recomputeTerritory();
    for (const t of this.liveTowns()) this.layout.found(t);
  }

  // -------------------------------------------------------------------------
  // Setup

  /** The best places to found towns: local maxima of site quality. */
  buildSiteList() {
    const { W, H } = this;
    const site = this.world.site;
    const out = [];
    for (let y = 2; y < H - 2; y++) {
      for (let x = 2; x < W - 2; x++) {
        const i = y * W + x;
        const s = site[i];
        if (s < 4) continue;
        let best = true;
        for (let dy = -2; dy <= 2 && best; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if ((dx || dy) && site[i + dy * W + dx] > s) {
              best = false;
              break;
            }
          }
        }
        if (best) out.push(i);
      }
    }
    out.sort((a, b) => site[b] - site[a]);
    return out;
  }

  /** Place the first peoples on the best land, spread apart. */
  populate(n) {
    const { W } = this;
    const minD = Math.sqrt((this.W * this.H * 0.42) / Math.max(1, n)) * 0.55;
    const placed = [];
    for (const i of this.siteList) {
      if (placed.length >= n) break;
      const x = i % W;
      const y = (i / W) | 0;
      if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < minD)) continue;
      if (this.world.partSize[this.world.part[i]] < 40) continue;
      placed.push({ x, y });
      this.newCiv(x, y, { pop: this.rng.int(600, 1400) });
    }
  }

  /** A new people with one town at (x, y). */
  newCiv(x, y, { pop = 800, culture = null, parent = null, names = null, gov = 0, techs = null, color = null } = {}) {
    const id = this.civs.length;
    const i = y * this.W + x;
    const k = culture ?? cultureFor(this.world.climate[i], this.rng);
    const nr = nameRng(this.seed, id * 977 + 13);
    const civ = {
      id,
      alive: true,
      culture: k,
      names: names || peopleName(k, nr),
      color: color || this.freeColor(),
      gov,
      name: '',
      capital: 0,
      techs: new Set(techs || ['agriculture']),
      era: 0,
      research: null,
      progress: 0,
      stability: 70,
      wealth: 50,
      income: 0,
      religion: 0,
      traits: {
        aggression: this.rng.next(),
        expansion: 0.3 + this.rng.next() * 0.7,
        trade: this.rng.next(),
        science: this.rng.next(),
        piety: this.rng.next(),
      },
      policy: { growth: 0.5, science: 0.5, military: 0.3, trade: 0.5, expansion: 0.5 },
      auto: { research: true, expansion: true, diplomacy: true, military: true },
      player: false,
      relations: new Map(),
      wars: new Set(),
      allies: new Set(),
      truce: new Map(),
      founded: this.year,
      parent,
      nextColony: this.year + this.rng.int(5, 30),
      goldenAge: 0,
      losses: 0,
      warWeary: 0,
      stats: { pop: 0, land: 0, towns: 0, urban: 0, army: 0 },
      hist: { pop: [], land: [], era: [] },
      histStart: this.history.years.length,
      fell: null,
    };
    civ.era = eraOf(civ.techs);
    civ.name = realmName(civ);
    this.civs.push(civ);
    this.dirtyCivs.add(id);
    const t = this.newTown(civ, x, y, pop, true);
    civ.capital = t.id;
    return civ;
  }

  freeColor() {
    const used = new Set(this.civs.filter((c) => c && c.alive).map((c) => c.color));
    const free = COLORS.filter((c) => !used.has(c));
    if (free.length) return free[this.rng.int(0, free.length - 1)];
    const h = this.rng.int(0, 359);
    return hsl(h, 0.55, 0.5);
  }

  newTown(civ, x, y, pop, capital = false) {
    const id = this.towns.length;
    const i = y * this.W + x;
    const t = {
      id,
      civ: civ.id,
      name: townName(civ.culture, nameRng(this.seed, id * 31 + 7)),
      x,
      y,
      i,
      founded: this.year,
      pop,
      K: pop * 1.5,
      land: 0,
      urban: 0,
      capital,
      alive: true,
      culture: civ.culture,
      religion: civ.religion,
      coast: this.world.coast[i] === 1,
      port: false,
      walls: 0,
      plague: 0,
      unrest: 0,
      reach: 1,
      tiles: 0,
      sacked: 0,
      routes: 0,
    };
    this.towns.push(t);
    this.townsVer++;
    this.addToGrid(t);
    this.dirtyTowns.add(id);
    this.territoryDirty = true;
    return t;
  }

  addToGrid(t) {
    const k = ((t.y >> 4) << 16) | (t.x >> 4);
    let b = this.grid.get(k);
    if (!b) this.grid.set(k, (b = []));
    b.push(t.id);
  }

  removeFromGrid(t) {
    const k = ((t.y >> 4) << 16) | (t.x >> 4);
    const b = this.grid.get(k);
    if (b) {
      const j = b.indexOf(t.id);
      if (j >= 0) b.splice(j, 1);
    }
  }

  /** Living towns within r tiles of (x, y). */
  townsNear(x, y, r) {
    const out = [];
    for (let by = (y - r) >> 4; by <= (y + r) >> 4; by++) {
      for (let bx = (x - r) >> 4; bx <= (x + r) >> 4; bx++) {
        const b = this.grid.get((by << 16) | bx);
        if (!b) continue;
        for (const id of b) {
          const t = this.towns[id];
          if (t.alive && Math.hypot(t.x - x, t.y - y) <= r) out.push(t);
        }
      }
    }
    return out;
  }

  *liveTowns() {
    for (let i = 1; i < this.towns.length; i++) if (this.towns[i].alive) yield this.towns[i];
  }

  *liveCivs() {
    for (let i = 1; i < this.civs.length; i++) if (this.civs[i].alive) yield this.civs[i];
  }

  /** A realm's living towns (cached until a town is founded, changes hands or dies). */
  townsOf(civ) {
    if (this._byCivVer !== this.townsVer) {
      const m = new Map();
      for (const t of this.liveTowns()) {
        let a = m.get(t.civ);
        if (!a) m.set(t.civ, (a = []));
        a.push(t);
      }
      this._byCiv = m;
      this._byCivVer = this.townsVer;
    }
    return (this._byCiv.get(civ.id) || []).slice();
  }

  // -------------------------------------------------------------------------
  // Chronicle

  log(type, text, { x = -1, y = -1, civs = [], weight = 1 } = {}) {
    const e = { id: ++this.eventSeq, year: this.year, month: this.month, type, text, x, y, civs, weight };
    this.events.push(e);
    if (this.events.length > 4000) this.events.splice(0, this.events.length - 3000);
    return e;
  }

  // -------------------------------------------------------------------------
  // Time

  /** Advance one month. */
  step() {
    this.tick++;
    this.war.month();
    const m = this.month;
    for (let i = 1 + m; i < this.towns.length; i += 12) {
      const t = this.towns[i];
      if (t.alive) this.townYear(t);
    }
    for (let i = 1 + m; i < this.civs.length; i += 12) {
      const c = this.civs[i];
      if (c.alive) this.civYear(c);
    }
    this.layout.month();
    if (m === 3) this.fate.year();
    if (m === 6 && this.year % 5 === 0) this.trade.update();
    if (m === 9) this.faith.year();
    if ((this.territoryDirty && m % 4 === 2) || (m === 0 && ++this.territoryTimer >= 6)) {
      this.territoryTimer = 0;
      this.recomputeTerritory();
    }
    this.month++;
    if (this.month >= 12) {
      this.month = 0;
      this.year++;
      if (this.year === 0) this.year = 1;
      if (this.year % 10 === 0) this.sample();
    }
  }

  // -------------------------------------------------------------------------
  // Towns

  townYear(t) {
    const civ = this.civs[t.civ];
    const era = ERAS[civ.era];
    // What the land can feed.
    let K = t.land * era.yield * PEOPLE_PER_FOOD;
    if (has(civ, 'husbandry')) K *= 1.1;
    if (has(civ, 'plough')) K *= 1.15;
    if (has(civ, 'fertilizer')) K *= 1.3;
    if (t.coast && has(civ, 'sailing')) K += 2500 * (1 + civ.era * 0.4);
    K *= 1 + Math.min(0.6, t.routes * 0.08);
    if (t.capital) K *= 1.15;
    K = Math.max(150, K);
    t.K = K;
    // Growth towards it; famine above it.
    const r = 0.016 * this.settings.growth * (1 + civ.policy.growth * 0.5) * (has(civ, 'medicine') ? 1.4 : 1);
    if (t.pop < K) t.pop += t.pop * r * (1 - t.pop / K);
    else {
      const over = t.pop - K;
      t.pop -= over * (has(civ, 'pottery') ? 0.12 : 0.2);
      if (over > K * 0.15) t.unrest = Math.min(1, t.unrest + 0.1);
    }
    t.pop += t.pop * (this.rng.next() - 0.5) * 0.01;
    if (t.plague > 0) {
      t.plague--;
      t.pop *= 1 - (has(civ, 'medicine') ? 0.03 : 0.09);
    }
    t.pop = Math.max(40, t.pop);
    t.unrest = Math.max(0, t.unrest - 0.04);
    // Who lives in town rather than on the farms.
    let rate = era.urban * (t.capital ? 1.8 : 1) * (t.port ? 1.25 : 1) * (1 + Math.min(0.8, t.routes * 0.12));
    if (has(civ, 'engineering')) rate *= 1.2;
    t.urban = Math.min(t.pop * 0.85, t.pop * rate);
    // Harbours and walls.
    if (!t.port && t.coast && has(civ, 'sailing') && t.pop > 1200) {
      t.port = true;
      this.dirtyTowns.add(t.id);
    }
    const wantWalls = (has(civ, 'masonry') && t.urban > 600) || (civ.era === 0 && t.pop > 2500 && civ.wars.size > 0);
    if (wantWalls && !t.walls) {
      t.walls = 1;
      this.dirtyTowns.add(t.id);
    }
    this.dirtyTowns.add(t.id);
  }

  /** How far a town's rule reaches (in crossing cost). */
  reachOf(t) {
    const civ = this.civs[t.civ];
    let r = ERAS[civ.era].reach;
    const s = Math.min(1.7, Math.max(0.55, 0.55 + 0.27 * Math.log10(Math.max(1, t.pop) / 500)));
    r *= s;
    if (t.capital) r *= 1.2;
    if (has(civ, 'law')) r *= 1.08;
    if (has(civ, 'radio')) r *= 1.1;
    return Math.max(1.5, r);
  }

  // -------------------------------------------------------------------------
  // Territory: every town claims the land it reaches most easily, as far as
  // its rule reaches. Mountains, rivers and marshes slow it, so borders
  // follow them; the sea stops it.

  recomputeTerritory() {
    const { W, H } = this;
    const N = W * H;
    const cost = this.world.cost;
    const biome = this.world.biome;
    const dist = (this._tdist ||= new Float32Array(N));
    const tag = (this._ttag ||= new Uint16Array(N));
    dist.fill(Infinity);
    tag.fill(0);
    const heap = new MinHeap();
    const reach = [];
    for (const t of this.liveTowns()) {
      t.reach = this.reachOf(t);
      reach[t.id] = t.reach;
      dist[t.i] = 0;
      tag[t.i] = t.id;
      heap.push(t.i, 0);
    }
    const next = (this._tnext ||= new Uint16Array(N));
    next.fill(0);
    const done = (this._tdone ||= new Uint8Array(N));
    done.fill(0);
    while (heap.size) {
      const c = heap.pop();
      if (done[c]) continue;
      done[c] = 1;
      const id = tag[c];
      next[c] = id;
      const d = dist[c];
      const R = reach[id];
      const x = c % W;
      const y = (c / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = k === 0 ? x + 1 : k === 1 ? x - 1 : x;
        const ny = k === 2 ? y + 1 : k === 3 ? y - 1 : y;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (done[ni]) continue;
        const cc = cost[ni];
        if (cc === Infinity) continue;
        const nd = d + cc / R;
        if (nd > 1 || nd >= dist[ni]) continue;
        dist[ni] = nd;
        tag[ni] = id;
        heap.push(ni, nd);
      }
    }
    // Apply, noting changed tiles; tally land and contacts.
    const changed = this.ownerChanged;
    const owner = this.owner;
    const food = this.world.food;
    const ym = this.yieldMod;
    const land = new Float64Array(this.towns.length);
    const tiles = new Int32Array(this.towns.length);
    const contacts = new Map();
    const touch = (a, b) => {
      let s = contacts.get(a);
      if (!s) contacts.set(a, (s = new Set()));
      s.add(b);
    };
    for (let i = 0; i < N; i++) {
      const o = next[i];
      if (owner[i] !== o) {
        owner[i] = o;
        changed.push(i);
      }
      if (!o) continue;
      land[o] += food[i] * ym[i];
      tiles[o]++;
      const x = i % W;
      if (x + 1 < W) {
        const o2 = next[i + 1];
        if (o2 && o2 !== o) {
          const a = this.towns[o].civ;
          const b = this.towns[o2].civ;
          if (a !== b) {
            touch(a, b);
            touch(b, a);
          }
        }
      }
      if (i + W < N) {
        const o2 = next[i + W];
        if (o2 && o2 !== o) {
          const a = this.towns[o].civ;
          const b = this.towns[o2].civ;
          if (a !== b) {
            touch(a, b);
            touch(b, a);
          }
        }
      }
    }
    // Sea neighbours: ports within reach of each other count as contacts.
    for (const t of this.liveTowns()) {
      t.land = land[t.id];
      t.tiles = tiles[t.id];
    }
    for (const r of this.trade.routes) {
      const a = this.towns[r.a];
      const b = this.towns[r.b];
      if (a && b && a.alive && b.alive && a.civ !== b.civ) {
        touch(a.civ, b.civ);
        touch(b.civ, a.civ);
      }
    }
    this.contacts = contacts;
    this.territoryDirty = false;
    void biome;
  }

  /** Civ that owns tile i (0 = none). */
  civAt(i) {
    const o = this.owner[i];
    return o ? this.towns[o].civ : 0;
  }

  // -------------------------------------------------------------------------
  // Realms

  civYear(civ) {
    const towns = this.townsOf(civ);
    if (!towns.length) {
      this.fall(civ);
      return;
    }
    // Totals.
    let pop = 0;
    let urban = 0;
    let land = 0;
    for (const t of towns) {
      pop += t.pop;
      urban += t.urban;
      land += t.tiles;
    }
    civ.stats.pop = pop;
    civ.stats.urban = urban;
    civ.stats.land = land;
    civ.stats.towns = towns.length;
    civ.stats.army = this.war.soldiersOf(civ.id);
    // Capital.
    let cap = this.towns[civ.capital];
    if (!cap || !cap.alive || cap.civ !== civ.id) {
      cap = towns.reduce((a, b) => (b.pop > a.pop ? b : a));
      for (const t of towns) t.capital = false;
      cap.capital = true;
      civ.capital = cap.id;
      this.territoryDirty = true;
    }
    // Wealth.
    const mult = (has(civ, 'currency') ? 1.3 : 1) * (has(civ, 'banking') ? 1.4 : 1) * (has(civ, 'steam') ? 1.5 : 1);
    let trade = 0;
    for (const t of towns) trade += t.routes;
    civ.income = (urban * 0.004 + trade * 4 * (0.5 + civ.policy.trade)) * mult - civ.stats.army * 0.004;
    civ.wealth = Math.max(0, civ.wealth + civ.income);
    // Learning.
    this.study(civ, towns, urban);
    // Government and loyalty.
    this.govern(civ, towns);
    // Decisions: settle, research, war and peace.
    decide(this, civ, towns);
    this.dirtyCivs.add(civ.id);
  }

  study(civ, towns, urban) {
    let rp = 0;
    for (const t of towns) rp += Math.sqrt(Math.max(1, t.urban)) * 0.35;
    let m = 1;
    if (has(civ, 'writing')) m += 0.3;
    if (has(civ, 'philosophy')) m += 0.25;
    if (has(civ, 'printing')) m += 0.5;
    if (has(civ, 'electricity')) m += 0.3;
    if (civ.goldenAge > 0) {
      m += 0.5;
      civ.goldenAge--;
    }
    m *= 0.6 + civ.policy.science * 0.8;
    m *= 0.85 + civ.traits.science * 0.3;
    rp *= m * this.settings.tech;
    void urban;
    if (!civ.research || civ.techs.has(civ.research)) civ.research = this.chooseTech(civ);
    if (!civ.research) return;
    const tech = TECH[civ.research];
    // Neighbours who know a tech make it cheaper to learn (it spreads).
    const nb = this.contacts.get(civ.id);
    let knew = 0;
    let n = 0;
    if (nb) {
      for (const id of nb) {
        n++;
        if (this.civs[id].techs.has(tech.key)) knew++;
      }
    }
    const cost = tech.cost * (1 - (n ? 0.6 * (knew / n) : 0));
    civ.progress += rp;
    if (civ.progress >= cost) {
      civ.progress -= cost;
      this.learn(civ, tech.key);
      civ.research = this.chooseTech(civ);
    }
  }

  chooseTech(civ) {
    const opts = available(civ.techs);
    if (!opts.length) return null;
    if (civ.player && !civ.auto.research && civ.wish && opts.some((t) => t.key === civ.wish)) return civ.wish;
    // Cheapest first, with a little preference by temperament.
    let best = null;
    let bestS = Infinity;
    for (const t of opts) {
      let s = t.cost * (0.85 + this.rng.next() * 0.3);
      if (civ.traits.aggression > 0.6 && ['bronze', 'iron', 'riding', 'gunpowder', 'rifles', 'feudalism'].includes(t.key)) s *= 0.8;
      if (civ.traits.trade > 0.6 && ['sailing', 'currency', 'navigation', 'guilds', 'banking', 'oceans'].includes(t.key)) s *= 0.8;
      if (civ.traits.piety > 0.6 && ['mysticism', 'monotheism'].includes(t.key)) s *= 0.7;
      if (s < bestS) {
        bestS = s;
        best = t;
      }
    }
    return best.key;
  }

  learn(civ, key) {
    civ.techs.add(key);
    const era = eraOf(civ.techs);
    if (era > civ.era) {
      civ.era = era;
      civ.name = realmName(civ);
      // The first realm into an age makes the chronicle.
      const first = !this.civs.some((c) => c && c !== civ && c.era >= era);
      const cap = this.towns[civ.capital];
      this.log('era', `${civ.name} entered the ${ERAS[era].name}${first ? ', the first in the world' : ''}.`, { x: cap?.x, y: cap?.y, civs: [civ.id], weight: first ? 3 : 1 });
      this.territoryDirty = true;
    }
    this.faith.learned(civ, key);
  }

  govern(civ, towns) {
    const n = towns.length;
    const pop = civ.stats.pop;
    const old = civ.gov;
    let gov = civ.gov;
    const g = GOV[gov].key;
    if (g === 'tribe' && (n >= 3 || civ.era >= 1)) gov = 1;
    if (gov === 1 && civ.era >= 1 && (n >= 4 || pop > 25000)) gov = 2;
    if (gov === 2 && civ.era >= 2 && n >= 16) gov = 3;
    if ((gov === 2 || gov === 3) && civ.era >= 3 && civ.traits.trade > 0.75 && civ.stability > 60 && this.rng.chance(0.01)) gov = 4;
    if (gov === 2 && civ.traits.piety > 0.85 && civ.religion && this.rng.chance(0.004)) gov = 6;
    if (civ.era >= 6 && gov !== 4 && gov !== 5 && this.rng.chance(0.03)) gov = 5;
    if (gov === 3 && n < 8) gov = 2;
    if (gov !== old) {
      civ.gov = gov;
      const before = civ.name;
      civ.name = realmName(civ);
      const cap = this.towns[civ.capital];
      if (gov >= 2) this.log('gov', `${before} became ${theName(civ)}.`, { x: cap?.x, y: cap?.y, civs: [civ.id], weight: gov === 3 ? 2 : 1 });
    } else civ.name = realmName(civ);
    // Loyalty: large, far-flung, war-weary, hungry or divided realms waver.
    const admin = 4 + civ.era * 2 + (has(civ, 'law') ? 4 : 0) + (has(civ, 'feudalism') ? 3 : 0) + (has(civ, 'railways') ? 6 : 0) + (has(civ, 'radio') ? 10 : 0);
    let target = 68;
    if (has(civ, 'philosophy')) target += 4;
    if (gov === 4) target += 4;
    target -= Math.max(0, n - admin) * 2.5;
    target -= civ.warWeary * 0.8;
    const cap = this.towns[civ.capital];
    let far = 0;
    let hungry = 0;
    let other = 0;
    for (const t of towns) {
      const d = Math.hypot(t.x - cap.x, t.y - cap.y);
      if (d > 25 + civ.era * 8) far++;
      if (t.pop > t.K * 1.05) hungry++;
      if (t.religion && civ.religion && t.religion !== civ.religion) other++;
      if (t.culture !== civ.culture) other += 0.5;
    }
    target -= (far / n) * 18 + (hungry / n) * 25 + (other / n) * 14;
    target += civ.policy.growth * 4;
    civ.stability += (Math.max(0, Math.min(100, target)) - civ.stability) * 0.12;
    civ.warWeary = Math.max(0, civ.warWeary * 0.9 - 0.5);
    this.fate.unrest(civ, towns);
  }

  /** A realm that has lost its last town. */
  fall(civ) {
    if (!civ.alive) return;
    civ.alive = false;
    civ.fell = this.year;
    this.war.endAll(civ);
    this.log('fall', `${civ.name} is no more.`, { civs: [civ.id], weight: 2 });
    this.dirtyCivs.add(civ.id);
  }

  /** Hand a town to another realm (conquest, rebellion, treaty). */
  transfer(t, civ, { sack = false } = {}) {
    const old = this.civs[t.civ];
    t.civ = civ.id;
    t.capital = false;
    this.townsVer++;
    t.walls = Math.min(t.walls, 1);
    if (sack) {
      t.pop *= 0.72;
      t.sacked = 40;
      this.layout.damage(t, 0.35);
    }
    if (old && old.capital === t.id) old.capital = 0;
    this.dirtyTowns.add(t.id);
    this.territoryDirty = true;
    this.layout.retag(t);
    if (old && !this.townsOf(old).length) this.fall(old);
  }

  /** Found a new town for a realm, moving settlers from `from`. */
  found(civ, x, y, from = null) {
    const settlers = from ? Math.max(150, Math.min(from.pop * 0.15, 4000)) : 400;
    if (from) from.pop -= settlers;
    const t = this.newTown(civ, x, y, settlers);
    t.religion = from ? from.religion : civ.religion;
    t.culture = from ? from.culture : civ.culture;
    this.layout.found(t);
    return t;
  }

  /** Can a town be founded at tile i (ignoring who could reach it)? */
  canSettle(i, minDist = 6) {
    const b = this.world.biome[i];
    if (isOpen(b) || b === B.RIVER || b === B.PEAK) return false;
    const x = i % this.W;
    const y = (i / this.W) | 0;
    return this.townsNear(x, y, minDist).length === 0;
  }

  // -------------------------------------------------------------------------
  // History

  sample() {
    const h = this.history;
    h.years.push(this.year);
    let world = 0;
    for (const c of this.civs) {
      if (!c) continue;
      const p = c.alive ? Math.round(c.stats.pop) : 0;
      c.hist.pop.push(p);
      c.hist.land.push(c.alive ? c.stats.land : 0);
      c.hist.era.push(c.era);
      world += p;
    }
    h.world.push(world);
  }
}

/** A realm's name mid-sentence ("the Kingdom of X", but plain "Meliia"). */
export function theName(civ) {
  const n = civ.name;
  if (n.startsWith('The ')) return `the ${n.slice(4)}`;
  return n === civ.names.land ? n : `the ${n}`;
}

function hsl(h, s, l) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export { isSea, CULTURES };
