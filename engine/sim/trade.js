// Trade: a shared market at the free cities with supply-and-demand prices,
// standing buy/sell orders carried out by caravans (overland or by sea, with
// travel time and transport costs), and bilateral agreements between
// kingdoms delivered by caravan.

import { RESOURCES, RES_KEYS, RULES } from './defs.js';

export function initMarket(m) {
  const mk = m.state.market;
  for (const r of RES_KEYS) mk.stock[r] = RESOURCES[r].eq;
  updatePrices(m);
}

export function priceOf(m, r) {
  const def = RESOURCES[r];
  const s = Math.max(1, m.state.market.stock[r]);
  const p = def.price * (def.eq / s) ** 0.75;
  return Math.max(def.price * 0.3, Math.min(def.price * 4, p));
}

function updatePrices(m) {
  const mk = m.state.market;
  for (const r of RES_KEYS) mk.price[r] = Math.round(priceOf(m, r) * 100) / 100;
}

export function caravanSlots(m, kid) {
  let n = 0;
  for (const s of m.settlementsOf(kid)) n += (s.buildings.market || 0) * 2 + (s.buildings.harbor || 0);
  return n;
}

export function activeCaravans(m, kid) {
  return m.state.parties.filter((p) => p.kind === 'caravan' && p.kid === kid).length;
}

/** Best trading post for a kingdom: its market town and the closest free city. */
function tradeRoute(m, kid) {
  const towns = m.settlementsOf(kid).filter((s) => s.buildings.market || s.buildings.harbor);
  if (!towns.length) return null;
  let best = null;
  for (const t of towns) {
    for (const h of m.state.hubs) {
      const sea = !!(t.buildings.harbor && h.coastal);
      const d = Math.hypot(t.x - h.x, t.y - h.y) * (sea ? 0.6 : 1);
      if (!best || d < best.d) best = { d, town: t, hub: h, sea };
    }
  }
  return best;
}

export function orderError(m, kid, o) {
  if (!RESOURCES[o.res]) return 'Unknown resource.';
  if (o.side !== 'buy' && o.side !== 'sell') return 'Order must buy or sell.';
  if (!(o.amount > 0) || o.amount > 200) return 'Amount per shipment must be 1–200.';
  if (!(o.limit > 0)) return 'Set a price limit.';
  if (!(o.keep >= 0)) return 'Set a stock threshold.';
  if (!tradeRoute(m, kid)) return 'Build a market (or harbour) to trade.';
  if (m.state.kingdoms[kid].orders.length >= 12) return 'At most 12 standing orders.';
  return null;
}

function dispatch(m, kid, route, cargo, mode, extra = {}) {
  const profile = { kid, kind: 'caravan', sea: route.sea };
  const path = m.findPath(profile, route.town.x, route.town.y, route.hub.x, route.hub.y);
  if (!path) return null;
  const tiles = path.length;
  const fare = tiles * RULES.caravanCostPerTile * 2;
  const k = m.state.kingdoms[kid];
  if (k.coin < fare) return null;
  k.coin -= fare;
  const c = { id: m.nextId(), kind: 'caravan', kid, x: route.town.x, y: route.town.y, path, pi: 0, pf: 0, sea: route.sea, mode, cargo, coin: 0, home: route.town.id, hub: route.hub.id, returning: false, fare, ...extra };
  m.state.parties.push(c);
  return c;
}

function runOrders(m) {
  for (const k of m.state.kingdoms) {
    if (!k.alive || !k.orders.length) continue;
    const route = tradeRoute(m, k.id);
    if (!route) continue;
    for (const o of k.orders) {
      if (activeCaravans(m, k.id) >= caravanSlots(m, k.id)) break;
      if (m.state.parties.some((p) => p.kind === 'caravan' && p.order === o.id && !p.returning)) continue;
      const price = m.state.market.price[o.res];
      if (o.side === 'sell') {
        const have = k.stock[o.res] || 0;
        if (have - o.amount < o.keep || price < o.limit) continue;
        k.stock[o.res] -= o.amount;
        const c = dispatch(m, k.id, route, { res: o.res, n: o.amount }, 'sell', { order: o.id });
        if (!c) k.stock[o.res] += o.amount;
      } else {
        const have = k.stock[o.res] || 0;
        if (have >= o.keep || price > o.limit) continue;
        if (k.coin < o.amount * price * 1.05 + 10) continue;
        dispatch(m, k.id, route, { res: o.res, n: o.amount }, 'buy', { order: o.id, limit: o.limit });
      }
    }
  }
}

function arriveAtHub(m, c) {
  const mk = m.state.market;
  const k = m.state.kingdoms[c.kid];
  if (c.mode === 'sell') {
    const p = priceOf(m, c.cargo.res);
    c.coin = c.cargo.n * p * (1 - RULES.marketFee);
    mk.stock[c.cargo.res] += c.cargo.n;
    m.event(c.kid, 'trade', `Sold ${c.cargo.n} ${c.cargo.res} for ${Math.round(c.coin)} coin.`, c.x, c.y);
    k.stats.sold = (k.stats.sold || 0) + c.coin;
    k.stats.trades = (k.stats.trades || 0) + 1;
    c.cargo = null;
  } else if (c.mode === 'buy') {
    const p = priceOf(m, c.cargo.res);
    let n = c.cargo.n;
    if (p > c.limit) n = 0;
    n = Math.min(n, Math.floor(k.coin / p), Math.floor(mk.stock[c.cargo.res] - 5));
    if (n > 0) {
      k.coin -= n * p;
      mk.stock[c.cargo.res] -= n;
      m.event(c.kid, 'trade', `Bought ${n} ${c.cargo.res} for ${Math.round(n * p)} coin.`, c.x, c.y);
      k.stats.bought = (k.stats.bought || 0) + n * p;
      k.stats.trades = (k.stats.trades || 0) + 1;
    }
    c.cargo = n > 0 ? { res: c.cargo.res, n } : null;
  }
  updatePrices(m);
}

function deliverHome(m, c) {
  const k = m.state.kingdoms[c.kid];
  if (c.coin) k.coin += c.coin;
  if (c.cargo && c.mode !== 'deliver') k.stock[c.cargo.res] = (k.stock[c.cargo.res] || 0) + c.cargo.n;
}

export function tick(m, dt, slow) {
  const mk = m.state.market;
  // Outside demand slowly pulls stocks back toward equilibrium.
  for (const r of RES_KEYS) {
    const eq = RESOURCES[r].eq;
    mk.stock[r] += (eq - mk.stock[r]) * 0.0035 * dt;
  }
  if (slow) {
    updatePrices(m);
    runOrders(m);
    runAgreements(m);
  }
  for (const c of m.state.parties.slice()) {
    if (c.kind !== 'caravan') continue;
    const k = m.state.kingdoms[c.kid];
    const done = m.advance(c, { kid: c.kid, kind: 'caravan', sea: c.sea }, c.sea ? 1.7 : 1.25, dt);
    if (c.blocked) {
      c.blocked = false;
      const dest = c.returning ? m.settlement(c.home) : c.mode === 'deliver' ? m.settlement(c.to) : m.settlement(c.hub);
      const path = dest ? m.findPath({ kid: c.kid, kind: 'caravan', sea: c.sea }, c.x, c.y, dest.x, dest.y) : null;
      if (!path) {
        m.state.parties = m.state.parties.filter((q) => q !== c);
        continue;
      }
      c.path = path;
      c.pi = 0;
      c.pf = 0;
    }
    if (!done) continue;
    if (c.mode === 'deliver') {
      const to = m.state.kingdoms[c.toKid];
      if (to && to.alive && c.cargo) to.stock[c.cargo.res] = (to.stock[c.cargo.res] || 0) + c.cargo.n;
      m.state.parties = m.state.parties.filter((q) => q !== c);
      continue;
    }
    if (!c.returning) {
      arriveAtHub(m, c);
      const home = m.settlement(c.home);
      if (!home || home.kingdom !== c.kid || !k.alive) {
        m.state.parties = m.state.parties.filter((q) => q !== c);
        continue;
      }
      c.returning = true;
      c.path = m.findPath({ kid: c.kid, kind: 'caravan', sea: c.sea }, c.x, c.y, home.x, home.y) || [];
      c.pi = 0;
      c.pf = 0;
    } else {
      deliverHome(m, c);
      m.state.parties = m.state.parties.filter((q) => q !== c);
    }
  }
}

// ---------------------------------------------------------------------------
// Bilateral agreements

export function proposalError(m, from, p) {
  const a = m.state.kingdoms[from];
  const b = m.state.kingdoms[p.to];
  if (!b || !b.alive || p.to === from) return 'Choose another living kingdom.';
  if (m.atWar(from, p.to)) return 'You are at war with them.';
  for (const side of [p.give, p.get]) {
    if (!side || !RESOURCES[side.res] || !(side.n > 0) || side.n > 150) return 'Each side must trade 1–150 of a resource.';
  }
  if (!(p.every >= 10 && p.every <= 120)) return 'Deliveries every 10–120 seconds.';
  if (!(p.times >= 1 && p.times <= 40)) return '1–40 deliveries.';
  if (!a.capital || !b.capital) return 'Both kingdoms need a capital.';
  if (m.state.proposals.filter((q) => q.from === from).length >= 4) return 'Too many open proposals.';
  return null;
}

export function propose(m, from, p) {
  const err = proposalError(m, from, p);
  if (err) return { error: err };
  const prop = { id: m.nextId(), from, to: p.to, give: p.give, get: p.get, every: p.every, times: p.times, t: m.state.t };
  m.state.proposals.push(prop);
  m.event(p.to, 'proposal', `${m.state.kingdoms[from].name} proposes: their ${p.give.n} ${p.give.res} for your ${p.get.n} ${p.get.res}, ${p.times}× every ${p.every}s.`);
  return { ok: true, id: prop.id };
}

export function respond(m, kid, id, accept) {
  const prop = m.state.proposals.find((q) => q.id === id);
  if (!prop || prop.to !== kid) return { error: 'No such proposal.' };
  m.state.proposals = m.state.proposals.filter((q) => q !== prop);
  if (!accept) {
    m.event(prop.from, 'info', `${m.state.kingdoms[kid].name} declined your trade proposal.`);
    return { ok: true };
  }
  m.state.agreements.push({ id: m.nextId(), a: prop.from, b: kid, give: prop.give, get: prop.get, every: prop.every, left: prop.times, next: m.state.t + 2 });
  m.event(prop.from, 'info', `${m.state.kingdoms[kid].name} accepted your trade agreement.`);
  m.event(kid, 'info', `Trade agreement with ${m.state.kingdoms[prop.from].name} begins.`);
  return { ok: true };
}

function runAgreements(m) {
  const st = m.state;
  // Expire stale proposals.
  st.proposals = st.proposals.filter((p) => st.t - p.t < 90);
  for (const ag of st.agreements.slice()) {
    const A = st.kingdoms[ag.a];
    const Bk = st.kingdoms[ag.b];
    const broken = (why) => {
      st.agreements = st.agreements.filter((q) => q !== ag);
      m.event(ag.a, 'warn', `Agreement with ${Bk.name} ended: ${why}.`);
      m.event(ag.b, 'warn', `Agreement with ${A.name} ended: ${why}.`);
    };
    if (!A.alive || !Bk.alive) {
      broken('a kingdom fell');
      continue;
    }
    if (m.atWar(ag.a, ag.b)) {
      broken('war');
      continue;
    }
    if (st.t < ag.next) continue;
    if ((A.stock[ag.give.res] || 0) < ag.give.n) {
      broken(`${A.name} could not deliver ${ag.give.res}`);
      continue;
    }
    if ((Bk.stock[ag.get.res] || 0) < ag.get.n) {
      broken(`${Bk.name} could not deliver ${ag.get.res}`);
      continue;
    }
    A.stock[ag.give.res] -= ag.give.n;
    Bk.stock[ag.get.res] -= ag.get.n;
    A.stats.deals = (A.stats.deals || 0) + 1;
    Bk.stats.deals = (Bk.stats.deals || 0) + 1;
    const capA = m.settlement(A.capital);
    const capB = m.settlement(Bk.capital);
    sendDelivery(m, ag.a, capA, capB, ag.b, ag.give);
    sendDelivery(m, ag.b, capB, capA, ag.a, ag.get);
    ag.left--;
    ag.next = st.t + ag.every;
    if (ag.left <= 0) {
      st.agreements = st.agreements.filter((q) => q !== ag);
      m.event(ag.a, 'info', `Agreement with ${Bk.name} fulfilled.`);
      m.event(ag.b, 'info', `Agreement with ${A.name} fulfilled.`);
    }
  }
}

function sendDelivery(m, kid, from, to, toKid, cargo) {
  if (!from || !to) return;
  const sea = !!(from.buildings.harbor && to.buildings.harbor);
  const profile = { kid, kind: 'caravan', sea };
  const path = m.findPath(profile, from.x, from.y, to.x, to.y);
  if (!path) {
    m.state.kingdoms[toKid].stock[cargo.res] = (m.state.kingdoms[toKid].stock[cargo.res] || 0) + cargo.n;
    return;
  }
  m.state.parties.push({ id: m.nextId(), kind: 'caravan', kid, x: from.x, y: from.y, path, pi: 0, pf: 0, sea, mode: 'deliver', cargo: { ...cargo }, to: to.id, toKid, home: from.id, returning: false });
}
