// Boats. Transport boats carry troops from your coast to a shore across the
// water and land there as an attack. Trade ships sail on their own between
// the ports of different players; both owners earn gold when one arrives.

import { RULES } from './defs.js';
import * as attacks from './attack.js';

export const MIN_WATER = 60; // smaller ponds carry no boats

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function waterCost(m) {
  return (from, to, diag) => (m.land[to] ? Infinity : diag ? 1.414 : 1);
}

/** Water tiles next to land tile i on body `body`. */
function waterBeside(m, i, body) {
  const out = [];
  const x = i % m.W;
  const y = (i / m.W) | 0;
  for (const [dx, dy] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= m.W || ny >= m.H) continue;
    const j = ny * m.W + nx;
    if (!m.land[j] && m.water[j] === body) out.push(j);
  }
  return out;
}

/** The nearest landing shore to (x, y) that `pid` could attack. */
export function landingNear(m, pid, x, y, r = 8) {
  let best = null;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.W || ny >= m.H) continue;
      const i = ny * m.W + nx;
      if (m.coast[i] < 0) continue;
      const o = m.owner[i];
      if (o === pid || (o >= 0 && m.allied(pid, o))) continue;
      const d = dx * dx + dy * dy;
      if (!best || d < best.d) best = { d, i };
    }
  }
  return best ? best.i : -1;
}

/**
 * Plan a boat from `pid`'s coast to land tile `target`: searches outward
 * over the water from the landing shore until it reaches the player's coast.
 * Returns { path, from } (water tiles from departure to arrival) or null.
 */
export function planBoat(m, pid, target, maxNodes = 160000) {
  const body = m.coast[target];
  if (body < 0) return null;
  const starts = waterBeside(m, target, body);
  if (!starts.length) return null;
  const { owner, W } = m;
  const isHome = (j) => {
    const x = j % W;
    const y = (j / W) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= m.H) continue;
      if (owner[ny * W + nx] === pid) return true;
    }
    return false;
  };
  // Search from the landing beach toward home; the path found is reversed.
  const path = m.search.astar({ start: starts[0], goal: isHome, cost: waterCost(m), diag: true, maxNodes });
  if (!path) return null;
  path.reverse();
  return { path };
}

/** Does `pid` hold any shore on water body `body`? */
export function hasCoastOn(m, pid, body) {
  const [x0, y0, x1, y1] = m.state.players[pid].bbox;
  for (let y = Math.max(0, y0); y <= Math.min(m.H - 1, y1); y++) {
    for (let x = Math.max(0, x0), i = y * m.W + x; x <= Math.min(m.W - 1, x1); x++, i++) {
      if (m.owner[i] === pid && m.coast[i] === body) return true;
    }
  }
  return false;
}

/** Send troops by boat toward (x, y). */
export function sendBoat(m, pid, x, y, troops) {
  const st = m.state;
  const p = st.players[pid];
  if (st.boats.filter((b) => b.owner === pid && b.kind === 'transport').length >= RULES.maxBoats) return { error: `At most ${RULES.maxBoats} boats at sea at once.` };
  const target = landingNear(m, pid, Math.round(x), Math.round(y));
  if (target < 0) return { error: 'Boats need a shore to land on.' };
  if (!hasCoastOn(m, pid, m.coast[target])) return { error: 'You have no coast on that water.' };
  const plan = planBoat(m, pid, target);
  if (!plan) return { error: 'None of your coast reaches that shore by water.' };
  const n = Math.min(troops, m.troops(p));
  if (n < RULES.minAttack) return { error: 'Not enough troops to send.' };
  p.troops -= n;
  const b = { id: m.nextId(), kind: 'transport', owner: pid, troops: n, path: plan.path, pi: 0, pf: 0, x: 0, y: 0, target };
  place(m, b);
  st.boats.push(b);
  p.stats.boats++;
  const o = m.owner[target];
  if (o >= 0) m.event(o, 'boat', `${p.name} sends ${Math.round(n)} troops by boat toward you.`, target % m.W, (target / m.W) | 0);
  return { ok: true, id: b.id };
}

function place(m, b) {
  const W = m.W;
  const a = b.path[b.pi];
  const c = b.path[Math.min(b.path.length - 1, b.pi + 1)];
  b.x = (a % W) + ((c % W) - (a % W)) * b.pf;
  b.y = ((a / W) | 0) + (((c / W) | 0) - ((a / W) | 0)) * b.pf;
}

/** Move a boat along its path; true on arrival. */
function sail(m, b, speed, dt) {
  const W = m.W;
  let budget = speed * dt;
  while (budget > 0 && b.pi < b.path.length - 1) {
    const a = b.path[b.pi];
    const c = b.path[b.pi + 1];
    const step = a % W !== c % W && ((a / W) | 0) !== ((c / W) | 0) ? 1.414 : 1;
    const need = step * (1 - b.pf);
    if (budget >= need) {
      budget -= need;
      b.pi++;
      b.pf = 0;
    } else {
      b.pf += budget / step;
      budget = 0;
    }
  }
  place(m, b);
  return b.pi >= b.path.length - 1;
}

function land(m, b) {
  const st = m.state;
  const p = st.players[b.owner];
  const i = b.target;
  const o = m.owner[i];
  if (!p.alive) return;
  if (o === b.owner || (o >= 0 && m.allied(b.owner, o))) {
    p.troops += b.troops;
    return;
  }
  const a = { from: b.owner, to: o, troops: b.troops, id: b.id };
  const { cost, loss } = attacks.tileCost(m, a, i);
  if (b.troops < cost) {
    if (o >= 0) m.event(o, 'repelled', `You threw back a landing by ${p.name}.`, i % m.W, (i / m.W) | 0);
    return;
  }
  if (o >= 0) st.players[o].troops = Math.max(0, st.players[o].troops - loss);
  m.setOwner(i, b.owner);
  attacks.launch(m, b.owner, o, b.troops - cost, { landing: i });
  if (o >= 0) m.event(o, 'landing', `${p.name} lands troops on your shore.`, i % m.W, (i / m.W) | 0);
}

// ---------------------------------------------------------------------------
// Trade

function tradePath(m, from, to) {
  const key = `${from.id}>${to.id}`;
  if (m.tradePaths.has(key)) return m.tradePaths.get(key);
  const body = m.coast[m.idx(from.x, from.y)];
  const a = waterBeside(m, m.idx(from.x, from.y), body)[0];
  const goal = new Set(waterBeside(m, m.idx(to.x, to.y), body));
  let path = null;
  if (a !== undefined && goal.size) {
    const g = [...goal][0];
    path = m.search.astar({ start: a, goal: (j) => goal.has(j), target: g, cost: waterCost(m), diag: true, maxNodes: 200000 });
  }
  if (m.tradePaths.size > 2000) m.tradePaths.clear();
  m.tradePaths.set(key, path);
  return path;
}

function launchTrade(m, port) {
  const st = m.state;
  const body = m.coast[m.idx(port.x, port.y)];
  const others = st.structures.filter((s) => s.kind === 'port' && s.owner >= 0 && s.owner !== port.owner && m.coast[m.idx(s.x, s.y)] === body);
  if (!others.length) return;
  // Allies are favoured partners; nearer ports a little more likely.
  const weighted = others.map((s) => [s, (m.allied(port.owner, s.owner) ? 3 : 1) / (1 + Math.hypot(s.x - port.x, s.y - port.y) / 120)]);
  const dest = m.rng.weighted(weighted);
  const path = tradePath(m, port, dest);
  if (!path || path.length < 2) return;
  const b = { id: m.nextId(), kind: 'trade', owner: port.owner, from: port.id, to: dest.id, path, pi: 0, pf: 0, x: 0, y: 0 };
  place(m, b);
  st.boats.push(b);
}

function arriveTrade(m, b) {
  const st = m.state;
  const dest = st.structures.find((s) => s.id === b.to);
  if (!dest || dest.owner < 0 || dest.owner === b.owner) return;
  const p = st.players[b.owner];
  const q = st.players[dest.owner];
  if (!p.alive || !q.alive) return;
  let gold = RULES.tradeGold + b.path.length * RULES.tradeGoldPerTile;
  if (m.allied(b.owner, dest.owner)) gold *= RULES.allyTradeBonus;
  p.gold += gold;
  q.gold += gold;
  p.stats.trade += gold;
  q.stats.trade += gold;
}

export function tick(m, dt) {
  const st = m.state;
  if (!st.boats.length && !st.structures.some((s) => s.kind === 'port')) return;
  const done = [];
  for (const b of st.boats) {
    const arrived = sail(m, b, b.kind === 'trade' ? RULES.tradeSpeed : RULES.boatSpeed, dt);
    if (!arrived) continue;
    done.push(b);
    if (b.kind === 'transport') land(m, b);
    else arriveTrade(m, b);
  }
  if (done.length) st.boats = st.boats.filter((b) => !done.includes(b));
  // Each port keeps one trade ship at sea.
  if (st.tick % 10 !== 0) return;
  for (const s of st.structures) {
    if (s.kind !== 'port' || s.owner < 0) continue;
    if (s.tradeAt == null) s.tradeAt = st.t + m.rng.range(RULES.tradeEvery[0] / 2, RULES.tradeEvery[1]);
    if (st.t < s.tradeAt) continue;
    if (st.boats.some((b) => b.kind === 'trade' && b.from === s.id)) continue;
    s.tradeAt = st.t + m.rng.range(RULES.tradeEvery[0], RULES.tradeEvery[1]);
    launchTrade(m, s);
  }
}
