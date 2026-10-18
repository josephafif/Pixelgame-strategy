// Wire format shared by the server, the single-player worker and the client.
// Players receive the full territory once, then only the tiles that changed
// since their last snapshot; settlement layouts are sent when they change.
// Gold is private; everything else (soldiers included) is public.

import { serializeLayout } from '../settlement/planner.js';
import { STRUCTURE_KINDS, structureCost, upgradeCost, MAX_TOWN_LEVEL, RULES, garrisonMax, guardRadius } from '../sim/defs.js';
import { rle } from '../core/rle.js';

export { rle, unrle } from '../core/rle.js';

const round = (v, d = 1) => Math.round(v * d) / d;

/**
 * Changed tiles as [[owner, firstIdx, gap, gap, ...], ...]: tiles grouped by
 * new owner, sorted, each after the first given as the gap from the previous.
 */
export function encodeDelta(owner, tiles) {
  const by = new Map();
  for (const i of new Set(tiles)) {
    const o = owner[i];
    if (!by.has(o)) by.set(o, []);
    by.get(o).push(i);
  }
  const out = [];
  for (const [o, list] of by) {
    list.sort((a, b) => a - b);
    const row = [o, list[0]];
    for (let k = 1; k < list.length; k++) row.push(list[k] - list[k - 1]);
    out.push(row);
  }
  return out;
}

/** Apply encodeDelta() output to an owner array; calls fn(idx) for each tile. */
export function applyDelta(owner, delta, fn = null) {
  for (const row of delta) {
    const o = row[0];
    let i = 0;
    for (let k = 1; k < row.length; k++) {
      i = k === 1 ? row[1] : i + row[k];
      owner[i] = o;
      if (fn) fn(i);
    }
  }
}

function publicPlayer(m, p) {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    ai: p.ai,
    personality: p.personality,
    alive: p.alive,
    spawned: p.spawned,
    tiles: p.tiles,
    pop: Math.round(p.pop),
    maxPop: Math.round(p.maxPop),
    army: Math.round(m.army(p.id)),
    traitor: p.traitorUntil > m.state.t ? round(p.traitorUntil - m.state.t) : 0,
  };
}

function privatePlayer(m, p) {
  const costs = {};
  for (const k of STRUCTURE_KINDS) costs[k] = structureCost(k, p.built[k]);
  return { gold: Math.floor(p.gold), goldRate: round(p.goldRate, 10), upkeep: round(p.upkeep || 0, 10), costs, stats: p.stats };
}

/** The snapshot for player `kid` (kid = -1: spectator). */
export function snapshot(m, kid) {
  const st = m.state;
  const W = m.W;
  const players = st.players.map((p) => {
    const o = publicPlayer(m, p);
    if (p.id === kid || kid < 0) Object.assign(o, privatePlayer(m, p));
    return o;
  });
  const structures = st.structures.map((s) => {
    const o = { id: s.id, kind: s.kind, owner: s.owner, x: s.x, y: s.y, level: s.level, name: s.name, capital: s.capital, layoutV: s.layoutV, garrison: Math.ceil(s.garrison), gmax: garrisonMax(s), guard: guardRadius(s) };
    if (s.owner === kid && s.kind === 'town' && s.level < MAX_TOWN_LEVEL) o.upgrade = upgradeCost(s.level);
    return o;
  });
  const boats = st.boats.map((b) => {
    const next = b.path[Math.min(b.path.length - 1, b.pi + 1)];
    return { id: b.id, kind: b.kind, owner: b.owner, x: round(b.x, 100), y: round(b.y, 100), dir: (next % W) < (b.path[b.pi] % W) ? -1 : 1 };
  });
  const squads = st.squads.map((q) => {
    const o = { id: q.id, owner: q.owner, type: q.type, n: Math.ceil(q.n), x: round(q.x, 100), y: round(q.y, 100), state: q.fighting ? 'fight' : q.state };
    if (q.owner === kid || kid < 0) o.dest = q.dest;
    return o;
  });
  return {
    t: 'snap',
    tick: st.tick,
    time: round(st.t, 10),
    phase: st.phase,
    placementLeft: round(st.placementLeft),
    winner: st.winner,
    players,
    structures,
    boats,
    squads,
    alliances: st.alliances.map((a) => ({ a: a.a, b: a.b, until: round(a.until) })),
    requests: st.requests.filter((r) => r.to === kid || r.from === kid || kid < 0).map((r) => ({ id: r.id, from: r.from, to: r.to, until: round(r.until), renew: r.renew })),
    labels: st.survey?.labels || [],
  };
}

/** Static match description sent once when a player joins. */
export function initMessage(m, kid) {
  return {
    t: 'init',
    you: kid,
    seed: m.state.seed,
    size: m.state.size,
    opts: { placementTime: m.opts.placementTime, timeLimit: m.opts.timeLimit },
    landTotal: m.landTotal,
    winShare: RULES.winShare,
    startSites: m.startSites.map((s) => ({ x: s.x, y: s.y })),
  };
}

/**
 * Tracks what one player has already received and produces the messages
 * needed to bring them up to date.
 */
export class PlayerView {
  constructor(m, kid) {
    this.m = m;
    this.kid = kid;
    this.seq = -1;
    this.layoutV = new Map();
    this.eventSeq = 0;
  }

  messages(full = false) {
    const m = this.m;
    const out = [];
    const st = m.state;
    const behind = m.changeSeq - this.seq;
    let td = null;
    if (full || this.seq < 0 || behind > m.changeLog.length) {
      out.push({ t: 'terr', owner: rle(m.owner) });
    } else if (behind > 0) {
      td = encodeDelta(m.owner, m.changeLog.slice(m.changeLog.length - behind));
    }
    this.seq = m.changeSeq;
    for (const s of st.structures) {
      const L = m.layouts.get(s.id);
      if (!full && this.layoutV.get(s.id) === L.v) continue;
      this.layoutV.set(s.id, L.v);
      out.push({ t: 'layout', sid: s.id, data: serializeLayout(L) });
    }
    const fresh = [];
    let last = this.eventSeq;
    for (const e of st.events) {
      if (e.seq <= this.eventSeq) continue;
      last = Math.max(last, e.seq);
      if (e.kid !== -1 && e.kid !== this.kid && this.kid >= 0) continue;
      fresh.push({ t: e.t, kind: e.kind, text: e.text, x: e.x, y: e.y });
    }
    this.eventSeq = last;
    const snap = snapshot(m, this.kid);
    if (td) snap.td = td;
    snap.events = fresh;
    out.push(snap);
    return out;
  }
}
