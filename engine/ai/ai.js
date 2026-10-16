// AI players. Once a second each one looks at the survey (who borders whom,
// how much unclaimed land is next to it) and issues the same commands a
// human would: expand into empty land, attack a weaker neighbour, build and
// grow towns, ports and outposts, make and keep (or break) alliances.
//
// Three temperaments: builders grow and fortify, merchants trade and ally,
// warlords keep a large army and look for prey.

import { MAX_TOWN_LEVEL, structureCost, upgradeCost } from '../sim/defs.js';
import { buildCheck } from '../sim/structures.js';

const STYLE = {
  builder: { share: 0.55, expandAt: 0.3, attackAt: 0.65, edge: 1.3, ratio: 0.35, trust: 0.6, towns: 1.2, ports: 0.7, outposts: 1 },
  merchant: { share: 0.45, expandAt: 0.3, attackAt: 0.75, edge: 1.6, ratio: 0.3, trust: 0.85, towns: 1, ports: 1.6, outposts: 0.6 },
  warlord: { share: 0.7, expandAt: 0.25, attackAt: 0.5, edge: 0.85, ratio: 0.45, trust: 0.35, towns: 0.8, ports: 0.4, outposts: 0.5 },
};

// How hard the AI plays: how big an edge it wants before attacking, how full
// its realm must be, and how much more it wants before turning on a human.
export const DIFFICULTY = {
  easy: { edge: 1.6, attackAt: 0.15, human: 3, pile: 1 },
  normal: { edge: 1, attackAt: 0, human: 1.6, pile: 2 },
  hard: { edge: 0.85, attackAt: -0.05, human: 1.1, pile: 3 },
};

const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const xy = (m, i) => ({ x: i % m.W, y: (i / m.W) | 0 });

export function thinkAI(m, p) {
  const st = m.state;
  const sv = st.survey;
  if (!sv || !p.alive || st.phase !== 'running') return;
  const s = STYLE[p.personality] || STYLE.builder;
  const mem = p.ai_;
  if (Math.abs(p.troopShare - s.share) > 0.01) m.exec(p.id, { type: 'troops', share: s.share });
  for (const r of st.requests.filter((q) => q.to === p.id)) m.exec(p.id, { type: 'answer', id: r.id, accept: wantsAlly(m, p, r.from, s) });
  diplomacy(m, p, s, mem);
  spend(m, p, s);
  fight(m, p, s, mem);
}

function power(m, q) {
  return m.troops(q);
}

/** Near the end, the other big realm stands between p and victory: no peace with it. */
function endgameRival(m, p, q) {
  return p.tiles + q.tiles > m.landTotal * 0.6 && q.tiles > m.landTotal * 0.15 && p.tiles > m.landTotal * 0.15;
}

/** Would p accept an alliance with q? */
function wantsAlly(m, p, qid, s) {
  const st = m.state;
  const q = st.players[qid];
  if (!q.alive || q.traitorUntil > st.t || endgameRival(m, p, q)) return false;
  const allies = st.alliances.filter((a) => a.a === p.id || a.b === p.id).length;
  if (allies >= 3 && !m.allied(p.id, qid)) return false;
  const ratio = power(m, q) / Math.max(1, power(m, p));
  // Strong neighbours are better friends than enemies; weak ones are prey for warlords.
  const borders = (st.survey.contacts[p.id] || []).some(([o]) => o === qid);
  if (borders && ratio < 0.5 && p.personality === 'warlord') return false;
  return ratio > 1 - s.trust || m.noise(qid * 131 + p.id, Math.floor(st.t / 60)) < s.trust * 0.5;
}

function diplomacy(m, p, s, mem) {
  const st = m.state;
  mem.asked ||= {};
  const mine = power(m, p);
  for (const [q, len] of st.survey.contacts[p.id] || []) {
    const other = st.players[q];
    if (!other.alive) continue;
    const al = st.alliances.find((a) => (a.a === p.id && a.b === q) || (a.a === q && a.b === p.id));
    const asked = mem.asked[q] ?? -999;
    if (al) {
      // Renew in time with allies still worth having.
      if (al.until - st.t < 45 && st.t - asked > 30 && power(m, other) > mine * (1 - s.trust) && !endgameRival(m, p, other)) {
        mem.asked[q] = st.t;
        m.exec(p.id, { type: 'ally', to: q });
      }
      // A warlord with nothing left to take turns on a weak ally.
      if (p.personality === 'warlord' && st.t - al.since > 120 && power(m, other) < mine * 0.3 && len > 20 && !(st.survey.neutral[p.id]?.[0] > 0) && st.t - (mem.brokeAt ?? -999) > 240) {
        const others = (st.survey.contacts[p.id] || []).filter(([o]) => o !== q && !m.allied(p.id, o));
        if (!others.length) {
          mem.brokeAt = st.t;
          m.exec(p.id, { type: 'breakAlliance', to: q });
        }
      }
      continue;
    }
    // Ask a much stronger neighbour for peace.
    if (power(m, other) > mine * 1.4 && st.t - asked > 90 && !endgameRival(m, p, other)) {
      mem.asked[q] = st.t;
      m.exec(p.id, { type: 'ally', to: q });
    }
  }
}

function spend(m, p, s) {
  const st = m.state;
  const own = st.structures.filter((q) => q.owner === p.id);
  const towns = own.filter((q) => q.kind === 'town');
  const ports = own.filter((q) => q.kind === 'port');
  const outposts = own.filter((q) => q.kind === 'outpost');
  const wantTowns = 1 + Math.floor((p.tiles / 650) * s.towns);
  const townCost = structureCost('town', p.built.town);
  if (towns.length < wantTowns && p.gold >= townCost) {
    const spot = findSpot(m, p, 'town', 5);
    if (spot && m.exec(p.id, { type: 'build', kind: 'town', x: spot.x, y: spot.y }).ok) return;
  }
  const low = towns.filter((q) => q.level < MAX_TOWN_LEVEL).sort((a, b) => a.level - b.level || (b.capital ? 1 : 0) - (a.capital ? 1 : 0))[0];
  // Grow towns when another town is not due, or when there is gold for both.
  if (low && p.gold >= upgradeCost(low.level) && (towns.length >= wantTowns || p.gold >= upgradeCost(low.level) + townCost)) {
    if (m.exec(p.id, { type: 'upgrade', sid: low.id }).ok) return;
  }
  const portCost = structureCost('port', p.built.port);
  const coast = st.survey.coast[p.id] || 0;
  if (coast > 10 && ports.length < Math.min(3, Math.floor(s.ports * (1 + towns.length / 3))) && p.gold >= portCost) {
    const spot = findSpot(m, p, 'port', 2);
    if (spot && m.exec(p.id, { type: 'build', kind: 'port', x: spot.x, y: spot.y }).ok) return;
  }
  // Outposts face the most dangerous neighbour.
  const threat = (st.survey.contacts[p.id] || [])
    .filter(([q]) => !m.allied(p.id, q) && st.players[q].alive)
    .sort((a, b) => power(m, st.players[b[0]]) - power(m, st.players[a[0]]))[0];
  if (threat && power(m, st.players[threat[0]]) > power(m, p) * 0.8 && outposts.length < Math.ceil(towns.length * s.outposts) && p.gold >= structureCost('outpost', p.built.outpost)) {
    const at = xy(m, threat[2]);
    const spot = nearOwn(m, p, at.x, at.y, 7);
    if (spot) m.exec(p.id, { type: 'build', kind: 'outpost', x: spot.x, y: spot.y });
  }
}

/** A buildable own tile, preferring land deep inside the realm. */
function findSpot(m, p, kind, depth) {
  const [x0, y0, x1, y1] = p.bbox;
  if (x1 < x0) return null;
  let best = null;
  for (let k = 0; k < 40; k++) {
    let x = m.rng.int(x0, x1);
    let y = m.rng.int(y0, y1);
    if (kind === 'port') {
      const c = coastOf(m, p, x, y);
      if (!c) continue;
      x = c.x;
      y = c.y;
    }
    if (m.owner[m.idx(x, y)] !== p.id) continue;
    const c = buildCheck(m, p.id, kind, x, y);
    if (c.error) continue;
    const score = interior(m, p.id, c.x, c.y, depth) + m.rng.next();
    if (!best || score > best.score) best = { x: c.x, y: c.y, score };
  }
  return best;
}

/** The realm's coast nearest to (x, y), searched in widening squares. */
function coastOf(m, p, x, y) {
  for (let r = 0; r <= 12; r += 3) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= m.W || ny >= m.H) continue;
        const i = ny * m.W + nx;
        if (m.owner[i] === p.id && m.coast[i] >= 0) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

/** How many of 8 rays of length `depth` stay on own land (or water). */
function interior(m, pid, x, y, depth) {
  let n = 0;
  for (const [dx, dy] of DIR8) {
    let ok = true;
    for (let r = 1; r <= depth && ok; r++) {
      const nx = x + dx * r;
      const ny = y + dy * r;
      if (nx < 0 || ny < 0 || nx >= m.W || ny >= m.H) ok = false;
      else {
        const i = ny * m.W + nx;
        ok = m.owner[i] === pid || !m.land[i];
      }
    }
    if (ok) n++;
  }
  return n;
}

/** An own, buildable tile within r of (x, y), a little way back from the edge. */
function nearOwn(m, p, x, y, r) {
  let best = null;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 3 || ny < 3 || nx >= m.W - 3 || ny >= m.H - 3) continue;
      if (m.owner[m.idx(nx, ny)] !== p.id) continue;
      const d = Math.hypot(dx, dy);
      if (d < 3 || (best && d >= best.d)) continue;
      if (buildCheck(m, p.id, 'outpost', nx, ny).error) continue;
      best = { x: nx, y: ny, d };
    }
  }
  return best;
}

function fight(m, p, s, mem) {
  const st = m.state;
  const sv = st.survey;
  const fill = p.pop / Math.max(1, p.maxPop);
  const mine = st.attacks.filter((a) => a.from === p.id);
  const incoming = st.attacks.filter((a) => a.to === p.id);
  const pressed = incoming.reduce((t, a) => t + a.troops, 0) > power(m, p) * 0.3;
  // Unclaimed land first: it is cheap and the race for it is on.
  const [neutral, nTile] = sv.neutral[p.id] || [0, -1];
  if (neutral > 0 && nTile >= 0 && fill > s.expandAt && !mine.some((a) => a.to < 0 && !a.landing)) {
    const at = xy(m, nTile);
    m.exec(p.id, { type: 'attack', x: at.x, y: at.y, ratio: neutral > 40 ? s.ratio : s.ratio * 0.6 });
    return;
  }
  const D = DIFFICULTY[m.opts.difficulty] || DIFFICULTY.normal;
  if ((pressed && fill < 0.85) || fill < s.attackAt + D.attackAt) return;
  // The weakest rival along the border, weighed by how much of it we share.
  let best = null;
  for (const [q, len, tile] of sv.contacts[p.id] || []) {
    const o = st.players[q];
    if (!o.alive || m.allied(p.id, q)) continue;
    // Humans are not ganged up on: only a few AIs may attack one at a time.
    if (!o.ai && st.attacks.filter((a) => a.to === q && a.from !== p.id && st.players[a.from].ai).length >= D.pile) continue;
    let edge = power(m, p) / Math.max(1, power(m, o)) / (D.edge * (o.ai ? 1 : D.human));
    if (o.traitorUntil > st.t) edge *= 1.6;
    const score = edge * (1 + Math.min(1, len / 200) * 0.5);
    if (!best || score > best.score) best = { q, tile, edge, score };
  }
  if (best && best.edge >= s.edge && mine.filter((a) => a.to >= 0).length < 2) {
    const at = xy(m, best.tile);
    m.exec(p.id, { type: 'attack', x: at.x, y: at.y, ratio: s.ratio });
    return;
  }
  // Nothing to take by land: look across the water.
  const boating = st.boats.some((b) => b.owner === p.id && b.kind === 'transport');
  if ((sv.coast[p.id] || 0) > 0 && fill > Math.max(0.6, s.attackAt) && !boating && st.t - (mem.boatAt ?? -999) > 20) {
    mem.boatAt = st.t;
    const target = shoreTarget(m, p, s, D);
    if (target >= 0) {
      const at = xy(m, target);
      m.exec(p.id, { type: 'boat', x: at.x, y: at.y, ratio: s.ratio });
    }
  }
}

/** A shore worth landing on: empty land first, then weak rivals. */
function shoreTarget(m, p, s, D) {
  const st = m.state;
  const [x0, y0, x1, y1] = p.bbox;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  let best = -1;
  let bestScore = -Infinity;
  for (let k = 0; k < 60 && m.coastTiles.length; k++) {
    const i = m.coastTiles[m.rng.int(0, m.coastTiles.length - 1)];
    const o = m.owner[i];
    if (o === p.id || (o >= 0 && (m.allied(p.id, o) || !st.players[o].alive))) continue;
    const q = o >= 0 ? st.players[o] : null;
    let value = !q ? 2 : (power(m, p) / Math.max(1, power(m, q)) / (D.edge * (q.ai ? 1 : D.human))) * (p.personality === 'warlord' ? 1 : 0.5);
    if (o >= 0 && value < s.edge) continue;
    value -= Math.hypot((i % m.W) - cx, ((i / m.W) | 0) - cy) / 150;
    if (value > bestScore) {
      bestScore = value;
      best = i;
    }
  }
  return best;
}
