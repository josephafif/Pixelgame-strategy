// Towns, ports and outposts. Each one is a settlement layout from the town
// planner: a town grows houses, fields and civic buildings as its level
// rises; a port is a harbour village; an outpost is a walled fort. Each has
// a garrison; when it is gone, the first rival squad at the gate takes the
// place and the land it guarded (engine/sim/units.js).

import { createLayout, addBuilding, applyStage, buildWalls, markBlocked } from '../settlement/planner.js';
import { canFoundAt } from '../world/sites.js';
import { placeName } from '../world/names.js';
import { BIOMES } from '../world/biomes.js';
import { RULES, TOWN_LEVELS, TOWN_PLAN, MAX_TOWN_LEVEL, STRUCTURES, structureCost, upgradeCost, garrisonMax } from './defs.js';

const LAYOUT_OPS_PER_STEP = 3;

export function create(m, kind, owner, x, y, { capital = false } = {}) {
  const st = m.state;
  const id = m.nextId();
  const i = m.idx(x, y);
  const biome = BIOMES[m.world.biome[i]].key;
  const s = {
    id,
    kind,
    owner,
    x,
    y,
    level: 1,
    capital,
    name: placeName(st.seed, id * 7 + x, biome),
    plan: 0,
    houses: 0,
    full: false,
    grownAt: st.t,
    built: st.t,
    layoutV: 0,
    garrison: 0,
  };
  s.garrison = garrisonMax(s);
  const L = createLayout(m.world, { id, cx: x, cy: y, seed: st.seed, kind: capital ? 'capital' : kind === 'outpost' ? 'outpost' : 'town', blocked: m.struct });
  m.layouts.set(id, L);
  st.structures.push(s);
  m.structAt.set(i, id);
  st.structV++;
  if (kind === 'town') {
    applyStage(m.world, L, TOWN_LEVELS[1].stage);
    for (let k = 0; k < 3; k++) if (layoutOp(m, s, 'house')) s.houses++;
  } else if (kind === 'port') {
    applyStage(m.world, L, 1);
    for (const b of ['harbor', 'house', 'fishery', 'house', 'house']) layoutOp(m, s, b);
  } else {
    for (const b of ['tower', 'barracks', 'tower', 'house']) layoutOp(m, s, b);
    buildWalls(m.world, L, 1);
  }
  m.layoutChanged(s);
  return s;
}

function layoutOp(m, s, kind) {
  const L = m.layouts.get(s.id);
  markBlocked(L, m.struct, m.world);
  const b = addBuilding(m.world, L, kind);
  m.layoutChanged(s);
  return b;
}

/** The tile under a structure changed hands. */
export function captured(m, sid, from, to) {
  const s = m.state.structures.find((q) => q.id === sid);
  if (!s || s.owner === to) return;
  s.owner = to;
  s.capital = false;
  s.garrison = garrisonMax(s) * 0.2;
  m.state.structV++;
  const what = STRUCTURES[s.kind].name.toLowerCase();
  const p = m.state.players[to];
  if (from >= 0) m.event(from, 'lost', `${p ? p.name : 'Someone'} took your ${what} ${s.name}.`, s.x, s.y);
  if (to >= 0) m.event(to, 'captured', `You took the ${what} ${s.name}.`, s.x, s.y);
}

/** Why `pid` cannot build `kind` at (x, y), or null. Also returns the spot to use. */
export function buildCheck(m, pid, kind, x, y) {
  const st = m.state;
  const p = st.players[pid];
  if (!STRUCTURES[kind]) return { error: 'Unknown building.' };
  if (x < 0 || y < 0 || x >= m.W || y >= m.H) return { error: 'Outside the map.' };
  let i = m.idx(x, y);
  if (kind === 'port') {
    // Ports go on the shore: use the nearest coastal tile of your own.
    let best = null;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 2 || ny < 2 || nx >= m.W - 2 || ny >= m.H - 2) continue;
        const j = m.idx(nx, ny);
        if (m.coast[j] < 0 || m.owner[j] !== pid || !canFoundAt(m.world, nx, ny)) continue;
        const d = dx * dx + dy * dy;
        if (!best || d < best.d) best = { d, x: nx, y: ny };
      }
    }
    if (!best) return { error: 'Ports must be on your own coast, by open water.' };
    x = best.x;
    y = best.y;
    i = m.idx(x, y);
  }
  if (m.owner[i] !== pid) return { error: 'You can only build on your own land.' };
  if (!canFoundAt(m.world, x, y)) return { error: 'That ground cannot be built on.' };
  for (const s of st.structures) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < RULES.structureSpacing) return { error: `Too close to ${s.name}.` };
    if (kind === 'town' && s.kind === 'town' && d < RULES.townSpacing) return { error: `Too close to the town ${s.name}.` };
  }
  const cost = structureCost(kind, p.built[kind]);
  if (p.gold < cost) return { error: `A ${STRUCTURES[kind].name.toLowerCase()} costs ${cost} gold.` };
  return { x, y, cost };
}

export function build(m, pid, kind, x, y) {
  const c = buildCheck(m, pid, kind, x, y);
  if (c.error) return c;
  const p = m.state.players[pid];
  p.gold -= c.cost;
  p.built[kind]++;
  const s = create(m, kind, pid, c.x, c.y);
  m.event(pid, 'built', `${STRUCTURES[kind].name} ${s.name} founded.`, s.x, s.y);
  return { ok: true, id: s.id };
}

export function upgrade(m, pid, sid) {
  const s = m.state.structures.find((q) => q.id === sid);
  if (!s || s.owner !== pid) return { error: 'Not your town.' };
  if (s.kind !== 'town') return { error: 'Only towns grow.' };
  if (s.level >= MAX_TOWN_LEVEL) return { error: `${s.name} is already a city.` };
  const p = m.state.players[pid];
  const cost = upgradeCost(s.level);
  if (p.gold < cost) return { error: `Growing ${s.name} costs ${cost} gold.` };
  p.gold -= cost;
  const before = garrisonMax(s);
  s.level++;
  s.full = false;
  s.garrison += garrisonMax(s) - before;
  m.state.structV++;
  const L = m.layouts.get(s.id);
  markBlocked(L, m.struct, m.world);
  applyStage(m.world, L, TOWN_LEVELS[s.level].stage);
  const w = TOWN_LEVELS[s.level].walls;
  if (w) buildWalls(m.world, L, w);
  m.layoutChanged(s);
  m.event(pid, 'grew', `${s.name} is now a ${TOWN_LEVELS[s.level].name.toLowerCase()}.`, s.x, s.y);
  return { ok: true };
}

/** Towns fill in their plan over time: a few layout operations per step. */
export function tick(m) {
  const st = m.state;
  const list = st.structures;
  if (!list.length) return;
  let ops = LAYOUT_OPS_PER_STEP;
  const n = list.length;
  const start = st.tick % n;
  for (let k = 0; k < n && ops > 0; k++) {
    const s = list[(start + k) % n];
    if (s.kind !== 'town' || s.full || s.owner < 0 || st.t - s.grownAt < 2.5) continue;
    s.grownAt = st.t;
    ops--;
    const plan = [];
    for (let l = 1; l <= s.level; l++) plan.push(...TOWN_PLAN[l]);
    if (s.plan < plan.length) {
      layoutOp(m, s, plan[s.plan]);
      s.plan++;
      continue;
    }
    if (s.houses >= TOWN_LEVELS[s.level].houses) {
      s.full = true;
      continue;
    }
    if (layoutOp(m, s, 'house')) s.houses++;
    else s.full = true;
  }
}
