// Expansion and infrastructure: settler parties found outposts, and
// kingdoms build roads (with bridges) between settlements.

import { B, BIOMES } from '../world/biomes.js';
import { canFoundAt } from '../world/sites.js';
import { ensureGate } from '../settlement/planner.js';
import { RULES } from './defs.js';

export function foundError(m, kid, src, x, y) {
  const W = m.world.width;
  if (x < 3 || y < 3 || x >= W - 3 || y >= m.world.height - 3) return 'Outside the known world.';
  if (!src || src.kingdom !== kid) return 'Choose one of your settlements to send settlers from.';
  if (!canFoundAt(m.world, x, y)) return 'Settlers cannot build on that terrain.';
  const own = m.ownerK[y * W + x];
  if (own !== -1 && own !== kid) return 'That land belongs to someone else.';
  for (const s of m.state.settlements) {
    if (Math.hypot(s.x - x, s.y - y) < (s.hub ? 14 : RULES.minSettlementGap)) return `Too close to ${s.name}.`;
  }
  for (const p of m.state.parties) if (p.kind === 'settlers' && Math.hypot(p.dest.x - x, p.dest.y - y) < RULES.minSettlementGap) return 'Settlers are already heading there.';
  if (src.pop < RULES.settlerMinPop) return `${src.name} needs ${RULES.settlerMinPop} people to send settlers.`;
  if (src.unrest > 0) return `${src.name} is in unrest.`;
  if (src.stage < 1) return 'Outposts cannot send settlers; grow them into a hamlet first.';
  if (!m.canAfford(kid, RULES.settlerCost)) return `Settlers need ${RULES.settlerCost.wood} wood and ${RULES.settlerCost.food} food.`;
  const parties = m.state.parties.filter((p) => p.kid === kid && p.kind === 'settlers').length;
  const cap = m.settlement(m.state.kingdoms[kid].capital);
  const maxParties = 1 + Math.floor((cap ? cap.stage : 0) / 2);
  if (parties >= maxParties) return `At most ${maxParties} settler parties at once.`;
  return null;
}

export function orderFound(m, kid, sid, x, y) {
  const src = m.settlement(sid);
  const err = foundError(m, kid, src, x, y);
  if (err) return { error: err };
  const profile = { kid, kind: 'settlers' };
  const path = m.findPath(profile, src.x, src.y, x, y);
  if (!path) return { error: 'Settlers cannot find a way there.' };
  if (m.pathCost(profile, path) > RULES.maxFoundDistance * 1.6) return { error: 'Too far for settlers to travel.' };
  m.pay(kid, RULES.settlerCost);
  src.pop -= RULES.settlerPop;
  m.state.parties.push({ id: m.nextId(), kind: 'settlers', kid, x: src.x, y: src.y, path, pi: 0, pf: 0, dest: { x, y }, pop: RULES.settlerPop, from: sid });
  m.event(kid, 'info', `Settlers leave ${src.name}.`, src.x, src.y);
  return { ok: true };
}

/** 4-connected road route between two world points (bridges allowed). */
export function roadPath(m, ax, ay, bx, by) {
  const W = m.world.width;
  const { biome } = m.world;
  const cost = (from, to) => {
    const b = biome[to];
    if (b === B.SEA || b === B.DEEP || b === B.LAKE || b === B.PEAK) return Infinity;
    if (m.struct[to] && !m.roadMask[to]) return Infinity;
    if (m.roadMask[to]) return 0.35;
    if (b === B.RIVER) return 7;
    return 0.6 + BIOMES[b].move * 0.45;
  };
  return m.search.astar({ start: ay * W + ax, goal: by * W + bx, target: by * W + bx, cost, diag: false, minStep: 0.35, maxNodes: 150000 });
}

export function roadQuote(m, path) {
  let wood = 0;
  let stone = 0;
  let tiles = 0;
  for (const i of path) {
    if (m.roads[i] || m.roadMask[i]) continue;
    tiles++;
    if (m.world.biome[i] === B.RIVER) {
      wood += RULES.bridgeCostPerTile.wood;
      stone += RULES.bridgeCostPerTile.stone;
    } else wood += RULES.roadCostPerTile.wood;
  }
  return { wood, stone, tiles };
}

export function orderRoad(m, kid, aId, bId) {
  const a = m.settlement(aId);
  const b = m.settlement(bId);
  if (!a || !b || a === b) return { error: 'Choose two settlements.' };
  if (a.kingdom !== kid) return { error: 'Roads start from your own settlements.' };
  if (b.kingdom !== kid && !b.hub) return { error: 'Roads can connect your settlements or a free city.' };
  if (m.state.roadJobs.some((r) => (r.a === aId && r.b === bId) || (r.a === bId && r.b === aId))) return { error: 'That road is already being built.' };
  if (Math.hypot(a.x - b.x, a.y - b.y) > 90) return { error: 'Too far for one road.' };
  const LA = m.layouts.get(a.id);
  const LB = m.layouts.get(b.id);
  m.prepareLayout(LA);
  m.prepareLayout(LB);
  const ga = ensureGate(m.world, LA, b.x, b.y);
  const gb = ensureGate(m.world, LB, a.x, a.y);
  m.layoutChanged(a);
  m.layoutChanged(b);
  const path = roadPath(m, ga.x, ga.y, gb.x, gb.y);
  if (!path) return { error: 'No buildable route between them.' };
  const q = roadQuote(m, path);
  if (q.tiles === 0) return { error: 'They are already connected by road.' };
  m.state.roadJobs.push({ id: m.nextId(), kid, a: aId, b: bId, path, idx: 0, acc: 0, quote: q });
  m.event(kid, 'info', `Road works begin between ${a.name} and ${b.name} (${q.tiles} tiles, ${q.wood} wood${q.stone ? `, ${q.stone} stone` : ''}).`, a.x, a.y);
  return { ok: true, quote: q };
}

export function tick(m, dt) {
  const st = m.state;
  // Settler parties (caravans are moved by trade.js).
  for (const p of st.parties.slice()) {
    if (p.kind !== 'settlers') continue;
    const k = st.kingdoms[p.kid];
    if (!k.alive) {
      st.parties = st.parties.filter((q) => q !== p);
      continue;
    }
    const done = m.advance(p, { kid: p.kid, kind: p.kind }, 0.7, dt);
    if (p.blocked) {
      p.blocked = false;
      const path = m.findPath({ kid: p.kid, kind: p.kind }, p.x, p.y, p.dest.x, p.dest.y);
      if (path) {
        p.path = path;
        p.pi = 0;
        p.pf = 0;
      } else {
        st.parties = st.parties.filter((q) => q !== p);
        continue;
      }
    }
    if (!done) continue;
    // Settlers arrive.
    st.parties = st.parties.filter((q) => q !== p);
    const { x, y } = p.dest;
    let err = null;
    if (!canFoundAt(m.world, x, y)) err = 'the land is unsuitable';
    const own = m.ownerK[y * m.world.width + x];
    if (!err && own !== -1 && own !== p.kid) err = 'another kingdom claimed it first';
    if (!err) for (const s of st.settlements) if (Math.hypot(s.x - x, s.y - y) < RULES.minSettlementGap) err = `it is too close to ${s.name}`;
    if (err) {
      const home = m.settlement(p.from);
      if (home && home.kingdom === p.kid) home.pop += p.pop;
      m.event(p.kid, 'warn', `Settlers turned back: ${err}.`, x, y);
      continue;
    }
    const s = m.newSettlement(p.kid, x, y, { kind: 'outpost', stage: 0, pop: p.pop });
    m.event(p.kid, 'found', `Settlers found the outpost of ${s.name}.`, x, y);
  }

  // Road construction, tile by tile, paid as it goes.
  for (const r of st.roadJobs.slice()) {
    const k = st.kingdoms[r.kid];
    const a = m.settlement(r.a);
    const b = m.settlement(r.b);
    if (!k.alive || !a || a.kingdom !== r.kid) {
      st.roadJobs = st.roadJobs.filter((q) => q !== r);
      continue;
    }
    const builders = (a.jobs.assigned?.build || 0) + (b && b.kingdom === r.kid ? b.jobs.assigned?.build || 0 : 0);
    const rate = RULES.roadRate * (0.35 + 0.65 * Math.min(1, builders / 6));
    r.acc += rate * dt;
    let changed = false;
    while (r.acc >= 1 && r.idx < r.path.length) {
      const i = r.path[r.idx];
      if (!m.roads[i] && !m.roadMask[i]) {
        const bridge = m.world.biome[i] === B.RIVER;
        const cost = bridge ? RULES.bridgeCostPerTile : RULES.roadCostPerTile;
        if (!m.canAfford(r.kid, cost)) {
          r.stalled = true;
          r.acc = 0;
          break;
        }
        m.pay(r.kid, cost);
        r.stalled = false;
      }
      m.roads[i] = 1;
      m.roadMask[i] = 1;
      r.idx++;
      r.acc -= 1;
      changed = true;
    }
    if (changed) st.roadsV++;
    if (r.idx >= r.path.length) {
      st.roadJobs = st.roadJobs.filter((q) => q !== r);
      m.event(r.kid, 'built', `The road from ${a.name} to ${b ? b.name : '?'} is finished.`, a.x, a.y);
    }
  }
}
