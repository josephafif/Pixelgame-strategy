// Saved worlds. The terrain is regenerated from the seed (and checked by
// fingerprint); everything that happened on it is stored: realms, towns,
// territory, roads, every building and street, armies, wars, routes, faiths,
// droughts, the chronicle, history and the random generator's position, so a
// loaded world goes on exactly as it would have.

import { CivSim } from './sim.js';
import { rle, unrle } from '../core/rle.js';
import { mix32 } from '../core/rng.js';

export const SAVE_FORMAT = 'annals-save';
export const SAVE_VERSION = 1;

function fingerprint(world) {
  let h = mix32(world.width * 65537 + world.height);
  const { biome, height01 } = world;
  for (let i = 0; i < biome.length; i += 7) h = mix32(h ^ (biome[i] + ((height01[i] * 1000) | 0) * 31));
  return h >>> 0;
}

const civOut = (c) => c && {
  ...c,
  techs: [...c.techs],
  relations: [...c.relations],
  wars: [...c.wars],
  allies: [...c.allies],
  truce: [...c.truce],
};

const civIn = (c) => c && {
  ...c,
  techs: new Set(c.techs),
  relations: new Map(c.relations),
  wars: new Set(c.wars),
  allies: new Set(c.allies),
  truce: new Map(c.truce),
};

export function saveWorld(sim) {
  const L = sim.layout;
  const lay = [...L.lay].map(([id, l]) => [id, { ...l, rngObj: undefined, marks: [...l.marks], blds: [...l.blds] }]);
  const data = {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    seed: sim.seed,
    opts: sim.opts,
    settings: sim.settings,
    check: fingerprint(sim.world),
    year: sim.year,
    month: sim.month,
    tick: sim.tick,
    rng: [sim.rng.a, sim.rng.b, sim.rng.c, sim.rng.d],
    eventSeq: sim.eventSeq,
    events: sim.events.slice(-1500),
    history: sim.history,
    territoryTimer: sim.territoryTimer,
    civs: sim.civs.map(civOut),
    towns: sim.towns,
    owner: rle(sim.owner),
    road: rle(sim.road),
    layout: {
      cell: rle(L.cell),
      aux: rle(L.aux),
      cleared: rle(L.cleared),
      blds: L.blds,
      free: L.free,
      lay,
      cursor: L.cursor,
    },
    war: { armies: sim.war.armies, wars: [...sim.war.wars], nextId: sim.war.nextId, battles: sim.war.battles },
    trade: { routes: sim.trade.routes.map((r) => ({ ...r, path: Array.from(r.path) })), ver: sim.trade.ver },
    faith: sim.faith.list,
    fate: { droughts: sim.fate.droughts },
  };
  return JSON.stringify(data);
}

export function loadWorld(text) {
  const d = typeof text === 'string' ? JSON.parse(text) : text;
  if (!d || d.format !== SAVE_FORMAT) throw new Error('This is not a saved Annals world.');
  if (d.version !== SAVE_VERSION) throw new Error(`Unsupported save version ${d.version}.`);
  const sim = new CivSim({ ...d.opts, seed: d.seed, settings: d.settings, empty: true });
  if (fingerprint(sim.world) !== d.check) throw new Error('The saved world does not match this version of the world generator.');
  sim.year = d.year;
  sim.month = d.month;
  sim.tick = d.tick;
  [sim.rng.a, sim.rng.b, sim.rng.c, sim.rng.d] = d.rng;
  sim.eventSeq = d.eventSeq;
  sim.events = d.events;
  sim.history = d.history;
  sim.territoryTimer = d.territoryTimer || 0;
  sim.civs = d.civs.map(civIn);
  sim.towns = d.towns;
  sim.grid.clear();
  for (const t of sim.towns) if (t) sim.addToGrid(t);
  sim.townsVer++;
  const n = sim.W * sim.H;
  sim.owner = unrle(d.owner, Uint16Array, n);
  sim.road = unrle(d.road, Uint8Array, n);
  const L = sim.layout;
  const cn = L.CW * L.CH;
  L.cell = unrle(d.layout.cell, Uint8Array, cn);
  L.aux = unrle(d.layout.aux, Uint8Array, cn);
  L.cleared = unrle(d.layout.cleared, Uint8Array, n);
  L.blds = d.layout.blds;
  L.free = d.layout.free;
  L.cursor = d.layout.cursor;
  L.bref = new Int32Array(cn).fill(-1);
  for (const b of L.blds) {
    if (!b) continue;
    for (let j = 0; j < b.d; j++) for (let i = 0; i < b.w; i++) L.bref[(b.y + j) * L.CW + b.x + i] = b.id;
  }
  L.lay = new Map(d.layout.lay.map(([id, l]) => [id, { ...l, marks: new Map(l.marks), blds: new Set(l.blds) }]));
  L.dirty.clear();
  sim.war.armies = d.war.armies;
  sim.war.wars = new Map(d.war.wars);
  sim.war.nextId = d.war.nextId;
  sim.war.battles = d.war.battles || [];
  sim.trade.routes = d.trade.routes.map((r) => ({ ...r, path: Int32Array.from(r.path) }));
  sim.trade.ver = d.trade.ver;
  sim.trade.pairs.clear();
  for (const r of sim.trade.routes) {
    const a = sim.towns[r.a];
    const b = sim.towns[r.b];
    if (a && b && a.civ !== b.civ) sim.trade.pairs.add(a.civ < b.civ ? `${a.civ}:${b.civ}` : `${b.civ}:${a.civ}`);
  }
  sim.faith.list = d.faith;
  sim.fate.droughts = d.fate.droughts || [];
  for (const dr of sim.fate.droughts) {
    for (let y = Math.max(0, dr.y - dr.r); y <= Math.min(sim.H - 1, dr.y + dr.r); y++) {
      for (let x = Math.max(0, dr.x - dr.r); x <= Math.min(sim.W - 1, dr.x + dr.r); x++) if (Math.hypot(x - dr.x, y - dr.y) <= dr.r) sim.yieldMod[y * sim.W + x] = 0.55;
    }
  }
  sim.ownerChanged.length = 0;
  sim.dirtyTowns.clear();
  sim.dirtyCivs.clear();
  sim.recomputeTerritory();
  sim.ownerChanged.length = 0;
  return sim;
}

/** Short description for the menu. */
export function describe(d) {
  const civs = d.civs.filter((c) => c && c.alive);
  const player = d.civs.find((c) => c && c.player);
  return { year: d.year, realms: civs.length, size: d.opts.size, seed: d.seed, player: player ? player.name : null };
}
