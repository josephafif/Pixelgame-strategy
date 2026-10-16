// AI kingdoms. They play by the same rules as humans: every action goes
// through the same validated commands (m.exec), costs the same resources and
// takes the same time. Personalities weight the same decisions differently:
//  builder  – grows settlements, defends, expands steadily
//  merchant – trades surpluses, forms agreements, aims at the Grand Exchange
//  warlord  – arms early and attacks weaker neighbours

import { BUILDINGS, STAGES, RES_KEYS, RESOURCES, UNITS, WALLS, RULES, stagePopNeed } from '../sim/defs.js';
import { stageUpError, siteFactor } from '../sim/economy.js';
import { foundError } from '../sim/expansion.js';
import { analyzeSite, siteStrengths } from '../world/sites.js';
import { total } from '../sim/military.js';

const PROFILE = {
  builder: { maxTowns: 8, aggression: 0.15, army: 1.0, trade: 0.6 },
  merchant: { maxTowns: 6, aggression: 0.05, army: 0.8, trade: 1.4 },
  warlord: { maxTowns: 6, aggression: 0.6, army: 1.6, trade: 0.4 },
};

function mem(k) {
  if (!k.ai_) k.ai_ = { lastExpand: -999, lastWarCheck: 0, warSince: 0, lastOrders: -999, lastPropose: -999, lastBuild: -999, attacks: {} };
  return k.ai_;
}

function soldiers(m, k) {
  let n = 0;
  for (const s of m.settlementsOf(k.id)) n += total(s.garrison);
  for (const a of m.state.armies) if (a.kid === k.id) n += total(a.units);
  return n;
}

/** Closest pair of settlements between two kingdoms. */
function frontier(m, a, b) {
  let best = null;
  for (const s of m.settlementsOf(a)) {
    for (const o of m.settlementsOf(b)) {
      const d = Math.hypot(s.x - o.x, s.y - o.y);
      if (!best || d < best.d) best = { d, mine: s, theirs: o };
    }
  }
  return best;
}

function try_(m, k, cmd) {
  const r = m.exec(k.id, cmd);
  return r && !r.error;
}

export function thinkAI(m, k) {
  const ai = mem(k);
  const prof = PROFILE[k.personality] || PROFILE.builder;
  const mine = m.settlementsOf(k.id);
  if (!mine.length) return;
  const t = m.state.t;
  const cap = m.settlement(k.capital) || mine[0];
  const storage = m.storageCap(k.id);

  respondToProposals(m, k, prof);
  setPriorities(m, k, mine);
  develop(m, k, mine, cap, prof, storage);
  if (t - ai.lastExpand > 50) expand(m, k, mine, prof, ai);
  connectRoads(m, k, mine);
  if (t - ai.lastOrders > 20) manageTrade(m, k, prof, storage, ai);
  military(m, k, mine, cap, prof, ai);
}

function setPriorities(m, k, mine) {
  const pop = mine.reduce((a, s) => a + s.pop, 0);
  const foodRate = k.rates.food ?? 0;
  const set = (cat, level) => {
    if (k.priorities[cat] !== level) m.exec(k.id, { type: 'priority', cat, level });
  };
  const eat = k.need?.food || pop * 0.02; // per second
  // Hunger with hysteresis, so that labour does not flip-flop around a balanced larder.
  const ai = mem(k);
  if (k.stock.food < Math.max(60, eat * 60) || (foodRate < 0 && k.stock.food < eat * 150)) ai.hungry = true;
  else if (k.stock.food > eat * 300 || (foodRate >= 0 && k.stock.food > eat * 150)) ai.hungry = false;
  const hungry = !!ai.hungry;
  set('food', hungry ? 3 : k.stock.food > m.storageCap(k.id) * 0.7 && foodRate > 0 ? 1 : 2);
  // Hunger comes first: wood work yields to the fields until food is secure,
  // unless wood has run out entirely (then nothing can be built at all).
  if (k.stock.wood < 25) ai.woodOut = true;
  else if (k.stock.wood > 90) ai.woodOut = false;
  set('wood', ai.woodOut ? 3 : k.stock.wood < 150 && !hungry ? 3 : 2);
  set('stone', k.stock.stone < 80 ? 2 : 1);
  set('iron', 2);
  set('build', 3);
}

function count(m, k, kind) {
  let n = 0;
  for (const s of m.settlementsOf(k.id)) n += (s.buildings[kind] || 0) + s.projects.filter((p) => p.kind === kind).length;
  return n;
}

/** Resources the AI is saving for (a stage-up within reach, or settlers). */
function reserveFor(m, k, mine, cap) {
  const res = {};
  const add = (cost) => {
    for (const [r, v] of Object.entries(cost)) res[r] = Math.max(res[r] || 0, v);
  };
  for (const s of mine) {
    const next = STAGES[s.stage + 1];
    if (!next || s.projects.some((p) => p.type === 'stage')) continue;
    const up = next.up;
    const needsOk = (up.needs || []).every((n) => s.buildings[n]);
    if (s.pop >= stagePopNeed(s) * 0.9 && needsOk) add(up.cost);
  }
  if (cap && cap.crowded && cap.stage >= 1) add({ wood: 70, food: 60 });
  // Saving for settlers while there is room to expand and a town able to send them.
  const prof = PROFILE[k.personality] || PROFILE.builder;
  if (mine.length < prof.maxTowns && mine.some((s) => s.pop >= 42 && s.stage >= 1) && !m.state.parties.some((p) => p.kid === k.id && p.kind === 'settlers')) add({ wood: 80, food: 80 });
  return res;
}

function affordWithReserve(m, k, cost, reserve) {
  for (const [r, v] of Object.entries(cost)) {
    const have = r === 'coin' ? k.coin : k.stock[r] || 0;
    if (have < v + (reserve[r] || 0)) return false;
  }
  return true;
}

function develop(m, k, mine, cap, prof, storage) {
  const ai = mem(k);
  if (m.state.t - ai.lastBuild < 4) return;
  const pop = mine.reduce((a, s) => a + s.pop, 0);
  const foodNeed = k.need ? k.need.food : pop * 0.02;
  let foodProd = 0;
  for (const s of mine) foodProd += s.out.food || 0;
  const hungry = foodProd < foodNeed * 1.1 || k.stock.food < 60;
  const reserve = reserveFor(m, k, mine, cap);
  const wants = [];
  for (const s of mine) {
    if (s.unrest > 0) continue;
    const busy = s.projects.filter((p) => p.type !== 'house').length;
    if (busy >= 2) continue;
    const has = (kind) => (s.buildings[kind] || 0) + s.projects.filter((p) => p.kind === kind).length;
    const idle = s.jobs.idle || 0;
    const farmCap = 3 + Math.floor(s.stage * 1.5);
    if (hungry) {
      // Both kinds are offered: if the fishery finds no shore, a farm is next in line.
      const fishFirst = s.site.fert < 0.7 || has('farm') >= 2;
      if (s.site.water > 0 && has('fishery') < (has('farm') >= farmCap ? 2 : 1)) wants.push({ s, kind: 'fishery', w: fishFirst ? 12.5 : 11.5, essential: true });
      if (has('farm') < farmCap + 3) wants.push({ s, kind: 'farm', w: 12, essential: true });
    }
    // Grow the settlement when possible (after feeding it).
    if (!stageUpError(m, s)) {
      wants.push({ s, cmd: { type: 'upgrade', sid: s.id }, w: 9 + s.stage, essential: true });
      if (!hungry) continue;
    }
    const woodShort = k.stock.wood < 60 && (k.rates.wood ?? 0) < 0.05;
    if (!has('lumber') && (s.site.wood > 0.3 || woodShort || s.capital)) wants.push({ s, kind: 'lumber', w: 8, essential: true });
    // Poor forest still gives some wood: more camps when wood is the bottleneck.
    if ((k.stock.wood < 150 || idle > 5) && has('lumber') < (s.site.wood > 0.3 ? 3 : 4) && (s.site.wood > 0.3 || woodShort || idle > 5)) wants.push({ s, kind: 'lumber', w: 7 - has('lumber') + (idle > 5 ? 1 : 0) + (woodShort ? 3 : 0), essential: woodShort });
    const nextUp = STAGES[s.stage + 1]?.up;
    const stoneNeed = nextUp?.cost?.stone || 0;
    const stoneBlocked = k.stock.stone < stoneNeed && count(m, k, 'quarry') === 0;
    if (s.stage >= 1 && !has('quarry') && (s.site.stone > 0.5 || stoneBlocked) && count(m, k, 'quarry') < 2) wants.push({ s, kind: 'quarry', w: stoneBlocked ? 9 : 7, essential: stoneBlocked });
    if (idle > 8 && has('farm') < Math.min(5, farmCap) && foodProd < foodNeed * 1.4) wants.push({ s, kind: 'farm', w: 5 });
    if (idle > 6 && s.stage >= 1 && has('quarry') < 2 && s.site.stone > 0.35) wants.push({ s, kind: 'quarry', w: 5 });
    if (s.stage >= 2 && !has('market') && s.pop > 90) wants.push({ s, kind: 'market', w: 8, essential: true });
    if (s.stage >= 1 && s === cap && !has('market')) {
      // The capital keeps its last free slot for a market (see below), so build it then.
      const lastSlot = STAGES[s.stage].maxBuild - Object.entries(s.buildings).reduce((a, [kk, c]) => a + (BUILDINGS[kk] ? c : 0), 0) - s.projects.filter((p) => p.type === 'building').length <= 1;
      const ironTrade = prof.army > 1.2 && !count(m, k, 'mine');
      wants.push({ s, kind: 'market', w: k.coin > 350 || lastSlot ? 9 : ironTrade ? 7 : 6 * prof.trade, essential: k.coin > 350 || lastSlot });
    }
    if (s.stage >= 2 && !has('market') && s.pop > 70) wants.push({ s, kind: 'market', w: 5 });
    // Iron arms soldiers and builds cities: one mine per realm, a second for warlords or cities.
    const ironStageNeed = (nextUp?.cost?.iron || 0) > k.stock.iron;
    if (s.stage >= 1 && s.site.iron > 0 && !has('mine') && count(m, k, 'mine') < (prof.army > 1.2 || mine.some((q) => q.stage >= 3) ? 2 : 1)) wants.push({ s, kind: 'mine', w: ironStageNeed || prof.army > 1.2 ? 8 : 6, essential: ironStageNeed });
    // Every realm wants a barracks in its capital once the first years are over, sooner when threatened.
    const threatened = Object.values(k.relations).includes('war');
    if (s.stage >= 1 && !has('barracks') && s === cap) wants.push({ s, kind: 'barracks', w: threatened ? 11 : m.state.t > 600 ? 8.5 : 4 * prof.army * prof.army, essential: prof.army > 1.2 || m.state.t > 600 || threatened });
    if (s.stage >= 2 && !has('barracks') && s !== cap && prof.army > 1.2) wants.push({ s, kind: 'barracks', w: 4 });
    if (s === cap && s.stage >= 4 && !has('wonder') && prof.trade > 1) wants.push({ s, kind: 'wonder', w: 12, essential: true });
    // Walls when there is danger nearby.
    const danger = m.state.armies.some((a) => a.kid !== k.id && m.atWar(a.kid, k.id) && Math.hypot(a.x - s.x, a.y - s.y) < 30);
    const nextWall = WALLS[s.walls.level + 1];
    if (nextWall && s.stage >= 1 && (!nextWall.stage || s.stage >= nextWall.stage) && (danger || (s === cap && s.stage >= 3 && s.walls.level < 2))) {
      wants.push({ s, cmd: { type: 'walls', sid: s.id }, w: danger ? 9 : 4, essential: danger });
    }
  }
  wants.sort((a, b) => b.w - a.w);
  const slotsLeft = (s) => {
    let n = 0;
    for (const [kk, c] of Object.entries(s.buildings)) if (BUILDINGS[kk]) n += c;
    n += s.projects.filter((p) => p.type === 'building').length;
    return STAGES[s.stage].maxBuild - n;
  };
  for (const w of wants.slice(0, 6)) {
    const cmd = w.cmd || { type: 'build', sid: w.s.id, kind: w.kind };
    if (w.kind && w.s === cap && !cap.buildings.market && w.kind !== 'market' && slotsLeft(cap) <= 1) continue;
    if (w.kind && w.s.stage >= 2 && !w.s.buildings.market && w.kind !== 'market' && slotsLeft(w.s) <= 1) continue;
    if (w.kind && siteFactor(w.s, w.kind) <= 0) continue;
    // Producers of what we are saving for are worth the delay they cause.
    const feedsReserve = w.kind && Object.keys(BUILDINGS[w.kind].out || {}).some((r) => (reserve[r] || 0) > (k.stock[r] || 0));
    if (w.kind && !(w.essential || feedsReserve ? m.canAfford(k.id, BUILDINGS[w.kind].cost) : affordWithReserve(m, k, BUILDINGS[w.kind].cost, reserve))) continue;
    if (try_(m, k, cmd)) {
      ai.lastBuild = m.state.t;
      return;
    }
  }
}

function expand(m, k, mine, prof, ai) {
  if (mine.length >= prof.maxTowns) return;
  if (m.state.parties.some((p) => p.kid === k.id && p.kind === 'settlers')) return;
  const src = [...mine].filter((s) => s.pop >= 42 && s.stage >= 1 && s.unrest <= 0).sort((a, b) => b.pop - a.pop)[0];
  if (!src) return;
  // Falling food stops expansion unless the towns are out of room: then new land is the cure.
  const cramped = mine.every((s) => s.crowded || s.full || STAGES[s.stage].maxBuild - Object.entries(s.buildings).reduce((a, [kk, c]) => a + (BUILDINGS[kk] ? c : 0), 0) <= 1);
  if ((k.rates.food ?? 0) < 0 && k.stock.food < 150 && !cramped) return;
  if (k.stock.wood < 80 || k.stock.food < 80) return;
  const reserve = reserveFor(m, k, mine, m.settlement(k.capital));
  if (k.stock.wood - 60 < (reserve.wood || 0) * 0.8 && mine.length >= 2) return;
  const W = m.world.width;
  let best = null;
  const needIron = !mine.some((s) => s.site.iron > 0);
  const needStone = !mine.some((s) => s.site.stone > 0.6);
  // Aggressive realms settle towards their weakest neighbour to shorten the march.
  let rival = null;
  if (prof.aggression >= 0.5) {
    for (const o of m.state.kingdoms) {
      if (o === k || !o.alive || !o.placed) continue;
      const f = frontier(m, k.id, o.id);
      if (f && (!rival || soldiers(m, o) + f.d * 0.05 < rival.w)) rival = { w: soldiers(m, o) + f.d * 0.05, s: f.theirs };
    }
  }
  for (const base of mine) {
    for (let dy = -30; dy <= 30; dy += 3) {
      for (let dx = -30; dx <= 30; dx += 3) {
        const d = Math.hypot(dx, dy);
        if (d < 11 || d > 32) continue;
        const x = base.x + dx;
        const y = base.y + dy;
        if (x < 4 || y < 4 || x >= W - 4 || y >= m.world.height - 4) continue;
        if (foundError(m, k.id, src, x, y)) continue;
        const a = analyzeSite(m.world, x, y, { r: 7 });
        if (a.buildable < 40) continue;
        const s = siteStrengths(a);
        let score = s.farming * 2 + s.timber + s.highland * (needStone ? 1.5 : 0.8) + s.maritime * prof.trade + s.trade * prof.trade;
        if (needIron && a.iron > 0) score += 2;
        score -= Math.hypot(src.x - x, src.y - y) * 0.03;
        if (rival) score -= Math.hypot(rival.s.x - x, rival.s.y - y) * 0.035 * prof.aggression;
        if (!best || score > best.score) best = { x, y, score };
      }
    }
  }
  ai.lastExpand = m.state.t;
  if (best) try_(m, k, { type: 'found', sid: src.id, x: best.x, y: best.y });
}

function connectRoads(m, k, mine) {
  if (m.state.roadJobs.some((r) => r.kid === k.id)) return;
  if (k.stock.wood < 60) return;
  const cap = m.settlement(k.capital);
  if (!cap) return;
  // A trade road from the market town to the nearest free city.
  const ai = mem(k);
  const market = mine.find((s) => s.buildings.market && s.connected);
  if (market && !ai.hubRoad && k.stock.wood > 160) {
    const hub = [...m.state.hubs].sort((a, b) => Math.hypot(a.x - market.x, a.y - market.y) - Math.hypot(b.x - market.x, b.y - market.y))[0];
    ai.hubRoad = true;
    if (hub && Math.hypot(hub.x - market.x, hub.y - market.y) <= 90 && try_(m, k, { type: 'road', a: market.id, b: hub.id })) return;
  }
  for (const s of mine) {
    if (s.connected || s === cap) continue;
    const linked = mine.filter((q) => q.connected && q !== s).sort((a, b) => Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y))[0];
    if (!linked || Math.hypot(linked.x - s.x, linked.y - s.y) > 70) continue;
    if (try_(m, k, { type: 'road', a: s.id, b: linked.id })) return;
  }
}

function manageTrade(m, k, prof, storage, ai) {
  ai.lastOrders = m.state.t;
  const hasMarket = m.settlementsOf(k.id).some((s) => s.buildings.market);
  if (!hasMarket) return;
  const price = m.state.market.price;
  const wantKeep = { food: 150, wood: 150, stone: 100, iron: 40 };
  const reserve = reserveFor(m, k, m.settlementsOf(k.id), m.settlement(k.capital));
  for (const [r, v] of Object.entries(reserve)) if (wantKeep[r] !== undefined) wantKeep[r] = Math.max(wantKeep[r], v + 20);
  if ((k.rates.food ?? 0) < 0) wantKeep.food = Math.max(wantKeep.food, 250);
  if (prof.army > 1.2 || Object.values(k.relations).includes('war')) wantKeep.iron = 70;
  const desired = [];
  for (const r of RES_KEYS) {
    const have = k.stock[r] || 0;
    const surplusAt = Math.max(260, storage * 0.4, (reserve[r] || 0) + 150);
    if (have > surplusAt) desired.push({ res: r, side: 'sell', amount: 40, limit: RESOURCES[r].price * 0.55, keep: Math.round(surplusAt * 0.8) });
    else if (have < wantKeep[r] * 0.6 && k.coin > 150) desired.push({ res: r, side: 'buy', amount: 35, limit: RESOURCES[r].price * 1.8, keep: wantKeep[r] });
  }
  // Replace orders that no longer make sense.
  for (const o of k.orders.slice()) {
    if (!desired.some((d) => d.res === o.res && d.side === o.side)) m.exec(k.id, { type: 'cancelOrder', oid: o.id });
  }
  for (const d of desired.slice(0, Math.round(3 * prof.trade) + 1)) {
    if (k.orders.some((o) => o.res === d.res && o.side === d.side)) continue;
    m.exec(k.id, { type: 'order', ...d });
  }
  // Merchants propose agreements: our surplus for their surplus.
  if (prof.trade > 1 && m.state.t - ai.lastPropose > 120) {
    ai.lastPropose = m.state.t;
    const surplus = RES_KEYS.filter((r) => (k.stock[r] || 0) > storage * 0.5);
    const need = RES_KEYS.filter((r) => (k.stock[r] || 0) < wantKeep[r] * 0.6);
    if (surplus.length && need.length) {
      for (const other of m.state.kingdoms) {
        if (other === k || !other.alive || m.atWar(k.id, other.id) || !other.placed) continue;
        if ((other.stock[need[0]] || 0) < 60) continue;
        const give = surplus[0];
        const ratio = (price[need[0]] || 1) / (price[give] || 1);
        try_(m, k, { type: 'propose', to: other.id, give: { res: give, n: Math.round(Math.min(150, 15 * ratio)) }, get: { res: need[0], n: 15 }, every: 30, times: 8 });
        break;
      }
    }
  }
}

function respondToProposals(m, k, prof) {
  const storage = m.storageCap(k.id);
  for (const p of m.state.proposals.filter((q) => q.to === k.id)) {
    if (p.peace) {
      const mine = soldiers(m, k);
      const theirs = soldiers(m, m.state.kingdoms[p.from]);
      const accept = mine < theirs * 1.1 || k.warWeariness > 400 || prof.aggression < 0.3;
      m.exec(k.id, { type: 'answerPeace', id: p.id, accept });
      continue;
    }
    // We receive p.give and pay p.get.
    const price = m.state.market.price;
    const valueIn = (price[p.give.res] || 1) * p.give.n;
    const valueOut = (price[p.get.res] || 1) * p.get.n;
    const canPay = (k.stock[p.get.res] || 0) > p.get.n * 3;
    const useful = (k.stock[p.give.res] || 0) < storage * 0.6;
    m.exec(k.id, { type: 'respond', id: p.id, accept: canPay && useful && valueIn >= valueOut * 0.9 });
  }
}

function military(m, k, mine, cap, prof, ai) {
  const t = m.state.t;
  const enemies = m.state.kingdoms.filter((o) => o.alive && o !== k && m.atWar(k.id, o.id));
  // Garrison targets (only when the kingdom can feed more mouths).
  const fed = (k.rates.food ?? 0) > 0.1 && k.stock.food > 100 && !k.flags.starving;
  // Upkeep the treasury can carry: about two thirds of tax income, plus savings.
  const income = mine.reduce((a, s) => a + s.pop * RULES.taxPerPop * (s.prosperity || 1), 0);
  const affordable = (income * 0.65) / UNITS.inf.coin + k.coin / 400;
  const armyNow = soldiers(m, k);
  for (const s of mine) {
    const want = Math.round((4 + s.stage * 3) * prof.army + (enemies.length ? 6 : 0));
    if (armyNow >= affordable && !enemies.length) break;
    const have = total(s.garrison) + s.training.reduce((a, q) => a + q.n, 0);
    if (s.buildings.barracks && have < want && (fed || enemies.length)) {
      const n = Math.min(10, want - have);
      // Infantry when there is iron to spare, archers (wood only) otherwise.
      const unit = m.rng.next() < 0.35 || !m.canAfford(k.id, UNITS.inf.cost, n + 20) ? 'arch' : 'inf';
      if (m.canAfford(k.id, UNITS[unit].cost, n)) m.exec(k.id, { type: 'recruit', sid: s.id, unit, n });
      else if (m.canAfford(k.id, UNITS.arch.cost, Math.max(1, Math.floor(n / 2)))) m.exec(k.id, { type: 'recruit', sid: s.id, unit: 'arch', n: Math.max(1, Math.floor(n / 2)) });
    }
    // Emergency levy when besieged.
    if (s.siege && s.garrison.militia < 1 && s.pop > 30) m.exec(k.id, { type: 'levy', sid: s.id });
    // Siege engines for walled enemies.
    if (enemies.length && s.stage >= UNITS.siege.needsStage && s.buildings.barracks && s.garrison.siege < 2) m.exec(k.id, { type: 'recruit', sid: s.id, unit: 'siege', n: 1 });
  }
  // Relief: a besieged town is answered by the strongest garrison within reach,
  // which marches on the besiegers and meets them in the field.
  for (const s of mine) {
    if (!s.siege || m.state.armies.some((a) => a.kid === k.id && a.relief === s.id)) continue;
    const foes = m.state.armies.filter((a) => a.kid !== k.id && m.atWar(a.kid, k.id) && Math.hypot(a.x - s.x, a.y - s.y) <= RULES.siegeRange + 0.5);
    if (!foes.length) continue;
    const foe = foes.sort((p, q) => total(q.units) - total(p.units))[0];
    const need = foes.reduce((n, a) => n + total(a.units), 0) * 0.8;
    const src = mine.filter((q) => q !== s && !q.siege && Math.hypot(q.x - s.x, q.y - s.y) <= 90).sort((p, q) => total(q.garrison) - total(p.garrison))[0];
    if (!src) continue;
    const keep = src.capital ? 3 : 1;
    if (total(src.garrison) - src.garrison.militia - keep < need) continue;
    const units = {};
    for (const [u, n] of Object.entries(src.garrison)) units[u] = u === 'militia' ? 0 : Math.max(0, Math.floor(n - (u === 'inf' ? keep : 0)));
    const r = m.exec(k.id, { type: 'formArmy', sid: src.id, units });
    if (r && r.id) {
      const a = m.state.armies.find((q) => q.id === r.id);
      a.relief = s.id;
      m.exec(k.id, { type: 'move', aid: a.id, x: foe.x, y: foe.y });
    }
  }
  // Idle armies return home and rejoin a garrison.
  for (const a of m.state.armies.filter((q) => q.kid === k.id)) {
    if (a.state === 'idle') {
      const tgt = a.target ? m.settlement(a.target) : null;
      const relieve = a.relief ? m.settlement(a.relief) : null;
      const foe = relieve && relieve.siege ? m.state.armies.find((q) => q.kid !== k.id && m.atWar(q.kid, k.id) && Math.hypot(q.x - relieve.x, q.y - relieve.y) <= RULES.siegeRange + 0.5) : null;
      if (foe) m.exec(k.id, { type: 'move', aid: a.id, x: foe.x, y: foe.y });
      else if (tgt && tgt.kingdom !== k.id && m.atWar(k.id, tgt.kingdom)) m.exec(k.id, { type: 'move', aid: a.id, x: tgt.x, y: tgt.y });
      else {
        const home = mine.sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[0];
        if (home && Math.hypot(home.x - a.x, home.y - a.y) < 2) m.exec(k.id, { type: 'garrison', aid: a.id });
        else if (home) m.exec(k.id, { type: 'move', aid: a.id, x: home.x, y: home.y });
      }
    }
  }
  // Declaring war on a weaker neighbour whose towns are close to our frontier.
  if (t - ai.lastWarCheck > 30) {
    ai.lastWarCheck = t;
    if (!enemies.length && t > 420) {
      const myPower = soldiers(m, k);
      let target = null;
      for (const o of m.state.kingdoms) {
        if (o === k || !o.alive || !o.placed) continue;
        const f = frontier(m, k.id, o.id);
        if (!f || f.d > 120) continue;
        const ratio = myPower / Math.max(4, soldiers(m, o));
        // Rich, sprawling and weakly held neighbours are tempting.
        const lure = Math.min(0.3, (o.stats.settlements || 1) * 0.04);
        const appetite = prof.aggression * Math.min(3, ratio) * (1 - f.d / 220) + lure * prof.aggression;
        if (ratio > 1.4 && appetite > 0.45 && (!target || appetite > target.appetite)) target = { o, appetite };
      }
      if (target && m.rng.next() < prof.aggression + 0.2) {
        m.exec(k.id, { type: 'declareWar', to: target.o.id });
        ai.warSince = t;
      }
    } else if (enemies.length) {
      for (const e of enemies) {
        const ratio = soldiers(m, k) / Math.max(1, soldiers(m, e));
        if ((ratio < 0.7 || t - ai.warSince > 900) && !m.state.proposals.some((p) => p.peace && p.from === k.id)) m.exec(k.id, { type: 'offerPeace', to: e.id });
      }
    }
  }
  // Attacks: the best-held town near the front marches on the weakest enemy town in reach.
  if (enemies.length && !m.state.armies.some((a) => a.kid === k.id && a.target && a.state !== 'retreat')) {
    let best = null;
    for (const src of mine) {
      const keep = src.capital ? 4 : 2;
      const force = total(src.garrison) - src.garrison.militia - keep;
      if (force < 6) continue;
      for (const e of enemies) {
        for (const s of m.settlementsOf(e.id)) {
          const d = Math.hypot(s.x - src.x, s.y - src.y);
          if (d > 130) continue;
          const defence = total(s.garrison) * (s.walls.level && s.walls.hp > 0 ? WALLS[s.walls.level].def : 1) + s.walls.hp / 60;
          if (force <= defence * 1.3 + 2) continue;
          const score = d * 0.5 + defence * 2 - (s.capital ? 10 : 0) - s.stage * 2;
          if (!best || score < best.score) best = { s, src, keep, score };
        }
      }
    }
    if (best) {
      const units = {};
      for (const [u, n] of Object.entries(best.src.garrison)) units[u] = u === 'militia' ? 0 : Math.max(0, Math.floor(n - (u === 'inf' ? best.keep : 0)));
      const r = m.exec(k.id, { type: 'formArmy', sid: best.src.id, units });
      if (r && r.id) {
        const a = m.state.armies.find((q) => q.id === r.id);
        a.target = best.s.id;
        m.exec(k.id, { type: 'move', aid: a.id, x: best.s.x, y: best.s.y });
      }
    }
  }
}
