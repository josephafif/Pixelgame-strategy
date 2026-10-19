// What the simulator tells the screen: the world once, then changes. The
// client keeps a mirror of realms, towns, territory, the town grid (per
// chunk of 64×64 cells), armies, routes and the chronicle.

import { CHUNK_CELLS } from './town.js';

/** The world's terrain and the fixed facts the client needs. */
export function initPayload(sim) {
  const w = sim.world;
  return {
    t: 'init',
    world: {
      seed: w.seed,
      width: w.width,
      height: w.height,
      biome: w.biome,
      height01: w.height01,
      feature: w.feature,
      river: w.river,
      temp: w.temp,
      moist: w.moist,
      waterDist: w.waterDist,
      landDist: w.landDist,
      thresholds: w.thresholds,
      volcanoes: w.volcanoes,
      climate: w.climate,
      coast: w.coast,
      part: w.part,
      food: w.food,
      deposit: w.deposit,
      size: w.size,
    },
    opts: sim.opts,
    settings: sim.settings,
    seed: sim.seed,
    CW: sim.layout.CW,
    CH: sim.layout.CH,
    chunksX: sim.layout.chunksX,
    chunksY: sim.layout.chunksY,
  };
}

/** Remembers what the client already has. */
export class Tracker {
  constructor() {
    this.events = 0;
    this.tradeVer = -1;
    this.faiths = 0;
    this.first = true;
  }
}

export function civView(sim, c) {
  return {
    id: c.id,
    name: c.name,
    names: c.names,
    color: c.color,
    culture: c.culture,
    era: c.era,
    gov: c.gov,
    alive: c.alive,
    capital: c.capital,
    religion: c.religion,
    stability: c.stability,
    wealth: c.wealth,
    income: c.income,
    pop: c.stats.pop,
    land: c.stats.land,
    towns: c.stats.towns,
    urban: c.stats.urban,
    army: c.stats.army,
    techs: [...c.techs],
    research: c.research,
    progress: c.progress,
    policy: c.policy,
    auto: c.auto,
    traits: c.traits,
    player: c.player,
    wars: [...c.wars],
    allies: [...c.allies],
    truce: [...c.truce],
    relations: [...c.relations].map(([id, r]) => [id, Math.round(r.opinion)]),
    founded: c.founded,
    fell: c.fell,
    parent: c.parent,
    goldenAge: c.goldenAge,
    histStart: c.histStart,
  };
}

export function townView(t) {
  return {
    id: t.id,
    civ: t.civ,
    name: t.name,
    x: t.x,
    y: t.y,
    pop: Math.round(t.pop),
    K: Math.round(t.K),
    urban: Math.round(t.urban),
    capital: t.capital,
    port: t.port,
    walls: t.walls,
    religion: t.religion,
    plague: t.plague,
    alive: t.alive,
    founded: t.founded,
    culture: t.culture,
    sacked: t.sacked,
    routes: t.routes,
  };
}

/**
 * Everything that changed since the last call. `maxChunks` bounds the town
 * grid sent at once (the rest follows next time).
 */
export function delta(sim, tr, { maxChunks = 48 } = {}) {
  const out = { t: 'delta', year: sim.year, month: sim.month, tick: sim.tick };
  const transfer = [];
  const first = tr.first;
  tr.first = false;
  // Realms and towns.
  const civIds = first ? sim.civs.map((c, i) => i).filter((i) => i) : [...sim.dirtyCivs];
  out.civs = civIds.map((id) => civView(sim, sim.civs[id]));
  sim.dirtyCivs.clear();
  const townIds = first ? sim.towns.map((t, i) => i).filter((i) => i) : [...sim.dirtyTowns];
  out.towns = townIds.map((id) => townView(sim.towns[id]));
  sim.dirtyTowns.clear();
  // Territory.
  const ch = sim.ownerChanged;
  if (first || ch.length > sim.owner.length * 0.04) {
    out.owner = sim.owner.slice();
    transfer.push(out.owner.buffer);
  } else if (ch.length) {
    const idx = Int32Array.from(ch);
    const val = new Uint16Array(ch.length);
    for (let k = 0; k < ch.length; k++) val[k] = sim.owner[ch[k]];
    out.ownerIdx = idx;
    out.ownerVal = val;
    transfer.push(idx.buffer, val.buffer);
  }
  ch.length = 0;
  // Town grid.
  const L = sim.layout;
  const keys = first ? allChunks(L) : [...L.dirty];
  const chunks = [];
  for (const k of keys) {
    if (chunks.length >= maxChunks) break;
    L.dirty.delete(k);
    if (!first || chunkUsed(L, k)) chunks.push(chunkData(sim, k, transfer));
  }
  if (first) L.dirty.clear();
  out.chunks = chunks;
  // Armies (all, they move).
  out.armies = sim.war.armies.map((a) => [a.id, a.civ, +a.x.toFixed(2), +a.y.toFixed(2), Math.round(a.size), a.mode, a.era, a.target]);
  out.battles = sim.war.battles.filter((b) => sim.year * 12 + sim.month - (b.year * 12 + b.month) < 3);
  // Chronicle.
  if (sim.events.length && tr.events < sim.events[sim.events.length - 1].id) {
    out.events = sim.events.filter((e) => e.id > tr.events);
    tr.events = sim.events[sim.events.length - 1].id;
  }
  // Trade routes.
  if (sim.trade.ver !== tr.tradeVer) {
    tr.tradeVer = sim.trade.ver;
    out.routes = sim.trade.routes.map((r) => ({ a: r.a, b: r.b, sea: r.sea, path: r.path }));
  }
  if (sim.faith.list.length !== tr.faiths || first) {
    tr.faiths = sim.faith.list.length;
    out.faiths = sim.faith.list;
  }
  if (first) out.history = history(sim);
  return { msg: out, transfer };
}

function allChunks(L) {
  const out = [];
  for (let k = 0; k < L.chunksX * L.chunksY; k++) out.push(k);
  return out;
}

function chunkUsed(L, k) {
  const x0 = (k % L.chunksX) * CHUNK_CELLS;
  const y0 = ((k / L.chunksX) | 0) * CHUNK_CELLS;
  for (let y = y0; y < Math.min(L.CH, y0 + CHUNK_CELLS); y++) {
    for (let x = x0; x < Math.min(L.CW, x0 + CHUNK_CELLS); x++) if (L.cell[y * L.CW + x]) return true;
  }
  return false;
}

function chunkData(sim, k, transfer) {
  const L = sim.layout;
  const S = CHUNK_CELLS;
  const x0 = (k % L.chunksX) * S;
  const y0 = ((k / L.chunksX) | 0) * S;
  const cell = new Uint8Array(S * S);
  const aux = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) {
    const cy = y0 + y;
    if (cy >= L.CH) break;
    const w = Math.min(S, L.CW - x0);
    cell.set(L.cell.subarray(cy * L.CW + x0, cy * L.CW + x0 + w), y * S);
    aux.set(L.aux.subarray(cy * L.CW + x0, cy * L.CW + x0 + w), y * S);
  }
  const T = S / 2;
  const tx0 = x0 / 2;
  const ty0 = y0 / 2;
  const cleared = new Uint8Array(T * T);
  for (let y = 0; y < T; y++) {
    const ty = ty0 + y;
    if (ty >= sim.H) break;
    const w = Math.min(T, sim.W - tx0);
    cleared.set(L.cleared.subarray(ty * sim.W + tx0, ty * sim.W + tx0 + w), y * T);
  }
  const blds = L.chunkBuildings(k).map((b) => [b.id, b.kind, b.x, b.y, b.w, b.d, b.era, b.cl, b.v, b.state, b.civ]);
  transfer.push(cell.buffer, aux.buffer, cleared.buffer);
  return { k, cell, aux, cleared, blds };
}

/** Per-realm population and land, sampled every ten years. */
export function history(sim) {
  return {
    years: sim.history.years.slice(),
    world: sim.history.world.slice(),
    civs: sim.civs.filter(Boolean).map((c) => ({ id: c.id, start: c.histStart || 0, pop: c.hist.pop.slice(), land: c.hist.land.slice() })),
  };
}
