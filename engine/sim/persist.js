// Saved games. A save holds the match options, the complete game state
// (squads keep their routes, ships theirs), every settlement
// layout, the territory and the RNG position, so a loaded match continues
// exactly as the original would have. The world is not stored: it is
// regenerated from its seed and checked by fingerprint.

import { Match } from './match.js';
import { serializeLayout, deserializeLayout } from '../settlement/planner.js';
import { rle, unrle } from '../core/rle.js';
import { mix32 } from '../core/rng.js';

export const SAVE_FORMAT = 'realmwright-save';
export const SAVE_VERSION = 5; // 5: land from settlements, command limits

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
    world: { width: m.W, height: m.H, land: m.landTotal, check: worldFingerprint(m.world) },
    state: plain(m.state),
    rng: [m.rng.a, m.rng.b, m.rng.c, m.rng.d],
    layouts: [...m.layouts.values()].map((L) => plain(serializeLayout(L))),
    startSites: plain(m.startSites),
    queue: plain(m.queue),
    tiles: { owner: rle(m.owner), struct: rle(m.struct) },
  };
}

/** Rebuild a match from saveMatch() output (optionally reusing a world). */
export function loadMatch(data, { world } = {}) {
  if (!data || data.format !== SAVE_FORMAT) throw new Error('This is not a Realmwright saved game.');
  if (data.version !== SAVE_VERSION) throw new Error(data.version < SAVE_VERSION ? 'This save is from an older version of the game and cannot be continued.' : `Unsupported save version ${data.version}.`);
  const m = new Match({ ...data.opts, world, restore: true });
  if (m.W !== data.world.width || m.H !== data.world.height || worldFingerprint(m.world) !== data.world.check) {
    throw new Error('The saved world does not match this version of the world generator.');
  }
  m.state = plain(data.state);
  [m.rng.a, m.rng.b, m.rng.c, m.rng.d] = data.rng;
  for (const L of data.layouts) m.layouts.set(L.id, deserializeLayout(plain(L)));
  const n = m.W * m.H;
  m.owner = unrle(data.tiles.owner, Int16Array, n);
  m.struct = unrle(data.tiles.struct, Uint8Array, n);
  for (const s of m.state.structures) m.structAt.set(m.idx(s.x, s.y), s.id);
  m.startSites = plain(data.startSites);
  m.queue = plain(data.queue || []);
  return m;
}

/** Short description for save menus. */
export function describeSave(data) {
  const st = data.state;
  const human = st.players.find((p) => !p.ai) || st.players[0];
  const land = data.world?.land || st.players.reduce((t, p) => t + p.tiles, 0);
  return {
    name: human ? human.name : '?',
    seed: st.seed,
    size: st.size,
    minutes: Math.floor(st.t / 60),
    phase: st.phase,
    players: st.players.length,
    alive: human ? human.alive : false,
    share: human && land ? Math.round((human.tiles / Math.max(1, land)) * 1000) / 10 : 0,
  };
}
