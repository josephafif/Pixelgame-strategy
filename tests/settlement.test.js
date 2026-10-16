import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, WORLD_SIZES } from '../engine/world/worldgen.js';
import { canFoundAt } from '../engine/world/sites.js';
import { styleForSite } from '../engine/settlement/styles.js';
import { createLayout, addBuilding, applyStage, buildWalls, ensureGate, serializeLayout, deserializeLayout, removeBuilding, N, O } from '../engine/settlement/planner.js';
import { validateLayout } from '../engine/settlement/validate.js';

const worlds = new Map();
function world(seed) {
  if (!worlds.has(seed)) worlds.set(seed, generateWorld({ seed, ...WORLD_SIZES.medium }));
  return worlds.get(seed);
}

/** Find a reproducible site whose surroundings give the wanted style. */
function findSite(w, style) {
  for (let y = 30; y < w.height - 30; y += 4) {
    for (let x = 30; x < w.width - 30; x += 4) {
      if (!canFoundAt(w, x, y)) continue;
      if (styleForSite(w, x, y) !== style) continue;
      // Need some room: count buildable cells nearby.
      let ok = 0;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (canFoundAt(w, x + dx, y + dy)) ok++;
      if (ok >= 60) return { x, y };
    }
  }
  return null;
}

const PLAN = ['farm', 'lumber', 'farm', 'market', 'quarry', 'granary', 'farm', 'smithy', 'workshop', 'temple', 'barracks', 'harbor', 'fishery', 'tavern', 'farm', 'herbalist', 'mine', 'kiln', 'stables', 'tower'];

function grow(w, site, { houses = 60, check = true, kind = 'capital' } = {}) {
  const L = createLayout(w, { cx: site.x, cy: site.y, seed: w.seed, kind });
  const log = [];
  const assertValid = (what) => {
    if (!check) return;
    const r = validateLayout(w, L);
    assert.ok(r.ok, `${what}: ${JSON.stringify(r.errors.slice(0, 5))}`);
  };
  assertValid('create');
  applyStage(w, L, kind === 'outpost' ? 0 : 1);
  const plan = PLAN.slice();
  for (let i = 0; i < houses; i++) {
    const stage = i < 6 ? 1 : i < 18 ? 2 : i < 40 ? 3 : 4;
    if (stage > L.stage) {
      applyStage(w, L, stage);
      assertValid(`stage ${stage}`);
    }
    if (stage === 3 && !L.walls) {
      buildWalls(w, L, 1);
      assertValid('walls');
    }
    const b = addBuilding(w, L, 'house');
    log.push(b ? 'ok' : 'fail');
    assertValid(`house ${i}`);
    if (i % 3 === 0 && plan.length) {
      const k = plan.shift();
      addBuilding(w, L, k);
      assertValid(k);
    }
  }
  return { L, log };
}

const STYLE_SEEDS = [1, 7, 42];
const STYLES_TO_TEST = ['farm', 'timber', 'stone', 'harbor', 'stilt', 'adobe', 'nordic', 'ash'];

for (const style of STYLES_TO_TEST) {
  test(`settlement (${style}): grows to a valid city, checked after every operation`, () => {
    let site = null;
    let w = null;
    for (const seed of STYLE_SEEDS) {
      w = world(seed);
      site = findSite(w, style);
      if (site) break;
    }
    assert.ok(site, `found a ${style} site`);
    const { L, log } = grow(w, site, { houses: 50 });
    assert.equal(L.style, style);
    const houses = L.buildings.filter((b) => b.kind === 'house').length;
    assert.ok(houses >= 25, `${style}: placed ${houses} houses (${log.filter((x) => x === 'fail').length} failed)`);
    assert.ok(L.buildings.some((b) => b.kind === 'keep'));
    assert.ok(L.arteries.length >= 2, 'has main roads');
  });
}

test('layouts are deterministic: same seed, same operations, identical result', () => {
  const w = world(1);
  const site = findSite(w, 'farm');
  const a = grow(w, site, { houses: 30, check: false }).L;
  const b = grow(w, site, { houses: 30, check: false }).L;
  assert.deepEqual(JSON.stringify(serializeLayout(a)), JSON.stringify(serializeLayout(b)));
});

test('growth is incremental: buildings never move and streets never disappear', () => {
  const w = world(7);
  const site = findSite(w, 'timber') || findSite(w, 'farm');
  const L = createLayout(w, { cx: site.x, cy: site.y, seed: 7, kind: 'capital' });
  applyStage(w, L, 1);
  const plan = PLAN.slice();
  for (let i = 0; i < 60; i++) {
    const before = new Map(L.buildings.map((b) => [b.id, `${b.kind}:${b.x},${b.y},${b.w}x${b.h}`]));
    const roadsBefore = [];
    for (let l = 0; l < N * N; l++) if (L.road[l]) roadsBefore.push(l);
    const op = i % 15 === 14 ? 'stage' : i % 4 === 0 && plan.length ? plan.shift() : 'house';
    if (op === 'stage') applyStage(w, L, Math.min(4, L.stage + 1));
    else addBuilding(w, L, op);
    for (const b of L.buildings) {
      if (before.has(b.id)) assert.equal(`${b.kind}:${b.x},${b.y},${b.w}x${b.h}`, before.get(b.id), `building ${b.id} moved during ${op}`);
    }
    assert.equal([...before.keys()].filter((id) => !L.buildings.some((b) => b.id === id)).length, 0, 'no building removed');
    for (const l of roadsBefore) assert.ok(L.road[l] > 0, `road cell ${l} vanished during ${op}`);
  }
});

test('layouts survive serialisation for the network', () => {
  const w = world(42);
  const site = findSite(w, 'farm') || findSite(w, 'timber');
  const { L } = grow(w, site, { houses: 20, check: false });
  const copy = deserializeLayout(JSON.parse(JSON.stringify(serializeLayout(L))));
  assert.deepEqual(copy.buildings, L.buildings);
  assert.deepEqual(copy.occ, L.occ);
  assert.deepEqual(copy.road, L.road);
  assert.ok(validateLayout(w, copy).ok);
});

test('ensureGate opens a main road toward a new neighbour', () => {
  const w = world(1);
  const site = findSite(w, 'farm');
  const L = createLayout(w, { cx: site.x, cy: site.y, seed: 1, kind: 'town' });
  const before = L.arteries.length;
  const g1 = ensureGate(w, L, site.x + 40, site.y);
  const g2 = ensureGate(w, L, site.x - 40, site.y);
  const g3 = ensureGate(w, L, site.x, site.y + 40);
  for (const g of [g1, g2, g3]) assert.ok(Number.isFinite(g.x) && Number.isFinite(g.y));
  assert.ok(L.arteries.length >= before);
  assert.ok(validateLayout(w, L).ok);
});

test('demolition keeps the layout valid (siege damage)', () => {
  const w = world(1);
  const site = findSite(w, 'farm');
  const { L } = grow(w, site, { houses: 25, check: false });
  const victims = L.buildings.filter((b) => b.kind === 'house').slice(0, 5);
  for (const b of victims) removeBuilding(w, L, b.id);
  const r = validateLayout(w, L);
  assert.ok(r.ok, JSON.stringify(r.errors.slice(0, 5)));
  // Freed land can be built on again.
  assert.ok(addBuilding(w, L, 'house'));
});

test('outposts start small and grow into villages without moving', () => {
  const w = world(7);
  const site = findSite(w, 'farm') || findSite(w, 'timber');
  const L = createLayout(w, { cx: site.x, cy: site.y, seed: 3, kind: 'outpost' });
  assert.ok(L.buildings.some((b) => b.kind === 'lodge'));
  const lodge = L.buildings.find((b) => b.kind === 'lodge');
  for (let i = 0; i < 6; i++) addBuilding(w, L, 'house');
  applyStage(w, L, 2);
  for (let i = 0; i < 10; i++) addBuilding(w, L, 'house');
  addBuilding(w, L, 'hall');
  assert.ok(L.buildings.find((b) => b.id === lodge.id && b.x === lodge.x && b.y === lodge.y));
  assert.ok(validateLayout(w, L).ok);
  // Roads never sit under buildings.
  for (let l = 0; l < N * N; l++) if (L.occ[l] === O.BUILDING) assert.equal(L.road[l], 0);
});

test('settlement growth is fast enough for the server tick', () => {
  const w = world(1);
  const site = findSite(w, 'farm');
  const t0 = performance.now();
  grow(w, site, { houses: 60, check: false });
  const ms = performance.now() - t0;
  assert.ok(ms < 4000, `grew a city in ${ms.toFixed(0)} ms`);
});
