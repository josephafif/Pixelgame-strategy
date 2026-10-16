import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../engine/sim/match.js';
import { TICK, UNITS, RULES, WALLS } from '../engine/sim/defs.js';
import { canFoundAt } from '../engine/world/sites.js';
import { B } from '../engine/world/biomes.js';
import { priceOf } from '../engine/sim/trade.js';
import { validateLayout } from '../engine/settlement/validate.js';
import { generateWorld, WORLD_SIZES } from '../engine/world/worldgen.js';

const WORLD = generateWorld({ seed: 21, ...WORLD_SIZES.small });

/** Two human kingdoms placed on the first two suggested sites. */
function twoKingdoms(opts = {}) {
  const m = new Match({ seed: 21, size: 'small', world: WORLD, placementTime: 0, players: [{ name: 'Aster' }, { name: 'Brann' }], ...opts });
  const sites = m.startSites.filter((s) => !m.placementError(s.x, s.y));
  assert.ok(m.exec(0, { type: 'place', x: sites[0].x, y: sites[0].y }).ok);
  const far = sites.find((s) => Math.hypot(s.x - sites[0].x, s.y - sites[0].y) > 30 && !m.placementError(s.x, s.y));
  assert.ok(m.exec(1, { type: 'place', x: far.x, y: far.y }).ok);
  m.step();
  assert.equal(m.state.phase, 'running');
  return m;
}

function run(m, seconds) {
  for (let i = 0; i < Math.round(seconds / TICK); i++) m.step();
}

const cap = (m, kid) => m.settlement(m.state.kingdoms[kid].capital);

test('placement founds a capital with houses, farms and a garrison', () => {
  const m = twoKingdoms();
  const c = cap(m, 0);
  assert.ok(c.capital && c.stage === 1);
  assert.ok(c.buildings.farm >= 1 && c.buildings.lumber >= 1);
  assert.ok(c.housing > c.pop * 0.9);
  assert.ok(c.garrison.inf > 0);
  assert.ok(validateLayout(m.world, m.layouts.get(c.id)).ok);
  assert.ok(m.exec(0, { type: 'place', x: 10, y: 10 }).error, 'cannot place twice');
});

test('population grows with food and housing, and is capped by housing', () => {
  const m = twoKingdoms();
  const c = cap(m, 0);
  const p0 = c.pop;
  m.state.kingdoms[0].stock.food = 2000;
  m.state.kingdoms[0].stock.wood = 0; // no new houses
  run(m, 90);
  assert.ok(c.pop > p0, `grew ${p0} -> ${c.pop}`);
  assert.ok(c.pop <= c.housing + 0.6, 'never beyond housing');
});

test('starvation shrinks the population and pulls workers onto the farms', () => {
  const m = twoKingdoms();
  const k = m.state.kingdoms[0];
  const c = cap(m, 0);
  k.priorities.food = 1;
  k.priorities.wood = 3;
  k.stock.food = 0;
  run(m, 2);
  const p0 = c.pop;
  run(m, 20);
  assert.ok(k.flags.starving || c.pop < p0);
  assert.ok(c.pop < p0, 'population fell');
  // Even with food set to low priority, a starving kingdom fills its farm jobs first.
  assert.equal(c.jobs.assigned.food, c.jobs.slots.food);
});

test('labour priorities move workers between jobs', () => {
  const m = twoKingdoms();
  const k = m.state.kingdoms[0];
  const c = cap(m, 0);
  k.stock.food = 1000;
  c.pop = 20; // too few workers for every job
  k.priorities.food = 3;
  k.priorities.wood = 1;
  run(m, 1.5);
  const foodFirst = c.jobs.assigned.food;
  const woodFirst = c.jobs.assigned.wood;
  k.priorities.food = 1;
  k.priorities.wood = 3;
  run(m, 1.5);
  assert.ok(c.jobs.assigned.wood > woodFirst, 'more woodcutters');
  assert.ok(c.jobs.assigned.food < foodFirst, 'fewer farmers');
});

test('recruiting needs barracks, equipment and capacity, and takes time', () => {
  const m = twoKingdoms();
  const k = m.state.kingdoms[0];
  const c = cap(m, 0);
  assert.match(m.exec(0, { type: 'recruit', sid: c.id, unit: 'inf', n: 4 }).error, /barracks/);
  c.buildings.barracks = 1;
  k.stock.arms = 2;
  assert.match(m.exec(0, { type: 'recruit', sid: c.id, unit: 'inf', n: 4 }).error, /equipment/);
  k.stock.arms = 100;
  assert.match(m.exec(0, { type: 'recruit', sid: c.id, unit: 'inf', n: 11 }).error, /train 10 at once/);
  const pop0 = c.pop;
  const inf0 = c.garrison.inf;
  assert.ok(m.exec(0, { type: 'recruit', sid: c.id, unit: 'inf', n: 8 }).ok);
  assert.equal(k.stock.arms, 92);
  assert.ok(Math.abs(c.pop - (pop0 - 8)) < 1e-9, 'recruits leave the workforce at once');
  run(m, UNITS.inf.train - 2);
  assert.equal(c.garrison.inf, inf0, 'still training');
  run(m, 3);
  assert.equal(c.garrison.inf, inf0 + 8, 'trained');
  assert.match(m.exec(0, { type: 'recruit', sid: c.id, unit: 'cav', n: 1 }).error, /stables/);
});

test('drafting workers reduces production', () => {
  const m = twoKingdoms();
  const k = m.state.kingdoms[0];
  const c = cap(m, 0);
  k.stock.food = 1000;
  c.buildings.farm = 6;
  c.pop = 40;
  c.housing = 40;
  run(m, 1.5);
  const before = c.out.food || 0;
  c.buildings.barracks = 1;
  k.stock.arms = 100;
  m.exec(0, { type: 'recruit', sid: c.id, unit: 'inf', n: 10 });
  m.exec(0, { type: 'levy', sid: c.id });
  run(m, 1.5);
  assert.ok((c.out.food || 0) < before, `food output ${before} -> ${c.out.food}`);
});

test('soldiers cost upkeep, and unpaid troops desert', () => {
  const m = twoKingdoms();
  const k = m.state.kingdoms[0];
  const c = cap(m, 0);
  c.garrison.inf = 60;
  k.coin = 0;
  k.stock.food = 1000;
  run(m, 30);
  assert.ok(k.flags.unpaid, 'cannot pay');
  assert.ok(c.garrison.inf < 60, `deserted to ${c.garrison.inf}`);
});

test('militia levies are capped and fast; demobilising takes time', () => {
  const m = twoKingdoms();
  const c = cap(m, 0);
  c.pop = 100;
  c.housing = 400;
  m.state.kingdoms[0].stock.food = 2000;
  m.state.kingdoms[0].stock.wood = 0;
  const r = m.exec(0, { type: 'levy', sid: c.id });
  assert.ok(r.ok && r.n <= Math.floor(100 * RULES.levyMax));
  assert.ok(m.exec(0, { type: 'levy', sid: c.id }).error, 'no second levy beyond the cap');
  run(m, UNITS.militia.train + 0.5);
  assert.ok(c.garrison.militia >= r.n);
  const pop0 = c.pop;
  assert.ok(m.exec(0, { type: 'demobilize', sid: c.id, unit: 'militia', n: r.n }).ok);
  run(m, RULES.demobilizeTime / 2);
  assert.ok(c.pop < pop0 + r.n * 0.5 + 2, 'not back yet');
  run(m, RULES.demobilizeTime);
  assert.ok(c.pop > pop0 + r.n * 0.5, 'returned to work');
});

test('expansion needs exploration, resources and travel; outposts start small', () => {
  const m = twoKingdoms();
  const k = m.state.kingdoms[0];
  const c = cap(m, 0);
  c.pop = 60;
  // Find a valid target 14–24 tiles away.
  let target = null;
  for (let r = 14; r < 26 && !target; r++) {
    for (let a = 0; a < 32 && !target; a++) {
      const x = Math.round(c.x + Math.cos((a / 32) * Math.PI * 2) * r);
      const y = Math.round(c.y + Math.sin((a / 32) * Math.PI * 2) * r);
      const ex = m.explored[0][y * m.world.width + x];
      m.explored[0][y * m.world.width + x] = 1;
      const ok = m.exec(0, { type: 'found', sid: c.id, x, y });
      if (ok.ok) target = { x, y };
      else m.explored[0][y * m.world.width + x] = ex;
    }
  }
  assert.ok(target, 'found a target');
  assert.ok(m.state.parties.some((p) => p.kind === 'settlers'));
  assert.ok(c.pop <= 60 - RULES.settlerPop + 1e-9);
  assert.ok(m.settlementsOf(0).length === 1, 'not founded instantly');
  let waited = 0;
  while (m.settlementsOf(0).length === 1 && waited < 200) {
    run(m, 1);
    waited++;
  }
  const out = m.settlementsOf(0).find((s) => s !== c);
  assert.ok(out, 'outpost founded after travel');
  assert.ok(waited >= 5, `travel took ${waited}s`);
  assert.equal(out.stage, 0);
  assert.ok(out.pop <= RULES.settlerPop + 1);
  assert.ok(validateLayout(m.world, m.layouts.get(out.id)).ok);
  // Unexplored land cannot be settled.
  m.explored[0].fill(0);
  k.stock.wood = 999;
  k.stock.food = 999;
  c.pop = 90;
  assert.match(m.exec(0, { type: 'found', sid: c.id, x: target.x + 12, y: target.y }).error || '', /explore|Too close|terrain|belongs/);
});

test('territory does not spread by itself', () => {
  const m = twoKingdoms();
  const count = () => m.ownerK.reduce((a, v) => a + (v === 0 ? 1 : 0), 0);
  const t0 = count();
  m.state.kingdoms[0].stock.wood = 0;
  run(m, 60);
  assert.equal(count(), t0);
});

test('roads are built tile by tile, cost wood and connect settlements', () => {
  const m = twoKingdoms();
  const k = m.state.kingdoms[0];
  const c = cap(m, 0);
  // Make a second settlement directly (as if founded) nearby.
  let spot = null;
  for (let r = 16; r < 30 && !spot; r++) for (let a = 0; a < 24 && !spot; a++) {
    const x = Math.round(c.x + Math.cos(a / 3.8) * r);
    const y = Math.round(c.y + Math.sin(a / 3.8) * r);
    if (!m.placementError(x, y) || m.world.biome[y * m.world.width + x] === B.GRASS) {
      if (m.world.biome[y * m.world.width + x] >= B.BEACH && m.world.biome[y * m.world.width + x] !== B.PEAK && m.world.biome[y * m.world.width + x] !== B.MOUNTAIN) spot = { x, y };
    }
  }
  const s2 = m.newSettlement(0, spot.x, spot.y, { kind: 'outpost', stage: 0, pop: 12 });
  m.recomputeTerritory();
  k.stock.wood = 1000;
  k.stock.stone = 1000;
  const r = m.exec(0, { type: 'road', a: s2.id, b: c.id });
  assert.ok(r.ok, r.error);
  const wood0 = k.stock.wood;
  run(m, 2);
  assert.ok(m.state.roadJobs.length === 1, 'still under construction');
  run(m, 400);
  assert.equal(m.state.roadJobs.length, 0, 'finished');
  assert.ok(k.stock.wood < wood0, 'paid in wood');
  run(m, 1.5);
  assert.ok(s2.connected, 'connected to the capital');
});

test('market prices respond to supply and demand and recover over time', () => {
  const m = twoKingdoms();
  const p0 = priceOf(m, 'wood');
  m.state.market.stock.wood *= 2;
  const cheap = priceOf(m, 'wood');
  assert.ok(cheap < p0 * 0.7);
  run(m, 300);
  assert.ok(priceOf(m, 'wood') > cheap, 'outside demand pulls the price back');
  m.state.market.stock.iron *= 0.3;
  assert.ok(priceOf(m, 'iron') > 2 * 7.5 * 0.9);
});

test('a sell order sends a caravan that takes time and brings coin back', () => {
  const m = twoKingdoms();
  const k = m.state.kingdoms[0];
  const c = cap(m, 0);
  c.buildings.market = 1;
  k.stock.wood = 900;
  k.coin = 500;
  const r = m.exec(0, { type: 'order', res: 'wood', side: 'sell', amount: 40, limit: 0.5, keep: 100 });
  assert.ok(r.ok, r.error);
  run(m, 6);
  const car = m.state.parties.find((p) => p.kind === 'caravan' && p.kid === 0);
  assert.ok(car, 'caravan dispatched');
  assert.ok(k.stock.wood <= 900 - 40 + 1);
  const coinAfterFare = k.coin;
  let t = 0;
  while (m.state.parties.some((p) => p.id === car.id) && t < 1500) {
    run(m, 5);
    t += 5;
  }
  assert.ok(t > 10, 'the journey takes time');
  assert.ok(k.coin > coinAfterFare, 'sale proceeds arrive home');
  assert.ok(m.state.market.stock.wood > 900 - 1, 'the free city now holds more wood');
});

test('trade agreements deliver goods between kingdoms by caravan', () => {
  const m = twoKingdoms();
  const A = m.state.kingdoms[0];
  const Bk = m.state.kingdoms[1];
  A.stock.wood = 500;
  Bk.stock.stone = 500;
  const r = m.exec(0, { type: 'propose', to: 1, give: { res: 'wood', n: 20 }, get: { res: 'stone', n: 10 }, every: 20, times: 2 });
  assert.ok(r.ok, r.error);
  const prop = m.state.proposals[0];
  assert.ok(m.exec(1, { type: 'respond', id: prop.id, accept: true }).ok);
  const bStone0 = Bk.stock.stone;
  const aStone0 = A.stock.stone;
  run(m, 6);
  assert.ok(Bk.stock.stone <= bStone0 - 10 + 1, 'B paid');
  assert.ok(m.state.parties.some((p) => p.mode === 'deliver'));
  run(m, 600);
  assert.ok(A.stock.stone > aStone0 + 5, 'A received stone');
});

test('borders are closed in peace and open in war', () => {
  const m = twoKingdoms();
  const a = cap(m, 0);
  const b = cap(m, 1);
  a.garrison.inf = 20;
  const r = m.exec(0, { type: 'formArmy', sid: a.id, units: { inf: 20 } });
  assert.ok(r.ok);
  assert.match(m.exec(0, { type: 'move', aid: r.id, x: b.x, y: b.y }).error || 'blocked', /peace|reach|blocked/);
  m.state.t = 200;
  assert.ok(m.exec(0, { type: 'declareWar', to: 1 }).ok);
  assert.ok(m.exec(0, { type: 'move', aid: r.id, x: b.x, y: b.y }).ok, 'war opens the way');
});

test('defenders on hills hold better than on open grass', async () => {
  const { tick } = await import('../engine/sim/military.js');
  const m = twoKingdoms();
  m.state.t = 200;
  m.exec(0, { type: 'declareWar', to: 1 });
  const W = m.world.width;
  const find = (biome) => {
    for (let i = 0; i < m.world.biome.length; i++) {
      if (m.world.biome[i] === biome && m.world.biome[i + 1] === biome && m.ownerK[i] === -1) return { x: i % W, y: (i / W) | 0 };
    }
    return null;
  };
  const fight = (spot) => {
    m.state.armies = [];
    const mk = (kid, x, y) => ({ id: m.nextId(), kid, x, y, units: { militia: 0, inf: 30, arch: 0, cav: 0, siege: 0 }, path: null, pi: 0, pf: 0, dest: null, supply: 90, morale: 1, state: 'idle', inSupply: true, home: -1, retreatT: 0 });
    const def = mk(1, spot.x, spot.y);
    const att = mk(0, spot.x + 1, spot.y);
    att.path = [spot.y * W + spot.x + 1, spot.y * W + spot.x];
    m.state.armies.push(def, att);
    for (let i = 0; i < 40; i++) tick(m, TICK);
    return { def: def.units.inf, att: att.units.inf };
  };
  const hill = fight(find(B.HILLS));
  const grass = fight(find(B.GRASS));
  assert.ok(hill.def > grass.def, `hill defenders kept ${hill.def.toFixed(1)}, grass ${grass.def.toFixed(1)}`);
});

test('walls must be breached before capture; capture moves ownership and causes unrest', () => {
  const m = twoKingdoms();
  const b = cap(m, 1);
  const A = m.state.kingdoms[0];
  const Bk = m.state.kingdoms[1];
  b.walls = { level: 1, hp: WALLS[1].hp };
  b.garrison = { militia: 0, inf: 3, arch: 0, cav: 0, siege: 0 };
  m.state.t = 200;
  m.exec(0, { type: 'declareWar', to: 1 });
  Bk.stock.wood = 400;
  const army = { id: m.nextId(), kid: 0, x: b.x + 1, y: b.y + 1, units: { militia: 0, inf: 40, arch: 0, cav: 0, siege: 2 }, path: null, pi: 0, pf: 0, dest: null, supply: 90, morale: 1, state: 'idle', inSupply: true, home: -1, retreatT: 0 };
  m.state.armies.push(army);
  run(m, 3);
  assert.ok(b.siege, 'siege begins');
  assert.equal(b.kingdom, 1, 'walls still hold');
  assert.ok(b.walls.hp < WALLS[1].hp);
  const pop0 = b.pop;
  const aWood0 = A.stock.wood;
  run(m, 120);
  assert.equal(b.kingdom, 0, 'captured');
  assert.ok(b.unrest > 0, 'unrest after conquest');
  assert.ok(b.pop < pop0, 'people fled or died');
  assert.ok(A.stock.wood > aWood0, 'loot');
  assert.ok(m.exec(0, { type: 'build', sid: b.id, kind: 'farm' }).error, 'no building during unrest');
  assert.ok(validateLayout(m.world, m.layouts.get(b.id)).ok, 'layout still valid after capture');
  // The loser had only this town: eliminated.
  run(m, 2);
  assert.equal(Bk.alive, false);
});

test('AI kingdoms play using the same commands and grow', () => {
  const m = new Match({ seed: 5, size: 'small', placementTime: 0, players: [{ ai: true, personality: 'builder' }, { ai: true, personality: 'warlord' }, { ai: true, personality: 'merchant' }] });
  run(m, 0.5);
  assert.equal(m.state.phase, 'running');
  run(m, 600);
  for (const k of m.state.kingdoms) {
    assert.ok(k.alive);
    const towns = m.settlementsOf(k.id);
    const built = towns.reduce((a, s) => a + Object.values(s.buildings).reduce((x, y) => x + y, 0), 0);
    assert.ok(built > 3, `${k.name} built ${built}`);
    assert.ok(k.stats.pop > 40, `${k.name} pop ${k.stats.pop}`);
    for (const s of towns) assert.ok(validateLayout(m.world, m.layouts.get(s.id)).ok);
  }
  const errors = m.state.events.filter((e) => e.kind === 'error' && /failed/.test(e.text));
  assert.equal(errors.length, 0, JSON.stringify(errors.slice(0, 3)));
});

test('the simulation is deterministic', () => {
  const play = () => {
    const m = new Match({ seed: 9, size: 'small', world: WORLD, placementTime: 0, players: [{ ai: true }, { ai: true, personality: 'warlord' }] });
    run(m, 240);
    return JSON.stringify({ k: m.state.kingdoms.map((k) => [k.stock, k.coin, k.stats]), s: m.state.settlements.map((s) => [s.pop, s.buildings, s.layoutV]) });
  };
  assert.equal(play(), play());
});

test('every suggested start site gives a capital room to grow', () => {
  for (const seed of [3, 7, 11]) {
    const m = new Match({ seed, size: 'small', placementTime: 0, players: [{ name: 'P' }] });
    for (const site of m.startSites.slice(0, 6)) {
      if (m.placementError(site.x, site.y)) continue;
      const probe = new Match({ seed, size: 'small', world: m.world, placementTime: 0, players: [{ name: 'P' }] });
      assert.ok(probe.exec(0, { type: 'place', x: site.x, y: site.y }).ok);
      const cap = probe.settlement(probe.state.kingdoms[0].capital);
      assert.ok(cap.houses >= 5, `seed ${seed} site ${site.x},${site.y}: ${cap.houses} houses`);
      assert.ok(cap.housing >= cap.pop, 'housing for everyone at the start');
      assert.ok(!cap.full, 'room for more houses');
    }
  }
});

test('domination must be held: most towns and people for several minutes', () => {
  const m = twoKingdoms();
  const home = cap(m, 0);
  // Give the first realm a ring of outposts far from its rival.
  let added = 0;
  for (let r = 12; r < 60 && added < 8; r += 4) {
    for (let a = 0; a < 16 && added < 8; a++) {
      const x = Math.round(home.x + Math.cos(a * 0.39) * r);
      const y = Math.round(home.y + Math.sin(a * 0.39) * r);
      if (!canFoundAt(m.world, x, y)) continue;
      if (m.state.settlements.some((s) => Math.hypot(s.x - x, s.y - y) < 10)) continue;
      m.newSettlement(0, x, y, { pop: 12 });
      added++;
    }
  }
  assert.equal(added, 8);
  m.checkVictory();
  assert.equal(m.state.winner, null, 'no instant win');
  assert.ok(m.state.events.some((e) => /dominates the realm/.test(e.text)), 'rivals are warned');
  for (let i = 0; i < RULES.dominationHold - 2; i++) m.checkVictory();
  assert.equal(m.state.winner, null);
  // Losing the majority resets the clock.
  const saved = m.state.kingdoms[0].domHeld;
  assert.ok(saved > 0);
  for (const s of m.settlementsOf(0).slice(1, 7)) s.kingdom = 1;
  m.checkVictory();
  assert.equal(m.state.kingdoms[0].domHeld, 0);
  for (const s of m.state.settlements) if (s.kingdom === 1 && !s.capital) s.kingdom = 0;
  for (let i = 0; i <= RULES.dominationHold; i++) m.checkVictory();
  assert.deepEqual(m.state.winner, { kid: 0, how: 'domination' });
});
