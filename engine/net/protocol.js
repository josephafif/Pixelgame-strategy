// Wire format shared by the server, the single-player worker and the client.
// The authoritative state stays in the Match; players receive per-player
// snapshots (with fog of war applied) plus versioned bulk data (territory,
// roads, exploration, settlement layouts) only when it changes.

import { serializeLayout } from '../settlement/planner.js';
import { STAGES } from '../sim/defs.js';
import { total } from '../sim/military.js';
import { rle } from '../core/rle.js';

export { rle, unrle } from '../core/rle.js';

const round = (v, d = 1) => Math.round(v * d) / d;

function publicKingdom(k) {
  return {
    id: k.id,
    name: k.name,
    color: k.color,
    ai: k.ai,
    personality: k.personality,
    alive: k.alive,
    placed: k.placed,
    capital: k.capital,
    relations: k.relations,
    stats: k.stats,
    score: k.score,
    wonderHeld: round(k.wonderHeld),
    domHeld: k.domHeld || 0,
  };
}

function privateKingdom(k) {
  const r = (o) => Object.fromEntries(Object.entries(o).map(([a, b]) => [a, round(b, 10)]));
  return { stock: r(k.stock), coin: round(k.coin, 10), rates: r(k.rates), priorities: k.priorities, orders: k.orders, flags: k.flags, need: k.need ? r(k.need) : null };
}

/**
 * Build the snapshot for kingdom `kid` (kid = -1: spectator). There is no fog
 * of war: everyone sees every town and army; only a realm's own stores,
 * workers and garrisons are private.
 */
export function snapshot(m, kid) {
  const st = m.state;
  const W = m.world.width;
  const kingdoms = st.kingdoms.map((k) => {
    const pk = publicKingdom(k);
    if (k.id === kid || kid < 0) Object.assign(pk, privateKingdom(k));
    return pk;
  });
  const settlements = [];
  for (const s of st.settlements) {
    const mine = s.kingdom === kid || kid < 0;
    const o = {
      id: s.id,
      kingdom: s.kingdom,
      name: s.name,
      x: s.x,
      y: s.y,
      stage: s.stage,
      pop: round(s.pop),
      housing: s.housing,
      capital: s.capital,
      hub: s.hub,
      walls: { level: s.walls.level, hp: round(s.walls.hp) },
      unrest: round(s.unrest),
      siege: s.siege ? { by: s.siege.by } : null,
      layoutV: s.layoutV,
      buildings: s.buildings,
    };
    if (mine) {
      Object.assign(o, {
        houses: s.houses,
        projects: s.projects.map((p) => ({ id: p.id, type: p.type, kind: p.kind, to: p.to, progress: round(p.progress), work: p.work })),
        training: s.training.map((t) => ({ unit: t.unit, n: t.n, t: round(t.t) })),
        demob: s.demob.map((d) => ({ n: d.n, t: round(d.t) })),
        garrison: Object.fromEntries(Object.entries(s.garrison).map(([u, n]) => [u, round(n, 10)])),
        jobs: s.jobs,
        out: Object.fromEntries(Object.entries(s.out || {}).map(([r, v]) => [r, round(v, 1000)])),
        site: s.site,
        connected: s.connected,
        full: s.full,
        crowded: s.crowded,
        prosperity: round(s.prosperity, 100),
      });
    } else {
      // Rivals only get a rough idea of a garrison's size.
      o.garrisonApprox = Math.round(total(s.garrison) / 5) * 5;
    }
    settlements.push(o);
  }
  const armies = [];
  for (const a of st.armies) {
    const mine = a.kid === kid || kid < 0;
    const o = { id: a.id, kid: a.kid, x: round(a.x, 100), y: round(a.y, 100), n: round(total(a.units)), state: a.state };
    if (mine) Object.assign(o, { units: Object.fromEntries(Object.entries(a.units).map(([u, n]) => [u, round(n, 10)])), morale: round(a.morale, 100), supply: round(a.supply), inSupply: a.inSupply, dest: a.dest, target: a.target ?? null });
    armies.push(o);
  }
  const parties = [];
  for (const p of st.parties) {
    const mine = p.kid === kid || kid < 0;
    parties.push({ id: p.id, kind: p.kind, kid: p.kid, x: round(p.x, 100), y: round(p.y, 100), sea: !!p.sea && m.world.biome[Math.round(p.y) * W + Math.round(p.x)] <= 2, mode: mine ? p.mode : undefined, cargo: mine ? p.cargo : undefined, returning: p.returning });
  }
  const roadJobs = st.roadJobs.filter((r) => r.kid === kid || kid < 0).map((r) => ({ id: r.id, a: r.a, b: r.b, idx: r.idx, len: r.path.length, stalled: !!r.stalled }));
  return {
    t: 'snap',
    tick: st.tick,
    time: round(st.t, 10),
    phase: st.phase,
    placementLeft: round(st.placementLeft),
    kingdoms,
    settlements,
    armies,
    parties,
    roadJobs,
    prices: st.market.price,
    proposals: st.proposals.filter((p) => p.to === kid || p.from === kid || kid < 0),
    agreements: st.agreements.filter((a) => a.a === kid || a.b === kid || kid < 0),
    winner: st.winner,
    territoryV: st.territoryV,
    roadsV: st.roadsV,
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
    hubs: m.state.hubs,
    startSites: m.startSites.map((s) => ({ x: s.x, y: s.y, title: s.title, blurb: s.blurb, pros: s.pros, cons: s.cons, archetype: s.archetype })),
    stages: STAGES.map((s) => s.name),
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
    this.terrV = -1;
    this.roadsV = -1;
    this.layoutV = new Map();
    this.eventSeq = 0;
  }

  messages(full = false) {
    const m = this.m;
    const out = [];
    const st = m.state;
    if (full || st.territoryV !== this.terrV) {
      this.terrV = st.territoryV;
      out.push({ t: 'terr', v: st.territoryV, owner: rle(m.owner) });
    }
    if (full || st.roadsV !== this.roadsV) {
      this.roadsV = st.roadsV;
      out.push({ t: 'roads', v: st.roadsV, data: rle(m.roads) });
    }
    for (const s of st.settlements) {
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
    snap.events = fresh;
    out.push(snap);
    return out;
  }
}
