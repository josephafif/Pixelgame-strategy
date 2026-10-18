// Strategic world generator for Realmwright.
//
// Pipeline: continental elevation → mountain ridges → sea level by land
// fraction → drainage (priority flood) → lakes → flow accumulation → rivers →
// climate (temperature, moisture) → biomes → vegetation → deposits.
// The output is a plain object of typed arrays; the same seed and size always
// yield the same world.

import { Rng, hash3 } from '../core/rng.js';
import { fbm, ridged, gradNoise } from '../core/noise.js';
import { MinHeap } from '../core/heap.js';
import { B, BIOMES, F, D, isWater } from './biomes.js';

export const WORLD_SIZES = {
  test: { width: 160, height: 112 },
  small: { width: 320, height: 224 },
  medium: { width: 448, height: 304 },
  large: { width: 576, height: 400 },
  huge: { width: 768, height: 544 },
  vast: { width: 1024, height: 704 },
};

const DX4 = [1, -1, 0, 0];
const DY4 = [0, 0, 1, -1];

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function percentile(values, p) {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];
}

/** Breadth-first distance (4-neighbour steps) from all cells where isSource(i). */
export function bfsDistance(w, h, isSource, cap = 255) {
  const dist = new Uint8Array(w * h).fill(cap);
  const queue = new Int32Array(w * h);
  let qh = 0;
  let qt = 0;
  for (let i = 0; i < w * h; i++) {
    if (isSource(i)) {
      dist[i] = 0;
      queue[qt++] = i;
    }
  }
  while (qh < qt) {
    const c = queue[qh++];
    const cx = c % w;
    const cy = (c / w) | 0;
    const nd = dist[c] + 1;
    if (nd >= cap) continue;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX4[d];
      const ny = cy + DY4[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (dist[ni] > nd) {
        dist[ni] = nd;
        queue[qt++] = ni;
      }
    }
  }
  return dist;
}

export function generateWorld({ seed = 1, width = 448, height = 304, landFraction = 0.5 } = {}) {
  const W = width;
  const H = height;
  const N = W * H;
  const rng = new Rng(seed);
  const s = (k) => (seed * 31 + k * 7919) | 0;

  // 1. Continental elevation with domain warping and a few continent blobs.
  const e0 = new Float32Array(N);
  const minDim = Math.min(W, H);
  const cs = 2.6 / minDim; // continent scale
  const blobs = [];
  const nBlobs = 3 + rng.int(0, 2);
  for (let k = 0; k < nBlobs; k++) {
    blobs.push({
      x: rng.range(0.2, 0.8) * W,
      y: rng.range(0.22, 0.78) * H,
      r: rng.range(0.22, 0.34) * minDim,
      a: rng.range(0.12, 0.24),
    });
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const wx = fbm(x * cs * 0.7, y * cs * 0.7, s(1), 3) * 1.3;
      const wy = fbm(x * cs * 0.7 + 9.1, y * cs * 0.7 - 4.3, s(2), 3) * 1.3;
      let v = fbm(x * cs + wx, y * cs + wy, s(3), 6) * 0.8;
      for (const b of blobs) {
        const dx = x - b.x;
        const dy = y - b.y;
        v += b.a * Math.exp(-(dx * dx + dy * dy) / (2 * b.r * b.r));
      }
      const ex = Math.abs(x / W - 0.5) * 2;
      const ey = Math.abs(y / H - 0.5) * 2;
      v -= smoothstep(0.78, 1.0, Math.max(ex, ey)) * 0.8;
      e0[y * W + x] = v;
    }
  }
  const sea = percentile(e0, 1 - landFraction);

  // 2. Mountain ridges raise land (never the sea floor), so land fraction holds.
  const elev = new Float32Array(N);
  const rs = 4.2 / minDim;
  const ms = 2.0 / minDim;
  let maxE = -Infinity;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const land = smoothstep(0, 0.22, e0[i] - sea);
      const r = ridged(x * rs, y * rs, s(4), 4);
      const mask = smoothstep(-0.1, 0.45, fbm(x * ms, y * ms, s(5), 3));
      const detail = fbm(x * 0.09, y * 0.09, s(6), 3) * 0.025;
      const v = e0[i] + (r * r * 0.75 * mask + detail) * land;
      elev[i] = v;
      if (v > maxE) maxE = v;
    }
  }

  const biome = new Uint8Array(N);
  const isSeaArr = new Uint8Array(N);
  for (let i = 0; i < N; i++) isSeaArr[i] = elev[i] < sea ? 1 : 0;
  // Land height normalised to [0,1]; water cells get negative depth.
  const hgt = new Float32Array(N);
  for (let i = 0; i < N; i++) hgt[i] = isSeaArr[i] ? elev[i] - sea : (elev[i] - sea) / (maxE - sea);

  // 3. Drainage: priority flood from the sea gives every land cell a
  //    downstream neighbour and fills depressions.
  const filled = new Float32Array(N);
  const down = new Int32Array(N).fill(-1);
  const order = new Int32Array(N);
  let orderLen = 0;
  {
    const visited = new Uint8Array(N);
    const heap = new MinHeap();
    for (let i = 0; i < N; i++) {
      if (isSeaArr[i]) {
        visited[i] = 1;
        filled[i] = hgt[i];
        // Seed with sea cells that border land.
        const x = i % W;
        const y = (i / W) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX4[d];
          const ny = y + DY4[d];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (!isSeaArr[ny * W + nx]) {
            heap.push(i, -1);
            break;
          }
        }
      }
    }
    // A land cell on the map edge (rare) drains off the map.
    for (let i = 0; i < N; i++) {
      const x = i % W;
      const y = (i / W) | 0;
      if (!isSeaArr[i] && (x === 0 || y === 0 || x === W - 1 || y === H - 1)) {
        visited[i] = 1;
        filled[i] = hgt[i];
        heap.push(i, hgt[i]);
        order[orderLen++] = i;
      }
    }
    while (heap.size > 0) {
      const c = heap.pop();
      const cx = c % W;
      const cy = (c / W) | 0;
      const base = isSeaArr[c] ? 0 : filled[c];
      // Visit neighbours in a seed-dependent rotation to avoid directional bias.
      const rot = hash3(cx, cy, seed) & 3;
      for (let k = 0; k < 4; k++) {
        const d = (k + rot) & 3;
        const nx = cx + DX4[d];
        const ny = cy + DY4[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (visited[ni]) continue;
        visited[ni] = 1;
        filled[ni] = Math.max(hgt[ni], base + 1e-5);
        down[ni] = c;
        order[orderLen++] = ni;
        heap.push(ni, filled[ni]);
      }
    }
  }

  // 4. Lakes: deep enough depressions with a reasonable area.
  const lake = new Uint8Array(N);
  {
    const cand = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (!isSeaArr[i] && filled[i] - hgt[i] > 0.012) cand[i] = 1;
    const seen = new Uint8Array(N);
    const stack = [];
    for (let i = 0; i < N; i++) {
      if (!cand[i] || seen[i]) continue;
      const comp = [];
      stack.push(i);
      seen[i] = 1;
      while (stack.length) {
        const c = stack.pop();
        comp.push(c);
        const cx = c % W;
        const cy = (c / W) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = cx + DX4[d];
          const ny = cy + DY4[d];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (cand[ni] && !seen[ni]) {
            seen[ni] = 1;
            stack.push(ni);
          }
        }
      }
      if (comp.length >= 10) for (const c of comp) lake[c] = 1;
    }
  }

  // 5. Flow accumulation in reverse flood order (upstream first).
  const flow = new Float32Array(N);
  for (let k = orderLen - 1; k >= 0; k--) {
    const i = order[k];
    const x = i % W;
    const y = (i / W) | 0;
    const rain = 0.6 + 0.4 * fbm(x * 0.02, y * 0.02, s(7), 2);
    flow[i] += rain;
    const dn = down[i];
    if (dn >= 0 && !isSeaArr[dn]) flow[dn] += flow[i];
  }
  const landFlows = [];
  for (let i = 0; i < N; i++) if (!isSeaArr[i] && !lake[i]) landFlows.push(flow[i]);
  const riverT = percentile(landFlows, 0.977);
  const river = new Uint8Array(N); // 0 none, 1 stream, 2 river, 3 great river
  for (let i = 0; i < N; i++) {
    if (isSeaArr[i] || lake[i]) continue;
    const f = flow[i];
    if (f >= riverT) river[i] = f >= riverT * 14 ? 3 : f >= riverT * 4 ? 2 : 1;
  }

  // 6. Coastal shelf: shallow sea within a few cells of land.
  const landDist = bfsDistance(W, H, (i) => !isSeaArr[i], 32);

  // 7. Climate.
  const temp = new Float32Array(N);
  const moist = new Float32Array(N);
  const waterDist = bfsDistance(W, H, (i) => isSeaArr[i] || lake[i] || river[i] > 0, 64);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const lat = y / (H - 1);
      const t = 0.06 + 0.92 * lat + fbm(x * 0.012, y * 0.012, s(8), 3) * 0.14 - Math.max(0, hgt[i]) * 0.3;
      temp[i] = t;
      const m = 0.5 + 0.5 * fbm(x * 0.016, y * 0.016, s(9), 4) + 0.32 * Math.exp(-waterDist[i] / 9) - 0.15;
      moist[i] = Math.min(1, Math.max(0, m));
    }
  }

  // 8. Height thresholds by land percentile keep proportions stable per seed.
  const landH = [];
  for (let i = 0; i < N; i++) if (!isSeaArr[i] && !lake[i]) landH.push(hgt[i]);
  const hillsT = percentile(landH, 0.78);
  const mountT = percentile(landH, 0.905);
  const peakT = percentile(landH, 0.972);

  // Volcanic regions: a few warm-latitude hotspots.
  const volcanoes = [];
  const nVol = Math.max(1, Math.round(N / 110000));
  for (let tries = 0; tries < 400 && volcanoes.length < nVol; tries++) {
    const x = rng.int(Math.floor(W * 0.1), Math.floor(W * 0.9));
    const y = rng.int(Math.floor(H * 0.45), Math.floor(H * 0.9));
    const i = y * W + x;
    if (isSeaArr[i] || lake[i]) continue;
    if (hgt[i] < 0.15 || waterDist[i] < 4) continue;
    if (volcanoes.some((v) => Math.hypot(v.x - x, v.y - y) < minDim * 0.4)) continue;
    volcanoes.push({ x, y, r: rng.range(0.06, 0.09) * minDim });
  }

  // 9. Biomes.
  const fs = 0.022;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (isSeaArr[i]) {
        biome[i] = landDist[i] <= 3 ? B.SEA : B.DEEP;
        continue;
      }
      if (lake[i]) {
        biome[i] = B.LAKE;
        continue;
      }
      if (river[i]) {
        biome[i] = B.RIVER;
        continue;
      }
      const h = hgt[i];
      const t = temp[i];
      const m = moist[i];
      let ash = false;
      for (const v of volcanoes) {
        const warp = gradNoise(x * 0.08, y * 0.08, s(10)) * 0.35;
        if (Math.hypot(x - v.x, y - v.y) < v.r * (1 + warp)) ash = true;
      }
      let b;
      if (h >= peakT) b = B.PEAK;
      else if (h >= mountT) b = B.MOUNTAIN;
      else if (ash) b = B.ASH;
      else if (t < 0.13) b = B.SNOW;
      else if (h >= hillsT) b = B.HILLS;
      else if (t < 0.25) b = m > 0.36 ? B.TAIGA : B.SNOW;
      else if (t > 0.66 && m < 0.5) b = B.DESERT;
      else if (m > 0.66 && h < hillsT * 0.5 && waterDist[i] < 12) b = B.MARSH;
      else {
        const forestN = fbm(x * fs, y * fs, s(11), 4) + (m - 0.5) * 0.9;
        b = forestN > 0.12 ? B.FOREST : B.GRASS;
      }
      // Beaches along warm/temperate sea coasts.
      if (landDist[i] === 1 && h < 0.09 && b !== B.SNOW && b !== B.PEAK && b !== B.MOUNTAIN && b !== B.MARSH) b = B.BEACH;
      biome[i] = b;
    }
  }
  // Thin lake slivers (one-cell fingers along a river) read badly; fold them
  // into the river or the surrounding land.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      if (biome[i] !== B.LAKE) continue;
      const x = i % W;
      const y = (i / W) | 0;
      let lakeN = 0;
      let riverN = false;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX4[d];
        const ny = y + DY4[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nb = biome[ny * W + nx];
        if (nb === B.LAKE) lakeN++;
        if (nb === B.RIVER || nb === B.SEA || nb === B.DEEP) riverN = true;
      }
      if (lakeN <= 1) {
        biome[i] = riverN ? B.RIVER : B.GRASS;
        lake[i] = 0;
        if (riverN) river[i] = Math.max(1, river[i]);
      }
    }
  }

  // Fertile river valleys and oases.
  for (let i = 0; i < N; i++) {
    const b = biome[i];
    if ((b === B.GRASS || b === B.DESERT || b === B.FOREST && waterDist[i] <= 1) && waterDist[i] <= (b === B.DESERT ? 2 : 3)) {
      const x = i % W;
      const y = (i / W) | 0;
      let nearRiver = false;
      for (let dy = -3; dy <= 3 && !nearRiver; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (biome[ni] === B.RIVER || biome[ni] === B.LAKE) {
            nearRiver = true;
            break;
          }
        }
      }
      if (nearRiver && hgt[i] < hillsT * 0.8) biome[i] = B.MEADOW;
    }
  }

  // 10. Vegetation and rocks.
  const feature = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const r = hash3(x, y, s(12)) / 4294967296;
      const r2 = hash3(x, y, s(13)) / 4294967296;
      const clear = fbm(x * 0.09, y * 0.09, s(14), 3);
      const grove = fbm(x * 0.07, y * 0.07, s(15), 3);
      let f = F.NONE;
      switch (biome[i]) {
        case B.FOREST: {
          const dens = clear < -0.28 ? 0.06 : 0.72;
          if (r < dens) f = r2 < 0.18 ? F.BIRCH : F.OAK;
          else if (r < dens + 0.05) f = F.BUSH;
          else if (r < dens + 0.065) f = F.ROCK;
          break;
        }
        case B.TAIGA: {
          const dens = clear < -0.3 ? 0.06 : 0.66;
          if (r < dens) f = F.PINE;
          else if (r < dens + 0.04) f = F.ROCK;
          break;
        }
        case B.GRASS: {
          const dens = grove > 0.3 ? 0.36 : 0.025;
          if (r < dens) f = r2 < 0.12 ? F.BIRCH : F.OAK;
          else if (r < dens + 0.03) f = F.BUSH;
          else if (r < dens + 0.042) f = F.ROCK;
          break;
        }
        case B.MEADOW:
          if (r < 0.015) f = F.OAK;
          else if (r < 0.035) f = F.BUSH;
          else if (r < 0.04) f = F.ROCK;
          break;
        case B.HILLS:
          if (r < (grove > 0.2 ? 0.3 : 0.07)) f = temp[i] < 0.38 ? F.PINE : F.OAK;
          else if (r < 0.36 && r > 0.25) f = r2 < 0.3 ? F.BOULDER : F.ROCK;
          else if (r > 0.95) f = F.BUSH;
          break;
        case B.MOUNTAIN:
          if (r < 0.18) f = F.CRAG;
          else if (r < 0.27) f = F.ROCK;
          else if (r < 0.31 && temp[i] > 0.25) f = F.PINE;
          break;
        case B.SNOW:
          if (r < 0.05) f = F.SNOWPINE;
          else if (r < 0.08) f = F.ROCK;
          break;
        case B.DESERT:
          if (waterDist[i] <= 2 && r < 0.25) f = F.PALM;
          else if (r < 0.035) f = F.CACTUS;
          else if (r < 0.06) f = F.ROCK;
          break;
        case B.MARSH:
          if (r < 0.22) f = F.REEDS;
          else if (r < 0.3) f = F.WILLOW;
          else if (r < 0.34) f = F.BUSH;
          break;
        case B.ASH:
          if (r < 0.05) f = F.DEADTREE;
          else if (r < 0.15) f = F.ASHROCK;
          break;
        case B.BEACH:
          if (temp[i] > 0.55 && r < 0.05) f = F.PALM;
          else if (r < 0.07) f = F.ROCK;
          break;
        default:
          break;
      }
      feature[i] = f;
    }
  }

  // 11. Deposits.
  const deposit = new Uint8Array(N);
  const depAmt = new Uint8Array(N);
  const landCount = landH.length;
  const placeDeposits = (type, biomesOk, count, minDist, clusterMax, extraOk) => {
    const placed = [];
    for (let tries = 0; tries < count * 80 && placed.length < count; tries++) {
      const x = rng.int(2, W - 3);
      const y = rng.int(2, H - 3);
      const i = y * W + x;
      if (!biomesOk.includes(biome[i]) || deposit[i]) continue;
      if (extraOk && !extraOk(i)) continue;
      if (placed.some((p) => Math.abs(p.x - x) + Math.abs(p.y - y) < minDist)) continue;
      placed.push({ x, y });
      const rich = rng.int(150, 255);
      const size = rng.int(1, clusterMax);
      let cx = x;
      let cy = y;
      for (let k = 0; k < size; k++) {
        const ci = cy * W + cx;
        if (biomesOk.includes(biome[ci]) && !deposit[ci]) {
          deposit[ci] = type;
          depAmt[ci] = rich;
        }
        const d = rng.int(0, 3);
        cx = Math.min(W - 2, Math.max(1, cx + DX4[d]));
        cy = Math.min(H - 2, Math.max(1, cy + DY4[d]));
      }
    }
    return placed.length;
  };
  placeDeposits(D.IRON, [B.HILLS, B.MOUNTAIN], Math.max(8, Math.round(landCount / 1700)), 14, 4);
  placeDeposits(D.COAL, [B.HILLS, B.MARSH, B.MOUNTAIN, B.TAIGA], Math.max(7, Math.round(landCount / 2200)), 14, 3);
  placeDeposits(D.CRYSTAL, [B.ASH], Math.max(3, Math.round(landCount / 9000)), 10, 3);
  placeDeposits(D.CRYSTAL, [B.MOUNTAIN, B.SNOW], Math.max(2, Math.round(landCount / 14000)), 30, 2, (i) => hgt[i] > mountT * 0.9 || biome[i] === B.SNOW);
  placeDeposits(D.HERBS, [B.FOREST, B.MARSH, B.TAIGA, B.MEADOW], Math.max(8, Math.round(landCount / 1800)), 12, 4);
  placeDeposits(D.STONE, [B.HILLS, B.MOUNTAIN, B.DESERT], Math.max(5, Math.round(landCount / 3500)), 16, 3);
  placeDeposits(D.FISH, [B.SEA, B.LAKE], Math.max(8, Math.round(landCount / 1500)), 10, 4);
  // Deposits clear the tree on their tile so they stay visible.
  for (let i = 0; i < N; i++) if (deposit[i] && deposit[i] !== D.HERBS && deposit[i] !== D.FISH) feature[i] = F.NONE;

  return {
    seed,
    width: W,
    height: H,
    biome,
    height01: hgt,
    river,
    feature,
    deposit,
    depAmt,
    temp,
    moist,
    waterDist,
    landDist,
    thresholds: { hillsT, mountT, peakT },
    volcanoes,
  };
}

/** Convenience accessors used across engine and client. */
export function inBounds(world, x, y) {
  return x >= 0 && y >= 0 && x < world.width && y < world.height;
}

export function biomeAt(world, x, y) {
  return world.biome[y * world.width + x];
}

export function passable(world, i) {
  return BIOMES[world.biome[i]].move !== Infinity;
}

export function isLandIdx(world, i) {
  return !isWater(world.biome[i]);
}
