// Saved games. A save holds the match options, the complete game state,
// every settlement layout, the per-tile masks and the simulation's internal
// caches that influence later decisions (RNG position, path cache), so that
// a loaded match continues exactly as the original would have. The world is
// not stored: it is regenerated from its seed and checked by fingerprint.

import { Match } from './match.js';
import { serializeLayout, deserializeLayout } from '../settlement/planner.js';
import { rle, unrle } from '../core/rle.js';
import { mix32 } from '../core/rng.js';

export const SAVE_FORMAT = 'realmwright-save';
export const SAVE_VERSION = 2; // 2: four resources, no fog of war

/** A cheap fingerprint of the generated world, to reject mismatched saves. */
export function worldFingerprint(world) {
  let h = mix32(world.width * 65537 + world.height);
  const { biome, height01 } = world;
  for (let i = 0; i < biome.length; i += 7) h = mix32(h ^ (biome[i] + ((height01[i] * 1000) | 0) * 31));
  return h >>> 0;
}

const plain = (v) => JSON.parse(JSON.stringify(v));

/** Serialise a match to a JSON-safe object. */
export function saveMatch(m) {
  const { world: _world, restore: _restore, ...opts } = m.opts;
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    opts: plain(opts),
    world: { width: m.world.width, height: m.world.height, check: worldFingerprint(m.world) },
    state: plain(m.state),
    rng: [m.rng.a, m.rng.b, m.rng.c, m.rng.d],
    layouts: [...m.layouts.values()].map((L) => plain(serializeLayout(L))),
    startSites: plain(m.startSites),
    queue: plain(m.queue),
    territoryDirty: m.territoryDirty,
    paths: [...m.pathCache],
    tiles: { owner: rle(m.owner), ownerK: rle(m.ownerK), roads: rle(m.roads), roadMask: rle(m.roadMask), struct: rle(m.struct) },
    explored: m.explored.map((e) => rle(e)),
  };
}

/** Rebuild a match from saveMatch() output (optionally reusing a world). */
export function loadMatch(data, { world } = {}) {
  if (!data || data.format !== SAVE_FORMAT) throw new Error('This is not a Realmwright saved game.');
  if (data.version !== SAVE_VERSION) throw new Error(data.version < SAVE_VERSION ? 'This save is from an older version of the game and cannot be continued.' : `Unsupported save version ${data.version}.`);
  const m = new Match({ ...data.opts, world, restore: true });
  const W = m.world.width;
  const H = m.world.height;
  if (W !== data.world.width || H !== data.world.height || worldFingerprint(m.world) !== data.world.check) {
    throw new Error('The saved world does not match this version of the world generator.');
  }
  m.state = plain(data.state);
  [m.rng.a, m.rng.b, m.rng.c, m.rng.d] = data.rng;
  for (const L of data.layouts) m.layouts.set(L.id, deserializeLayout(plain(L)));
  const n = W * H;
  const t = data.tiles;
  m.owner = unrle(t.owner, Int32Array, n);
  m.ownerK = unrle(t.ownerK, Int8Array, n);
  m.roads = unrle(t.roads, Uint8Array, n);
  m.roadMask = unrle(t.roadMask, Uint8Array, n);
  m.struct = unrle(t.struct, Uint8Array, n);
  m.explored = data.explored.map((e) => unrle(e, Uint8Array, n));
  m.startSites = plain(data.startSites);
  m.queue = plain(data.queue || []);
  m.territoryDirty = !!data.territoryDirty;
  m.pathCache = new Map(data.paths || []);
  return m;
}

/** Short description for save menus. */
export function describeSave(data) {
  const st = data.state;
  const human = st.kingdoms.find((k) => !k.ai) || st.kingdoms[0];
  const min = Math.floor(st.t / 60);
  return {
    name: human ? human.name : '?',
    seed: st.seed,
    size: st.size,
    minutes: min,
    phase: st.phase,
    kingdoms: st.kingdoms.length,
    settlements: st.settlements.filter((s) => s.kingdom === (human ? human.id : 0)).length,
  };
}
