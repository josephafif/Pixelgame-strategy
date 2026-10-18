// AI players. Once a second each one reads the survey (who borders whom,
// how much unclaimed land is next to it) and the soldiers on the map, and
// issues the same commands a human would:
// - riders roam the empty land nearby to claim it;
// - guards (spears and bows) stand by the towns and outposts that face the
//   most dangerous neighbour, and reinforcements are raised where an enemy
//   column is coming;
// - when it has the upper hand, it marches a mixed army (with trebuchets)
//   on the nearest town or outpost of its weakest rival;
// - it builds and grows towns, ports and outposts, and makes, keeps or
//   breaks alliances.
// Three temperaments: builders grow and fortify, merchants trade and ally,
// warlords keep a large army and look for prey.

import { MAX_TOWN_LEVEL, UNITS, structureCost, upgradeCost } from '../sim/defs.js';
import { buildCheck } from '../sim/structures.js';
import { power as squadPower } from '../sim/units.js';

const STYLE = {
  builder: { army: 0.45, edge: 1.4, trust: 0.6, towns: 1.2, ports: 0.7, outposts: 1, claimers: 1, guard: 0.7 },
  merchant: { army: 0.35, edge: 1.7, trust: 0.85, towns: 1, ports: 1.6, outposts: 0.6, claimers: 1, guard: 0.6 },
  warlord: { army: 0.65, edge: 1.05, trust: 0.35, towns: 0.8, ports: 0.4, outposts: 0.5, claimers: 1.2, guard: 0.5 },
};

// How hard the AI plays: how big an edge it wants before attacking, and how
// much more before turning on a human, and how many AIs may march on the
// same human at once.
export const DIFFICULTY = {
  easy: { edge: 1.6, human: 2.5, pile: 1, army: 0.8 },
  normal: { edge: 1, human: 1.5, pile: 2, army: 1 },
  hard: { edge: 0.85, human: 1.1, pile: 3, army: 1.15 },
};

const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const xy = (m, i) => ({ x: i % m.W, y: (i / m.W) | 0 });
const GARRISON_POWER = 7; // a garrison soldier, in squad power units
const MAX_ORDERS = 4; // deploy and move orders per think (each finds a path)
const MAX_SQUADS = 90;

export function thinkAI(m, p) {
  const st = m.state;
  const sv = st.survey;
  if (!sv || !p.alive || st.phase !== 'running') return;
  const s = STYLE[p.personality] || STYLE.builder;
  const D = DIFFICULTY[m.opts.difficulty] || DIFFICULTY.normal;
  const mem = p.ai_;
  mem.roles ||= {};
  const ctx = { m, p, s, D, mem, orders: 0, mine: st.squads.filter((q) => q.owner === p.id) };
  for (const id of Object.keys(mem.roles)) if (!ctx.mine.some((q) => q.id === Number(id))) delete mem.roles[id];
  for (const r of st.requests.filter((q) => q.to === p.id)) m.exec(p.id, { type: 'answer', id: r.id, accept: wantsAlly(m, p, r.from, s) });
  diplomacy(m, p, s, mem);
  const threat = defend(ctx);
  if (!threat) spend(m, p, s);
  claimLand(ctx);
  guard(ctx);
  attack(ctx);
}

/** Army strength of a player: soldiers in the field plus garrisons. */
function power(m, q) {
  let n = 0;
  for (const sq of m.state.squads) if (sq.owner === q.id) n += squadPower(sq);
  for (const s of m.state.structures) if (s.owner === q.id) n += s.garrison * GARRISON_POWER;
  return n;
}

function order(ctx, cmd) {
  if (ctx.orders >= MAX_ORDERS) return { error: 'busy' };
  ctx.orders++;
  return ctx.m.exec(ctx.p.id, cmd);
}

function idle(ctx, role) {
  return ctx.mine.filter((q) => (ctx.mem.roles[q.id] || 'guard') === role && q.state === 'idle' && !q.fighting);
}

/** Raise n soldiers of a type toward (x, y) and give them a role. */
function raise(ctx, unit, n, x, y, role) {
  const { p } = ctx;
  n = Math.min(n, Math.floor(p.gold / UNITS[unit].cost), 200);
  // Few, sizeable squads: easier to read on the map, cheaper to simulate.
  if (n < (unit === 'trebuchet' ? 1 : 5) || ctx.mine.length >= MAX_SQUADS) return false;
  const r = order(ctx, { type: 'deploy', unit, n, x, y });
  if (r.ok) ctx.mem.roles[r.id] = role;
  return !!r.ok;
}

/** Hostile soldiers on our land or marching on one of our places: help and raise more there. */
function defend(ctx) {
  const { m, p, mine } = ctx;
  const st = m.state;
  // Hostile soldiers on our land or marching on one of our places.
  const [bx0, by0, bx1, by1] = p.bbox;
  const foes = st.squads.filter((q) => {
    if (q.owner === p.id || q.x < bx0 - 14 || q.y < by0 - 14 || q.x > bx1 + 14 || q.y > by1 + 14 || m.allied(p.id, q.owner)) return false;
    return m.owner[m.idx(Math.round(q.x), Math.round(q.y))] === p.id || !!q.dest;
  });
  if (!foes.length) return false;
  let worst = null;
  for (const s of st.structures) {
    if (s.owner !== p.id) continue;
    let foe = 0;
    for (const q of foes) {
      if (Math.hypot(q.x - s.x, q.y - s.y) >= 14) continue;
      const onOurs = m.owner[m.idx(Math.round(q.x), Math.round(q.y))] === p.id;
      const coming = q.dest && Math.hypot(q.dest[0] - s.x, q.dest[1] - s.y) < 12;
      if (onOurs || coming) foe += squadPower(q);
    }
    if (!foe) continue;
    let own = s.garrison * GARRISON_POWER;
    for (const q of mine) if (Math.hypot(q.x - s.x, q.y - s.y) < 14) own += squadPower(q);
    const gap = foe * 1.2 - own;
    if (gap > 0 && (!worst || gap > worst.gap)) worst = { s, gap };
  }
  if (!worst) return false;
  const { s } = worst;
  // Idle guards nearby come to help.
  const helpers = mine.filter((q) => q.state === 'idle' && (ctx.mem.roles[q.id] || 'guard') === 'guard' && Math.hypot(q.x - s.x, q.y - s.y) < 40 && Math.hypot(q.x - s.x, q.y - s.y) > 4);
  if (helpers.length) order(ctx, { type: 'move', ids: helpers.slice(0, 10).map((q) => q.id), x: s.x, y: s.y });
  // Fresh spears and bows come from the nearest place that is not under siege.
  const need = Math.ceil(worst.gap / 10);
  const budget = p.gold * 0.8;
  raise(ctx, 'shield', Math.min(need, Math.floor((budget * 0.6) / UNITS.shield.cost)), s.x, s.y, 'guard');
  raise(ctx, 'bow', Math.min(Math.ceil(need / 2), Math.floor((budget * 0.4) / UNITS.bow.cost)), s.x, s.y, 'guard');
  return true;
}

/** An unclaimed land tile within reach of (x, y), sampled. */
function emptyLandNear(m, x, y, r0, r1) {
  for (let k = 0; k < 40; k++) {
    const a = m.rng.next() * Math.PI * 2;
    const d = r0 + m.rng.next() * (r1 - r0);
    const tx = Math.round(x + Math.cos(a) * d);
    const ty = Math.round(y + Math.sin(a) * d);
    if (tx < 2 || ty < 2 || tx >= m.W - 2 || ty >= m.H - 2) continue;
    const i = m.idx(tx, ty);
    if (m.land[i] && m.owner[i] === -1) return { x: tx, y: ty };
  }
  return null;
}

/** Riders roam the empty land nearby; more are raised while there is land to take. */
function claimLand(ctx) {
  const { m, p, s, mine } = ctx;
  const sv = m.state.survey;
  const [neutral, nTile] = sv.neutral[p.id] || [0, -1];
  for (const q of idle(ctx, 'claim')) {
    const spot = emptyLandNear(m, q.x, q.y, 6, 30) || (nTile >= 0 ? xy(m, nTile) : null);
    if (spot) order(ctx, { type: 'move', ids: [q.id], x: spot.x, y: spot.y });
    else ctx.mem.roles[q.id] = 'guard';
  }
  if (neutral <= 0 || nTile < 0) return;
  const claimers = mine.filter((q) => ctx.mem.roles[q.id] === 'claim').length;
  const want = Math.min(6, Math.round((1.5 + p.tiles / 1500) * s.claimers));
  if (claimers < want && p.gold > UNITS.rider.cost * 6) {
    const at = xy(m, nTile);
    raise(ctx, 'rider', 6 + Math.min(6, Math.floor(p.gold / 400)), at.x, at.y, 'claim');
  }
}

/** A few guards stand at the places nearest the most dangerous neighbour. */
function guard(ctx) {
  const { m, p, s, D, mine, mem } = ctx;
  const st = m.state;
  if (st.t - (mem.guardAt ?? -99) < 15 || p.gold < 150) return;
  const contacts = (st.survey.contacts[p.id] || []).filter(([q]) => !m.allied(p.id, q) && st.players[q].alive);
  if (!contacts.length) return;
  let worst = null;
  for (const c of contacts) {
    let pw = 0;
    for (const q of st.squads) if (q.owner === c[0]) pw += squadPower(q);
    if (!worst || pw > worst.pw) worst = { c, pw };
  }
  const guards = mine.filter((q) => (mem.roles[q.id] || 'guard') === 'guard');
  const have = guards.reduce((t, q) => t + squadPower(q), 0);
  if (have >= worst.pw * s.guard * D.army * 0.35) return;
  mem.guardAt = st.t;
  // The own place nearest to that neighbour's border; guards stand on it.
  const at = xy(m, worst.c[2]);
  let post = null;
  for (const b of st.structures) {
    if (b.owner !== p.id) continue;
    const d = Math.hypot(b.x - at.x, b.y - at.y);
    if (!post || d < post.d) post = { b, d };
  }
  if (!post) return;
  const spend = p.gold * 0.4;
  raise(ctx, 'shield', Math.floor((spend * 0.55) / UNITS.shield.cost), post.b.x, post.b.y + 1, 'guard');
  raise(ctx, 'bow', Math.floor((spend * 0.45) / UNITS.bow.cost), post.b.x, post.b.y + 1, 'guard');
}

/** Their place nearest to ours, and what defends it. */
function nearestTarget(m, p, q) {
  const st = m.state;
  let target = null;
  for (const a of st.structures) {
    if (a.owner !== q) continue;
    for (const b of st.structures) {
      if (b.owner !== p.id) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (!target || d < target.d) target = { a, d };
    }
  }
  if (!target) return null;
  let defence = target.a.garrison * GARRISON_POWER;
  for (const sq of st.squads) if (sq.owner === q && Math.hypot(sq.x - target.a.x, sq.y - target.a.y) < 16) defence += squadPower(sq);
  return { s: target.a, d: target.d, defence };
}

/**
 * Campaigns: pick the rival place we can best take, gather the army out of
 * reach of its towers, go in together, then on to the next place.
 */
function attack(ctx) {
  const { m, p, s, D, mem, mine } = ctx;
  const st = m.state;
  const sv = st.survey;
  const [neutral] = sv.neutral[p.id] || [0];
  let plan = mem.plan;
  if (plan) {
    const target = st.structures.find((q) => q.id === plan.sid);
    const won = target && target.owner === p.id;
    const over = !target || (!won && target.owner !== plan.to) || !st.players[plan.to].alive || m.allied(p.id, plan.to) || st.t - plan.since > (plan.phase === 'assault' ? 150 : 210);
    if (won && st.players[plan.to].alive && !m.allied(p.id, plan.to)) {
      // Taken: carry on to their next place, from here.
      const next = nearestTarget(m, p, plan.to);
      if (next && next.d < 120) {
        plan = mem.plan = { to: plan.to, sid: next.s.id, since: st.t, waves: 0, phase: 'gather' };
      } else plan = mem.plan = null;
    } else if (over) {
      plan = mem.plan = null;
      for (const q of mine) if (mem.roles[q.id] === 'strike') mem.roles[q.id] = 'guard';
    }
  }
  if (!plan) {
    // Empty land first, unless war is the whole point.
    const open = 1 - st.players.reduce((t, o) => t + o.tiles, 0) / m.landTotal;
    if (neutral > 30 && open > 0.08 && p.personality !== 'warlord') return;
    if (p.pop / Math.max(1, p.maxPop) < 0.4) return;
    // What we could field: soldiers not busy claiming, plus what the treasury buys.
    let field = p.gold * 0.8;
    for (const q of mine) if (mem.roles[q.id] !== 'claim') field += squadPower(q) * 0.6;
    const near = (sv.contacts[p.id] || []).map((c) => c[0]);
    // An island realm looks across the water.
    const rivals = near.length ? near : st.players.filter((o) => o.id !== p.id && o.alive).map((o) => o.id);
    let best = null;
    for (const q of rivals) {
      const o = st.players[q];
      if (!o.alive || m.allied(p.id, q)) continue;
      if (!o.ai && st.players.filter((a) => a.ai && a.id !== p.id && a.ai_?.plan?.to === q).length >= D.pile) continue;
      const t = nearestTarget(m, p, q);
      if (!t || t.d > 220) continue;
      let edge = field / Math.max(50, t.defence) / (D.edge * (o.ai ? 1 : D.human));
      if (o.traitorUntil > st.t) edge *= 1.5;
      edge /= 1 + t.d / 200; // far targets are worth less
      if (!best || edge > best.edge) best = { q, edge, t };
    }
    if (!best || best.edge < s.edge * 1.3) return;
    plan = mem.plan = { to: best.q, sid: best.t.s.id, since: st.t, waves: 0, phase: 'gather' };
    m.event(best.q, 'warning', `${p.name} is marching on ${best.t.s.name}.`, best.t.s.x, best.t.s.y);
  }
  const target = st.structures.find((q) => q.id === plan.sid);
  if (!plan.stage) {
    // A gathering point eleven tiles out from the target, on our side.
    let home = null;
    for (const b of st.structures) {
      if (b.owner !== p.id) continue;
      const d = Math.hypot(b.x - target.x, b.y - target.y);
      if (!home || d < home.d) home = { b, d };
    }
    if (!home) return;
    const dx = home.b.x - target.x;
    const dy = home.b.y - target.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const back = Math.min(len, 11);
    plan.stage = [Math.round(target.x + (dx / len) * back), Math.round(target.y + (dy / len) * back)];
  }
  // All but a few guards join the campaign.
  const guards = mine.filter((q) => (mem.roles[q.id] || 'guard') === 'guard' && q.state === 'idle');
  for (const q of guards.slice(3)) mem.roles[q.id] = 'strike';
  const strike = mine.filter((q) => mem.roles[q.id] === 'strike');
  const [sx, sy] = plan.stage;
  if (plan.phase === 'gather') {
    const ready = strike.filter((q) => Math.hypot(q.x - sx, q.y - sy) < 7).reduce((t, q) => t + squadPower(q), 0);
    const t = nearestTarget(m, p, plan.to);
    const defence = t && t.s.id === target.id ? t.defence : target.garrison * GARRISON_POWER;
    const waited = st.t - plan.since;
    if (ready > defence * 1.4 || (waited > 90 && ready > defence) || (waited > 150 && ready > defence * 0.6)) {
      plan.phase = 'assault';
      plan.since = st.t;
    } else {
      const away = strike.filter((q) => q.state === 'idle' && Math.hypot(q.x - sx, q.y - sy) >= 7);
      if (away.length) order(ctx, { type: 'move', ids: away.map((q) => q.id), x: sx, y: sy });
    }
  }
  if (plan.phase === 'assault') {
    // Everyone to the gate; trebuchets stop within their reach by themselves.
    const go = strike.filter((q) => q.state === 'idle' && !q.fighting && Math.hypot(q.x - target.x, q.y - target.y) > 1.5);
    if (go.length) order(ctx, { type: 'move', ids: go.map((q) => q.id), x: target.x, y: target.y });
  }
  // Fresh waves while the treasury allows.
  const wave = 200 * s.army * D.army;
  if (p.gold < wave) return;
  plan.waves++;
  const g = p.gold * 0.85;
  const [wx, wy] = plan.phase === 'assault' ? [target.x, target.y] : plan.stage;
  if (target.garrison > 15 && !strike.some((q) => q.type === 'trebuchet')) raise(ctx, 'trebuchet', Math.max(1, Math.min(4, Math.floor((g * 0.2) / UNITS.trebuchet.cost))), wx, wy, 'strike');
  raise(ctx, 'shield', Math.floor((g * 0.35) / UNITS.shield.cost), wx, wy, 'strike');
  raise(ctx, 'bow', Math.floor((g * 0.25) / UNITS.bow.cost), wx, wy, 'strike');
  raise(ctx, p.gold > 900 ? 'knight' : 'rider', Math.floor((g * 0.2) / (p.gold > 900 ? UNITS.knight.cost : UNITS.rider.cost)), wx, wy, 'strike');
}

/** Towns, upgrades, ports and outposts, keeping gold for the army. */
function spend(m, p, s) {
  const st = m.state;
  const own = st.structures.filter((q) => q.owner === p.id);
  const towns = own.filter((q) => q.kind === 'town');
  const ports = own.filter((q) => q.kind === 'port');
  const outposts = own.filter((q) => q.kind === 'outpost');
  const keep = 120 * s.army;
  const wantTowns = 1 + Math.floor((p.tiles / 700) * s.towns);
  const townCost = structureCost('town', p.built.town);
  if (towns.length < wantTowns && p.gold >= townCost + keep) {
    const spot = findSpot(m, p, 'town', 5);
    if (spot && m.exec(p.id, { type: 'build', kind: 'town', x: spot.x, y: spot.y }).ok) return;
  }
  const low = towns.filter((q) => q.level < MAX_TOWN_LEVEL).sort((a, b) => a.level - b.level || (b.capital ? 1 : 0) - (a.capital ? 1 : 0))[0];
  if (low && p.gold >= upgradeCost(low.level) + keep && (towns.length >= wantTowns || p.gold >= upgradeCost(low.level) + townCost)) {
    if (m.exec(p.id, { type: 'upgrade', sid: low.id }).ok) return;
  }
  const portCost = structureCost('port', p.built.port);
  const coast = st.survey.coast[p.id] || 0;
  if (coast > 10 && ports.length < Math.min(3, Math.floor(s.ports * (1 + towns.length / 3))) && p.gold >= portCost + keep) {
    const spot = findSpot(m, p, 'port', 2);
    if (spot && m.exec(p.id, { type: 'build', kind: 'port', x: spot.x, y: spot.y }).ok) return;
  }
  // Outposts face the most dangerous neighbour.
  const threat = (st.survey.contacts[p.id] || [])
    .filter(([q]) => !m.allied(p.id, q) && st.players[q].alive)
    .sort((a, b) => power(m, st.players[b[0]]) - power(m, st.players[a[0]]))[0];
  if (threat && outposts.length < Math.ceil(towns.length * s.outposts) && p.gold >= structureCost('outpost', p.built.outpost) + keep) {
    const at = xy(m, threat[2]);
    const spot = nearOwn(m, p, at.x, at.y, 9);
    if (spot) m.exec(p.id, { type: 'build', kind: 'outpost', x: spot.x, y: spot.y });
  }
}

function endgameRival(m, p, q) {
  return p.tiles + q.tiles > m.landTotal * 0.6 && q.tiles > m.landTotal * 0.15 && p.tiles > m.landTotal * 0.15;
}

/** Would p accept an alliance with q? */
function wantsAlly(m, p, qid, s) {
  const st = m.state;
  const q = st.players[qid];
  if (!q.alive || q.traitorUntil > st.t || endgameRival(m, p, q)) return false;
  const allies = st.alliances.filter((a) => a.a === p.id || a.b === p.id).length;
  if (allies >= (p.personality === 'merchant' ? 2 : 1) && !m.allied(p.id, qid)) return false;
  const ratio = power(m, q) / Math.max(1, power(m, p));
  // Strong neighbours are better friends than enemies; weak ones are prey for warlords.
  const borders = (st.survey.contacts[p.id] || []).some(([o]) => o === qid);
  if (borders && ratio < 0.5 && p.personality === 'warlord') return false;
  // Peace with someone clearly stronger; merchants also with equals.
  return ratio > 1.5 - s.trust * 0.6 || (p.personality === 'merchant' && ratio > 0.8 && m.noise(qid * 131 + p.id, Math.floor(st.t / 60)) < 0.5)
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
