// The authoritative match simulation. It owns the game state, applies
// validated commands, and advances all systems in fixed ticks. It never
// touches rendering: settlement layouts are stable visual data derived
// from gameplay events (a building finished → the planner places it).
//
// The same class runs on the multiplayer server and in the single-player
// worker; clients only ever see snapshots.

import { Rng } from '../core/rng.js';
import { GridSearch } from '../core/search.js';
import { generateWorld, WORLD_SIZES } from '../world/worldgen.js';
import { pickStartSites, pickTradeHubs, canFoundAt, analyzeSite } from '../world/sites.js';
import { placeName, kingdomNames } from '../world/names.js';
import { B, BIOMES } from '../world/biomes.js';
import { createLayout, addBuilding, applyStage, buildWalls, markBlocked, syncWorldRoads, occupiedWorldCells, N as LN, O } from '../settlement/planner.js';
import { TICK, RES_KEYS, STAGES, HOUSE, WALLS, BUILDINGS, RULES } from './defs.js';
import * as economy from './economy.js';
import * as expansion from './expansion.js';
import * as trade from './trade.js';
import * as military from './military.js';
import { applyCommand } from './commands.js';
import { thinkAI } from '../ai/ai.js';

export const KINGDOM_COLORS = ['#d23c3c', '#3a68d8', '#e6b422', '#8e44c4', '#20a68c', '#e0702a', '#e05a9a', '#6c7a2a', '#3cb4e6', '#a05a32', '#f0f0f0', '#404048'];

export class Match {
  /**
   * opts: { seed, size, players: [{ name, ai?, personality? }], placementTime, timeLimit, hubs }
   */
  constructor(opts = {}) {
    const seed = opts.seed ?? 1;
    const size = opts.size || 'medium';
    this.opts = { placementTime: 30, timeLimit: 45 * 60, hubs: { test: 2, small: 3, medium: 4, large: 5 }[size] || 4, ...opts, seed, size };
    const dims = WORLD_SIZES[size] || WORLD_SIZES.medium;
    this.world = opts.world || generateWorld({ seed, ...dims });
    this.rng = new Rng(seed ^ 0x5eed);
    const W = this.world.width;
    const H = this.world.height;
    this.search = new GridSearch(W, H);
    this.layouts = new Map();
    this.owner = new Int32Array(W * H).fill(-1); // settlement id owning each tile
    this.ownerK = new Int8Array(W * H).fill(-1); // kingdom id (-1 none, -2 neutral hub)
    this.roads = new Uint8Array(W * H); // kingdom-built roads
    this.roadMask = new Uint8Array(W * H); // any road (kingdom + settlement streets)
    this.struct = new Uint8Array(W * H); // settlement structures (buildings, fields...)
    this.explored = [];
    this.pathCache = new Map();
    this.queue = [];
    this.territoryDirty = true;
    this.listeners = new Set();
    // Loading a saved game (engine/sim/persist.js) fills in the rest.
    if (opts.restore) return;
    const names = kingdomNames(seed, opts.players?.length || 1);
    this.state = {
      seed,
      size,
      t: 0,
      tick: 0,
      phase: 'placement',
      placementLeft: this.opts.placementTime,
      kingdoms: [],
      settlements: [],
      armies: [],
      parties: [],
      roadJobs: [],
      agreements: [],
      proposals: [],
      hubs: [],
      market: { stock: {}, price: {} },
      events: [],
      winner: null,
      nextId: 1,
      territoryV: 0,
      roadsV: 0,
    };
    (opts.players || [{ name: 'You' }]).forEach((p, k) => {
      this.state.kingdoms.push(this.newKingdom(k, p.name || names[k], p, names[k]));
      this.explored.push(new Uint8Array(W * H));
    });
    trade.initMarket(this);
    // Neutral free cities, grown to full size at the start.
    const hubSites = pickTradeHubs(this.world, this.opts.hubs);
    for (const h of hubSites) this.createHub(h.x, h.y);
    this.startSites = pickStartSites(this.world, Math.max(10, this.state.kingdoms.length * 2), this.state.hubs);
    this.recomputeTerritory();
  }

  newKingdom(id, name, p, realm) {
    return {
      id,
      name: p.name || name,
      realm: realm || name,
      color: KINGDOM_COLORS[id % KINGDOM_COLORS.length],
      ai: !!p.ai,
      personality: p.personality || (p.ai ? ['builder', 'merchant', 'warlord'][id % 3] : null),
      alive: true,
      placed: false,
      capital: -1,
      stock: { food: 160, wood: 160, stone: 40, iron: 0, fuel: 12, herbs: 6, crystal: 0, goods: 6, arms: 16 },
      coin: 160,
      priorities: { food: 3, wood: 2, stone: 2, iron: 2, fuel: 1, herbs: 1, crystal: 1, industry: 2, build: 3 },
      relations: {},
      orders: [],
      rates: {},
      flags: {},
      stats: { pop: 0, soldiers: 0, settlements: 0, workers: 0, idle: 0 },
      score: 0,
      wonderHeld: 0,
      domHeld: 0,
      warWeariness: 0,
      caravans: 0,
      ai_: null,
    };
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

  /** Count a notable happening for the chronicle's statistics. */
  tally(key, n = 1) {
    const t = (this.state.tally ||= {});
    t[key] = (t[key] || 0) + n;
  }

  kingdom(kid) {
    return this.state.kingdoms[kid];
  }

  settlement(sid) {
    return this.state.settlements.find((s) => s.id === sid);
  }

  idx(x, y) {
    return y * this.world.width + x;
  }

  atWar(a, b) {
    if (a < 0 || b < 0 || a === b) return false;
    return this.state.kingdoms[a].relations[b] === 'war';
  }

  settlementsOf(kid) {
    return this.state.settlements.filter((s) => s.kingdom === kid);
  }

  /** Can kingdom kid afford cost (resources + optional coin)? */
  canAfford(kid, cost, mult = 1) {
    const k = this.state.kingdoms[kid];
    for (const [r, v] of Object.entries(cost)) {
      const have = r === 'coin' ? k.coin : k.stock[r] || 0;
      if (have + 1e-9 < v * mult) return false;
    }
    return true;
  }

  pay(kid, cost, mult = 1) {
    const k = this.state.kingdoms[kid];
    for (const [r, v] of Object.entries(cost)) {
      if (r === 'coin') k.coin -= v * mult;
      else k.stock[r] = (k.stock[r] || 0) - v * mult;
    }
  }

  refund(kid, cost, mult = 1) {
    this.pay(kid, cost, -mult);
  }

  storageCap(kid) {
    let cap = RULES.baseStorage;
    for (const s of this.settlementsOf(kid)) {
      cap += 120 + s.stage * 80;
      cap += (s.buildings.granary || 0) * BUILDINGS.granary.effect.storage;
    }
    return cap;
  }

  // -------------------------------------------------------------------------
  // Settlements and layouts

  /** Mark other layouts' structures as blocked inside L, and sync world roads. */
  prepareLayout(L) {
    markBlocked(L, this.struct, this.world);
    syncWorldRoads(this.world, L, this.roads);
  }

  /** After a layout changes: update structure and road masks. */
  layoutChanged(s) {
    const L = this.layouts.get(s.id);
    const W = this.world.width;
    for (const [x, y] of occupiedWorldCells(L)) if (x >= 0 && y >= 0 && x < W && y < this.world.height) this.struct[y * W + x] = 1;
    for (let l = 0; l < LN * LN; l++) {
      if (!L.road[l] && L.occ[l] !== O.PLAZA) continue;
      const x = L.ox + (l % LN);
      const y = L.oy + ((l / LN) | 0);
      if (x >= 0 && y >= 0 && x < W && y < this.world.height) this.roadMask[y * W + x] = 1;
    }
    s.layoutV = L.v;
    this.recalcHousing(s);
  }

  recalcHousing(s) {
    const L = this.layouts.get(s.id);
    let h = STAGES[s.stage].baseHousing;
    let houses = 0;
    for (const b of L.buildings) {
      if (b.kind === 'house' && b.state === 'built') {
        h += HOUSE.capacity[Math.min(3, b.level)];
        houses++;
      }
    }
    s.housing = h;
    s.houses = houses;
  }

  /** Place a planner structure for a settlement. Returns the layout building or null. */
  layoutAdd(s, plan, state = 'built') {
    const L = this.layouts.get(s.id);
    this.prepareLayout(L);
    const b = addBuilding(this.world, L, plan, { state });
    this.layoutChanged(s);
    return b;
  }

  layoutStage(s) {
    const L = this.layouts.get(s.id);
    this.prepareLayout(L);
    applyStage(this.world, L, s.stage);
    this.layoutChanged(s);
  }

  layoutWalls(s, level) {
    const L = this.layouts.get(s.id);
    this.prepareLayout(L);
    buildWalls(this.world, L, level);
    this.layoutChanged(s);
  }

  newSettlement(kid, x, y, { kind = 'town', stage = 0, pop = 10, name = null } = {}) {
    const id = this.nextId();
    const b = this.world.biome[this.idx(x, y)];
    const s = {
      id,
      kingdom: kid,
      name: name || placeName(this.state.seed, id * 7 + x, BIOMES[b].key),
      x,
      y,
      hub: kind === 'hub',
      capital: kind === 'capital',
      stage,
      pop,
      housing: 0,
      houses: 0,
      buildings: {},
      projects: [],
      garrison: { militia: 0, inf: 0, arch: 0, cav: 0, siege: 0 },
      training: [],
      demob: [],
      walls: { level: 0, hp: 0 },
      unrest: 0,
      siege: null,
      site: {},
      jobs: {},
      out: {},
      connected: kind === 'capital' || kind === 'hub',
      founded: this.state.t,
      full: false,
      prosperity: 1,
      layoutV: 0,
    };
    const toward = [];
    const cap = kid >= 0 ? this.settlement(this.state.kingdoms[kid].capital) : null;
    if (cap) toward.push({ x: cap.x, y: cap.y });
    const L = createLayout(this.world, { id, cx: x, cy: y, seed: this.state.seed, kind, toward, worldRoads: this.roads, blocked: this.struct });
    this.layouts.set(id, L);
    this.state.settlements.push(s);
    this.layoutChanged(s);
    this.layoutStage(s);
    this.territoryDirty = true;
    return s;
  }

  createHub(x, y) {
    const s = this.newSettlement(-2, x, y, { kind: 'hub', stage: 4, pop: 600, name: placeName(this.state.seed, x * 31 + y, 'beach') + ' Free City' });
    s.kingdom = -2;
    const plan = ['market', 'temple', 'harbor', 'granary', 'workshop', 'tavern', 'farm', 'farm', 'fishery', 'smithy'];
    for (let i = 0; i < 46; i++) {
      this.layoutAdd(s, 'house');
      if (i % 4 === 1 && plan.length) this.layoutAdd(s, plan.shift());
    }
    this.layoutWalls(s, 2);
    s.walls = { level: 2, hp: WALLS[2].hp };
    this.state.hubs.push({ id: s.id, x: s.x, y: s.y, name: s.name, coastal: !!this.layouts.get(s.id).harbor });
    return s;
  }

  /** Found a kingdom's capital (placement phase). */
  foundCapital(kid, x, y) {
    const k = this.state.kingdoms[kid];
    const s = this.newSettlement(kid, x, y, { kind: 'capital', stage: 1, pop: 36 });
    k.capital = s.id;
    k.placed = true;
    s.capital = true;
    s.connected = true;
    // The lumber camp first (it needs forest, the most contested ground), then
    // homes and fields in turn so that neither crowds the other out.
    for (const plan of ['lumber', 'house', 'house', 'farm', 'house', 'farm', 'house', 'house']) {
      if (plan === 'house') this.layoutAdd(s, 'house');
      else if (this.layoutAdd(s, BUILDINGS[plan].plan)) s.buildings[plan] = (s.buildings[plan] || 0) + 1;
    }
    s.garrison.inf = 6;
    economy.computeSite(this, s);
    this.recalcHousing(s);
    this.revealAround(kid, x, y, 22);
    this.event(-1, 'found', `${k.name} founds the capital ${s.name}.`, x, y);
    return s;
  }

  // -------------------------------------------------------------------------
  // Territory and vision

  recomputeTerritory() {
    const W = this.world.width;
    const { biome } = this.world;
    this.owner.fill(-1);
    const dist = new Float32Array(W * this.world.height).fill(Infinity);
    const sources = [];
    for (const s of this.state.settlements) {
      const towers = s.buildings.tower || 0;
      const r = (s.hub ? 12 : STAGES[s.stage].radius) + Math.min(3, towers) * 1.5;
      sources.push({ idx: this.idx(s.x, s.y), cost0: 0, tag: s.id, limit: r });
    }
    const cost = (from, to, diag) => {
      const b = biome[to];
      if (b === B.SEA || b === B.DEEP || b === B.LAKE) return Infinity;
      const m = BIOMES[b].move;
      const step = diag ? 1.414 : 1;
      if (m === Infinity) return 3 * step; // peaks stop growth quickly but don't cut holes
      return (b === B.RIVER ? 2.5 : 0.7 + m * 0.3) * step;
    };
    this.search.flood({ sources, cost, diag: true, outDist: dist, outTag: this.owner });
    const kingdomOf = new Map(this.state.settlements.map((s) => [s.id, s.kingdom]));
    for (let i = 0; i < this.owner.length; i++) {
      const o = this.owner[i];
      this.ownerK[i] = o < 0 ? -1 : kingdomOf.get(o);
    }
    this.territoryDirty = false;
    this.state.territoryV++;
    for (const s of this.state.settlements) economy.computeSite(this, s);
  }

  revealAround(kid, x, y, r) {
    const ex = this.explored[kid];
    if (!ex) return;
    const W = this.world.width;
    const H = this.world.height;
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= H) continue;
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= W || dx * dx + dy * dy > r2) continue;
        ex[yy * W + xx] = 1;
      }
    }
  }

  vision() {
    for (const s of this.state.settlements) {
      if (s.kingdom < 0) continue;
      this.revealAround(s.kingdom, s.x, s.y, STAGES[s.stage].radius + 4 + (s.buildings.tower || 0) * 4);
    }
    for (const a of this.state.armies) this.revealAround(a.kid, Math.round(a.x), Math.round(a.y), 5);
    for (const p of this.state.parties) this.revealAround(p.kid, Math.round(p.x), Math.round(p.y), p.kind === 'scout' ? 8 : 3);
  }

  /** Is world point visible to kingdom kid right now (for units)? */
  canSee(kid, x, y) {
    if (kid < 0) return true;
    for (const s of this.state.settlements) {
      if (s.kingdom !== kid) continue;
      const r = STAGES[s.stage].radius + 4 + (s.buildings.tower || 0) * 4;
      if ((s.x - x) ** 2 + (s.y - y) ** 2 <= r * r) return true;
    }
    for (const a of this.state.armies) if (a.kid === kid && (a.x - x) ** 2 + (a.y - y) ** 2 <= 36) return true;
    for (const p of this.state.parties) if (p.kid === kid && (p.x - x) ** 2 + (p.y - y) ** 2 <= (p.kind === 'scout' ? 64 : 12)) return true;
    return false;
  }

  // -------------------------------------------------------------------------
  // Movement costs and paths

  /**
   * Step cost for a mover profile. profile: { kid, kind: 'army'|'caravan'|'scout'|'settlers', sea }
   */
  moveCost(profile, i) {
    const b = this.world.biome[i];
    const onRoad = this.roadMask[i];
    if (b === B.SEA || b === B.DEEP || b === B.LAKE) return profile.sea ? 0.45 : Infinity;
    if (b === B.PEAK) return Infinity;
    if (this.struct[i] && !onRoad && profile.kind !== 'army') return 1.6;
    let c = BIOMES[b].move;
    if (b === B.RIVER) c = onRoad ? 0.5 : profile.kind === 'army' ? 6 : 4;
    else if (onRoad) c = 1 / RULES.roadSpeed;
    if (profile.kind === 'army' && !profile.ignoreBorders) {
      const ok = this.ownerK[i];
      if (ok >= 0 && ok !== profile.kid && !this.atWar(profile.kid, ok)) return Infinity; // peace: borders closed
    }
    if (profile.kind === 'caravan') {
      const ok = this.ownerK[i];
      if (ok >= 0 && ok !== profile.kid && this.atWar(profile.kid, ok)) return Infinity;
    }
    return c;
  }

  findPath(profile, fromX, fromY, toX, toY, maxNodes = 120000) {
    const start = this.idx(Math.round(fromX), Math.round(fromY));
    const goal = this.idx(Math.round(toX), Math.round(toY));
    const key = `${profile.kind}:${profile.kid}:${profile.sea ? 1 : 0}${profile.ignoreBorders ? 'b' : ''}:${start}:${goal}:${this.state.roadsV}:${this.state.territoryV}`;
    const hit = this.pathCache.get(key);
    if (hit !== undefined) return hit;
    const cost = (from, to, diag) => {
      const c = this.moveCost(profile, to);
      return c === Infinity ? Infinity : c * (diag ? 1.414 : 1);
    };
    // The start tile may itself be "closed" (an army leaving a town); allow it.
    const path = this.search.astar({ start, goal, target: goal, cost, diag: true, minStep: 0.5, maxNodes });
    if (this.pathCache.size > 600) this.pathCache.clear();
    this.pathCache.set(key, path);
    return path;
  }

  /** Total cost of a path (seconds at base speed). */
  pathCost(profile, path) {
    let c = 0;
    for (let k = 1; k < path.length; k++) c += this.moveCost(profile, path[k]);
    return c;
  }

  /** Advance a mover along its path. speed in tiles/second on cost-1 ground. */
  advance(mover, profile, speed, dt) {
    const W = this.world.width;
    let budget = speed * dt;
    while (budget > 0 && mover.path && mover.pi < mover.path.length - 1) {
      const next = mover.path[mover.pi + 1];
      const cur = mover.path[mover.pi];
      const diag = (next % W !== cur % W) && (((next / W) | 0) !== ((cur / W) | 0));
      const c = this.moveCost(profile, next);
      if (c === Infinity) {
        mover.blocked = true;
        break;
      }
      const stepCost = c * (diag ? 1.414 : 1);
      const need = stepCost * (1 - mover.pf);
      if (budget >= need) {
        budget -= need;
        mover.pi++;
        mover.pf = 0;
      } else {
        mover.pf += budget / stepCost;
        budget = 0;
      }
    }
    if (mover.path && mover.path.length) {
      const a = mover.path[mover.pi];
      const b = mover.path[Math.min(mover.path.length - 1, mover.pi + 1)];
      const ax = a % W;
      const ay = (a / W) | 0;
      const bx = b % W;
      const by = (b / W) | 0;
      mover.x = ax + (bx - ax) * mover.pf;
      mover.y = ay + (by - ay) * mover.pf;
    }
    return !mover.path || mover.pi >= mover.path.length - 1;
  }

  // -------------------------------------------------------------------------
  // Commands and ticking

  /** Queue a command from kingdom kid. Returns { ok, error } after validation. */
  command(kid, cmd) {
    this.queue.push({ kid, cmd });
    return { ok: true };
  }

  /** Apply a command immediately (used by AI, tests and the queue). */
  exec(kid, cmd) {
    try {
      const r = applyCommand(this, kid, cmd);
      // Rejected commands are reported to human players; AIs simply try something else.
      if (r && r.error && kid >= 0 && !this.state.kingdoms[kid]?.ai) this.event(kid, 'error', r.error);
      return r || { ok: true };
    } catch (e) {
      if (kid >= 0) this.event(kid, 'error', `Command failed: ${e.message}`);
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
      const humansPlaced = st.kingdoms.every((k) => k.ai || k.placed);
      if ((this.opts.placementTime > 0 && st.placementLeft <= 0) || (this.opts.placementTime <= 0 && humansPlaced)) this.finishPlacement();
      st.tick++;
      return;
    }
    if (st.phase === 'over') return;
    st.t += dt;
    st.tick++;
    const every = (sec) => st.tick % Math.round(sec / dt) === 0;
    economy.tick(this, dt, every(1));
    expansion.tick(this, dt);
    trade.tick(this, dt, every(5));
    military.tick(this, dt);
    if (every(1)) this.vision();
    if (this.territoryDirty) this.recomputeTerritory();
    if (every(1)) this.checkVictory();
    for (const k of st.kingdoms) {
      if (!k.ai || !k.alive) continue;
      if ((st.tick + k.id * 3) % 8 === 0) thinkAI(this, k);
    }
  }

  finishPlacement() {
    const st = this.state;
    // Humans who didn't choose get the best free suggested site; then AIs.
    const order = [...st.kingdoms.filter((k) => !k.ai && !k.placed), ...st.kingdoms.filter((k) => k.ai && !k.placed)];
    for (const k of order) {
      const site = this.bestFreeSite();
      if (site) this.foundCapital(k.id, site.x, site.y);
      else {
        k.alive = false;
        this.event(-1, 'info', `${k.name} found no land to settle.`);
      }
    }
    for (const a of st.kingdoms) for (const b of st.kingdoms) if (a !== b) a.relations[b.id] = 'peace';
    st.phase = 'running';
    this.recomputeTerritory();
    this.vision();
    this.event(-1, 'info', 'The age of kingdoms begins.');
  }

  /** Validity of a capital location for placement. */
  placementError(x, y) {
    if (!canFoundAt(this.world, x, y)) return 'Cannot settle on that terrain.';
    for (const s of this.state.settlements) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (s.hub && d < 26) return 'Too close to a free city.';
      if (!s.hub && d < 20) return 'Too close to another kingdom.';
    }
    const a = analyzeSite(this.world, x, y, { r: 7 });
    if (a.buildable < 50) return 'Not enough buildable land for a capital.';
    return null;
  }

  bestFreeSite() {
    const free = this.startSites.filter((s) => !this.placementError(s.x, s.y));
    if (free.length) return this.rng.pick(free.slice(0, Math.max(1, Math.min(4, free.length))));
    // Fallback: scan for any valid spot.
    for (let tries = 0; tries < 4000; tries++) {
      const x = this.rng.int(10, this.world.width - 10);
      const y = this.rng.int(10, this.world.height - 10);
      if (!this.placementError(x, y)) return { x, y };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Scoring and victory

  score(k) {
    let pop = 0;
    let soldiers = 0;
    let n = 0;
    for (const s of this.settlementsOf(k.id)) {
      pop += s.pop;
      n++;
      for (const v of Object.values(s.garrison)) soldiers += v;
    }
    for (const a of this.state.armies) if (a.kid === k.id) for (const v of Object.values(a.units)) soldiers += v;
    let worth = k.coin;
    for (const r of RES_KEYS) worth += (k.stock[r] || 0) * (this.state.market.price[r] || 1);
    k.stats.pop = Math.round(pop);
    k.stats.soldiers = Math.round(soldiers);
    k.stats.settlements = n;
    k.score = Math.round(pop + soldiers * 1.5 + n * 25 + worth / 25);
    return k.score;
  }

  checkVictory() {
    const st = this.state;
    for (const k of st.kingdoms) this.score(k);
    const alive = st.kingdoms.filter((k) => k.alive);
    for (const k of alive) {
      const caps = this.settlementsOf(k.id);
      if (!caps.length && k.placed) {
        k.alive = false;
        this.event(-1, 'fall', `${k.name} has fallen.`);
      }
    }
    const living = st.kingdoms.filter((k) => k.alive);
    const total = st.settlements.filter((s) => !s.hub).length;
    const allPop = living.reduce((a, k) => a + k.stats.pop, 0);
    for (const k of living) {
      const mine = this.settlementsOf(k.id).length;
      if (living.length === 1 && st.kingdoms.length > 1) return this.end(k, 'conquest');
      // Domination needs most towns and most people, held long enough for rivals to answer.
      const dominant = living.length > 1 && total >= 8 && mine / total >= RULES.dominationTowns && k.stats.pop >= allPop * RULES.dominationPop;
      if (dominant) {
        if (!k.domHeld) this.event(-1, 'war', `${k.name} dominates the realm: unless rivals take towns back within ${RULES.dominationHold / 60} minutes, it wins.`);
        k.domHeld = (k.domHeld || 0) + 1;
        if (k.domHeld >= RULES.dominationHold) return this.end(k, 'domination');
      } else k.domHeld = 0;
      if (k.wonderHeld >= RULES.wonderHold) return this.end(k, 'prosperity');
    }
    if (this.opts.timeLimit > 0 && st.t >= this.opts.timeLimit) {
      const best = [...living].sort((a, b) => b.score - a.score)[0];
      if (best) return this.end(best, 'score');
    }
    return null;
  }

  end(k, how) {
    const st = this.state;
    st.phase = 'over';
    st.winner = { kid: k.id, how };
    const text = { conquest: 'conquered every rival', domination: 'rules most of the realm', prosperity: 'built the Grand Exchange and held it', score: 'leads when the chronicle closes' }[how];
    this.event(-1, 'victory', `${k.name} ${text}.`);
    return st.winner;
  }
}

