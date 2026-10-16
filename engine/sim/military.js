// Military: recruitment (capacity, training time, equipment), militia levies,
// demobilisation, armies with supply and morale, terrain-dependent battles,
// sieges against walls and garrisons, capture of settlements and caravans.

import { B } from '../world/biomes.js';
import { UNITS, UNIT_KEYS, RULES, WALLS, BUILDINGS, RES_KEYS } from './defs.js';
import { removeBuilding } from '../settlement/planner.js';

export function total(units) {
  let n = 0;
  for (const v of Object.values(units)) n += v;
  return n;
}

function emptyUnits() {
  return { militia: 0, inf: 0, arch: 0, cav: 0, siege: 0 };
}

export function recruitCapacity(s) {
  return (s.buildings.barracks || 0) * BUILDINGS.barracks.effect.recruit;
}

export function recruitError(m, kid, s, unit, n) {
  const u = UNITS[unit];
  if (!u || u.levy) return 'Unknown unit.';
  if (!s || s.kingdom !== kid) return 'Not your settlement.';
  if (!(n >= 1 && n <= 50)) return 'Recruit 1–50 at a time.';
  const cap = recruitCapacity(s);
  if (!cap) return `${s.name} needs barracks to train soldiers.`;
  const busy = s.training.filter((t) => !UNITS[t.unit].levy).reduce((a, t) => a + t.n, 0);
  if (busy + n > cap) return `Barracks can train ${cap} at once (${busy} in training).`;
  if (u.needs === 'cavalry' && !s.buildings.stables) return 'Cavalry needs stables in this settlement.';
  if (u.needs === 'siege' && !s.buildings.siegeworks) return 'Siege engines need siege works here.';
  const people = n * (u.crew || 1);
  if (s.pop - people < 12) return `${s.name} cannot spare ${people} workers.`;
  if (!m.canAfford(kid, u.cost, n)) return `Not enough equipment: each ${u.name.toLowerCase()} needs ${Object.entries(u.cost).map(([r, v]) => `${v} ${r}`).join(', ')}.`;
  return null;
}

export function recruit(m, kid, s, unit, n) {
  const err = recruitError(m, kid, s, unit, n);
  if (err) return { error: err };
  const u = UNITS[unit];
  m.pay(kid, u.cost, n);
  s.pop -= n * (u.crew || 1);
  s.training.push({ unit, n, t: u.train });
  return { ok: true };
}

/** Emergency levy: militia from the population, fast but weak and limited. */
export function levy(m, kid, s) {
  if (!s || s.kingdom !== kid) return { error: 'Not your settlement.' };
  const max = Math.floor(s.pop * RULES.levyMax);
  const already = s.garrison.militia + s.training.filter((t) => t.unit === 'militia').reduce((a, t) => a + t.n, 0);
  const n = Math.max(0, Math.min(max - already, Math.floor(s.pop - 10)));
  if (n <= 0) return { error: `${s.name} has no one left to levy.` };
  s.pop -= n;
  s.training.push({ unit: 'militia', n, t: UNITS.militia.train });
  m.event(kid, 'military', `${n} militia are called up in ${s.name}; work suffers.`, s.x, s.y);
  return { ok: true, n };
}

/** Send garrison soldiers back to work (gradual; equipment partly recovered). */
export function demobilize(m, kid, s, unit, n) {
  if (!s || s.kingdom !== kid) return { error: 'Not your settlement.' };
  const have = Math.floor(s.garrison[unit] || 0);
  n = Math.min(have, n);
  if (n <= 0) return { error: 'No such soldiers in the garrison.' };
  s.garrison[unit] -= n;
  const u = UNITS[unit];
  const k = m.state.kingdoms[kid];
  for (const [r, v] of Object.entries(u.cost)) if (r === 'arms') k.stock.arms += v * n * 0.7;
  s.demob.push({ n: n * (u.crew || 1), t: RULES.demobilizeTime });
  return { ok: true };
}

export function formArmy(m, kid, s, units) {
  if (!s || s.kingdom !== kid) return { error: 'Not your settlement.' };
  const take = emptyUnits();
  let n = 0;
  for (const u of UNIT_KEYS) {
    const want = Math.floor(Math.max(0, units?.[u] ?? s.garrison[u]));
    take[u] = Math.min(Math.floor(s.garrison[u] || 0), want);
    n += take[u];
  }
  if (n <= 0) return { error: 'No soldiers to form an army.' };
  for (const u of UNIT_KEYS) s.garrison[u] -= take[u];
  const a = { id: m.nextId(), kid, x: s.x, y: s.y, units: take, path: null, pi: 0, pf: 0, dest: null, supply: RULES.supplyCap, morale: 1, state: 'idle', inSupply: true, home: s.id, retreatT: 0 };
  m.state.armies.push(a);
  return { ok: true, id: a.id };
}

export function moveArmy(m, kid, aid, x, y) {
  const a = m.state.armies.find((q) => q.id === aid);
  if (!a || a.kid !== kid) return { error: 'Not your army.' };
  if (a.state === 'retreat') return { error: 'The army is retreating.' };
  const W = m.world.width;
  x = Math.max(0, Math.min(W - 1, Math.round(x)));
  y = Math.max(0, Math.min(m.world.height - 1, Math.round(y)));
  const path = m.findPath({ kid, kind: 'army' }, a.x, a.y, x, y);
  if (!path) {
    const own = m.ownerK[y * W + x];
    if (own >= 0 && own !== kid && !m.atWar(kid, own)) return { error: `You are at peace with ${m.state.kingdoms[own].name}: borders are closed.` };
    return { error: 'The army cannot reach that place.' };
  }
  a.path = path;
  a.pi = 0;
  a.pf = 0;
  a.dest = { x, y };
  a.state = 'moving';
  return { ok: true };
}

export function garrisonArmy(m, kid, aid) {
  const a = m.state.armies.find((q) => q.id === aid);
  if (!a || a.kid !== kid) return { error: 'Not your army.' };
  const s = nearestOwn(m, kid, a.x, a.y, 2.5);
  if (!s) return { error: 'Move the army into one of your settlements first.' };
  for (const u of UNIT_KEYS) s.garrison[u] = (s.garrison[u] || 0) + a.units[u];
  m.state.armies = m.state.armies.filter((q) => q !== a);
  return { ok: true };
}

function nearestOwn(m, kid, x, y, within = Infinity) {
  let best = null;
  for (const s of m.state.settlements) {
    if (s.kingdom !== kid) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d <= within && (!best || d < best.d)) best = { s, d };
  }
  return best ? best.s : null;
}

function speedOf(a) {
  let sp = 9;
  for (const u of UNIT_KEYS) if (a.units[u] > 0.01) sp = Math.min(sp, UNITS[u].speed);
  return RULES.armySpeed * (sp === 9 ? 1 : sp);
}

function inSupply(m, a) {
  const W = m.world.width;
  const H = m.world.height;
  const x = Math.round(a.x);
  const y = Math.round(a.y);
  if (m.ownerK[y * W + x] === a.kid) return true;
  const r = RULES.supplyRange;
  for (let dy = -r; dy <= r; dy += 2) {
    for (let dx = -r; dx <= r; dx += 2) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      if (m.ownerK[yy * W + xx] === a.kid) return true;
    }
  }
  return false;
}

/** Combat strength of a force in context. */
function strength(m, units, { attacking, x, y, walls = 1, settlement = false, morale = 1 }) {
  const W = m.world.width;
  const i = Math.round(y) * W + Math.round(x);
  const b = m.world.biome[i];
  let terrain = 1;
  if (!attacking) {
    if (b === B.HILLS) terrain = 1.25;
    else if (b === B.MOUNTAIN) terrain = 1.5;
    else if (b === B.FOREST || b === B.TAIGA) terrain = 1.2;
    else if (b === B.MARSH) terrain = 0.9;
  } else if (b === B.RIVER && !m.roadMask[i]) terrain = 0.7;
  else if (b === B.MARSH) terrain = 0.9;
  const open = b === B.GRASS || b === B.MEADOW || b === B.DESERT || b === B.BEACH;
  const rough = b === B.FOREST || b === B.TAIGA || b === B.MARSH || b === B.MOUNTAIN || b === B.HILLS;
  let s = 0;
  for (const u of UNIT_KEYS) {
    const n = units[u] || 0;
    if (n <= 0) continue;
    const def = UNITS[u];
    let v = attacking ? def.atk : def.def;
    if (u === 'cav') v *= open ? 1.3 : rough ? 0.65 : 1;
    if (!attacking && settlement && def.defendBonus) v *= 1 + def.defendBonus;
    if (!attacking && settlement) v *= walls;
    s += v * n;
  }
  return s * terrain * (0.4 + 0.6 * morale);
}

function applyLosses(units, losses) {
  const t = total(units);
  if (t <= 0) return 0;
  const frac = Math.min(1, losses / t);
  for (const u of UNIT_KEYS) units[u] = Math.max(0, units[u] * (1 - frac));
  return frac;
}

function retreat(m, a, why) {
  const home = nearestOwn(m, a.kid, a.x, a.y);
  a.state = 'retreat';
  a.retreatT = 12;
  if (home) {
    a.path = m.findPath({ kid: a.kid, kind: 'army', ignoreBorders: true }, a.x, a.y, home.x, home.y) || null;
    a.pi = 0;
    a.pf = 0;
    a.dest = { x: home.x, y: home.y };
  }
  m.event(a.kid, 'military', `Your army ${why} and retreats.`, a.x, a.y);
}

export function desert(m, k, dt) {
  const f = 0.003 * dt;
  for (const s of m.settlementsOf(k.id)) for (const u of UNIT_KEYS) s.garrison[u] *= 1 - f;
  for (const a of m.state.armies) if (a.kid === k.id) for (const u of UNIT_KEYS) a.units[u] *= 1 - f;
}

function capture(m, s, kid) {
  const st = m.state;
  const oldKid = s.kingdom;
  const old = st.kingdoms[oldKid];
  const k = st.kingdoms[kid];
  // Loot: a share of the loser's stock proportional to this town's size.
  const oldPop = Math.max(1, m.settlementsOf(oldKid).reduce((a, q) => a + q.pop, 0));
  const share = 0.2 * (s.pop / oldPop);
  for (const r of RES_KEYS) {
    const amt = (old.stock[r] || 0) * share;
    old.stock[r] -= amt;
    k.stock[r] = (k.stock[r] || 0) + amt;
  }
  const coin = old.coin * share;
  old.coin -= coin;
  k.coin += coin;
  // Unfinished work is lost; its construction sites are cleared.
  const L = m.layouts.get(s.id);
  for (const p of s.projects) if (p.bid) removeBuilding(m.world, L, p.bid);
  s.projects = [];
  s.training = [];
  s.demob = [];
  s.garrison = emptyUnits();
  s.kingdom = kid;
  s.pop = Math.max(5, s.pop * 0.72);
  s.unrest = RULES.unrestCapture;
  s.walls.hp = s.walls.level ? WALLS[s.walls.level].hp * 0.15 : 0;
  s.siege = null;
  s.full = false;
  const wasCapital = s.capital;
  s.capital = false;
  m.layoutChanged(s);
  m.territoryDirty = true;
  // Orders and agreements of the loser no longer use this town.
  if (wasCapital) {
    const rest = m.settlementsOf(oldKid).sort((a, b) => b.pop - a.pop);
    if (rest.length) {
      rest[0].capital = true;
      old.capital = rest[0].id;
      m.event(oldKid, 'military', `${s.name} has fallen! The court flees to ${rest[0].name}.`, s.x, s.y);
    } else {
      old.capital = -1;
    }
  }
  if (!m.settlementsOf(oldKid).length) {
    old.alive = false;
    st.armies = st.armies.filter((a) => a.kid !== oldKid);
    st.parties = st.parties.filter((p) => p.kid !== oldKid);
    m.tally('falls');
    m.event(-1, 'fall', `${old.name} has fallen to ${k.name}.`, s.x, s.y);
  }
  m.tally('captures');
  m.event(-1, 'capture', `${k.name} captures ${s.name} from ${old.name}.`, s.x, s.y);
}

export function tick(m, dt) {
  const st = m.state;
  // Movement, supply and morale.
  for (const a of st.armies) {
    if (a.retreatT > 0) a.retreatT -= dt;
    if (a.state === 'moving' || a.state === 'retreat') {
      const done = m.advance(a, { kid: a.kid, kind: 'army', ignoreBorders: a.state === 'retreat' }, speedOf(a), dt);
      if (a.blocked) {
        a.blocked = false;
        a.state = 'idle';
        a.path = null;
        m.event(a.kid, 'military', 'Your army was stopped at a closed border.', a.x, a.y);
      } else if (done) {
        a.state = 'idle';
        a.path = null;
        // Arriving in one of our own towns: join the garrison.
        const home = nearestOwn(m, a.kid, a.x, a.y, 1.5);
        if (home && a.dest && Math.hypot(a.dest.x - home.x, a.dest.y - home.y) < 1.5) {
          for (const u of UNIT_KEYS) home.garrison[u] = (home.garrison[u] || 0) + a.units[u];
          a.units = emptyUnits();
        }
      }
    }
    if (st.tick % 4 === 0) a.inSupply = inSupply(m, a);
    if (a.inSupply) {
      a.supply = Math.min(RULES.supplyCap, a.supply + dt * 6);
      if (a.state !== 'battle') a.morale = Math.min(1, a.morale + dt * 0.01);
    } else {
      a.supply -= dt;
      if (a.supply <= 0) {
        a.supply = 0;
        applyLosses(a.units, total(a.units) * 0.012 * dt);
        a.morale = Math.max(0, a.morale - dt * 0.01);
        if (st.tick % 40 === 0) m.event(a.kid, 'military', 'Your army is out of supplies and starving.', a.x, a.y);
      }
    }
    if (st.kingdoms[a.kid].flags.unpaid) a.morale = Math.max(0, a.morale - dt * 0.004);
  }
  // Field battles.
  const engaged = new Map();
  for (let i = 0; i < st.armies.length; i++) {
    const a = st.armies[i];
    if (a.retreatT > 0 || total(a.units) < 0.5) continue;
    for (let j = i + 1; j < st.armies.length; j++) {
      const b = st.armies[j];
      if (b.retreatT > 0 || total(b.units) < 0.5) continue;
      if (!m.atWar(a.kid, b.kid)) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) > RULES.engageRange) continue;
      (engaged.get(a) || engaged.set(a, []).get(a)).push(b);
      (engaged.get(b) || engaged.set(b, []).get(b)).push(a);
    }
  }
  const losses = new Map();
  for (const [a, foes] of engaged) {
    if (a.state !== 'battle') m.tally('battles', 0.5); // each clash counts once for its two sides
    a.state = 'battle';
    for (const b of foes) {
      const aMoving = a.path && a.pi < a.path.length - 1;
      const atk = strength(m, a.units, { attacking: true, x: a.x, y: a.y, morale: a.morale });
      const def = strength(m, b.units, { attacking: false, x: b.x, y: b.y, morale: b.morale }) / Math.max(1, total(b.units));
      const dmg = (atk * 0.035 * dt) / Math.max(0.4, def) / foes.length;
      losses.set(b, (losses.get(b) || 0) + dmg * (aMoving ? 0.9 : 1));
    }
  }
  for (const [b, l] of losses) {
    const frac = applyLosses(b.units, l);
    b.morale = Math.max(0, b.morale - frac * 1.6);
    if (total(b.units) >= 0.5 && b.morale < 0.3) retreat(m, b, 'broke in battle');
  }
  for (const a of st.armies) if (a.state === 'battle' && !engaged.has(a)) a.state = a.path ? 'moving' : 'idle';
  // Sieges.
  for (const s of st.settlements) {
    if (s.hub || s.kingdom < 0) continue;
    const besiegers = st.armies.filter((a) => a.retreatT <= 0 && !engaged.has(a) && m.atWar(a.kid, s.kingdom) && Math.hypot(a.x - s.x, a.y - s.y) <= RULES.siegeRange && total(a.units) >= 0.5);
    if (!besiegers.length) {
      if (s.siege) {
        s.siege = null;
        m.event(s.kingdom, 'military', `The siege of ${s.name} is lifted.`, s.x, s.y);
      }
      if (s.walls.level) s.walls.hp = Math.min(WALLS[s.walls.level].hp, s.walls.hp + dt * 2);
      continue;
    }
    if (!s.siege) {
      s.siege = { by: besiegers[0].kid, t: 0, blockade: true };
      m.tally('sieges');
      m.event(s.kingdom, 'military', `${s.name} is under siege by ${st.kingdoms[besiegers[0].kid].name}!`, s.x, s.y);
      m.event(besiegers[0].kid, 'military', `Your army besieges ${s.name}.`, s.x, s.y);
    }
    s.siege.t += dt;
    for (const a of besiegers) a.state = 'siege';
    const wallMult = s.walls.level && s.walls.hp > 0 ? WALLS[s.walls.level].def : 1.1 + (s.buildings.tower ? 0.1 : 0);
    // Walls first: engines batter them while the garrison shoots back.
    let wallDmg = 0;
    let atk = 0;
    for (const a of besiegers) {
      for (const u of UNIT_KEYS) wallDmg += (a.units[u] || 0) * UNITS[u].wall;
      atk += strength(m, a.units, { attacking: true, x: a.x, y: a.y, morale: a.morale });
    }
    const gTotal = total(s.garrison);
    const gAtk = strength(m, s.garrison, { attacking: true, x: s.x, y: s.y, morale: 1 }) * (s.walls.hp > 0 ? 0.6 : 1);
    if (s.walls.level && s.walls.hp > 0) {
      s.walls.hp = Math.max(0, s.walls.hp - wallDmg * dt);
      if (s.walls.hp === 0) {
        m.tally('breaches');
        m.event(-1, 'military', `The walls of ${s.name} are breached!`, s.x, s.y);
      }
    } else if (gTotal >= 0.5) {
      const gDef = strength(m, s.garrison, { attacking: false, x: s.x, y: s.y, walls: wallMult, settlement: true }) / gTotal;
      const frac = applyLosses(s.garrison, (atk * 0.035 * dt) / Math.max(0.4, gDef));
      s.pop = Math.max(3, s.pop * (1 - frac * 0.05));
    }
    // Garrison return fire spreads over the besiegers.
    if (gTotal >= 0.5) {
      for (const a of besiegers) {
        const aDef = strength(m, a.units, { attacking: false, x: a.x, y: a.y, morale: a.morale }) / Math.max(1, total(a.units));
        const frac = applyLosses(a.units, (gAtk * 0.035 * dt) / Math.max(0.4, aDef) / besiegers.length);
        a.morale = Math.max(0, a.morale - frac * 1.2);
        if (a.morale < 0.3 && total(a.units) >= 0.5) retreat(m, a, `was repulsed at ${s.name}`);
      }
    }
    if ((s.walls.level === 0 || s.walls.hp <= 0) && total(s.garrison) < 0.5) {
      const winner = besiegers.sort((p, q) => total(q.units) - total(p.units))[0];
      capture(m, s, winner.kid);
      // The victorious army occupies the town.
      for (const u of UNIT_KEYS) s.garrison[u] = Math.floor(winner.units[u] * 0.5);
      for (const u of UNIT_KEYS) winner.units[u] -= s.garrison[u];
    }
  }
  // Raiders intercept enemy caravans and settlers.
  for (const p of st.parties.slice()) {
    if (p.kind === 'scout') continue;
    for (const a of st.armies) {
      if (!m.atWar(a.kid, p.kid) || total(a.units) < 0.5) continue;
      if (Math.hypot(a.x - p.x, a.y - p.y) > 1.5) continue;
      st.parties = st.parties.filter((q) => q !== p);
      m.tally('seized');
      const k = st.kingdoms[a.kid];
      if (p.cargo) k.stock[p.cargo.res] = (k.stock[p.cargo.res] || 0) + p.cargo.n;
      if (p.coin) k.coin += p.coin;
      m.event(p.kid, 'military', `A ${p.kind === 'settlers' ? 'settler party' : 'caravan'} was seized by ${k.name}.`, p.x, p.y);
      m.event(a.kid, 'military', `Your army seized an enemy ${p.kind === 'settlers' ? 'settler party' : 'caravan'}.`, p.x, p.y);
      break;
    }
  }
  st.armies = st.armies.filter((a) => total(a.units) >= 0.5);
}

export function declareWar(m, kid, other) {
  const a = m.state.kingdoms[kid];
  const b = m.state.kingdoms[other];
  if (!b || !b.alive || other === kid) return { error: 'No such kingdom.' };
  if (a.relations[other] === 'war') return { error: 'Already at war.' };
  if (m.state.t < 90) return { error: 'Kingdoms cannot declare war in the first minute and a half.' };
  a.relations[other] = 'war';
  b.relations[kid] = 'war';
  m.state.proposals = m.state.proposals.filter((p) => !((p.from === kid && p.to === other) || (p.from === other && p.to === kid)));
  m.pathCache.clear();
  m.tally('wars');
  m.event(-1, 'war', `${a.name} declares war on ${b.name}!`);
  return { ok: true };
}

export function offerPeace(m, kid, other) {
  const a = m.state.kingdoms[kid];
  const b = m.state.kingdoms[other];
  if (!b || a.relations[other] !== 'war') return { error: 'You are not at war with them.' };
  if (m.state.proposals.some((p) => p.peace && p.from === kid && p.to === other)) return { error: 'Peace already offered.' };
  m.state.proposals.push({ id: m.nextId(), peace: true, from: kid, to: other, t: m.state.t });
  m.event(other, 'proposal', `${a.name} offers peace.`);
  return { ok: true };
}

export function answerPeace(m, kid, id, accept) {
  const p = m.state.proposals.find((q) => q.id === id && q.peace);
  if (!p || p.to !== kid) return { error: 'No such offer.' };
  m.state.proposals = m.state.proposals.filter((q) => q !== p);
  if (!accept) {
    m.event(p.from, 'info', `${m.state.kingdoms[kid].name} rejects peace.`);
    return { ok: true };
  }
  makePeace(m, p.from, kid);
  return { ok: true };
}

export function makePeace(m, a, b) {
  const A = m.state.kingdoms[a];
  const Bk = m.state.kingdoms[b];
  A.relations[b] = 'peace';
  Bk.relations[a] = 'peace';
  m.pathCache.clear();
  // Armies standing in the other's land walk home.
  for (const army of m.state.armies) {
    const i = Math.round(army.y) * m.world.width + Math.round(army.x);
    const own = m.ownerK[i];
    if ((army.kid === a && own === b) || (army.kid === b && own === a)) retreat(m, army, 'must leave after the peace');
  }
  m.tally('peace');
  m.event(-1, 'peace', `${A.name} and ${Bk.name} make peace.`);
}
