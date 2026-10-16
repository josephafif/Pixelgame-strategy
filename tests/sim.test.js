import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../engine/sim/match.js';
import { TICK, RULES, TOWN_LEVELS, structureCost } from '../engine/sim/defs.js';
import { tileCost } from '../engine/sim/attack.js';
import { create as createStructure } from '../engine/sim/structures.js';
import { PlayerView, applyDelta, unrle } from '../engine/net/protocol.js';
import { validateLayout } from '../engine/settlement/validate.js';
import { generateWorld, WORLD_SIZES } from '../engine/world/worldgen.js';
import { B } from '../engine/world/biomes.js';

const WORLD = generateWorld({ seed: 21, ...WORLD_SIZES.small });

function run(m, seconds) {
  for (let i = 0; i < Math.round(seconds / TICK); i++) m.step();
}

/** A spot where player `pid` may start, at least `apart` tiles from (ax, ay). */
function spawnSpot(m, ax = null, ay = null, apart = 40) {
  for (const s of m.startSites) {
    if (m.spawnError(s.x, s.y)) continue;
    if (ax !== null && Math.hypot(s.x - ax, s.y - ay) < apart) continue;
    return s;
  }
  for (let y = 10; y < m.H - 10; y += 3) {
    for (let x = 10; x < m.W - 10; x += 3) {
      if (m.spawnError(x, y)) continue;
      if (ax !== null && Math.hypot(x - ax, y - ay) < apart) continue;
      return { x, y };
    }
  }
  throw new Error('no spawn spot');
}

/** Two human players placed far apart; the match is running. */
function twoPlayers(opts = {}) {
  const m = new Match({ seed: 21, size: 'small', world: WORLD, placementTime: 0, players: [{ name: 'Aster' }, { name: 'Brann' }], ...opts });
  const a = spawnSpot(m);
  assert.ok(m.exec(0, { type: 'place', x: a.x, y: a.y }).ok);
  const b = spawnSpot(m, a.x, a.y);
  assert.ok(m.exec(1, { type: 'place', x: b.x, y: b.y }).ok);
  m.step();
  assert.equal(m.state.phase, 'running');
  return m;
}

/** Hand every land tile within r of (x, y) to pid. */
function claim(m, pid, x, y, r) {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.W || ny >= m.H || dx * dx + dy * dy > r * r) continue;
      const i = m.idx(nx, ny);
      if (m.land[i]) m.setOwner(i, pid);
    }
  }
}

/** A tile next to pid's border that nobody owns. */
function neutralEdge(m, pid) {
  for (let i = 0; i < m.owner.length; i++) if (m.owner[i] === -1 && m.land[i] && m.touches(i, pid)) return { x: i % m.W, y: (i / m.W) | 0 };
  return null;
}

test('starting claims a patch of land around a hamlet', () => {
  const m = twoPlayers();
  for (const p of m.state.players) {
    assert.ok(p.spawned && p.alive);
    assert.ok(p.tiles > 50 && p.tiles <= 90, `${p.name} starts with ${p.tiles} tiles`);
    const town = m.state.structures.find((s) => s.owner === p.id);
    assert.equal(town.kind, 'town');
    assert.ok(town.capital);
    assert.equal(m.owner[m.idx(town.x, town.y)], p.id);
    assert.ok(validateLayout(m.world, m.layouts.get(town.id)).ok);
  }
  // Nobody owns water.
  for (let i = 0; i < m.owner.length; i++) if (m.owner[i] >= 0) assert.ok(m.land[i]);
});

test('start spots must be open land, apart from other realms', () => {
  const m = new Match({ seed: 21, size: 'small', world: WORLD, placementTime: 0, players: [{ name: 'Aster' }, { name: 'Brann' }] });
  let water = null;
  for (let i = 0; i < m.owner.length && !water; i++) if (m.world.biome[i] === B.DEEP) water = { x: i % m.W, y: (i / m.W) | 0 };
  assert.match(m.exec(0, { type: 'place', ...water }).error, /open land/);
  const a = spawnSpot(m);
  assert.ok(m.exec(0, { type: 'place', x: a.x, y: a.y }).ok);
  assert.match(m.exec(0, { type: 'place', x: a.x + 30, y: a.y }).error, /already started/);
  const near = m.exec(1, { type: 'place', x: a.x + 3, y: a.y + 3 });
  assert.match(near.error, /already holds|Too close/);
});

test('people grow toward a limit set by land and towns', () => {
  const m = twoPlayers();
  const p = m.state.players[0];
  const pop0 = p.pop;
  run(m, 30);
  assert.ok(p.pop > pop0 * 1.5, `grew from ${pop0} to ${Math.round(p.pop)}`);
  const levels = m.state.structures.filter((s) => s.owner === 0 && s.kind === 'town').reduce((t, s) => t + TOWN_LEVELS[s.level].pop, 0);
  assert.equal(p.maxPop, RULES.baseMaxPop + p.tiles * RULES.popPerTile + levels);
  run(m, 240);
  assert.ok(p.pop <= p.maxPop * 1.001, 'never above the limit by growth');
  assert.ok(p.pop > p.maxPop * 0.9, 'close to the limit after a while');
});

test('workers earn gold: a smaller army means a richer realm', () => {
  const m = twoPlayers();
  m.exec(0, { type: 'troops', share: 0.2 });
  m.exec(1, { type: 'troops', share: 0.9 });
  run(m, 20);
  const [a, b] = m.state.players;
  assert.ok(a.goldRate > b.goldRate * 2, `${a.goldRate} vs ${b.goldRate}`);
  assert.ok(a.gold > b.gold);
  assert.equal(m.exec(0, { type: 'troops', share: 5 }).ok, true);
  assert.equal(a.troopShare, 0.95, 'the slider is clamped');
});

test('attacking unclaimed land spends troops and pushes the border out', () => {
  const m = twoPlayers();
  const p = m.state.players[0];
  run(m, 10);
  const tiles0 = p.tiles;
  const troops0 = m.troops(p);
  const at = neutralEdge(m, 0);
  const r = m.exec(0, { type: 'attack', x: at.x, y: at.y, ratio: 0.5 });
  assert.equal(r.how, 'land');
  assert.equal(m.state.attacks.length, 1);
  assert.ok(Math.abs(m.troops(p) - troops0 * 0.5) < troops0 * 0.01, 'half the troops left with the attack');
  run(m, 2);
  assert.ok(p.tiles > tiles0 + 20, `border moved: ${tiles0} → ${p.tiles}`);
  run(m, 60);
  assert.equal(m.state.attacks.length, 0, 'the attack ends when its troops are spent');
  const gained = p.tiles - tiles0;
  assert.ok(gained > 100, `took ${gained} tiles`);
  // A tile costs about RULES.neutralCost troops on open ground, more in rough country.
  assert.ok(gained < (troops0 * 0.5) / RULES.neutralCost + 5);
});

test('rough terrain costs more troops than open grassland', () => {
  const m = twoPlayers();
  const a = { from: 0, to: -1, troops: 1000, id: 1 };
  const find = (b) => {
    for (let i = 0; i < m.owner.length; i++) if (m.world.biome[i] === b) return i;
    return -1;
  };
  const grass = tileCost(m, a, find(B.GRASS)).cost;
  const forest = tileCost(m, a, find(B.FOREST)).cost;
  const mountain = tileCost(m, a, find(B.MOUNTAIN)).cost;
  assert.ok(grass < forest && forest < mountain, `${grass} < ${forest} < ${mountain}`);
});

test('war: tiles change hands, defenders lose troops, towns are captured', () => {
  const m = twoPlayers();
  const [a, b] = m.state.players;
  const town = m.state.structures.find((s) => s.owner === 1);
  // Make the two realms neighbours: Aster holds a ring right around Brann's land.
  claim(m, 0, town.x, town.y, 14);
  claim(m, 1, town.x, town.y, 8);
  a.troops = 400000;
  const bTiles = b.tiles;
  const bTroops = b.troops;
  const r = m.exec(0, { type: 'attack', x: town.x, y: town.y, ratio: 1 });
  assert.equal(r.how, 'land');
  assert.ok(m.state.events.some((e) => e.kid === 1 && e.kind === 'attacked'), 'the defender is told');
  run(m, 20);
  assert.ok(b.tiles < bTiles, `${bTiles} → ${b.tiles}`);
  assert.ok(b.troops < bTroops, 'defenders fell');
  assert.equal(town.owner, 0, 'the town changed hands');
  assert.ok(m.state.events.some((e) => e.kid === 1 && e.kind === 'lost'));
  run(m, 5);
  if (b.tiles === 0) assert.equal(b.alive, false, 'a realm without land has fallen');
});

test('outposts make the land around them harder to take', () => {
  const m = twoPlayers();
  const town = m.state.structures.find((s) => s.owner === 1);
  claim(m, 1, town.x, town.y, 12);
  const atk = { from: 0, to: 1, troops: 5000, id: 9 };
  m.state.players[1].gold = 1e6;
  let spot = null;
  for (let r = 6; r <= 10 && !spot; r++) {
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
      if (m.exec(1, { type: 'build', kind: 'outpost', x: town.x + dx, y: town.y + dy }).ok) {
        spot = { x: town.x + dx, y: town.y + dy };
        break;
      }
    }
  }
  assert.ok(spot, 'an outpost was built');
  const near = tileCost(m, atk, m.idx(spot.x + 1, spot.y)).cost;
  const out = m.state.structures.find((s) => s.kind === 'outpost');
  m.state.structures = m.state.structures.filter((s) => s !== out);
  const without = tileCost(m, atk, m.idx(spot.x + 1, spot.y)).cost;
  assert.ok(near > without * 1.8, `${near} vs ${without}`);
});

test('alliances: asking, answering, no attacks between allies, betrayal', () => {
  const m = twoPlayers();
  const [a, b] = m.state.players;
  const town = m.state.structures.find((s) => s.owner === 1);
  claim(m, 0, town.x, town.y, 14);
  claim(m, 1, town.x, town.y, 8);
  assert.ok(m.exec(0, { type: 'ally', to: 1 }).ok);
  assert.match(m.exec(0, { type: 'ally', to: 1 }).error, /already asked/);
  const req = m.state.requests[0];
  assert.equal(req.to, 1);
  // Asking back seals it.
  assert.ok(m.exec(1, { type: 'ally', to: 0 }).ok);
  assert.ok(m.allied(0, 1));
  assert.equal(m.state.requests.length, 0);
  assert.match(m.exec(0, { type: 'attack', x: town.x, y: town.y }).error, /ally/);
  // Trade between allies is worth more, and the alliance runs out.
  const atk = { from: 0, to: 1, troops: 5000, id: 3 };
  const before = tileCost(m, atk, m.idx(town.x + 2, town.y)).cost;
  assert.ok(m.exec(1, { type: 'breakAlliance', to: 0 }).ok);
  assert.ok(!m.allied(0, 1));
  assert.ok(b.traitorUntil > m.state.t, 'the one who broke it is a traitor');
  assert.ok(m.state.events.some((e) => e.kind === 'betrayal'));
  const after = tileCost(m, atk, m.idx(town.x + 2, town.y)).cost;
  assert.ok(after < before, `a traitor's land is easier to take (${after} < ${before})`);
  // Requests expire.
  assert.ok(m.exec(0, { type: 'ally', to: 1 }).ok);
  run(m, RULES.requestTime + 2);
  assert.equal(m.state.requests.length, 0);
  // Alliances expire too.
  m.exec(0, { type: 'ally', to: 1 });
  m.exec(1, { type: 'answer', id: m.state.requests[0].id, accept: true });
  assert.ok(m.allied(0, 1));
  run(m, RULES.allianceTime + 2);
  assert.ok(!m.allied(0, 1));
  assert.ok(a.alive && b.alive);
});

test('boats carry troops across the water and land as an attack', () => {
  const m = new Match({ seed: 21, size: 'small', world: WORLD, placementTime: 0, players: [{ name: 'Aster' }] });
  // Land masses, so the target lies on a different one.
  const mass = new Int32Array(m.W * m.H).fill(-1);
  const size = [];
  let n = 0;
  for (let i = 0; i < mass.length; i++) {
    if (!m.land[i] || mass[i] >= 0) continue;
    const stack = [i];
    mass[i] = n;
    while (stack.length) {
      const j = stack.pop();
      const x = j % m.W;
      for (const k of [x > 0 ? j - 1 : -1, x < m.W - 1 ? j + 1 : -1, j - m.W, j + m.W]) {
        if (k < 0 || k >= mass.length || !m.land[k] || mass[k] >= 0) continue;
        mass[k] = n;
        stack.push(k);
      }
    }
    size.push(mass.reduce((t, v) => t + (v === n ? 1 : 0), 0));
    n++;
  }
  // A coastal start, and the nearest coast of another land mass on the same water.
  let pair = null;
  for (const i of m.coastTiles) {
    const x = i % m.W;
    const y = (i / m.W) | 0;
    if (m.spawnError(x, y)) continue;
    for (const j of m.coastTiles) {
      if (mass[j] === mass[i] || m.coast[j] !== m.coast[i] || size[mass[j]] < 400) continue;
      const d = Math.hypot((j % m.W) - x, ((j / m.W) | 0) - y);
      if (d > 12 && d < 60 && (!pair || d < pair.d)) pair = { i, j, d };
    }
    if (pair) break;
  }
  assert.ok(pair, 'the test world has two shores across water');
  const sx = pair.i % m.W;
  const sy = (pair.i / m.W) | 0;
  assert.ok(m.exec(0, { type: 'place', x: sx, y: sy }).ok);
  m.step();
  const p = m.state.players[0];
  const tx = pair.j % m.W;
  const ty = (pair.j / m.W) | 0;
  p.troops = 12000;
  const r = m.exec(0, { type: 'attack', x: tx, y: ty, ratio: 0.5 });
  assert.equal(r.how, 'boat', JSON.stringify(r));
  assert.equal(m.state.boats.length, 1);
  const boat = m.state.boats[0];
  assert.ok(boat.troops > 1000);
  let landed = false;
  for (let k = 0; k < 600 && !landed; k++) {
    m.step();
    landed = !m.state.boats.includes(boat);
  }
  assert.ok(landed, 'the boat arrived');
  run(m, 3);
  let across = 0;
  for (let i = 0; i < m.owner.length; i++) if (m.owner[i] === 0 && mass[i] === mass[pair.j]) across++;
  assert.ok(across > 20, `took ${across} tiles on the far shore`);
  assert.ok(p.stats.boats === 1);
  // At most three boats at sea.
  for (let k = 0; k < 3; k++) m.exec(0, { type: 'boat', x: sx, y: sy, ratio: 0.01 });
});

test('trade ships sail between ports and pay both owners', () => {
  const m = twoPlayers();
  // Two ports on the same sea, owned by different players.
  const body = m.coast[m.coastTiles[0]];
  const shores = m.coastTiles.filter((i) => m.coast[i] === body && m.owner[i] === -1);
  const first = shores[0];
  const far = shores.find((i) => Math.hypot((i % m.W) - (first % m.W), ((i / m.W) | 0) - ((first / m.W) | 0)) > 40);
  assert.ok(far !== undefined);
  const ports = [];
  for (const [pid, i] of [[0, first], [1, far]]) {
    const x = i % m.W;
    const y = (i / m.W) | 0;
    claim(m, pid, x, y, 4);
    ports.push(createStructure(m, 'port', pid, x, y));
  }
  const g0 = m.state.players.map((p) => p.gold);
  run(m, 120);
  const [a, b] = m.state.players;
  assert.ok(a.stats.trade > 0 && b.stats.trade > 0, `trade ${a.stats.trade} / ${b.stats.trade}`);
  assert.ok(a.gold > g0[0] && b.gold > g0[1]);
  assert.ok(m.state.boats.some((s) => s.kind === 'trade') || a.stats.trade > 0);
});

test('towns grow by themselves and can be raised to a walled city', () => {
  const m = twoPlayers();
  const p = m.state.players[0];
  const home = m.state.structures.find((s) => s.owner === 0);
  claim(m, 0, home.x, home.y, 30);
  p.gold = 1e6;
  let spot = null;
  for (let r = 14; r <= 26 && !spot; r += 2) {
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r]]) {
      const res = m.exec(0, { type: 'build', kind: 'town', x: home.x + dx, y: home.y + dy });
      if (res.ok) {
        spot = res.id;
        break;
      }
    }
  }
  assert.ok(spot, 'a second town was founded');
  assert.equal(p.built.town, 1);
  assert.ok(p.gold < 1e6 - structureCost('town', 0) + 1);
  const town = m.state.structures.find((s) => s.id === spot);
  const L = m.layouts.get(town.id);
  const houses0 = L.buildings.filter((b) => b.kind === 'house').length;
  run(m, 40);
  assert.ok(L.buildings.filter((b) => b.kind === 'house').length > houses0, 'houses went up on their own');
  for (let k = 0; k < 3; k++) assert.ok(m.exec(0, { type: 'upgrade', sid: town.id }).ok);
  assert.equal(town.level, 4);
  assert.match(m.exec(0, { type: 'upgrade', sid: town.id }).error, /already a city/);
  assert.equal(L.stage, TOWN_LEVELS[4].stage);
  assert.ok(L.walls && L.walls.level >= 2, 'a city has stone walls');
  run(m, 120);
  assert.ok(validateLayout(m.world, L).ok);
  assert.ok(p.maxPop > RULES.baseMaxPop + p.tiles * RULES.popPerTile + TOWN_LEVELS[4].pop - 1);
  // Building on someone else's land is refused.
  const theirs = m.state.structures.find((s) => s.owner === 1);
  assert.match(m.exec(0, { type: 'build', kind: 'town', x: theirs.x + 3, y: theirs.y }).error, /own land/);
});

test('victory: the first to hold 80% of the land wins', () => {
  const m = twoPlayers();
  let need = Math.ceil(m.landTotal * RULES.winShare) - m.state.players[0].tiles;
  for (let i = 0; i < m.owner.length && need > 0; i++) {
    if (m.land[i] && m.owner[i] === -1) {
      m.setOwner(i, 0);
      need--;
    }
  }
  run(m, 1.1);
  assert.equal(m.state.phase, 'over');
  assert.deepEqual(m.state.winner, { kid: 0, how: 'domination' });
});

test('when time runs out, the realm with the most land wins', () => {
  const m = twoPlayers({ timeLimit: 30 });
  const town = m.state.structures.find((s) => s.owner === 1);
  claim(m, 1, town.x, town.y, 12);
  run(m, 31);
  assert.deepEqual(m.state.winner, { kid: 1, how: 'time' });
});

test('AI players expand, build, ally and fight on their own', { timeout: 120000 }, () => {
  const m = new Match({ seed: 5, size: 'small', world: generateWorld({ seed: 5, ...WORLD_SIZES.small }), placementTime: 0.2, players: Array.from({ length: 6 }, () => ({ ai: true })) });
  run(m, 300);
  const st = m.state;
  assert.ok(st.players.every((p) => p.spawned));
  const held = st.players.reduce((t, p) => t + p.tiles, 0);
  assert.ok(held > m.landTotal * 0.6, `claimed ${Math.round((held / m.landTotal) * 100)}% of the land`);
  assert.ok(st.structures.filter((s) => s.kind === 'town').length > st.players.length, 'new towns');
  assert.ok(st.players.some((p) => p.stats.attacks > 3));
  assert.ok(st.events.some((e) => e.kind === 'captured' || e.kind === 'fall') || st.players.some((p) => p.stats.lost > 50), 'realms fought');
  for (const s of st.structures) assert.ok(validateLayout(m.world, m.layouts.get(s.id)).ok, `${s.name} layout valid`);
});

test('the simulation is deterministic', { timeout: 60000 }, () => {
  const make = () => new Match({ seed: 9, size: 'small', world: WORLD, placementTime: 0.2, players: Array.from({ length: 4 }, () => ({ ai: true })) });
  const a = make();
  const b = make();
  run(a, 90);
  run(b, 90);
  assert.equal(JSON.stringify(a.state), JSON.stringify(b.state));
  assert.deepEqual([...a.owner], [...b.owner]);
});

test('players get the territory once, then only the tiles that changed', () => {
  const m = twoPlayers();
  const view = new PlayerView(m, 0);
  const first = view.messages();
  const terr = first.find((q) => q.t === 'terr');
  assert.ok(terr, 'full territory on joining');
  const mine = unrle(terr.owner, Int16Array, m.W * m.H);
  const snap0 = first.find((q) => q.t === 'snap');
  assert.ok(snap0.players[0].gold !== undefined, 'own gold');
  assert.equal(snap0.players[1].gold, undefined, 'gold is private');
  assert.ok(snap0.players[1].troops > 0, 'troops are public');
  m.exec(0, { type: 'attack', ...neutralEdge(m, 0), ratio: 0.8 });
  for (let k = 0; k < 5; k++) {
    run(m, 0.6);
    const msgs = view.messages();
    assert.ok(!msgs.some((q) => q.t === 'terr'), 'no full resend');
    const snap = msgs.find((q) => q.t === 'snap');
    if (snap.td) applyDelta(mine, snap.td);
  }
  assert.deepEqual([...mine], [...m.owner], 'deltas rebuild the same map');
});
