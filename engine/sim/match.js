// The authoritative match. Every land tile has an owner (a player or
// nobody). Players grow people with the land and towns they hold; gold and
// people raise squads of soldiers that march out from towns and outposts,
// claim the land they stand on and fight anyone who is not an ally. Towns,
// ports and outposts are the only buildings; towns grow on their own as
// pixel-art settlements laid out by the planner.
//
// The same class runs on the multiplayer server and in the single-player
// worker; clients only ever see snapshots.

import { Rng, hash3 } from '../core/rng.js';
import { GridSearch } from '../core/search.js';
import { generateWorld, WORLD_SIZES } from '../world/worldgen.js';
import { canFoundAt, analyzeSite, pickStartSites } from '../world/sites.js';
import { kingdomNames } from '../world/names.js';
import { B, isOpenWater } from '../world/biomes.js';
import { occupiedWorldCells } from '../settlement/planner.js';
import { TICK, RULES, TOWN_LEVELS } from './defs.js';
import * as units from './units.js';
import * as territory from './territory.js';
import * as naval from './naval.js';
import * as diplomacy from './diplomacy.js';
import * as structures from './structures.js';
import { applyCommand } from './commands.js';
import { thinkAI } from '../ai/ai.js';

const BASE_COLORS = ['#d23c3c', '#3a68d8', '#e6b422', '#8e44c4', '#20a68c', '#e0702a', '#e05a9a', '#7a9a2a', '#3cb4e6', '#a05a32', '#5a5ae0', '#c0306a', '#2e8a4a', '#d8d040', '#7a4ab0', '#e09a6a', '#40c0a0', '#b04030', '#6a8ae0', '#c070d0', '#909090', '#2a6a8a', '#d0a0a0', '#5a3a2a'];

/** A distinct colour for every player slot. */
export function playerColor(i) {
  if (i < BASE_COLORS.length) return BASE_COLORS[i];
  // Beyond the hand-picked palette: golden-angle hues, alternating lightness.
  const h = (i * 137.508) % 360;
  const l = i % 2 ? 0.45 : 0.6;
  const s = 0.6;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
export const KINGDOM_COLORS = BASE_COLORS;

// Cost of taking a tile, by biome: open ground is quick, mountains are slow.
const TERRAIN = new Map([
  [B.RIVER, 1.8], [B.BEACH, 1], [B.GRASS, 1], [B.MEADOW, 1], [B.FOREST, 1.3], [B.TAIGA, 1.35], [B.MARSH, 1.6],
  [B.DESERT, 1.1], [B.HILLS, 1.5], [B.MOUNTAIN, 2.2], [B.PEAK, 3], [B.SNOW, 1.4], [B.ASH, 1.3],
]);

export const PERSONALITIES = ['builder', 'merchant', 'warlord'];
const W_BIG = 1 << 20; // empty bounding box

export class Match {
  /**
   * opts: { seed, size, players: [{ name, ai?, personality? }], placementTime, timeLimit, difficulty }
   */
  constructor(opts = {}) {
    const seed = opts.seed ?? 1;
    const size = opts.size || 'medium';
    this.opts = { placementTime: 20, timeLimit: 30 * 60, difficulty: 'normal', ...opts, seed, size };
    const dims = WORLD_SIZES[size] || WORLD_SIZES.medium;
    this.world = opts.world || generateWorld({ seed, ...dims });
    this.rng = new Rng(seed ^ 0x5eed);
    const W = this.world.width;
    const H = this.world.height;
    this.W = W;
    this.H = H;
    this.search = new GridSearch(W, H);
    this.layouts = new Map();
    this.owner = new Int16Array(W * H).fill(-1);
    this.struct = new Uint8Array(W * H); // planner structures, so layouts never overlap
    this.analyzeTerrain();
    // Tiles changed since the start, for clients (engine/net/protocol.js).
    this.changeLog = [];
    this.changeSeq = 0;
    this.structAt = new Map();
    this.tradePaths = new Map();
    this.queue = [];
    this.listeners = new Set();
    // Loading a saved game (engine/sim/persist.js) fills in the rest.
    if (opts.restore) return;
    const n = opts.players?.length || 1;
    const names = kingdomNames(seed, n);
    this.state = {
      seed,
      size,
      t: 0,
      tick: 0,
      phase: 'placement',
      placementLeft: this.opts.placementTime,
      players: [],
      structures: [],
      squads: [],
      boats: [],
      alliances: [],
      requests: [],
      events: [],
      survey: null,
      winner: null,
      nextId: 1,
      structV: 0,
    };
    (opts.players || [{ name: 'You' }]).forEach((p, k) => this.state.players.push(this.newPlayer(k, p, names[k] || `Realm ${k + 1}`)));
    this.startSites = pickStartSites(this.world, Math.max(8, Math.min(16, n * 2)));
  }

  newPlayer(id, p, realm) {
    return {
      id,
      name: p.name || realm,
      color: playerColor(id),
      ai: !!p.ai,
      personality: p.personality || (p.ai ? PERSONALITIES[id % 3] : null),
      alive: true,
      spawned: false,
      pop: 0,
      maxPop: 0,
      tiles: 0,
      gold: 0,
      goldRate: 0,
      built: { town: 0, port: 0, outpost: 0 },
      traitorUntil: 0,
      bbox: [W_BIG, W_BIG, -1, -1],
      stats: { maxTiles: 0, taken: 0, lost: 0, trade: 0, raised: 0, lostSoldiers: 0 },
      ai_: {},
    };
  }

  /** Static per-tile tables: what can be owned, its cost, water bodies and coasts. */
  analyzeTerrain() {
    const { W, H } = this;
    const biome = this.world.biome;
    const n = W * H;
    this.land = new Uint8Array(n);
    this.terr = new Float32Array(n);
    let land = 0;
    for (let i = 0; i < n; i++) {
      if (isOpenWater(biome[i])) continue;
      this.land[i] = 1;
      this.terr[i] = TERRAIN.get(biome[i]) || 1;
      land++;
    }
    this.landTotal = land;
    // Water bodies (4-connected open water) and their sizes.
    this.water = new Int32Array(n).fill(-1);
    this.waterSize = [];
    const stack = [];
    for (let i = 0; i < n; i++) {
      if (this.land[i] || this.water[i] >= 0) continue;
      const id = this.waterSize.length;
      let size = 0;
      this.water[i] = id;
      stack.push(i);
      while (stack.length) {
        const j = stack.pop();
        size++;
        const x = j % W;
        const y = (j / W) | 0;
        if (x > 0 && !this.land[j - 1] && this.water[j - 1] < 0) (this.water[j - 1] = id), stack.push(j - 1);
        if (x < W - 1 && !this.land[j + 1] && this.water[j + 1] < 0) (this.water[j + 1] = id), stack.push(j + 1);
        if (y > 0 && !this.land[j - W] && this.water[j - W] < 0) (this.water[j - W] = id), stack.push(j - W);
        if (y < H - 1 && !this.land[j + W] && this.water[j + W] < 0) (this.water[j + W] = id), stack.push(j + W);
      }
      this.waterSize.push(size);
    }
    // Coastal land: the largest water body next to it (ports need one).
    this.coast = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      if (!this.land[i]) continue;
      const x = i % W;
      const y = (i / W) | 0;
      let best = -1;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j < 0 || this.land[j]) continue;
        const b = this.water[j];
        if (best < 0 || this.waterSize[b] > this.waterSize[best]) best = b;
      }
      if (best >= 0 && this.waterSize[best] >= naval.MIN_WATER) this.coast[i] = best;
    }
    this.coastTiles = [];
    for (let i = 0; i < n; i++) if (this.coast[i] >= 0) this.coastTiles.push(i);
  }

  // -------------------------------------------------------------------------
  // Helpers

  nextId() {
    return this.state.nextId++;
  }

  event(kid, kind, text, x = null, y = null) {
    this.state.eventSeq = (this.state.eventSeq || 0) + 1;
    this.state.events.push({ seq: this.state.eventSeq, t: this.state.t, kid, kind, text, x, y });
    if (this.state.events.length > 400) this.state.events.splice(0, this.state.events.length - 300);
  }

  player(id) {
    return this.state.players[id];
  }

  idx(x, y) {
    return y * this.W + x;
  }

  /** Deterministic noise in [0, 1) for a tile and a salt. */
  noise(i, salt) {
    return hash3(i, salt, this.state.seed) / 4294967296;
  }

  /** Soldiers of a player in the field. */
  army(pid) {
    let n = 0;
    for (const sq of this.state.squads) if (sq.owner === pid) n += sq.n;
    return n;
  }

  allied(a, b) {
    return diplomacy.allied(this, a, b);
  }

  /** Does tile i have a 4-neighbour owned by p? */
  touches(i, p) {
    const { W, owner } = this;
    const x = i % W;
    return (x > 0 && owner[i - 1] === p) || (x < W - 1 && owner[i + 1] === p) || (i >= W && owner[i - W] === p) || (i + W < owner.length && owner[i + W] === p);
  }

  /** Change a tile's owner, with all bookkeeping. */
  setOwner(i, p) {
    const old = this.owner[i];
    if (old === p) return;
    const ps = this.state.players;
    if (old >= 0) {
      ps[old].tiles--;
      ps[old].stats.lost++;
    }
    this.owner[i] = p;
    if (p >= 0) {
      const q = ps[p];
      q.tiles++;
      q.stats.taken++;
      if (q.tiles > q.stats.maxTiles) q.stats.maxTiles = q.tiles;
      const x = i % this.W;
      const y = (i / this.W) | 0;
      const bb = q.bbox;
      if (x < bb[0]) bb[0] = x;
      if (y < bb[1]) bb[1] = y;
      if (x > bb[2]) bb[2] = x;
      if (y > bb[3]) bb[3] = y;
    }
    this.changeLog.push(i);
    this.changeSeq++;
    const sid = this.structAt.get(i);
    if (sid !== undefined) structures.captured(this, sid, old, p);
  }

  /** Total town levels a player holds (each adds people and gold). */
  townLevels(pid) {
    let n = 0;
    let pop = 0;
    for (const s of this.state.structures) {
      if (s.owner !== pid || s.kind !== 'town') continue;
      n += s.level;
      pop += TOWN_LEVELS[s.level].pop;
    }
    return { levels: n, pop };
  }

  // -------------------------------------------------------------------------
  // Spawning

  /** Why a player cannot start at (x, y), or null. */
  spawnError(x, y) {
    if (!canFoundAt(this.world, x, y)) return 'Pick open land to start on.';
    const i = this.idx(x, y);
    if (this.owner[i] >= 0) return 'Someone already holds that land.';
    for (const p of this.state.players) {
      if (!p.spawned || !p.spawnAt) continue;
      if (Math.hypot(p.spawnAt[0] - x, p.spawnAt[1] - y) < RULES.spawnSpacing) return 'Too close to another realm.';
    }
    const a = analyzeSite(this.world, x, y, { r: 6 });
    if (a.buildable < 40) return 'Not enough open land for a town.';
    return null;
  }

  spawn(pid, x, y) {
    const p = this.state.players[pid];
    const R = RULES.spawnRadius;
    // The land around the town that can be walked to from it (never across water).
    const start = this.idx(x, y);
    const queue = [start];
    const seen = new Set(queue);
    for (let k = 0; k < queue.length; k++) {
      const i = queue[k];
      if (this.owner[i] < 0) this.setOwner(i, pid);
      const ix = i % this.W;
      for (const j of [ix > 0 ? i - 1 : -1, ix < this.W - 1 ? i + 1 : -1, i - this.W, i + this.W]) {
        if (j < 0 || j >= this.owner.length || seen.has(j) || !this.land[j] || this.owner[j] >= 0) continue;
        const dx = (j % this.W) - x;
        const dy = ((j / this.W) | 0) - y;
        if (dx * dx + dy * dy > R * R + 1) continue;
        seen.add(j);
        queue.push(j);
      }
    }
    p.spawned = true;
    p.spawnAt = [x, y];
    p.pop = RULES.startPop;
    p.gold = RULES.startGold;
    const town = structures.create(this, 'town', pid, x, y, { capital: true });
    // A small starting army waits at the gate.
    RULES.startArmy.forEach(([type, n], k) => {
      const [dx, dy] = [[1, 1], [-1, 1], [0, 2]][k % 3];
      const sq = { id: this.nextId(), owner: pid, type, n, x: town.x + dx, y: town.y + dy, post: [town.x + dx, town.y + dy], path: null, pi: 0, pf: 0, state: 'idle', dest: null, cp: 0, born: this.state.t };
      this.state.squads.push(sq);
    });
    this.updatePeople(p, 0);
    this.event(-1, 'spawn', `${p.name} rises.`, x, y);
  }

  /** Spread-out starting spots for players who did not choose one. */
  pickSpawn() {
    const taken = this.state.players.filter((p) => p.spawnAt).map((p) => p.spawnAt);
    let best = null;
    for (let k = 0; k < 160; k++) {
      const x = this.rng.int(8, this.W - 9);
      const y = this.rng.int(8, this.H - 9);
      if (this.spawnError(x, y)) continue;
      let d = Infinity;
      for (const [tx, ty] of taken) d = Math.min(d, Math.hypot(tx - x, ty - y));
      if (!taken.length) d = 1000 - Math.hypot(x - this.W / 2, y - this.H / 2);
      const score = d + this.rng.next() * 6;
      if (!best || score > best.score) best = { x, y, score };
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // People and gold

  updatePeople(p, dt) {
    const towns = this.townLevels(p.id);
    p.maxPop = RULES.baseMaxPop + p.tiles * RULES.popPerTile + towns.pop;
    if (dt > 0) {
      if (p.pop < p.maxPop) p.pop += RULES.growth * p.pop * (1 - p.pop / p.maxPop) * dt + 0.5 * dt;
      else p.pop -= (p.pop - p.maxPop) * RULES.overflowDecay * dt;
    }
    p.goldRate = p.pop * RULES.goldPerPerson + towns.levels * RULES.goldPerTown;
    p.gold += p.goldRate * dt;
  }

  // -------------------------------------------------------------------------
  // Survey: who borders whom, coasts, label positions (once a second)

  survey() {
    const { W, H, owner } = this;
    const ps = this.state.players;
    const n = ps.length;
    const N1 = n + 1;
    const contact = new Int32Array(n * N1); // [p][q+1], q = -1 is unclaimed land
    const sample = new Int32Array(n * N1).fill(-1); // one target tile per contact
    const pick = new Float64Array(n * N1);
    const coast = new Int32Array(n);
    const bbox = ps.map(() => [W, H, -1, -1]);
    const land = this.land;
    const seed = this.state.tick;
    const touch = (o, j) => {
      const k = o * N1 + owner[j] + 1;
      contact[k]++;
      const r = hash3(j, seed, 77) / 4294967296;
      if (r >= pick[k]) {
        pick[k] = r;
        sample[k] = j;
      }
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const o = owner[i];
        if (o < 0) continue;
        const bb = bbox[o];
        if (x < bb[0]) bb[0] = x;
        if (y < bb[1]) bb[1] = y;
        if (x > bb[2]) bb[2] = x;
        if (y > bb[3]) bb[3] = y;
        if (this.coast[i] >= 0) coast[o]++;
        if (x < W - 1 && land[i + 1] && owner[i + 1] !== o) touch(o, i + 1);
        if (x > 0 && land[i - 1] && owner[i - 1] !== o) touch(o, i - 1);
        if (y < H - 1 && land[i + W] && owner[i + W] !== o) touch(o, i + W);
        if (y > 0 && land[i - W] && owner[i - W] !== o) touch(o, i - W);
      }
    }
    // contacts[p] = [[q, border length, a tile of q's on the border], ...]
    const out = { tick: this.state.tick, neutral: [], contacts: [], coast: [...coast], labels: this.state.survey?.labels || [] };
    for (let p = 0; p < n; p++) {
      ps[p].bbox = bbox[p];
      out.neutral.push([contact[p * N1], sample[p * N1]]);
      const c = [];
      for (let q = 0; q < n; q++) if (contact[p * N1 + q + 1]) c.push([q, contact[p * N1 + q + 1], sample[p * N1 + q + 1]]);
      out.contacts.push(c);
    }
    if (this.state.tick % Math.round(2 / TICK) < Math.round(1 / TICK) || !out.labels.length) out.labels = this.labelSpots();
    this.state.survey = out;
  }

  /** Where to write each player's name: the point deepest inside its land. */
  labelSpots() {
    const { W, H, owner } = this;
    const n = W * H;
    const d = new Uint16Array(n);
    // Two-pass chamfer distance (3-4) to the nearest tile of another owner.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const o = owner[i];
        if (o < 0 || x === 0 || y === 0 || x === W - 1 || y === H - 1) continue;
        if (owner[i - 1] !== o || owner[i + 1] !== o || owner[i - W] !== o || owner[i + W] !== o) {
          d[i] = 3;
          continue;
        }
        d[i] = Math.min(d[i - 1] + 3, d[i - W] + 3, d[i - W - 1] + 4, d[i - W + 1] + 4);
      }
    }
    const ps = this.state.players;
    const best = ps.map(() => [0, 0, 0]);
    for (let y = H - 2; y > 0; y--) {
      for (let x = W - 2; x > 0; x--) {
        const i = y * W + x;
        if (!d[i]) continue;
        const v = Math.min(d[i], d[i + 1] + 3, d[i + W] + 3, d[i + W + 1] + 4, d[i + W - 1] + 4);
        d[i] = v;
        const b = best[owner[i]];
        if (v > b[2]) {
          b[0] = x;
          b[1] = y;
          b[2] = v;
        }
      }
    }
    return best.map((b, k) => (ps[k].tiles ? [b[0], b[1], Math.round((b[2] / 3) * 10) / 10] : null));
  }

  // -------------------------------------------------------------------------
  // Commands and ticking

  /** Queue a command from player pid. */
  command(pid, cmd) {
    this.queue.push({ kid: pid, cmd });
    return { ok: true };
  }

  /** Apply a command immediately (used by AI, tests and the queue). */
  exec(pid, cmd) {
    try {
      const r = applyCommand(this, pid, cmd);
      // Rejected commands are reported to human players; AIs simply try something else.
      if (r && r.error && pid >= 0 && !this.state.players[pid]?.ai) this.event(pid, 'error', r.error);
      return r || { ok: true };
    } catch (e) {
      if (pid >= 0) this.event(pid, 'error', `Command failed: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  step() {
    const st = this.state;
    const dt = TICK;
    const q = this.queue;
    this.queue = [];
    for (const { kid, cmd } of q) this.exec(kid, cmd);
    if (st.phase === 'placement') {
      if (this.opts.placementTime > 0) st.placementLeft -= dt;
      const humansIn = st.players.every((p) => p.ai || p.spawned);
      if ((this.opts.placementTime > 0 && st.placementLeft <= 0) || (this.opts.placementTime <= 0 && humansIn)) this.finishPlacement();
      st.tick++;
      return;
    }
    if (st.phase === 'over') return;
    st.t += dt;
    st.tick++;
    // Periodic work, spread over different ticks so no single tick does all of it.
    const every = (sec, offset = 0) => (st.tick + offset) % Math.round(sec / dt) === 0;
    for (const p of st.players) if (p.alive) this.updatePeople(p, dt);
    units.tick(this, dt);
    units.upkeep(this, dt);
    if (every(RULES.claimEvery, 2)) units.claim(this);
    if (every(1)) units.merge(this);
    if (every(RULES.townClaimEvery, 3)) territory.townClaims(this);
    if (every(RULES.annexEvery, 15)) territory.annex(this);
    naval.tick(this, dt);
    structures.tick(this);
    if (every(1)) {
      diplomacy.tick(this);
      this.survey();
      this.checkVictory();
    }
    for (const p of st.players) {
      if (!p.ai || !p.alive) continue;
      if ((st.tick + p.id * 3) % 10 === 0) thinkAI(this, p);
    }
    if (this.changeLog.length > 400000) this.changeLog.splice(0, this.changeLog.length - 200000);
  }

  finishPlacement() {
    const st = this.state;
    // Humans who didn't choose get a spot first, then the AIs.
    const order = [...st.players.filter((p) => !p.ai && !p.spawned), ...st.players.filter((p) => p.ai && !p.spawned)];
    for (const p of order) {
      const s = this.pickSpawn();
      if (s) this.spawn(p.id, s.x, s.y);
      else {
        p.alive = false;
        this.event(-1, 'info', `${p.name} found no land to settle.`);
      }
    }
    st.phase = 'running';
    this.survey();
    this.event(-1, 'info', 'The race for land begins.');
  }

  // -------------------------------------------------------------------------
  // Victory

  checkVictory() {
    const st = this.state;
    // A realm that has lost its last town, port and outpost holds out for a
    // minute (its soldiers may take one back), then falls.
    const has = new Uint8Array(st.players.length);
    for (const s of st.structures) if (s.owner >= 0) has[s.owner] = 1;
    for (const p of st.players) {
      if (!p.alive || !p.spawned) continue;
      if (has[p.id]) p.homeless = 0;
      else {
        p.homeless = (p.homeless || 0) + 1;
        if (p.homeless === 1) this.event(p.id, 'warning', 'You have lost every town and outpost. Take one back within a minute or your realm falls.');
        if (p.homeless > 60 || !st.squads.some((sq) => sq.owner === p.id)) this.eliminate(p);
      }
    }
    const living = st.players.filter((p) => p.alive);
    if (st.players.length > 1 && living.length === 1) return this.end(living[0], 'conquest');
    for (const p of living) if (p.tiles >= this.landTotal * RULES.winShare) return this.end(p, 'domination');
    if (this.opts.timeLimit > 0 && st.t >= this.opts.timeLimit) {
      const best = [...living].sort((a, b) => b.tiles - a.tiles)[0];
      if (best) return this.end(best, 'time');
    }
    return null;
  }

  eliminate(p) {
    p.alive = false;
    p.pop = 0;
    const st = this.state;
    st.squads = st.squads.filter((sq) => sq.owner !== p.id);
    st.boats = st.boats.filter((b) => b.owner !== p.id);
    st.alliances = st.alliances.filter((a) => a.a !== p.id && a.b !== p.id);
    st.requests = st.requests.filter((r) => r.from !== p.id && r.to !== p.id);
    // Its land goes back to the wilds.
    for (let i = 0; i < this.owner.length; i++) if (this.owner[i] === p.id) this.setOwner(i, -1);
    this.event(-1, 'fall', `${p.name} has fallen.`);
  }

  end(p, how) {
    const st = this.state;
    st.phase = 'over';
    st.winner = { kid: p.id, how };
    const text = { conquest: 'is the last realm standing', domination: `holds ${Math.round(RULES.winShare * 100)}% of all land`, time: 'holds the most land when time runs out' }[how];
    this.event(-1, 'victory', `${p.name} ${text}.`);
    return st.winner;
  }

  // -------------------------------------------------------------------------
  // Settlement layouts

  /** After a layout changes: mark its cells so other layouts keep clear. */
  layoutChanged(s) {
    const L = this.layouts.get(s.id);
    for (const [x, y] of occupiedWorldCells(L)) if (x >= 0 && y >= 0 && x < this.W && y < this.H) this.struct[y * this.W + x] = 1;
    s.layoutV = L.v;
  }
}
