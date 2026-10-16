// Step 1 of the settlement pipeline: analyse the land inside a settlement's
// local square (2R+1 tiles across) and classify every cell for the planner.

import { B, BIOMES, F, TREE_FEATURES } from '../world/biomes.js';

export const R = 24;
export const N = 2 * R + 1;

/** Terrain base classes. */
export const T = Object.freeze({
  BLOCK: 0, // out of the world or impassable peaks
  LAND: 1,
  RIVER: 2, // roads may bridge it
  MARSH: 3, // stilt buildings and boardwalks only
  STEEP: 4, // mountain ground: mines, quarries, stone towns
  SHORE: 5, // water touching land: piers
  WATER: 6, // open water
});

/** Occupancy codes of the local grid. */
export const O = Object.freeze({
  FREE: 0,
  ROAD: 1,
  BUILDING: 2,
  FIELD: 3,
  PLAZA: 4,
  GARDEN: 5,
  APRON: 6, // kept clear beyond a gate so the main road can grow
  WALL: 7,
  DECOR: 8,
  DOCK: 9,
  RESERVE: 10, // lot held for a future civic building
});

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

/**
 * Analyse the local square whose top-left world tile is (ox, oy).
 * Returns typed arrays indexed by local cell ly*N + lx.
 */
export function analyzeLocal(world, ox, oy, seed) {
  const { width: W, height: H, biome, height01, feature } = world;
  const n = N * N;
  const tbase = new Uint8Array(n);
  const slope = new Float32Array(n);
  const tree = new Uint8Array(n);
  const fert = new Float32Array(n);
  const rock = new Uint8Array(n);
  const green = new Uint8Array(n);
  const noise = new Float32Array(n);
  const isWaterB = (b) => b === B.SEA || b === B.DEEP || b === B.LAKE;
  for (let ly = 0; ly < N; ly++) {
    for (let lx = 0; lx < N; lx++) {
      const l = ly * N + lx;
      const wx = ox + lx;
      const wy = oy + ly;
      // Smooth noise for organic road wobble (cheap value noise per cell).
      const nh = Math.imul(wx * 73856093 ^ wy * 19349663 ^ seed, 0x9e3779b1) >>> 0;
      noise[l] = (nh & 0xffff) / 65535;
      if (wx < 1 || wy < 1 || wx >= W - 1 || wy >= H - 1) {
        tbase[l] = T.BLOCK;
        continue;
      }
      const i = wy * W + wx;
      const b = biome[i];
      if (isWaterB(b)) {
        let shore = false;
        for (let d = 0; d < 4; d++) {
          const nb = biome[(wy + DY[d]) * W + wx + DX[d]];
          if (!isWaterB(nb) && nb !== B.RIVER) shore = true;
        }
        tbase[l] = shore ? T.SHORE : T.WATER;
        continue;
      }
      if (b === B.RIVER) {
        tbase[l] = T.RIVER;
        continue;
      }
      if (b === B.PEAK) {
        tbase[l] = T.BLOCK;
        continue;
      }
      tbase[l] = b === B.MOUNTAIN ? T.STEEP : b === B.MARSH ? T.MARSH : T.LAND;
      // Slope from a 3×3-smoothed height field (the raw field carries pixel
      // noise), plus an inherent ruggedness for hill and mountain ground.
      const sh = (x, y) => {
        let sum = 0;
        let cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const v = height01[(y + dy) * W + x + dx];
            if (v >= 0) {
              sum += v;
              cnt++;
            }
          }
        }
        return cnt ? sum / cnt : 0;
      };
      const h0 = sh(wx, wy);
      let s = 0;
      for (let d = 0; d < 4; d++) {
        const nx = wx + DX[d];
        const ny = wy + DY[d];
        if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
        if (height01[ny * W + nx] >= 0) s = Math.max(s, Math.abs(sh(nx, ny) - h0));
      }
      slope[l] = s * 30 + (b === B.HILLS ? 0.35 : b === B.MOUNTAIN ? 0.8 : 0);
      const f = feature[i];
      tree[l] = TREE_FEATURES.has(f) ? 1 : 0;
      fert[l] = BIOMES[b].fert;
      rock[l] = b === B.HILLS || b === B.MOUNTAIN || f === F.ROCK || f === F.BOULDER || f === F.CRAG || f === F.ASHROCK ? 1 : 0;
      green[l] = b === B.FOREST || b === B.MARSH || b === B.TAIGA || b === B.MEADOW || tree[l] ? 1 : 0;
    }
  }
  // Smooth the wobble noise so neighbouring cells correlate.
  const sm = new Float32Array(n);
  for (let ly = 0; ly < N; ly++) {
    for (let lx = 0; lx < N; lx++) {
      let sum = 0;
      let cnt = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = lx + dx;
          const y = ly + dy;
          if (x < 0 || y < 0 || x >= N || y >= N) continue;
          sum += noise[y * N + x];
          cnt++;
        }
      }
      sm[ly * N + lx] = sum / cnt;
    }
  }
  return { tbase, slope, tree, fert, rock, green, noise: sm };
}
