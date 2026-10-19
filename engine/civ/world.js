// The world as the civilization simulator sees it: the generated terrain
// plus what people make of each tile: how much food it yields, how hard it
// is to cross, which climate its buildings are built for, which landmass it
// belongs to and how good a place it is to found a town.

import { generateWorld, WORLD_SIZES } from '../world/worldgen.js';
import { B, BIOMES } from '../world/biomes.js';

export const SIZES = {
  small: WORLD_SIZES.small,
  medium: WORLD_SIZES.medium,
  large: WORLD_SIZES.large,
  huge: WORLD_SIZES.huge,
};

/** Climates (building styles). */
export const CL = Object.freeze({ TEMPERATE: 0, ARID: 1, COLD: 2, TROPICAL: 3, WETLAND: 4 });
export const CLIMATE_KEYS = ['temperate', 'arid', 'cold', 'tropical', 'wetland'];

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

/** Food a tile yields to farmers of the first age (before tools and irrigation). */
const FOOD = new Float32Array(16);
FOOD[B.BEACH] = 0.35;
FOOD[B.GRASS] = 1.0;
FOOD[B.MEADOW] = 1.35;
FOOD[B.FOREST] = 0.55;
FOOD[B.TAIGA] = 0.3;
FOOD[B.MARSH] = 0.45;
FOOD[B.DESERT] = 0.12;
FOOD[B.HILLS] = 0.5;
FOOD[B.MOUNTAIN] = 0.08;
FOOD[B.SNOW] = 0.08;
FOOD[B.ASH] = 0.6;

/** Cost of crossing a tile (territory reach and marching). */
const COST = new Float32Array(16).fill(Infinity);
COST[B.BEACH] = 1.1;
COST[B.GRASS] = 1;
COST[B.MEADOW] = 1;
COST[B.FOREST] = 1.5;
COST[B.TAIGA] = 1.6;
COST[B.MARSH] = 2.2;
COST[B.DESERT] = 1.5;
COST[B.HILLS] = 1.9;
COST[B.MOUNTAIN] = 3.5;
COST[B.PEAK] = 9;
COST[B.SNOW] = 2.2;
COST[B.ASH] = 1.6;
COST[B.RIVER] = 2.6;

export function isSea(b) {
  return b === B.DEEP || b === B.SEA;
}

export function isOpen(b) {
  return b === B.DEEP || b === B.SEA || b === B.LAKE;
}

/** Generate a world and derive the simulator's per-tile data. */
export function makeWorld({ seed = 1, size = 'medium', landFraction = 0.42 } = {}) {
  const dims = SIZES[size] || SIZES.medium;
  const world = generateWorld({ seed, width: dims.width, height: dims.height, landFraction });
  world.size = size;
  derive(world);
  return world;
}

export function derive(world) {
  const { width: W, height: H, biome, temp, moist, waterDist } = world;
  const N = W * H;
  const food = new Float32Array(N);
  const cost = new Float32Array(N);
  const climate = new Uint8Array(N);
  const coast = new Uint8Array(N); // 1 sea coast, 2 lake shore
  for (let i = 0; i < N; i++) {
    const b = biome[i];
    cost[i] = COST[b];
    if (isOpen(b)) continue;
    let f = FOOD[b];
    // Irrigation: land by rivers and lakes is far richer.
    if (waterDist[i] <= 2 && b !== B.MOUNTAIN && b !== B.SNOW) f += b === B.DESERT ? 0.6 : 0.3;
    if (temp[i] < 0.22) f *= 0.6;
    food[i] = f;
    const t = temp[i];
    const m = moist[i];
    let c = CL.TEMPERATE;
    if (b === B.MARSH) c = CL.WETLAND;
    else if (b === B.DESERT || (b === B.ASH && t > 0.5) || (t > 0.6 && m < 0.42 && b !== B.FOREST)) c = CL.ARID;
    else if (b === B.SNOW || b === B.TAIGA || t < 0.3) c = CL.COLD;
    else if (t > 0.68 && m > 0.55) c = CL.TROPICAL;
    climate[i] = c;
    const x = i % W;
    const y = (i / W) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const nb = biome[ny * W + nx];
      if (isSea(nb)) coast[i] = 1;
      else if (nb === B.LAKE && !coast[i]) coast[i] = 2;
    }
  }
  // Landmasses (rivers join their banks).
  const part = new Int32Array(N).fill(-1);
  const partSize = [];
  const stack = [];
  for (let i = 0; i < N; i++) {
    if (part[i] >= 0 || isOpen(biome[i])) continue;
    const id = partSize.length;
    let n = 0;
    part[i] = id;
    stack.push(i);
    while (stack.length) {
      const c = stack.pop();
      n++;
      const x = c % W;
      const y = (c / W) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (part[ni] >= 0 || isOpen(biome[ni])) continue;
        part[ni] = id;
        stack.push(ni);
      }
    }
    partSize.push(n);
  }
  // How good a place is to found a town: food within a few tiles, fresh
  // water, a harbour, defensible ground; never on water, peaks or marsh.
  const sum = boxSum(W, H, food, 3);
  const site = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const b = biome[i];
    if (isOpen(b) || b === B.RIVER || b === B.PEAK || b === B.MOUNTAIN || b === B.MARSH || b === B.SNOW) continue;
    if (BIOMES[b].build !== 1) continue;
    let s = sum[i];
    if (waterDist[i] <= 1) s += 6;
    else if (waterDist[i] <= 2) s += 3;
    if (coast[i] === 1) s += 5;
    else if (coast[i] === 2) s += 2;
    if (b === B.HILLS) s += 1;
    if (b === B.DESERT) s *= 0.5;
    if (partSize[part[i]] < 12) s *= 0.3;
    site[i] = s;
  }
  Object.assign(world, { food, cost, climate, coast, part, partSize, site });
  return world;
}

/** Sum of v over the (2r+1)² box round every cell. */
export function boxSum(W, H, v, r) {
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += v[y * W + x];
      I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(W, x + r + 1);
      out[y * W + x] = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
    }
  }
  return out;
}
