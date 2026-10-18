import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../engine/sim/match.js';
import { TICK } from '../engine/sim/defs.js';
import { saveMatch, loadMatch, describeSave } from '../engine/sim/persist.js';
import { validateLayout } from '../engine/settlement/validate.js';
import { generateWorld, WORLD_SIZES } from '../engine/world/worldgen.js';

const WORLD = generateWorld({ seed: 13, ...WORLD_SIZES.small });

function run(m, seconds) {
  for (let i = 0; i < Math.round(seconds / TICK); i++) m.step();
}

function aiMatch() {
  return new Match({ seed: 13, size: 'small', world: WORLD, placementTime: 0.25, players: [{ name: 'Ilse' }, { ai: true, personality: 'warlord' }, { ai: true, personality: 'merchant' }] });
}

test('a saved match loads and continues exactly as the original', { timeout: 120000 }, () => {
  const a = aiMatch();
  run(a, 180);
  // A pending human command must survive the save too.
  const h = a.state.structures.find((s) => s.owner === 0);
  a.command(0, { type: 'deploy', unit: 'knight', n: 2, x: h.x + 3, y: h.y + 1 });
  const text = JSON.stringify(saveMatch(a));
  const b = loadMatch(JSON.parse(text), { world: WORLD });
  assert.equal(JSON.stringify(saveMatch(b)), text, 'identical right after loading');
  run(a, 1);
  run(b, 1);
  assert.ok(b.state.squads.some((q) => q.owner === 0 && q.type === 'knight'), 'the queued order went through');
  run(a, 180);
  run(b, 180);
  assert.equal(JSON.stringify(saveMatch(b)), JSON.stringify(saveMatch(a)), 'identical after three more minutes');
  assert.ok(a.state.structures.length > 6, 'the saved match had grown');
  assert.deepEqual([...b.owner], [...a.owner], 'same territory');
  for (const s of b.state.structures) assert.ok(validateLayout(b.world, b.layouts.get(s.id)).ok, `${s.name} layout valid after load`);
});

test('loading regenerates the world from the seed when none is given', { timeout: 120000 }, () => {
  const a = aiMatch();
  run(a, 30);
  const b = loadMatch(JSON.parse(JSON.stringify(saveMatch(a))));
  assert.notEqual(b.world, WORLD);
  assert.equal(b.world.width, WORLD.width);
  run(a, 30);
  run(b, 30);
  assert.equal(JSON.stringify(b.state), JSON.stringify(a.state));
});

test('bad or mismatched saves are rejected with a clear error', () => {
  const a = aiMatch();
  run(a, 5);
  const data = saveMatch(a);
  assert.throws(() => loadMatch({ hello: 1 }), /not a Realmwright saved game/);
  assert.throws(() => loadMatch({ ...data, version: 99 }), /Unsupported save version/);
  assert.throws(() => loadMatch({ ...data, version: 2 }), /older version/);
  assert.throws(() => loadMatch({ ...data, world: { ...data.world, check: 12345 } }, { world: WORLD }), /does not match/);
  const d = describeSave(data);
  assert.equal(d.name, 'Ilse');
  assert.equal(d.players, 3);
  assert.equal(typeof d.share, 'number');
  assert.equal(d.alive, true);
});
