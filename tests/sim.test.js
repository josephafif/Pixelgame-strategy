import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../engine/sim/match.js';
import { TICK, RULES, TOWN_LEVELS, UNITS, structureCost, garrisonMax, guardRadius } from '../engine/sim/defs.js';
import { create as createStructure } from '../engine/sim/structures.js';
import { findPath, landPart } from '../engine/sim/units.js';
import { PlayerView, applyDelta, unrle } from '../engine/net/protocol.js';
import { validateLayout } from '../engine/settlement/validate.js';
import { generateWorld, WORLD_SIZES } from '../engine/world/worldgen.js';
import { B } from '../engine/world/biomes.js';

const WORLD = generateWorld({ seed: 21, ...WORLD_SIZES.small });

function run(m, seconds) {
  for (let i = 0; i < Math.round(seconds / TICK); i++) m.step();
}

/** A spot where a player may start, at least `apart` tiles from (ax, ay). */
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

/** Open, walkable ground near (x, y) at least `min` tiles away. */
function openGround(m, x, y, min = 6, max = 30, owner = null) {
  for (let r = min; r <= max; r++) {
    for (let a = 0; a < 16; a++) {
      const tx = Math.round(x + Math.cos((a / 16) * Math.PI * 2) * r);
      const ty = Math.round(y + Math.sin((a / 16) * Math.PI * 2) * r);
      if (tx < 2 || ty < 2 || tx >= m.W - 2 || ty >= m.H - 2) continue;
      const i = m.idx(tx, ty);
      const b = m.world.biome[i];
      if (!m.land[i] || b === B.PEAK || b === B.MOUNTAIN || b === B.RIVER) continue;
      if (owner !== null && m.owner[i] !== owner) continue;
      return { x: tx, y: ty };
    }
  }
  throw new Error('no open ground');
}

/** Put a squad on the map directly (for combat tests). */
function squad(m, owner, type, n, x, y) {
  const sq = { id: m.nextId(), owner, type, n, x, y, post: [x, y], path: null, pi: 0, pf: 0, state: 'idle', dest: null, cp: 0, born: m.state.t };
  m.state.squads.push(sq);
  return sq;
}

const home = (m, pid) => m.state.structures.find((s) => s.owner === pid && s.capital) || m.state.structures.find((s) => s.owner === pid);

test('starting claims land around a hamlet with a small army at its gate', () => {
  const m = twoPlayers();
  for (const p of m.state.players) {
    assert.ok(p.spawned && p.alive);
    assert.ok(p.tiles > 60 && p.tiles <= 130, `${p.name} starts with ${p.tiles} tiles`);
    const town = home(m, p.id);
    assert.equal(town.kind, 'town');
    assert.ok(town.capital);
    assert.equal(town.garrison, garrisonMax(town));
    assert.ok(validateLayout(m.world, m.layouts.get(town.id)).ok);
    const army = m.state.squads.filter((q) => q.owner === p.id);
    assert.deepEqual(army.map((q) => [q.type, q.n]), RULES.startArmy);
    for (const q of army) assert.ok(Math.hypot(q.x - town.x, q.y - town.y) < 3);
    assert.equal(p.gold > RULES.startGold - 1, true);
  }
  for (let i = 0; i < m.owner.length; i++) if (m.owner[i] >= 0) assert.ok(m.land[i], 'nobody owns water');
});

test('start spots must be open land, apart from other realms', () => {
  const m = new Match({ seed: 21, size: 'small', world: WORLD, placementTime: 0, players: [{ name: 'Aster' }, { name: 'Brann' }] });
  let water = null;
  for (let i = 0; i < m.owner.length && !water; i++) if (m.world.biome[i] === B.DEEP) water = { x: i % m.W, y: (i / m.W) | 0 };
  assert.match(m.exec(0, { type: 'place', ...water }).error, /open land/);
  const a = spawnSpot(m);
  assert.ok(m.exec(0, { type: 'place', x: a.x, y: a.y }).ok);
  assert.match(m.exec(0, { type: 'place', x: a.x + 30, y: a.y }).error, /already started/);
  assert.match(m.exec(1, { type: 'place', x: a.x + 3, y: a.y + 3 }).error, /already holds|Too close/);
});

test('people grow toward a limit set by land and towns, and earn gold', () => {
  const m = twoPlayers();
  const p = m.state.players[0];
  const pop0 = p.pop;
  const gold0 = p.gold;
  run(m, 30);
  assert.ok(p.pop > pop0 * 1.3, `grew from ${pop0} to ${Math.round(p.pop)}`);
  const towns = m.state.structures.filter((s) => s.owner === 0 && s.kind === 'town').reduce((t, s) => t + TOWN_LEVELS[s.level].pop, 0);
  assert.equal(p.maxPop, RULES.baseMaxPop + p.tiles * RULES.popPerTile + towns);
  assert.ok(p.gold > gold0, 'gold comes in');
  run(m, 240);
  assert.ok(p.pop <= p.maxPop * 1.001, 'never above the limit by growth');
  assert.ok(p.pop > p.maxPop * 0.85, 'close to the limit after a while');
});

test('soldiers are raised at the nearest town or outpost and march where they are sent', () => {
  const m = twoPlayers();
  const p = m.state.players[0];
  const town = home(m, 0);
  p.gold = 5000;
  const to = openGround(m, town.x, town.y, 14, 30);
  const gold = p.gold;
  const pop = p.pop;
  const r = m.exec(0, { type: 'deploy', unit: 'shield', n: 20, x: to.x, y: to.y });
  assert.ok(r.ok, r.error);
  assert.equal(r.from, town.id);
  assert.equal(p.gold, gold - UNITS.shield.cost * 20);
  assert.equal(p.pop, pop - 20);
  const sq = m.state.squads.find((q) => q.id === r.id);
  assert.equal(sq.state, 'moving');
  assert.ok(Math.hypot(sq.x - town.x, sq.y - town.y) < 1, 'it starts at the town');
  run(m, 60);
  assert.equal(sq.state, 'idle', 'arrived and holding');
  assert.ok(Math.hypot(sq.x - to.x, sq.y - to.y) < 2, `at (${sq.x}, ${sq.y}), sent to (${to.x}, ${to.y})`);
  // Too poor for more.
  p.gold = 5;
  assert.match(m.exec(0, { type: 'deploy', unit: 'knight', n: 5, x: to.x, y: to.y }).error, /gold each/);
  // An outpost becomes the nearer source.
  p.gold = 5000;
  claim(m, 0, to.x, to.y, 8);
  const out = createStructure(m, 'outpost', 0, to.x, to.y);
  const far = openGround(m, to.x, to.y, 4, 12);
  assert.equal(m.exec(0, { type: 'deploy', unit: 'bow', n: 5, x: far.x, y: far.y }).from, out.id);
  // Selected squads can be sent on and stopped.
  assert.ok(m.exec(0, { type: 'move', ids: [sq.id], x: town.x, y: town.y }).ok);
  assert.equal(sq.state, 'moving');
  assert.ok(m.exec(0, { type: 'stop', ids: [sq.id] }).ok);
  assert.equal(sq.state, 'idle');
  // Nobody can order another player's soldiers.
  assert.match(m.exec(1, { type: 'move', ids: [sq.id], x: 1, y: 1 }).error, /No soldiers/);
});

test('soldiers claim unclaimed land around them; riders faster than spearmen', () => {
  const m = twoPlayers();
  const town = home(m, 0);
  const at = openGround(m, town.x, town.y, 20, 40);
  // Clear a patch of wild land and stand a squad of each kind in it.
  const tiles = (pid) => m.state.players[pid].tiles;
  const before = tiles(0);
  const a = squad(m, 0, 'rider', 12, at.x, at.y);
  run(m, 3);
  const riders = tiles(0) - before;
  assert.ok(riders > 8, `riders claimed ${riders}`);
  m.state.squads = m.state.squads.filter((q) => q !== a);
  const at2 = openGround(m, town.x, town.y, 45, 80);
  const before2 = tiles(0);
  squad(m, 0, 'shield', 12, at2.x, at2.y);
  run(m, 3);
  const spears = tiles(0) - before2;
  assert.ok(spears > 0 && spears < riders, `spears ${spears} < riders ${riders}`);
});

test('soldiers walk round lakes and bays on their own land, and sail only to other land', () => {
  const m = twoPlayers();
  const part = landPart(m);
  const W = m.W;
  // Two tiles of one stretch of land with water on the straight line between them.
  let pair = null;
  for (let i = 0; i < m.owner.length && !pair; i += 7) {
    if (part[i] < 0) continue;
    const ax = i % W;
    const ay = (i / W) | 0;
    for (const [dx, dy] of [[24, 0], [0, 24], [17, 17], [17, -17]]) {
      const bx = ax + dx;
      const by = ay + dy;
      if (bx >= W - 1 || by < 1 || by >= m.H - 1 || part[by * W + bx] !== part[i]) continue;
      let wet = 0;
      for (let k = 1; k < 24; k++) if (!m.land[Math.round(ay + (dy * k) / 24) * W + Math.round(ax + (dx * k) / 24)]) wet++;
      if (wet >= 4) {
        pair = { a: i, bx, by };
        break;
      }
    }
  }
  assert.ok(pair, 'the test world has a lake or bay to walk round');
  const path = findPath(m, 'shield', pair.a, pair.bx, pair.by);
  assert.ok(path, 'a way round exists');
  assert.ok(path.every((t) => m.land[t]), 'no boats on the way round');
  // Land of another stretch is reached by sea.
  const other = m.owner.findIndex((o, i) => part[i] >= 0 && part[i] !== part[pair.a] && m.land[i]);
  if (other >= 0) {
    const sea = findPath(m, 'shield', pair.a, other % W, (other / W) | 0);
    if (sea) assert.ok(sea.some((t) => !m.land[t]), 'other land is reached by boat');
  }
  // Open sea is no place to send soldiers.
  const deep = m.owner.findIndex((o, i) => {
    const x = i % W;
    const y = (i / W) | 0;
    if (x < 10 || y < 10 || x > W - 10 || y > m.H - 10) return false;
    for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) if (m.land[i + dy * W + dx]) return false;
    return true;
  });
  if (deep >= 0) {
    const home = m.state.structures.find((q) => q.owner === 0);
    assert.match(m.exec(0, { type: 'deploy', unit: 'shield', n: 5, x: deep % W, y: (deep / W) | 0 }).error || '', /land/);
    assert.ok(home);
  }
});

test('counters: riders run down archers, spears stop riders', () => {
  const m = twoPlayers();
  const town = home(m, 0);
  const at = openGround(m, town.x, town.y, 25, 60);
  const bows = squad(m, 0, 'bow', 20, at.x, at.y);
  const riders = squad(m, 1, 'rider', 20, at.x + 1, at.y);
  run(m, 20);
  assert.ok(!m.state.squads.includes(bows) || bows.n < 3, 'the archers fell');
  assert.ok(riders.n > 8, `riders left: ${riders.n}`);
  const spears = squad(m, 0, 'shield', 20, riders.x + 1, riders.y);
  run(m, 25);
  assert.ok(!m.state.squads.includes(riders), 'the riders fell');
  assert.ok(spears.n > 5, `spears left: ${spears.n}`);
  assert.ok(m.state.players[1].stats.lostSoldiers > 15);
});

test('rival land is taken only where no rival soldiers or buildings guard it', () => {
  const m = twoPlayers();
  const town = home(m, 1);
  claim(m, 1, town.x, town.y, 26);
  const r = guardRadius(town);
  // Inside the town's guard: nothing changes hands.
  const inside = squad(m, 0, 'rider', 30, town.x + r - 2, town.y);
  inside.x = town.x + 3;
  run(m, 3);
  for (let dx = -2; dx <= 2; dx++) assert.equal(m.owner[m.idx(town.x + 3 + dx, town.y)], 1);
  m.state.squads = m.state.squads.filter((q) => q !== inside);
  // Outside it, unguarded: taken.
  const far = openGround(m, town.x, town.y, r + 5, 25, 1);
  const taker = squad(m, 0, 'rider', 30, far.x, far.y);
  const before = m.state.players[0].tiles;
  run(m, 3);
  assert.ok(m.state.players[0].tiles > before, 'unguarded rival land was taken');
  m.state.squads = m.state.squads.filter((q) => q !== taker);
  // With a rival squad nearby it is contested.
  const near = openGround(m, far.x, far.y, 10, 25, 1);
  const theirs = squad(m, 1, 'shield', 5, near.x, near.y);
  const mine = squad(m, 0, 'rider', 30, near.x + 3, near.y);
  const own = m.state.players[1].tiles;
  run(m, 1);
  assert.ok(m.state.squads.includes(theirs) && m.state.squads.includes(mine));
  assert.ok(m.state.players[1].tiles >= own - 2, 'no land changes hands while it is defended');
});

test('a town falls when its garrison is gone and soldiers reach its gate', () => {
  const m = twoPlayers();
  const town = home(m, 1);
  claim(m, 1, town.x, town.y, guardRadius(town) + 2);
  const r = guardRadius(town);
  m.state.squads = m.state.squads.filter((q) => q.owner !== 1);
  // Trebuchets out of reach of the walls, then spears to the gate.
  const at = openGround(m, town.x, town.y, 6, 7);
  squad(m, 0, 'trebuchet', 4, at.x, at.y);
  run(m, 15);
  assert.ok(town.garrison < garrisonMax(town) * 0.6, `garrison ${town.garrison}`);
  const spears = squad(m, 0, 'shield', 60, at.x, at.y);
  m.exec(0, { type: 'move', ids: [spears.id], x: town.x, y: town.y });
  run(m, 40);
  assert.equal(town.owner, 0, 'captured');
  assert.ok(!town.capital);
  assert.ok(m.state.events.some((e) => e.kid === 1 && e.kind === 'lost'));
  // The land it guarded came with it.
  let flipped = 0;
  for (let dx = -r; dx <= r; dx++) if (m.owner[m.idx(town.x + dx, town.y)] === 0) flipped++;
  assert.ok(flipped > r, `${flipped} tiles across the town are now ours`);
  // Brann has no place left: a minute later the realm falls.
  run(m, 65);
  assert.equal(m.state.players[1].alive, false);
});

test('a besieged town cannot raise soldiers', () => {
  const m = twoPlayers();
  const town = home(m, 0);
  const p = m.state.players[0];
  p.gold = 5000;
  squad(m, 1, 'shield', 40, town.x + 6, town.y);
  run(m, 0.5);
  const to = openGround(m, town.x, town.y, 3, 10);
  assert.match(m.exec(0, { type: 'deploy', unit: 'shield', n: 10, x: to.x, y: to.y }).error, /under siege/);
});

test('allies neither fight nor take each other\'s land; betrayal weakens the traitor', () => {
  const m = twoPlayers();
  assert.ok(m.exec(0, { type: 'ally', to: 1 }).ok);
  assert.match(m.exec(0, { type: 'ally', to: 1 }).error, /already asked/);
  assert.ok(m.exec(1, { type: 'ally', to: 0 }).ok, 'asking back seals it');
  assert.ok(m.allied(0, 1));
  const town = home(m, 0);
  const at = openGround(m, town.x, town.y, 25, 60);
  const a = squad(m, 0, 'shield', 20, at.x, at.y);
  const b = squad(m, 1, 'shield', 20, at.x + 1, at.y);
  run(m, 5);
  assert.equal(a.n, 20);
  assert.equal(b.n, 20);
  assert.ok(m.exec(1, { type: 'breakAlliance', to: 0 }).ok);
  assert.ok(m.state.players[1].traitorUntil > m.state.t);
  assert.ok(m.state.events.some((e) => e.kind === 'betrayal'));
  run(m, 6);
  assert.ok(a.n < 20 && b.n < 20, 'enemies again');
  assert.ok(b.n < a.n, `the traitor suffers more (${b.n} < ${a.n})`);
  // Requests and alliances expire.
  m.state.squads = m.state.squads.filter((q) => q !== a && q !== b);
  assert.ok(m.exec(0, { type: 'ally', to: 1 }).ok);
  run(m, RULES.requestTime + 2);
  assert.equal(m.state.requests.length, 0);
  m.exec(0, { type: 'ally', to: 1 });
  m.exec(1, { type: 'answer', id: m.state.requests[0].id, accept: true });
  assert.ok(m.allied(0, 1));
  run(m, RULES.allianceTime + 2);
  assert.ok(!m.allied(0, 1));
});

test('idle squads of one kind standing together merge', () => {
  const m = twoPlayers();
  const town = home(m, 0);
  const at = openGround(m, town.x, town.y, 25, 60);
  const a = squad(m, 0, 'bow', 10, at.x, at.y);
  squad(m, 0, 'bow', 15, at.x + 1, at.y);
  squad(m, 0, 'shield', 15, at.x, at.y + 1);
  run(m, 1.1);
  const here = m.state.squads.filter((q) => q.owner === 0 && Math.hypot(q.x - at.x, q.y - at.y) < 3);
  assert.equal(here.length, 2);
  assert.equal(a.n, 25);
});

test('armies cost upkeep; an empty treasury makes soldiers desert', () => {
  const m = twoPlayers();
  const p = m.state.players[0];
  const town = home(m, 0);
  const big = squad(m, 0, 'knight', 200, town.x + 2, town.y + 2);
  p.gold = 0;
  run(m, 10);
  assert.equal(p.gold, 0);
  assert.ok(big.n < 200 * 0.95, `deserted to ${big.n}`);
});

test('pockets enclosed by one realm are annexed', () => {
  const m = twoPlayers();
  const town = home(m, 0);
  claim(m, 0, town.x, town.y, 16);
  // Punch an unclaimed hole and a small rival island into the land.
  const hole = [];
  const isle = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const i = m.idx(town.x + 10 + dx, town.y + dy);
      const j = m.idx(town.x - 10 + dx, town.y + dy);
      if (m.land[i]) {
        m.setOwner(i, -1);
        hole.push(i);
      }
      if (m.land[j]) {
        m.setOwner(j, 1);
        isle.push(j);
      }
    }
  }
  run(m, RULES.annexEvery + 0.2);
  for (const i of hole) assert.equal(m.owner[i], 0);
  for (const i of isle) assert.equal(m.owner[i], 0);
});

test('towns grow by themselves and can be raised to a walled city', () => {
  const m = twoPlayers();
  const p = m.state.players[0];
  const town0 = home(m, 0);
  claim(m, 0, town0.x, town0.y, 30);
  p.gold = 1e6;
  let id = null;
  for (let r = 14; r <= 26 && !id; r += 2) {
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r]]) {
      const res = m.exec(0, { type: 'build', kind: 'town', x: town0.x + dx, y: town0.y + dy });
      if (res.ok) {
        id = res.id;
        break;
      }
    }
  }
  assert.ok(id, 'a second town was founded');
  assert.equal(p.built.town, 1);
  assert.ok(p.gold < 1e6 - structureCost('town', 0) + 1);
  const town = m.state.structures.find((s) => s.id === id);
  const L = m.layouts.get(town.id);
  const houses0 = L.buildings.filter((b) => b.kind === 'house').length;
  run(m, 40);
  assert.ok(L.buildings.filter((b) => b.kind === 'house').length > houses0, 'houses went up on their own');
  for (let k = 0; k < 3; k++) assert.ok(m.exec(0, { type: 'upgrade', sid: town.id }).ok);
  assert.equal(town.level, 4);
  assert.equal(garrisonMax(town), TOWN_LEVELS[4].garrison);
  assert.match(m.exec(0, { type: 'upgrade', sid: town.id }).error, /already a city/);
  assert.equal(L.stage, TOWN_LEVELS[4].stage);
  assert.ok(L.walls && L.walls.level >= 2, 'a city has stone walls');
  run(m, 120);
  assert.ok(validateLayout(m.world, L).ok);
  const theirs = home(m, 1);
  assert.match(m.exec(0, { type: 'build', kind: 'town', x: theirs.x + 3, y: theirs.y }).error, /own land/);
});

test('trade ships sail between ports and pay both owners', () => {
  const m = twoPlayers();
  const body = m.coast[m.coastTiles[0]];
  const shores = m.coastTiles.filter((i) => m.coast[i] === body && m.owner[i] === -1);
  const first = shores[0];
  const far = shores.find((i) => Math.hypot((i % m.W) - (first % m.W), ((i / m.W) | 0) - ((first / m.W) | 0)) > 40);
  assert.ok(far !== undefined);
  for (const [pid, i] of [[0, first], [1, far]]) {
    const x = i % m.W;
    const y = (i / m.W) | 0;
    claim(m, pid, x, y, 4);
    createStructure(m, 'port', pid, x, y);
  }
  run(m, 120);
  const [a, b] = m.state.players;
  assert.ok(a.stats.trade > 0 && b.stats.trade > 0, `trade ${a.stats.trade} / ${b.stats.trade}`);
});

test('victory: the first to hold 80% of the land wins; otherwise the most land when time runs out', () => {
  const m = twoPlayers();
  // A little over the line: the rival's soldiers win back a few tiles meanwhile.
  let need = Math.ceil(m.landTotal * (RULES.winShare + 0.01)) - m.state.players[0].tiles;
  for (let i = 0; i < m.owner.length && need > 0; i++) {
    if (m.land[i] && m.owner[i] === -1) {
      m.setOwner(i, 0);
      need--;
    }
  }
  run(m, 1.1);
  assert.deepEqual(m.state.winner, { kid: 0, how: 'domination' });
  const t = twoPlayers({ timeLimit: 30 });
  claim(t, 1, home(t, 1).x, home(t, 1).y, 14);
  run(t, 31);
  assert.deepEqual(t.state.winner, { kid: 1, how: 'time' });
});

test('AI players claim land, build, raise armies and fight', { timeout: 180000 }, () => {
  const m = new Match({ seed: 5, size: 'small', world: generateWorld({ seed: 5, ...WORLD_SIZES.small }), placementTime: 0.2, players: Array.from({ length: 6 }, () => ({ ai: true })) });
  run(m, 420);
  const st = m.state;
  assert.ok(st.players.every((p) => p.spawned));
  const held = st.players.reduce((t, p) => t + p.tiles, 0);
  assert.ok(held > m.landTotal * 0.7, `claimed ${Math.round((held / m.landTotal) * 100)}% of the land`);
  assert.ok(st.structures.filter((s) => s.kind === 'town').length > st.players.length, 'new towns');
  assert.ok(st.players.every((p) => p.stats.raised > 20), 'every AI raised soldiers');
  assert.ok(st.players.reduce((t, p) => t + p.stats.lostSoldiers, 0) > 100, 'they fought');
  for (const s of st.structures) assert.ok(validateLayout(m.world, m.layouts.get(s.id)).ok, `${s.name} layout valid`);
});

test('the simulation is deterministic', { timeout: 60000 }, () => {
  const make = () => new Match({ seed: 9, size: 'small', world: WORLD, placementTime: 0.2, players: Array.from({ length: 4 }, () => ({ ai: true })) });
  const a = make();
  const b = make();
  run(a, 120);
  run(b, 120);
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
  assert.ok(snap0.players[1].army > 0, 'armies are public');
  assert.ok(snap0.squads.some((q) => q.owner === 1), 'so are soldiers');
  assert.ok(snap0.squads.find((q) => q.owner === 1).dest === undefined, 'but not where they are going');
  const town = home(m, 0);
  m.state.players[0].gold = 1000;
  const to = openGround(m, town.x, town.y, 15, 30);
  m.exec(0, { type: 'deploy', unit: 'rider', n: 20, x: to.x, y: to.y });
  for (let k = 0; k < 6; k++) {
    run(m, 0.6);
    const msgs = view.messages();
    assert.ok(!msgs.some((q) => q.t === 'terr'), 'no full resend');
    const snap = msgs.find((q) => q.t === 'snap');
    if (snap.td) applyDelta(mine, snap.td);
  }
  assert.deepEqual([...mine], [...m.owner], 'deltas rebuild the same map');
});
