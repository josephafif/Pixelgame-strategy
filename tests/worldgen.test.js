import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, WORLD_SIZES } from '../engine/world/worldgen.js';
import { B, BIOMES, D, isWater } from '../engine/world/biomes.js';
import { pickStartSites, pickTradeHubs, analyzeSite, canFoundAt } from '../engine/world/sites.js';

const SEEDS = [1, 7, 42];

test('world generation is deterministic for a seed', () => {
  const a = generateWorld({ seed: 99, ...WORLD_SIZES.test });
  const b = generateWorld({ seed: 99, ...WORLD_SIZES.test });
  assert.deepEqual(a.biome, b.biome);
  assert.deepEqual(a.feature, b.feature);
  assert.deepEqual(a.deposit, b.deposit);
  const c = generateWorld({ seed: 100, ...WORLD_SIZES.test });
  assert.notDeepEqual(a.biome, c.biome);
});

for (const seed of SEEDS) {
  test(`world ${seed}: biome mix, land share and map edges`, () => {
    const w = generateWorld({ seed, ...WORLD_SIZES.small });
    const counts = new Map();
    let land = 0;
    for (let i = 0; i < w.biome.length; i++) {
      counts.set(w.biome[i], (counts.get(w.biome[i]) || 0) + 1);
      if (!isWater(w.biome[i])) land++;
    }
    const share = land / w.biome.length;
    assert.ok(share > 0.35 && share < 0.62, `land share ${share}`);
    // A strategic map needs varied terrain.
    for (const b of [B.GRASS, B.FOREST, B.HILLS, B.MOUNTAIN, B.RIVER, B.SEA]) {
      assert.ok((counts.get(b) || 0) > 20, `biome ${BIOMES[b].key} present`);
    }
    // The border is water so no kingdom sits on the edge of the world.
    for (let x = 0; x < w.width; x++) {
      assert.ok(isWater(w.biome[x]) && isWater(w.biome[(w.height - 1) * w.width + x]));
    }
  });

  test(`world ${seed}: every river flows downhill to the sea or a lake`, () => {
    const w = generateWorld({ seed, ...WORLD_SIZES.small });
    const W = w.width;
    // Each river cell must connect (4-neighbour, through river cells) to open water.
    const seen = new Uint8Array(w.biome.length);
    const q = [];
    for (let i = 0; i < w.biome.length; i++) {
      const b = w.biome[i];
      if (b === B.SEA || b === B.DEEP || b === B.LAKE) {
        seen[i] = 1;
        q.push(i);
      }
    }
    while (q.length) {
      const c = q.pop();
      for (const n of [c - 1, c + 1, c - W, c + W]) {
        if (n < 0 || n >= w.biome.length || seen[n]) continue;
        if (w.biome[n] === B.RIVER) {
          seen[n] = 1;
          q.push(n);
        }
      }
    }
    let orphan = 0;
    let rivers = 0;
    for (let i = 0; i < w.biome.length; i++) {
      if (w.biome[i] !== B.RIVER) continue;
      rivers++;
      if (!seen[i]) orphan++;
    }
    assert.ok(rivers > 50, 'has rivers');
    assert.equal(orphan, 0, `${orphan} river cells do not reach open water`);
  });

  test(`world ${seed}: deposits sit on fitting terrain`, () => {
    const w = generateWorld({ seed, ...WORLD_SIZES.small });
    const ok = {
      [D.IRON]: [B.HILLS, B.MOUNTAIN],
      [D.COAL]: [B.HILLS, B.MARSH, B.MOUNTAIN, B.TAIGA],
      [D.CRYSTAL]: [B.ASH, B.MOUNTAIN, B.SNOW],
      [D.HERBS]: [B.FOREST, B.MARSH, B.TAIGA, B.MEADOW],
      [D.STONE]: [B.HILLS, B.MOUNTAIN, B.DESERT],
      [D.FISH]: [B.SEA, B.LAKE],
    };
    const seenTypes = new Set();
    for (let i = 0; i < w.deposit.length; i++) {
      const d = w.deposit[i];
      if (!d) continue;
      seenTypes.add(d);
      assert.ok(ok[d].includes(w.biome[i]), `deposit ${d} on biome ${w.biome[i]}`);
    }
    for (const d of [D.IRON, D.COAL, D.CRYSTAL, D.HERBS, D.FISH]) assert.ok(seenTypes.has(d), `deposit type ${d}`);
  });

  test(`world ${seed}: start sites are viable, spread out and distinct`, () => {
    const w = generateWorld({ seed, ...WORLD_SIZES.medium });
    const hubs = pickTradeHubs(w, 3);
    assert.ok(hubs.length >= 2, 'trade hubs');
    const sites = pickStartSites(w, 8, hubs);
    assert.ok(sites.length >= 6, `sites ${sites.length}`);
    const archetypes = new Set(sites.map((s) => s.archetype));
    assert.ok(archetypes.size >= 4, `distinct archetypes ${[...archetypes]}`);
    for (const s of sites) {
      assert.ok(canFoundAt(w, s.x, s.y));
      const a = analyzeSite(w, s.x, s.y);
      assert.ok(a.fert >= 55 && a.wood >= 12 && a.buildable >= 90);
      for (const t of sites) if (t !== s) assert.ok(Math.hypot(s.x - t.x, s.y - t.y) >= 22);
    }
  });
}
