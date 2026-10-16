// Attacks: troops pushing a border into unclaimed land or a rival's realm.
// Each attack keeps a frontier of target tiles next to the attacker's land,
// ordered like a wave front: a captured tile adds its neighbours with a key
// that grows with terrain (mountains fall later) and, when the attack has a
// focus point, is a little smaller toward it. Every tile costs troops; the
// attack ends when the troops are spent or no frontier is left, and what
// remains goes home.

import { MinHeap } from '../core/heap.js';
import { RULES, attackSpeed } from './defs.js';

const FOCUS_PULL = 0.5;

function heapOf(a) {
  const h = new MinHeap();
  h.keys = a.hk;
  h.vals = a.hv;
  return h;
}

/** Defence multiplier of tile i for its owner: outposts nearby, traitors. */
export function defenseAt(m, i, owner) {
  let mult = 1;
  const p = m.state.players[owner];
  if (p.traitorUntil > m.state.t) mult *= RULES.traitorDefense;
  const x = i % m.W;
  const y = (i / m.W) | 0;
  const R2 = RULES.outpostRadius * RULES.outpostRadius;
  for (const s of m.state.structures) {
    if (s.kind !== 'outpost' || s.owner !== owner) continue;
    const dx = s.x - x;
    const dy = s.y - y;
    if (dx * dx + dy * dy <= R2) {
      mult *= RULES.outpostDefense;
      break;
    }
  }
  return mult;
}

/** Troops needed to take tile i in attack a, and what the defender loses. */
export function tileCost(m, a, i) {
  const terr = m.terr[i];
  if (a.to < 0) return { cost: RULES.neutralCost * terr, loss: 0 };
  const d = m.state.players[a.to];
  const troops = m.troops(d);
  const density = troops / Math.max(1, d.tiles);
  // A large attack against a small garrison pays less per tile, and the reverse.
  const ratio = Math.max(0.4, Math.min(2.5, Math.pow(Math.max(1, troops) / Math.max(1, a.troops), 0.35)));
  const local = density * terr * defenseAt(m, i, a.to);
  return { cost: 1 + local * RULES.defense * ratio, loss: Math.min(troops, local * RULES.defLoss) };
}

function focusDist(a, i, W) {
  if (a.fx == null) return 0;
  return Math.hypot((i % W) - a.fx, ((i / W) | 0) - a.fy);
}

/** Add target tiles bordering the attacker's land to the frontier. */
function seed(m, a) {
  const { W, H, owner } = m;
  const p = m.state.players[a.from];
  const h = heapOf(a);
  const [x0, y0, x1, y1] = p.bbox;
  const w = FOCUS_PULL;
  for (let y = Math.max(0, y0 - 1); y <= Math.min(H - 1, y1 + 1); y++) {
    for (let x = Math.max(0, x0 - 1); x <= Math.min(W - 1, x1 + 1); x++) {
      const i = y * W + x;
      if (owner[i] !== a.to || !m.land[i] || !m.touches(i, a.from)) continue;
      h.push(i, m.noise(i, a.id) * 1.5 + w * focusDist(a, i, W) * 0.2);
    }
  }
}

function push(m, a, h, from, key) {
  const { W, owner } = m;
  const x = from % W;
  const fd = focusDist(a, from, W);
  const add = (j) => {
    if (owner[j] !== a.to || !m.land[j]) return;
    const step = m.terr[j] * (0.6 + 0.8 * m.noise(j, a.id));
    const pull = a.fx == null ? 0 : FOCUS_PULL * (focusDist(a, j, W) - fd);
    h.push(j, key + Math.max(0.1, step + pull));
  };
  if (x > 0) add(from - 1);
  if (x < W - 1) add(from + 1);
  if (from >= W) add(from - W);
  if (from + W < owner.length) add(from + W);
}

/**
 * Start (or reinforce) an attack. opts: { fx, fy } focus point, landing tile
 * for troops arriving by boat.
 */
export function launch(m, from, to, troops, { fx = null, fy = null, landing = null } = {}) {
  const st = m.state;
  const p = st.players[from];
  if (landing == null) {
    // Troops meeting an attack coming the other way cancel out first.
    const counter = st.attacks.find((q) => q.from === to && q.to === from && !q.landing);
    if (counter) {
      const n = Math.min(counter.troops, troops);
      counter.troops -= n;
      troops -= n;
      if (counter.troops <= 0.5) st.attacks = st.attacks.filter((q) => q !== counter);
      if (troops <= 0.5) return null;
    }
    const same = st.attacks.find((q) => q.from === from && q.to === to && !q.landing);
    if (same) {
      same.troops += troops;
      if (fx != null) {
        same.fx = fx;
        same.fy = fy;
      }
      return same;
    }
  }
  const a = { id: m.nextId(), from, to, troops, start: st.t, fx, fy, landing: landing != null, hk: [], hv: [] };
  if (landing != null) push(m, a, heapOf(a), landing, 0);
  else seed(m, a);
  st.attacks.push(a);
  p.stats.attacks++;
  if (to >= 0 && landing == null) m.event(to, 'attacked', `${p.name} attacks you.`);
  return a;
}

/** Advance every attack by one step. */
export function tick(m) {
  const st = m.state;
  const ps = st.players;
  const done = [];
  for (const a of st.attacks) {
    const p = ps[a.from];
    if (!p.alive) {
      done.push(a);
      continue;
    }
    const h = heapOf(a);
    let n = attackSpeed(a.troops, a.to < 0);
    let stuck = false;
    while (n > 0 && h.size) {
      const key = h.peekKey();
      const i = h.pop();
      if (m.owner[i] !== a.to || !m.touches(i, a.from)) continue;
      const { cost, loss } = tileCost(m, a, i);
      if (a.troops < cost) {
        stuck = true;
        break;
      }
      a.troops -= cost;
      if (a.to >= 0) {
        const d = ps[a.to];
        d.troops = Math.max(0, d.troops - loss);
      }
      m.setOwner(i, a.from);
      push(m, a, h, i, key);
      n--;
    }
    if (stuck || !h.size || a.troops < 0.5) done.push(a);
  }
  if (!done.length) return;
  for (const a of done) finish(m, a, 1);
}

/** End an attack; `keep` is the share of its troops that returns home. */
export function finish(m, a, keep = 1) {
  const st = m.state;
  st.attacks = st.attacks.filter((q) => q !== a);
  const p = st.players[a.from];
  if (p.alive) p.troops += a.troops * keep;
}

/** Call off attacks between two players (an alliance was made). */
export function callOff(m, x, y) {
  for (const a of [...m.state.attacks]) if ((a.from === x && a.to === y) || (a.from === y && a.to === x)) finish(m, a, 1);
}
