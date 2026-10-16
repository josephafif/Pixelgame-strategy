// Road-first settlement planner.
//
// Pipeline (see docs/DESIGN.md):
//   1. analyse terrain (terrain.js)
//   2. pick destinations: plaza, gates (artery ends), harbour, districts
//   3. route roads between destinations with a terrain-aware A*
//   4. find lots along road frontage
//   5. place buildings (footprint, entrance facing the road, spacing)
//   6. add gardens, fields, piers and decoration
//   7. validate and repair (validate.js)
//
// Growth is incremental: existing buildings and streets are never moved.
// New districts are grafted onto the network; upgrades happen in place.
// Everything is deterministic from the layout seed and its operation count.

import { hash3 } from '../core/rng.js';
import { MinHeap } from '../core/heap.js';
import { KINDS, KIND_KEYS, ROAD, FIELD_SIZES, ARTERY_RADIUS } from './kinds.js';
import { STYLES, styleForSite } from './styles.js';
import { analyzeLocal, R, N, T, O } from './terrain.js';
import { repairLayout } from './validate.js';

export { R, N, T, O };

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];
const OPP = [1, 0, 3, 2];
const FACE = ['e', 'w', 's', 'n']; // side of the building that faces the road
const CACHE = Symbol('planner-cache');

// ---------------------------------------------------------------------------
// Layout creation and derived caches

/**
 * Create a new settlement layout.
 * kind: 'capital' | 'town' | 'outpost' | 'hub'
 * toward: world points the settlement should open main roads toward
 */
export function createLayout(world, { id = 0, cx, cy, seed = 1, kind = 'town', style = null, toward = [], worldRoads = null, blocked = null }) {
  const L = {
    id,
    seed: hash3(seed, cx, cy) ^ (id * 7919),
    kind,
    cx,
    cy,
    ox: cx - R,
    oy: cy - R,
    style: style || (kind === 'hub' ? 'free' : styleForSite(world, cx, cy)),
    stage: 0,
    v: 1,
    ops: 0,
    occ: new Uint8Array(N * N),
    road: new Uint8Array(N * N),
    plaza: null,
    arteries: [],
    harbor: null,
    districts: [],
    buildings: [],
    fields: [],
    docks: [],
    decor: [],
    walls: null,
    reserved: [],
    nextBid: 1,
  };
  const ctx = ctxOf(world, L);
  if (blocked) markBlocked(L, blocked, world);
  if (worldRoads) syncWorldRoads(world, L, worldRoads);

  // Plaza: the flattest open square near the requested centre.
  const ps = kind === 'capital' || kind === 'hub' ? 4 : 3;
  let best = null;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const x0 = R + dx - (ps >> 1);
      const y0 = R + dy - (ps >> 1);
      let ok = true;
      let cost = Math.hypot(dx, dy) * 0.3;
      for (let y = y0 - 1; y <= y0 + ps && ok; y++) {
        for (let x = x0 - 1; x <= x0 + ps; x++) {
          const l = y * N + x;
          const t = ctx.tbase[l];
          const inside = x >= x0 && x < x0 + ps && y >= y0 && y < y0 + ps;
          if (inside && !(t === T.LAND || (t === T.MARSH && ctx.style.marsh) || (t === T.STEEP && ctx.style.steepOk))) ok = false;
          if (inside && L.occ[l] !== O.FREE) ok = false;
          if (ok) cost += ctx.slope[l] + (t === T.LAND ? 0 : 0.5);
        }
      }
      if (ok && (!best || cost < best.cost)) best = { x0, y0, cost };
    }
  }
  if (!best) {
    // Cramped site: shrink to a 2×2 green rather than fail.
    best = { x0: R - 1, y0: R - 1, cost: 0, small: true };
  }
  const pw = best.small ? 2 : ps;
  L.plaza = { x0: best.x0, y0: best.y0, w: pw, h: pw };
  for (let y = best.y0; y < best.y0 + pw; y++) {
    for (let x = best.x0; x < best.x0 + pw; x++) L.occ[y * N + x] = O.PLAZA;
  }

  // Harbour destination: the nearest shore cell, if any.
  {
    let bestH = null;
    const pc = plazaCentre(L);
    for (let l = 0; l < N * N; l++) {
      if (ctx.tbase[l] !== T.SHORE) continue;
      const x = l % N;
      const y = (l / N) | 0;
      const d = Math.hypot(x - pc.x, y - pc.y);
      if (d > 15 || d < 2) continue;
      // Need a land neighbour to reach it from.
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k];
        const ny = y + DY[k];
        if (nx < 1 || ny < 1 || nx >= N - 1 || ny >= N - 1) continue;
        const nl = ny * N + nx;
        if (ctx.tbase[nl] === T.LAND || ctx.tbase[nl] === T.MARSH) {
          if (!bestH || d < bestH.d) bestH = { d, shore: l, land: nl, dir: OPP[k] };
        }
      }
    }
    if (bestH) L.harbor = { shore: bestH.shore, land: bestH.land, dir: bestH.dir };
  }

  // Founding building on the plaza first, then plaza-front lots held for the
  // civic buildings a growing settlement will want. Main roads route around them.
  const founder = kind === 'capital' ? 'keep' : kind === 'hub' ? 'hall' : 'lodge';
  addBuilding(world, L, founder);
  const civic = kind === 'capital' || kind === 'hub' ? ['market', 'temple'] : ['hall', 'market'];
  for (const c of civic) reserveLot(world, L, c);

  // Arteries (main roads) toward gates.
  const nArt = kind === 'capital' || kind === 'hub' ? 4 : kind === 'outpost' ? 2 : 3;
  const required = toward.map((p) => Math.atan2(p.y - cy, p.x - cx));
  if (L.harbor) {
    const pc = plazaCentre(L);
    const hx = L.harbor.land % N;
    const hy = (L.harbor.land / N) | 0;
    required.unshift(Math.atan2(hy - pc.y, hx - pc.x));
  }
  const angles = chooseArteryAngles(ctx, L, nArt, required);
  const radius = ARTERY_RADIUS[kind === 'outpost' ? 0 : kind === 'hub' ? 4 : 1];
  for (const a of angles) addArtery(world, L, a, radius);
  if (L.harbor) connectHarbor(world, L);
  return L;
}

function reserveLot(world, L, kind) {
  const ctx = ctxOf(world, L);
  const k = KINDS[kind];
  const lots = findLots(ctx, L, kind, k.w, k.h, 4);
  const lot = lots.find((q) => q.ft === 'plaza') || lots[0];
  if (!lot) return false;
  for (let y = lot.y0; y < lot.y0 + lot.h; y++) for (let x = lot.x0; x < lot.x0 + lot.w; x++) L.occ[y * N + x] = O.RESERVE;
  L.reserved.push({ kind, x0: lot.x0, y0: lot.y0, w: lot.w, h: lot.h, f: lot.f, d: lot.d, ft: lot.ft });
  return true;
}

function releaseReservation(L, r) {
  for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) if (L.occ[y * N + x] === O.RESERVE) L.occ[y * N + x] = O.FREE;
  L.reserved = L.reserved.filter((q) => q !== r);
}

function plazaCentre(L) {
  return { x: L.plaza.x0 + (L.plaza.w - 1) / 2, y: L.plaza.y0 + (L.plaza.h - 1) / 2 };
}

/** Derived, non-serialised state: terrain analysis, building index map. */
export function ctxOf(world, L) {
  let c = L[CACHE];
  if (!c || c.world !== world) {
    const an = analyzeLocal(world, L.ox, L.oy, L.seed);
    c = { world, ...an, style: STYLES[L.style] || STYLES.farm, bid: new Int32Array(N * N), search: null };
    Object.defineProperty(L, CACHE, { value: c, enumerable: false, configurable: true, writable: true });
    rebuildBid(L);
  }
  return c;
}

function rebuildBid(L) {
  const c = L[CACHE];
  c.bid.fill(0);
  for (const b of L.buildings) {
    const x0 = b.x - L.ox;
    const y0 = b.y - L.oy;
    for (let y = y0; y < y0 + b.h; y++) for (let x = x0; x < x0 + b.w; x++) c.bid[y * N + x] = b.id;
  }
}

function rngFor(L, salt = 0) {
  L.ops++;
  let s = hash3(L.seed, L.ops, salt);
  return () => {
    s = hash3(s, 0x51, 0x2d);
    return s / 4294967296;
  };
}

function inner(x, y) {
  return x >= 1 && y >= 1 && x < N - 1 && y < N - 1;
}

/** Mark cells that other settlements or infrastructure already use. */
export function markBlocked(L, blocked, world) {
  const W = world.width;
  for (let ly = 0; ly < N; ly++) {
    for (let lx = 0; lx < N; lx++) {
      const wx = L.ox + lx;
      const wy = L.oy + ly;
      if (wx < 0 || wy < 0 || wx >= W || wy >= world.height) continue;
      if (blocked[wy * W + wx] && L.occ[ly * N + lx] === O.FREE) L.occ[ly * N + lx] = O.DECOR;
    }
  }
}

/** Copy kingdom-built roads that pass through this square into the layout. */
export function syncWorldRoads(world, L, worldRoads) {
  const W = world.width;
  let changed = false;
  for (let ly = 0; ly < N; ly++) {
    for (let lx = 0; lx < N; lx++) {
      const wx = L.ox + lx;
      const wy = L.oy + ly;
      if (wx < 0 || wy < 0 || wx >= W || wy >= world.height) continue;
      if (!worldRoads[wy * W + wx]) continue;
      const l = ly * N + lx;
      const o = L.occ[l];
      if (o === O.FREE || o === O.APRON) {
        L.occ[l] = O.ROAD;
        if (!L.road[l] || L.road[l] > ROAD.MAIN) L.road[l] = ROAD.MAIN;
        changed = true;
      } else if (o === O.ROAD && L.road[l] !== ROAD.MAIN) {
        L.road[l] = ROAD.MAIN;
        changed = true;
      }
    }
  }
  if (changed) L.v++;
  return changed;
}

// ---------------------------------------------------------------------------
// Road routing

function isNet(L, l) {
  return L.road[l] > 0 || L.occ[l] === O.PLAZA;
}

function distC(L, l) {
  const pc = plazaCentre(L);
  return Math.hypot((l % N) - pc.x, ((l / N) | 0) - pc.y);
}

/**
 * Terrain-aware A* over the local grid with a turn penalty (state = cell×4+dir).
 * starts: cells to start from; goal(l): reached; target: heuristic cell or -1.
 */
function route(ctx, L, starts, goal, target, { cls = ROAD.STREET, ringR = 0, maxNodes = 12000, startDir = -1, breach = false } = {}) {
  const S = N * N * 4;
  const g = new Float32Array(S).fill(Infinity);
  const from = new Int32Array(S).fill(-1);
  const closed = new Uint8Array(S);
  const open = new MinHeap();
  const tx = target >= 0 ? target % N : 0;
  const ty = target >= 0 ? (target / N) | 0 : 0;
  const heur = (l) => (target >= 0 ? (Math.abs((l % N) - tx) + Math.abs(((l / N) | 0) - ty)) * 0.3 : 0);
  const st = ctx.style;
  for (const s of starts) {
    for (let d = 0; d < 4; d++) {
      if (startDir >= 0 && d !== startDir) continue;
      const k = s * 4 + d;
      g[k] = 0;
      open.push(k, heur(s));
    }
  }
  let expanded = 0;
  const pc = plazaCentre(L);
  while (open.size > 0) {
    const k = open.pop();
    if (closed[k]) continue;
    closed[k] = 1;
    const l = k >> 2;
    const pd = k & 3;
    if (g[k] > 0 && goal(l)) {
      const path = [];
      let c = k;
      while (c !== -1) {
        path.push(c >> 2);
        c = from[c];
      }
      path.reverse();
      // Collapse consecutive duplicates (start states share a cell).
      return path.filter((v, i) => i === 0 || v !== path[i - 1]);
    }
    if (++expanded > maxNodes) return null;
    const x = l % N;
    const y = (l / N) | 0;
    const onRiver = ctx.tbase[l] === T.RIVER;
    for (let d = 0; d < 4; d++) {
      if (onRiver && d !== pd && g[k] > 0) continue; // bridges run straight
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (!inner(nx, ny)) continue;
      const n = ny * N + nx;
      const nk = n * 4 + d;
      if (closed[nk]) continue;
      const t = ctx.tbase[n];
      if (t === T.BLOCK || t === T.SHORE || t === T.WATER) continue;
      const o = L.occ[n];
      if (o === O.BUILDING || o === O.FIELD || o === O.GARDEN || o === O.DECOR || o === O.DOCK || o === O.RESERVE) continue;
      if (o === O.WALL && !breach) continue;
      let c;
      if (o === O.WALL) c = 8; // cutting a new gate is expensive
      else if (L.road[n]) c = L.road[n] === ROAD.PATH ? 0.5 : 0.3;
      else if (o === O.PLAZA) c = 0.35;
      else {
        c = 1;
        if (o === O.APRON) c += cls === ROAD.MAIN ? -0.2 : 1.5;
        c += ctx.slope[n] * st.slopeW * 0.2;
        if (t === T.RIVER) c += 9;
        else if (t === T.MARSH) c += st.marsh ? 0.3 : 1.6;
        else if (t === T.STEEP) c += st.steepOk ? 1.2 : 2.6;
        if (ctx.tree[n]) c += 0.45;
        c += ctx.noise[n] * st.wander * 1.4;
        // Discourage hugging an existing road (double-wide streets).
        let side = 0;
        for (let e = 0; e < 4; e++) {
          if (e === OPP[d]) continue;
          const sx = nx + DX[e];
          const sy = ny + DY[e];
          if (inner(sx, sy) && L.road[sy * N + sx] && !goal(sy * N + sx)) side++;
        }
        c += side * 0.9;
      }
      if (ringR > 0) c += Math.abs(Math.hypot(nx - pc.x, ny - pc.y) - ringR) * 0.8;
      if (pd !== d && g[k] > 0) c += st.turn * (cls === ROAD.MAIN ? 1.6 : 1);
      const ng = g[k] + c;
      if (ng < g[nk]) {
        g[nk] = ng;
        from[nk] = k;
        open.push(nk, ng + heur(n));
      }
    }
  }
  return null;
}

function layRoad(L, path, cls) {
  for (const l of path) {
    if (L.occ[l] === O.PLAZA) continue;
    if (L.occ[l] === O.WALL && L.walls) {
      const wx = L.ox + (l % N);
      const wy = L.oy + ((l / N) | 0);
      L.walls.cells = L.walls.cells.filter(([x, y]) => x !== wx || y !== wy);
      L.walls.gates.push([wx, wy]);
    }
    L.occ[l] = O.ROAD;
    if (!L.road[l] || L.road[l] > cls) L.road[l] = cls;
  }
}

function chooseArteryAngles(ctx, L, count, required) {
  const pc = plazaCentre(L);
  const openness = (a) => {
    let s = 0;
    for (let r = 2; r < R - 1; r++) {
      const x = Math.round(pc.x + Math.cos(a) * r);
      const y = Math.round(pc.y + Math.sin(a) * r);
      if (!inner(x, y)) break;
      const t = ctx.tbase[y * N + x];
      if (t === T.BLOCK || t === T.WATER || t === T.SHORE) break;
      s += t === T.LAND ? 1 : t === T.RIVER ? 0.3 : 0.6;
      s -= ctx.slope[y * N + x] * 0.3;
    }
    return s;
  };
  const chosen = [];
  const sep = (a, b) => {
    let d = Math.abs(a - b) % (Math.PI * 2);
    return d > Math.PI ? Math.PI * 2 - d : d;
  };
  for (const a of required) {
    if (chosen.length >= count + 1) break;
    if (chosen.every((c) => sep(c, a) > 0.9)) chosen.push(a);
  }
  const cands = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2 + (hash3(L.seed, k, 3) / 4294967296 - 0.5) * 0.25;
    cands.push({ a, s: openness(a) });
  }
  cands.sort((p, q) => q.s - p.s);
  for (const minSep of [1.3, 1.0, 0.75]) {
    for (const c of cands) {
      if (chosen.length >= count) break;
      if (c.s < 3) continue;
      if (chosen.every((a) => sep(a, c.a) > minSep)) chosen.push(c.a);
    }
  }
  return chosen;
}

function nearestBuildable(ctx, L, x, y, radius = 3) {
  let best = -1;
  let bestD = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inner(nx, ny)) continue;
      const l = ny * N + nx;
      const t = ctx.tbase[l];
      if (!(t === T.LAND || t === T.MARSH || t === T.STEEP)) continue;
      const o = L.occ[l];
      if (o !== O.FREE && o !== O.APRON && o !== O.ROAD) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
  }
  return best;
}

function setApron(ctx, L, art) {
  // Clear the old apron, then reserve 3 cells beyond the gate.
  if (art.apron) for (const l of art.apron) if (L.occ[l] === O.APRON) L.occ[l] = O.FREE;
  art.apron = [];
  const g = art.gate;
  const dx = Math.round(Math.cos(art.angle));
  const dy = Math.round(Math.sin(art.angle));
  let x = g % N;
  let y = (g / N) | 0;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(dx) >= Math.abs(dy) || k % 2 === 0) x += dx || 0;
    if (Math.abs(dy) > Math.abs(dx) || k % 2 === 1) y += dy || 0;
    if (!inner(x, y)) break;
    const l = y * N + x;
    if (L.occ[l] !== O.FREE) break;
    L.occ[l] = O.APRON;
    art.apron.push(l);
  }
}

function addArtery(world, L, angle, radius) {
  const ctx = ctxOf(world, L);
  const pc = plazaCentre(L);
  let target = -1;
  for (let r = radius; r >= 3 && target < 0; r--) {
    target = nearestBuildable(ctx, L, Math.round(pc.x + Math.cos(angle) * r), Math.round(pc.y + Math.sin(angle) * r), 2);
    if (target >= 0 && (distC(L, target) < 2.5 || isNet(L, target))) target = -1;
  }
  if (target < 0) return null;
  const starts = plazaCells(L);
  const path = route(ctx, L, starts, (l) => l === target, target, { cls: ROAD.MAIN, breach: true });
  if (!path || path.length < 2) return null;
  layRoad(L, path, ROAD.MAIN);
  const cells = path.filter((l) => L.occ[l] !== O.PLAZA);
  const art = { angle, cells, gate: cells[cells.length - 1], apron: [] };
  L.arteries.push(art);
  setApron(ctx, L, art);
  L.v++;
  return art;
}

function plazaCells(L) {
  const out = [];
  const p = L.plaza;
  for (let y = p.y0; y < p.y0 + p.h; y++) for (let x = p.x0; x < p.x0 + p.w; x++) out.push(y * N + x);
  return out;
}

function connectHarbor(world, L) {
  const ctx = ctxOf(world, L);
  const h = L.harbor;
  if (isNet(L, h.land)) return true;
  if (L.occ[h.land] !== O.FREE && L.occ[h.land] !== O.APRON) return false;
  const path = route(ctx, L, [h.land], (l) => isNet(L, l), -1, { cls: ROAD.MAIN });
  if (!path) return false;
  layRoad(L, path, ROAD.MAIN);
  h.connected = true;
  L.v++;
  return true;
}

/** Extend an artery outward to `radius` (deliberate growth at stage-up). */
function extendArtery(world, L, art, radius) {
  const ctx = ctxOf(world, L);
  if (distC(L, art.gate) >= radius - 0.5) return false;
  const pc = plazaCentre(L);
  let target = -1;
  for (let r = radius; r > distC(L, art.gate) + 1 && target < 0; r--) {
    const t = nearestBuildable(ctx, L, Math.round(pc.x + Math.cos(art.angle) * r), Math.round(pc.y + Math.sin(art.angle) * r), 2);
    if (t >= 0 && !isNet(L, t)) target = t;
  }
  if (target < 0) return false;
  for (const l of art.apron) if (L.occ[l] === O.APRON) L.occ[l] = O.FREE;
  const path = route(ctx, L, [art.gate], (l) => l === target, target, { cls: ROAD.MAIN, breach: true });
  if (!path) {
    setApron(ctx, L, art);
    return false;
  }
  layRoad(L, path, ROAD.MAIN);
  for (const l of path.slice(1)) art.cells.push(l);
  art.gate = target;
  setApron(ctx, L, art);
  L.v++;
  return true;
}

/**
 * Return a gate (world coords) facing the world point (wx, wy), creating a
 * new artery toward it if no existing one points that way.
 */
export function ensureGate(world, L, wx, wy) {
  const ang = Math.atan2(wy - L.cy, wx - L.cx);
  const sep = (a, b) => {
    const d = Math.abs(a - b) % (Math.PI * 2);
    return d > Math.PI ? Math.PI * 2 - d : d;
  };
  let best = null;
  for (const a of L.arteries) {
    const s = sep(a.angle, ang);
    if (s < 0.9 && (!best || s < best.s)) best = { a, s };
  }
  if (!best) {
    const radius = ARTERY_RADIUS[L.stage] ?? 4;
    const art = addArtery(world, L, ang, radius);
    if (art) best = { a: art };
  }
  if (!best) {
    // Fall back to the nearest gate of any artery.
    let nb = null;
    for (const a of L.arteries) {
      const gx = L.ox + (a.gate % N);
      const gy = L.oy + ((a.gate / N) | 0);
      const d = Math.hypot(gx - wx, gy - wy);
      if (!nb || d < nb.d) nb = { a, d };
    }
    if (!nb) return { x: L.cx, y: L.cy };
    best = nb;
  }
  const g = best.a.gate;
  return { x: L.ox + (g % N), y: L.oy + ((g / N) | 0) };
}

// ---------------------------------------------------------------------------
// Lots and buildings

function gapReq(L, kind, lx, ly) {
  const k = KINDS[kind];
  if (k && k.house && L.stage >= 2) {
    const pc = plazaCentre(L);
    const core = L.stage >= 4 ? 10 : L.stage >= 3 ? 7.5 : 4.5;
    if (Math.hypot(lx - pc.x, ly - pc.y) < core) return 0; // terraced core
  }
  return 1;
}

function frontType(L, l) {
  if (L.occ[l] === O.PLAZA) return 'plaza';
  const r = L.road[l];
  return r === ROAD.MAIN ? 'main' : r === ROAD.STREET ? 'street' : r === ROAD.PATH ? 'path' : null;
}

function terrainOk(ctx, kind, t) {
  const k = KINDS[kind];
  if (t === T.LAND) return true;
  if (t === T.MARSH) return ctx.style.marsh || kind === 'fishery' || kind === 'herbalist';
  if (t === T.STEEP) return !!(k.steep || ctx.style.steepOk);
  return false;
}

/** Check a footprint against terrain, occupancy and spacing. */
function rectOk(ctx, L, kind, x0, y0, w, h) {
  if (!inner(x0, y0) || !inner(x0 + w - 1, y0 + h - 1)) return false;
  const k = KINDS[kind];
  // Civic buildings may be terraced into a slope; ordinary ones need flatter ground.
  const maxSlope = k.civic ? 2.6 : k.steep || ctx.style.steepOk ? 2.2 : 1.1;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const l = y * N + x;
      const o = L.occ[l];
      if (o !== O.FREE && !(o === O.RESERVE && k.civic)) return false;
      if (!terrainOk(ctx, kind, ctx.tbase[l])) return false;
      if (ctx.slope[l] > maxSlope) return false;
    }
  }
  const myGap = gapReq(L, kind, x0 + w / 2, y0 + h / 2);
  for (let y = y0 - 1; y <= y0 + h; y++) {
    for (let x = x0 - 1; x <= x0 + w; x++) {
      if (x >= x0 && x < x0 + w && y >= y0 && y < y0 + h) continue;
      if (!inner(x, y)) continue;
      const l = y * N + x;
      const o = L.occ[l];
      if (o === O.DOCK || o === O.WALL || o === O.RESERVE) return false;
      if (o === O.BUILDING) {
        const other = L.buildings.find((b) => b.id === ctx.bid[l]);
        const og = other ? gapReq(L, other.kind, other.x - L.ox + other.w / 2, other.y - L.oy + other.h / 2) : 1;
        if (Math.max(myGap, og) > 0) return false;
        // Terraced rows must line up: share the full edge and the same face.
        if (other && (other.kind !== 'house' || kind !== 'house')) return false;
        if (x !== x0 - 1 && x !== x0 + w) return false; // only side-by-side
        if (other.y - L.oy !== y0 || other.h !== h) return false;
      }
    }
  }
  return true;
}

function countNear(ctx, arr, x0, y0, w, h, r) {
  let c = 0;
  for (let y = y0 - r; y < y0 + h + r; y++) {
    for (let x = x0 - r; x < x0 + w + r; x++) {
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      c += arr[y * N + x] ? 1 : 0;
    }
  }
  return c;
}

function nearScore(ctx, L, kind, x0, y0, w, h) {
  const k = KINDS[kind];
  switch (k.near) {
    case 'forest':
      return Math.min(14, countNear(ctx, ctx.tree, x0, y0, w, h, 3)) * 0.4;
    case 'rock': {
      let c = 0;
      for (let y = y0 - 3; y < y0 + h + 3; y++) {
        for (let x = x0 - 3; x < x0 + w + 3; x++) {
          if (x < 0 || y < 0 || x >= N || y >= N) continue;
          const l = y * N + x;
          if (ctx.rock[l] || ctx.tbase[l] === T.STEEP) c++;
        }
      }
      return Math.min(16, c) * 0.4;
    }
    case 'green':
      return Math.min(14, countNear(ctx, ctx.green, x0, y0, w, h, 3)) * 0.3;
    case 'fertile': {
      let s = 0;
      let c = 0;
      for (let y = y0 - 3; y < y0 + h + 3; y++) {
        for (let x = x0 - 3; x < x0 + w + 3; x++) {
          if (x < 0 || y < 0 || x >= N || y >= N) continue;
          const l = y * N + x;
          if (L.occ[l] === O.FREE) {
            s += ctx.fert[l];
            c++;
          }
        }
      }
      return c ? (s / c) * 3 + Math.min(30, c) * 0.08 : -5;
    }
    default:
      return 0;
  }
}

/** Enumerate candidate lots for a kind, best first. */
function findLots(ctx, L, kind, w, h, limit = 12) {
  const k = KINDS[kind];
  const pc = plazaCentre(L);
  const dens = ctx.style.density;
  const [rmin, rideal, rmax] = k.ring.map((v) => v / (k.civic ? 1 : dens));
  const seen = new Set();
  const out = [];
  const gates = L.arteries.map((a) => a.gate);
  const kIdx = KIND_KEYS.indexOf(kind);
  for (let f = 0; f < N * N; f++) {
    const ft = frontType(L, f);
    if (!ft || !k.front.includes(ft)) continue;
    const fx = f % N;
    const fy = (f / N) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = fx + DX[d];
      const ny = fy + DY[d];
      if (!inner(nx, ny) || L.occ[ny * N + nx] !== O.FREE) continue;
      const opts = [];
      if (d === 0 || d === 1) {
        const x0 = d === 0 ? fx + 1 : fx - w;
        for (const y0 of [fy - ((h - 1) >> 1), fy - h + 1, fy]) opts.push([x0, y0]);
      } else {
        const y0 = d === 2 ? fy + 1 : fy - h;
        for (const x0 of [fx - ((w - 1) >> 1), fx - w + 1, fx]) opts.push([x0, y0]);
      }
      for (const [x0, y0] of opts) {
        const key = x0 * 1000 + y0;
        if (seen.has(key)) continue;
        if (!rectOk(ctx, L, kind, x0, y0, w, h)) continue;
        seen.add(key);
        const cx = x0 + (w - 1) / 2;
        const cy = y0 + (h - 1) / 2;
        const dist = Math.hypot(cx - pc.x, cy - pc.y);
        let s = 0;
        if (dist < rmin) s -= (rmin - dist) * 3;
        s -= Math.abs(dist - rideal) * (k.house ? 0.6 : 0.35);
        if (dist > rmax) s -= (dist - rmax) * 2;
        if (ft === 'plaza') s += k.civic ? 3 : -1;
        else if (ft === 'main') s += k.front[0] === 'main' ? 1 : 0.3;
        else if (ft === 'street') s += k.house ? 0.6 : 0.2;
        else if (ft === 'path') s -= k.house ? 0.8 : 0;
        s += nearScore(ctx, L, kind, x0, y0, w, h);
        if (k.gate && gates.length) {
          let gd = Infinity;
          for (const g of gates) gd = Math.min(gd, Math.hypot((g % N) - cx, ((g / N) | 0) - cy));
          s -= gd * 0.3;
        }
        if (d === 3) s += 0.45; // building north of the road: its door faces the viewer
        let trees = 0;
        let sl = 0;
        for (let y = y0; y < y0 + h; y++) {
          for (let x = x0; x < x0 + w; x++) {
            trees += ctx.tree[y * N + x];
            sl += ctx.slope[y * N + x];
          }
        }
        s -= trees * (L.style === 'timber' ? 0.05 : 0.15);
        s -= (sl / (w * h)) * 1.5;
        if (k.house) {
          // Rows: reward lining up with a neighbour on the same street side.
          for (const dx of [-w - 1, w + 1, -w, w]) {
            const l2 = (y0 * N) + x0 + dx;
            if (l2 >= 0 && l2 < N * N && ctx.bid[l2]) {
              const b2 = L.buildings.find((b) => b.id === ctx.bid[l2]);
              if (b2 && b2.y - L.oy === y0) s += 0.5;
            }
          }
        }
        s += (hash3(L.seed ^ kIdx, x0 * 31 + y0, L.buildings.length) / 4294967296) * 0.9;
        out.push({ x0, y0, w, h, f, d, s, dist, ft });
      }
    }
  }
  out.sort((p, q) => q.s - p.s || p.x0 - q.x0 || p.y0 - q.y0);
  return out.slice(0, limit);
}

/** Find a field next to a farmhouse rect; returns rect or null. */
function findField(ctx, L, b) {
  const bx = b.x - L.ox;
  const by = b.y - L.oy;
  const doorSide = b.side; // d index from road to building
  let best = null;
  const sizes = FIELD_SIZES.map(([fw, fh]) => [Math.max(3, Math.round(fw * Math.min(1.3, ctx.style.fields))), fh]);
  for (const [fw0, fh0] of sizes) {
    for (const [fw, fh] of [[fw0, fh0], [fh0, fw0]]) {
      const cand = [];
      // Sides: the field sits beside or behind the house (never in front, where the road is).
      for (let side = 0; side < 4; side++) {
        if (side === OPP[doorSide]) continue;
        if (side === 0) for (let oy = -fh + 1; oy <= b.h - 1; oy++) cand.push([bx + b.w + 1, by + oy]);
        if (side === 1) for (let oy = -fh + 1; oy <= b.h - 1; oy++) cand.push([bx - fw - 1, by + oy]);
        if (side === 2) for (let ox = -fw + 1; ox <= b.w - 1; ox++) cand.push([bx + ox, by + b.h + 1]);
        if (side === 3) for (let ox = -fw + 1; ox <= b.w - 1; ox++) cand.push([bx + ox, by - fh - 1]);
      }
      for (const [x0, y0] of cand) {
        if (!inner(x0, y0) || !inner(x0 + fw - 1, y0 + fh - 1)) continue;
        let ok = true;
        let fert = 0;
        for (let y = y0; y < y0 + fh && ok; y++) {
          for (let x = x0; x < x0 + fw; x++) {
            const l = y * N + x;
            const t = ctx.tbase[l];
            if (L.occ[l] !== O.FREE || !(t === T.LAND || (t === T.MARSH && ctx.style.marsh)) || ctx.slope[l] > 1.2) {
              ok = false;
              break;
            }
            fert += ctx.fert[l];
          }
        }
        if (!ok) continue;
        // Keep a one-cell margin from other buildings (except this farmhouse).
        for (let y = y0 - 1; y <= y0 + fh && ok; y++) {
          for (let x = x0 - 1; x <= x0 + fw; x++) {
            if (!inner(x, y)) continue;
            const l = y * N + x;
            if (L.occ[l] === O.BUILDING || L.occ[l] === O.DOCK || L.occ[l] === O.APRON || L.occ[l] === O.WALL) {
              ok = false;
              break;
            }
          }
        }
        if (!ok) continue;
        const avg = fert / (fw * fh);
        if (avg < 0.3) continue;
        const s = fert + (hash3(L.seed, x0, y0) / 4294967296) * 0.5;
        if (!best || s > best.s) best = { x0, y0, w: fw, h: fh, s };
      }
    }
    if (best) break;
  }
  return best;
}

/** Find a pier (2–4 cells straight into water) next to a dockside rect. */
function findPier(ctx, L, x0, y0, w, h, minLen) {
  let best = null;
  for (let y = y0 - 1; y <= y0 + h; y++) {
    for (let x = x0 - 1; x <= x0 + w; x++) {
      const edge = (x === x0 - 1 || x === x0 + w) !== (y === y0 - 1 || y === y0 + h);
      if (!edge || !inner(x, y)) continue;
      const l = y * N + x;
      if (ctx.tbase[l] !== T.SHORE || L.occ[l] !== O.FREE) continue;
      const dir = x === x0 - 1 ? 1 : x === x0 + w ? 0 : y === y0 - 1 ? 3 : 2;
      const cells = [l];
      let cx = x;
      let cy = y;
      for (let k = 1; k < 4; k++) {
        cx += DX[dir];
        cy += DY[dir];
        if (!inner(cx, cy)) break;
        const cl = cy * N + cx;
        const t = ctx.tbase[cl];
        if ((t !== T.SHORE && t !== T.WATER) || L.occ[cl] !== O.FREE) break;
        cells.push(cl);
      }
      if (cells.length < minLen) continue;
      if (!best || cells.length > best.cells.length) best = { cells, dir };
    }
  }
  return best;
}

function waterNear(ctx, x0, y0, w, h) {
  for (let y = y0 - 1; y <= y0 + h; y++) {
    for (let x = x0 - 1; x <= x0 + w; x++) {
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const t = ctx.tbase[y * N + x];
      if (t === T.SHORE || t === T.RIVER) return true;
    }
  }
  return false;
}

function compactRadius(L) {
  let area = 0;
  for (const b of L.buildings) if (b.kind === 'house') area += b.w * b.h * 1.7;
  return 2.5 + Math.sqrt(area / Math.PI);
}

function footprintFor(L, kind, rnd) {
  const k = KINDS[kind];
  if (kind === 'house') {
    if (L.stage >= 3 && rnd() < (L.stage >= 4 ? 0.55 : 0.35)) return [3, 2];
    return [2, 2];
  }
  return [k.w, k.h];
}

/**
 * Add one building of `kind`. Grows new streets/districts if no lot fits.
 * Returns the building record, or null when the settlement has no room.
 */
export function addBuilding(world, L, kind, { state = 'built' } = {}) {
  const ctx = ctxOf(world, L);
  const k = KINDS[kind];
  if (!k) throw new Error(`unknown building kind ${kind}`);
  const rnd = rngFor(L, KIND_KEYS.indexOf(kind));
  const [w, h] = footprintFor(L, kind, rnd);
  const res = L.reserved.find((r) => r.kind === kind);
  if (res) {
    releaseReservation(L, res);
    if (rectOk(ctx, L, kind, res.x0, res.y0, res.w, res.h) && isNet(L, res.f)) {
      return placeBuilding(ctx, L, kind, { ...res, dist: 0 }, null, state, rnd);
    }
  }
  const sizes = [[w, h], ...(k.alt || [])];
  for (let attempt = 0; attempt < 5; attempt++) {
    let lots = [];
    let fw = w;
    let fh = h;
    for (const [sw, sh] of sizes) {
      lots = findLots(ctx, L, kind, sw, sh, 16);
      if (lots.length) {
        fw = sw;
        fh = sh;
        break;
      }
    }
    let chosen = null;
    let extra = null;
    for (const lot of lots) {
      if (k.dock) {
        const pier = waterNear(ctx, lot.x0, lot.y0, fw, fh) ? findPier(ctx, L, lot.x0, lot.y0, fw, fh, kind === 'harbor' ? 2 : 1) : null;
        if (!pier) continue;
        extra = { pier };
      }
      if (k.field) {
        const probe = { x: L.ox + lot.x0, y: L.oy + lot.y0, w: fw, h: fh, side: lot.d };
        const field = findField(ctx, L, probe);
        if (!field) continue;
        extra = { field };
      }
      chosen = lot;
      break;
    }
    // Houses should keep the town compact: if the best lot is far out,
    // grow a new street nearer the centre first.
    const sprawl = chosen && k.house && chosen.dist > compactRadius(L) + 3 && attempt < 2;
    if (chosen && !sprawl) return placeBuilding(ctx, L, kind, chosen, extra, state, rnd);
    if (!growDistrict(world, L, kind, rnd) && !chosen && attempt >= 1) break;
  }
  repairLayout(world, L);
  return null;
}

function placeBuilding(ctx, L, kind, lot, extra, state, rnd) {
  const { x0, y0, w, h, f, d } = lot;
  for (const r of L.reserved.slice()) {
    if (r.x0 < x0 + w && x0 < r.x0 + r.w && r.y0 < y0 + h && y0 < r.y0 + r.h) releaseReservation(L, r);
  }
  const doorL = (f % N) + DX[d] + (((f / N) | 0) + DY[d]) * N;
  const b = {
    id: L.nextBid++,
    kind,
    x: L.ox + x0,
    y: L.oy + y0,
    w,
    h,
    side: d,
    face: FACE[OPP[d]],
    door: { x: L.ox + (doorL % N), y: L.oy + ((doorL / N) | 0) },
    front: f,
    level: 1,
    variant: Math.floor(rnd() * 4),
    state,
    born: L.ops,
  };
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      L.occ[y * N + x] = O.BUILDING;
      ctx.bid[y * N + x] = b.id;
    }
  }
  L.buildings.push(b);
  if (extra && extra.field) {
    const fr = extra.field;
    const fld = { id: b.id, x: L.ox + fr.x0, y: L.oy + fr.y0, w: fr.w, h: fr.h, crop: cropFor(L, rnd) };
    for (let y = fr.y0; y < fr.y0 + fr.h; y++) for (let x = fr.x0; x < fr.x0 + fr.w; x++) L.occ[y * N + x] = O.FIELD;
    L.fields.push(fld);
    b.field = fld.id;
  }
  if (extra && extra.pier) {
    for (const l of extra.pier.cells) L.occ[l] = O.DOCK;
    L.docks.push({ id: b.id, cells: extra.pier.cells.map((l) => [L.ox + (l % N), L.oy + ((l / N) | 0)]), dir: extra.pier.dir });
  }
  decorateBuilding(ctx, L, b, rnd);
  // Peel back any street stub this operation laid but no door ended up using,
  // so the player never sees a road that leads nowhere.
  repairLayout(ctx.world, L);
  L.v++;
  return b;
}

function cropFor(L, rnd) {
  const byStyle = {
    farm: ['wheat', 'wheat', 'cabbage', 'corn'],
    timber: ['wheat', 'cabbage', 'turnip'],
    stone: ['barley', 'turnip'],
    harbor: ['wheat', 'cabbage'],
    stilt: ['rice', 'rice'],
    adobe: ['millet', 'dates'],
    nordic: ['barley', 'turnip'],
    ash: ['millet', 'turnip'],
    free: ['wheat', 'cabbage', 'corn'],
  };
  const list = byStyle[L.style] || byStyle.farm;
  return list[Math.floor(rnd() * list.length)];
}

/** Gardens, wood piles, hay and crates around a new building. */
function decorateBuilding(ctx, L, b, rnd) {
  const x0 = b.x - L.ox;
  const y0 = b.y - L.oy;
  const freeCellsAround = () => {
    const cells = [];
    for (let y = y0 - 1; y <= y0 + b.h; y++) {
      for (let x = x0 - 1; x <= x0 + b.w; x++) {
        if (x >= x0 && x < x0 + b.w && y >= y0 && y < y0 + b.h) continue;
        if (!inner(x, y)) continue;
        const l = y * N + x;
        if (L.occ[l] !== O.FREE) continue;
        const t = ctx.tbase[l];
        if (t !== T.LAND && t !== T.MARSH && t !== T.STEEP) continue;
        // Never decorate directly beside a road: keeps frontage open.
        let byRoad = false;
        for (let e = 0; e < 4; e++) if (inner(x + DX[e], y + DY[e]) && isNet(L, (y + DY[e]) * N + x + DX[e])) byRoad = true;
        if (byRoad) continue;
        cells.push(l);
      }
    }
    return cells;
  };
  const put = (k, l, blocks = true) => {
    L.decor.push({ k, x: L.ox + (l % N), y: L.oy + ((l / N) | 0), l });
    if (blocks) L.occ[l] = O.DECOR;
  };
  if (b.kind === 'house') {
    // Back garden on the side away from the street.
    const back = b.side; // from road toward building; the far side continues that way
    const cells = [];
    for (let k = 0; k < (b.side < 2 ? b.h : b.w); k++) {
      let x;
      let y;
      if (back === 0) [x, y] = [x0 + b.w, y0 + k];
      else if (back === 1) [x, y] = [x0 - 1, y0 + k];
      else if (back === 2) [x, y] = [x0 + k, y0 + b.h];
      else [x, y] = [x0 + k, y0 - 1];
      if (!inner(x, y)) continue;
      const l = y * N + x;
      if (L.occ[l] === O.FREE && ctx.tbase[l] === T.LAND) cells.push(l);
    }
    if (cells.length && rnd() < 0.55) {
      const kind = rnd() < 0.6 ? 'veg' : rnd() < 0.5 ? 'flowers' : 'yardtree';
      for (const l of cells) {
        L.occ[l] = O.GARDEN;
        L.decor.push({ k: kind, x: L.ox + (l % N), y: L.oy + ((l / N) | 0), l });
      }
    }
    return;
  }
  const items = {
    lumber: ['logs', 'logs', 'stump'],
    quarry: ['stones', 'stones'],
    mine: ['cart', 'stones'],
    crystalmine: ['cart', 'crystals'],
    kiln: ['logs', 'charcoal'],
    farm: ['hay', 'hay'],
    granary: ['sacks', 'crates'],
    market: ['crates', 'barrels'],
    smithy: ['anvil', 'barrels'],
    workshop: ['crates', 'logs'],
    harbor: ['crates', 'barrels', 'nets'],
    fishery: ['nets', 'barrels'],
    barracks: ['dummy', 'rack'],
    stables: ['hay', 'trough'],
    siegeworks: ['logs', 'crates'],
    herbalist: ['herbbed', 'herbbed'],
    tavern: ['barrels'],
    temple: ['flowers', 'flowers'],
    keep: ['banner', 'banner'],
    hall: ['banner'],
    lodge: ['logs', 'campfire'],
  }[b.kind];
  if (!items) return;
  const cells = freeCellsAround();
  for (const it of items) {
    if (!cells.length) break;
    const idx = Math.floor(rnd() * cells.length);
    const l = cells.splice(idx, 1)[0];
    put(it, l);
  }
}

// ---------------------------------------------------------------------------
// District growth

/** BFS steps from the road network over cells a new road could cross (255 = unreachable). */
function stepsFromNet(ctx, L) {
  const steps = new Uint8Array(N * N).fill(255);
  const q = [];
  for (let l = 0; l < N * N; l++) {
    if (isNet(L, l)) {
      steps[l] = 0;
      q.push(l);
    }
  }
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    const x = c % N;
    const y = (c / N) | 0;
    const ns = steps[c] + 1;
    if (ns >= 255) continue;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (!inner(nx, ny)) continue;
      const n = ny * N + nx;
      if (steps[n] !== 255) continue;
      const t = ctx.tbase[n];
      if (t === T.BLOCK || t === T.SHORE || t === T.WATER) continue;
      const o = L.occ[n];
      if (o !== O.FREE && o !== O.APRON) continue;
      steps[n] = ns;
      q.push(n);
    }
  }
  return steps;
}

/**
 * Graft a new street (or farm track) onto the network toward open land that
 * suits `kind`. Returns true if road cells were added.
 */
function growDistrict(world, L, kind, rnd) {
  const ctx = ctxOf(world, L);
  const k = KINDS[kind];
  const pc = plazaCentre(L);
  const rural = !!(k.field || k.near === 'forest' || k.near === 'rock');
  const cls = rural && kind !== 'house' ? ROAD.PATH : ROAD.STREET;
  const baseR = k.house ? compactRadius(L) + 1.5 : Math.max(compactRadius(L) + 3, k.ring[1]);
  const steps = stepsFromNet(ctx, L);
  const cands = [];
  for (let y = 2; y < N - 2; y++) {
    for (let x = 2; x < N - 2; x++) {
      const l = y * N + x;
      if (L.occ[l] !== O.FREE) continue;
      const t = ctx.tbase[l];
      if (!terrainOk(ctx, kind, t)) continue;
      const dist = Math.hypot(x - pc.x, y - pc.y);
      if (dist < 3 || dist > R - 3) continue;
      const near = steps[l];
      if (near < 2 || near > (rural ? 22 : 12)) continue;
      let free = 0;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (inner(nx, ny) && L.occ[ny * N + nx] === O.FREE && terrainOk(ctx, kind, ctx.tbase[ny * N + nx])) free++;
        }
      }
      if (free < 12) continue;
      let s = free * 0.12 - Math.abs(dist - baseR) * 0.7 - Math.max(0, near - 4) * 0.5;
      if (k.near) s += nearScore(ctx, L, kind, x - 1, y - 1, 3, 3);
      for (const dn of L.districts) s -= Math.max(0, 6 - Math.hypot(dn.x - x, dn.y - y)) * 0.6;
      s += (hash3(L.seed, l, L.ops) / 4294967296) * 1.2;
      cands.push({ l, s, x, y });
    }
  }
  cands.sort((p, q) => q.s - p.s || p.l - q.l);
  for (const c of cands.slice(0, 8)) {
    const path = route(ctx, L, [c.l], (l) => isNet(L, l), -1, { cls, maxNodes: 12000 });
    if (!path || path.length > 34) continue;
    // path: c.l ... networkCell. Lay everything except the network cell.
    const newCells = path.slice(0, -1).filter((l) => !isNet(L, l));
    if (!newCells.length) continue;
    layRoad(L, newCells, cls);
    // Stub beyond the district node, continuing away from the network.
    const first = path[0];
    const second = path[1];
    const dx = (first % N) - (second % N);
    const dy = ((first / N) | 0) - ((second / N) | 0);
    let sx = first % N;
    let sy = (first / N) | 0;
    const stub = [];
    const stubLen = 2 + Math.floor(rnd() * 4);
    for (let s = 0; s < stubLen; s++) {
      const nx = sx + dx;
      const ny = sy + dy;
      if (!inner(nx, ny)) break;
      const nl = ny * N + nx;
      const t = ctx.tbase[nl];
      if (L.occ[nl] !== O.FREE || !(t === T.LAND || t === T.MARSH && ctx.style.marsh || t === T.STEEP)) break;
      // Stop before running alongside another road.
      let touches = false;
      for (let e = 0; e < 4; e++) {
        const ex = nx + DX[e];
        const ey = ny + DY[e];
        if ((ex !== sx || ey !== sy) && inner(ex, ey) && isNet(L, ey * N + ex)) touches = true;
      }
      stub.push(nl);
      sx = nx;
      sy = ny;
      if (touches) break;
    }
    if (stub.length) layRoad(L, stub, cls);
    // Try to close a loop from the stub end to a different part of the network.
    const endL = stub.length ? stub[stub.length - 1] : first;
    const own = new Set([...newCells, ...stub]);
    const loop = route(ctx, L, [endL], (l) => isNet(L, l) && !own.has(l) && distC(L, l) > 1, -1, { cls, maxNodes: 2500 });
    if (loop && loop.length <= 11 && loop.length > 2) layRoad(L, loop.slice(1, -1).filter((l) => !isNet(L, l)), cls);
    L.districts.push({ x: c.x, y: c.y });
    L.v++;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Stages, walls, removal

/** Apply the visual consequences of reaching `stage` (0..4). Idempotent. */
export function applyStage(world, L, stage) {
  const ctx = ctxOf(world, L);
  if (stage <= L.stage) return false;
  for (let s = L.stage + 1; s <= stage; s++) {
    L.stage = s;
    const radius = ARTERY_RADIUS[s];
    for (const art of L.arteries) extendArtery(world, L, art, radius);
    if (s === 2 && L.arteries.length < 3) {
      const used = L.arteries.map((a) => a.angle);
      const extra = chooseArteryAngles(ctx, L, used.length + 1, used).filter((a) => !used.includes(a));
      if (extra.length) addArtery(world, L, extra[0], radius);
    }
    if (s === 3) ringRoad(world, L, 7.5 * ctx.style.density);
    if (s === 4) ringRoad(world, L, 12.5 * ctx.style.density);
    // Deliberate upgrade of the core's houses.
    const pc = plazaCentre(L);
    for (const b of L.buildings) {
      const d = Math.hypot(b.x - L.ox + b.w / 2 - pc.x, b.y - L.oy + b.h / 2 - pc.y);
      if (b.kind === 'house') {
        if (s >= 3 && d < 8) b.level = Math.max(b.level, 2);
        if (s >= 4 && d < 6) b.level = Math.max(b.level, 3);
      }
      if (b.kind === 'keep' || b.kind === 'hall') b.level = Math.max(b.level, s >= 4 ? 3 : s >= 3 ? 2 : 1);
    }
    plazaDecor(L);
  }
  repairLayout(world, L);
  L.v++;
  return true;
}

function plazaDecor(L) {
  const p = L.plaza;
  const cx = L.ox + p.x0 + ((p.w - 1) >> 1);
  const cy = L.oy + p.y0 + ((p.h - 1) >> 1);
  L.decor = L.decor.filter((d) => !(d.plaza && d.k !== 'stall'));
  if (L.stage >= 1) L.decor.push({ k: L.stage >= 4 ? 'fountain' : 'well', x: cx, y: cy, plaza: true });
}

/** Market stalls along the plaza edge (overlay; never blocks movement). */
export function addMarketStalls(L) {
  const p = L.plaza;
  if (L.decor.some((d) => d.k === 'stall')) return;
  const spots = [];
  for (let x = p.x0; x < p.x0 + p.w; x++) spots.push([x, p.y0 + p.h - 1]);
  let n = 0;
  for (const [x, y] of spots) {
    if (n >= 3) break;
    if ((x - p.x0) % 2 === 1 && p.w > 3) continue;
    L.decor.push({ k: 'stall', x: L.ox + x, y: L.oy + y, plaza: true });
    n++;
  }
  L.v++;
}

function ringRoad(world, L, ringR) {
  const ctx = ctxOf(world, L);
  const pts = [];
  for (const art of L.arteries) {
    let best = -1;
    let bd = Infinity;
    for (const l of art.cells) {
      const d = Math.abs(distC(L, l) - ringR);
      if (d < bd) {
        bd = d;
        best = l;
      }
    }
    if (best >= 0 && bd < 2.5) pts.push({ l: best, a: Math.atan2(((best / N) | 0) - plazaCentre(L).y, (best % N) - plazaCentre(L).x) });
  }
  if (pts.length < 3) return;
  pts.sort((p, q) => p.a - q.a);
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k];
    const b = pts[(k + 1) % pts.length];
    let gap = b.a - a.a;
    if (gap <= 0) gap += Math.PI * 2;
    if (gap > 2.3) continue;
    const path = route(ctx, L, [a.l], (l) => l === b.l, b.l, { cls: ROAD.STREET, ringR, maxNodes: 20000 });
    if (!path) continue;
    if (path.length > ringR * gap * 1.9 + 5) continue;
    layRoad(L, path.filter((l) => !isNet(L, l)), ROAD.STREET);
  }
  L.v++;
}

/**
 * Raise walls around the built-up core. level 1 palisade, 2 stone, 3 fortress.
 * The wall traces the outline of the dense core (core buildings dilated by two
 * cells, holes filled); structures touching the outline are absorbed so the
 * wall never cuts through them. Roads crossing the line become gates; water
 * and rivers close the ring naturally.
 */
export function buildWalls(world, L, level) {
  const ctx = ctxOf(world, L);
  if (L.walls) {
    L.walls.level = Math.max(L.walls.level, level);
    L.v++;
    return L.walls;
  }
  const pc = plazaCentre(L);
  const cap = compactRadius(L) * 1.15 + 2;
  const CORE = new Set(['house', 'keep', 'hall', 'lodge', 'market', 'temple', 'tavern', 'granary', 'workshop', 'smithy', 'wonder']);
  const region = new Uint8Array(N * N);
  const addRect = (x0, y0, w, h, pad) => {
    for (let y = y0 - pad; y < y0 + h + pad; y++) {
      for (let x = x0 - pad; x < x0 + w + pad; x++) if (inner(x, y)) region[y * N + x] = 1;
    }
  };
  for (const y of [L.plaza.y0]) addRect(L.plaza.x0, y, L.plaza.w, L.plaza.h, 2);
  for (const b of L.buildings) {
    if (!CORE.has(b.kind)) continue;
    const x0 = b.x - L.ox;
    const y0 = b.y - L.oy;
    if (Math.hypot(x0 + b.w / 2 - pc.x, y0 + b.h / 2 - pc.y) > cap) continue; // suburb
    addRect(x0, y0, b.w, b.h, 2);
  }
  for (const r of L.reserved) addRect(r.x0, r.y0, r.w, r.h, 2);
  const structureRect = (l) => {
    // Rect of whatever structure occupies cell l (building, field, garden or pier).
    const o = L.occ[l];
    if (o === O.BUILDING) {
      const b = L.buildings.find((q) => q.id === ctx.bid[l]);
      if (b) return [b.x - L.ox, b.y - L.oy, b.w, b.h];
    }
    if (o === O.FIELD) {
      const x = L.ox + (l % N);
      const y = L.oy + ((l / N) | 0);
      const f = L.fields.find((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
      if (f) return [f.x - L.ox, f.y - L.oy, f.w, f.h];
    }
    return [l % N, (l / N) | 0, 1, 1];
  };
  const blocks = (o) => o === O.BUILDING || o === O.FIELD || o === O.DOCK || o === O.GARDEN || o === O.RESERVE;
  let outline = [];
  for (let iter = 0; iter < 60; iter++) {
    // Fill holes: everything not reachable from the border is inside.
    const outside = new Uint8Array(N * N);
    const q = [];
    for (let k = 0; k < N; k++) {
      for (const l of [k, (N - 1) * N + k, k * N, k * N + N - 1]) {
        if (!region[l] && !outside[l]) {
          outside[l] = 1;
          q.push(l);
        }
      }
    }
    while (q.length) {
      const c = q.pop();
      const x = c % N;
      const y = (c / N) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const nl = ny * N + nx;
        if (!region[nl] && !outside[nl]) {
          outside[nl] = 1;
          q.push(nl);
        }
      }
    }
    for (let l = 0; l < N * N; l++) if (!outside[l]) region[l] = 1;
    // Outline: outside cells touching the region (8-neighbour => 4-connected ring).
    outline = [];
    let grew = false;
    for (let l = 0; l < N * N; l++) {
      if (region[l]) continue;
      const x = l % N;
      const y = (l / N) | 0;
      let touch = false;
      for (let dy = -1; dy <= 1 && !touch; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if ((dx || dy) && nx >= 0 && ny >= 0 && nx < N && ny < N && region[ny * N + nx]) {
            touch = true;
            break;
          }
        }
      }
      if (!touch) continue;
      if (blocks(L.occ[l])) {
        const [rx, ry, rw, rh] = structureRect(l);
        addRect(rx, ry, rw, rh, 1);
        grew = true;
      }
      outline.push(l);
    }
    if (!grew) break;
  }
  // Every main road must leave through the wall: extend arteries that end inside.
  const onOutline = new Uint8Array(N * N);
  for (const l of outline) onOutline[l] = 1;
  for (const art of L.arteries) {
    if (!region[art.gate] && !onOutline[art.gate]) continue;
    let target = -1;
    for (let r = Math.ceil(distC(L, art.gate)) + 1; r < R - 1 && target < 0; r++) {
      const t = nearestBuildable(ctx, L, Math.round(pc.x + Math.cos(art.angle) * r), Math.round(pc.y + Math.sin(art.angle) * r), 1);
      if (t >= 0 && !region[t] && !onOutline[t] && !isNet(L, t)) target = t;
    }
    if (target < 0) continue;
    for (const l of art.apron) if (L.occ[l] === O.APRON) L.occ[l] = O.FREE;
    const path = route(ctx, L, [art.gate], (l) => l === target, target, { cls: ROAD.MAIN });
    if (!path) continue;
    layRoad(L, path, ROAD.MAIN);
    for (const l of path.slice(1)) art.cells.push(l);
    art.gate = target;
  }
  const wall = [];
  const gates = [];
  for (const l of outline) {
    if (!inner(l % N, (l / N) | 0)) continue;
    const t = ctx.tbase[l];
    if (t === T.WATER || t === T.SHORE || t === T.BLOCK || t === T.RIVER) continue;
    const o = L.occ[l];
    if (blocks(o)) continue;
    if (o === O.ROAD || o === O.PLAZA) gates.push(l);
    else wall.push(l);
  }
  for (const l of wall) L.occ[l] = O.WALL;
  L.decor = L.decor.filter((d) => !(d.l !== undefined && L.occ[d.l] === O.WALL));
  L.walls = {
    level,
    cells: wall.map((l) => [L.ox + (l % N), L.oy + ((l / N) | 0)]),
    gates: gates.map((l) => [L.ox + (l % N), L.oy + ((l / N) | 0)]),
  };
  for (const art of L.arteries) setApron(ctx, L, art);
  repairLayout(world, L);
  L.v++;
  return L.walls;
}

/** Remove a building (deliberate demolition or siege damage). */
export function removeBuilding(world, L, id) {
  const ctx = ctxOf(world, L);
  const b = L.buildings.find((q) => q.id === id);
  if (!b) return false;
  const x0 = b.x - L.ox;
  const y0 = b.y - L.oy;
  for (let y = y0; y < y0 + b.h; y++) {
    for (let x = x0; x < x0 + b.w; x++) {
      L.occ[y * N + x] = O.FREE;
      ctx.bid[y * N + x] = 0;
    }
  }
  const fi = L.fields.findIndex((f) => f.id === id);
  if (fi >= 0) {
    const f = L.fields[fi];
    for (let y = f.y - L.oy; y < f.y - L.oy + f.h; y++) for (let x = f.x - L.ox; x < f.x - L.ox + f.w; x++) L.occ[y * N + x] = O.FREE;
    L.fields.splice(fi, 1);
  }
  const di = L.docks.findIndex((d) => d.id === id);
  if (di >= 0) {
    for (const [x, y] of L.docks[di].cells) L.occ[(y - L.oy) * N + (x - L.ox)] = O.FREE;
    L.docks.splice(di, 1);
  }
  L.buildings = L.buildings.filter((q) => q !== b);
  repairLayout(world, L);
  L.v++;
  return true;
}

/** Mark a construction site as finished. */
export function completeBuilding(L, id) {
  const b = L.buildings.find((q) => q.id === id);
  if (b && b.state !== 'built') {
    b.state = 'built';
    L.v++;
  }
  return b;
}

// ---------------------------------------------------------------------------
// Queries and serialisation

/** World tiles this settlement occupies with structures (for world-road routing). */
export function occupiedWorldCells(L) {
  const out = [];
  for (let l = 0; l < N * N; l++) {
    const o = L.occ[l];
    if (o === O.BUILDING || o === O.FIELD || o === O.DOCK || o === O.WALL || o === O.GARDEN) out.push([L.ox + (l % N), L.oy + ((l / N) | 0)]);
  }
  return out;
}

/** Bounding box (world tiles) of everything built, for rendering. */
export function layoutBounds(L) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let l = 0; l < N * N; l++) {
    if (L.occ[l] === O.FREE || L.occ[l] === O.APRON) continue;
    const x = l % N;
    const y = (l / N) | 0;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  if (x0 === Infinity) return { x: L.cx, y: L.cy, w: 1, h: 1 };
  return { x: L.ox + x0, y: L.oy + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function b64(u8) {
  if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

function unb64(str) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(str, 'base64'));
  const s = atob(str);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

/** Plain JSON-safe copy (typed arrays as base64). */
export function serializeLayout(L) {
  return {
    ...L,
    occ: b64(L.occ),
    road: b64(L.road),
    arteries: L.arteries.map((a) => ({ angle: a.angle, cells: a.cells, gate: a.gate, apron: a.apron })),
  };
}

export function deserializeLayout(data) {
  return { ...data, occ: unb64(data.occ), road: unb64(data.road) };
}
