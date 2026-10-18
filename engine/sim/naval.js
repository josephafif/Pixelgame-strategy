// Trade ships. Every port keeps one ship at sea, sailing on its own to a
// port of another player on the same water; both owners earn gold when it
// arrives. (Soldiers cross water themselves: see engine/sim/units.js.)

import { RULES } from './defs.js';

export const MIN_WATER = 60; // smaller ponds carry no ships

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
    // Weighted A* (minStep above the true 1 per tile): near-straight routes over open water for a
    // fraction of the search, which matters on the big maps.
    path = m.search.astar({ start: a, goal: (j) => goal.has(j), target: g, cost: waterCost(m), diag: true, minStep: 1.6, maxNodes: 200000 });
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
    if (!sail(m, b, RULES.tradeSpeed, dt)) continue;
    done.push(b);
    arriveTrade(m, b);
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
