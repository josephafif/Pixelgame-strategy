// Chunk renderer for the ground layer: per-pixel terrain with ragged biome
// transitions, relief shading, water depth, shore foam and wet banks, small
// ground details, roads, bridges, plazas, fields and gardens, plus the
// natural objects standing on tiles (trees, rocks) with soft cast shadows.
// A chunk is drawn once into a canvas and cached.

import { valueNoise } from '../../engine/core/noise.js';
import { hash3 } from '../../engine/core/rng.js';
import { B, TREE_FEATURES } from '../../engine/world/biomes.js';
import { GROUND, FOAM, FOAM2, WET_SAND, WATER_DEPTH, ROADS, CROPS } from './palette.js';
import { rgb, hex, mix, ramp7, packABGR, BAYER4 } from './color.js';
import { makeCanvas } from './pix.js';
import { natureSprite } from './nature.js';

export const TILE = 16;
export const CHUNK = 32; // tiles per chunk side

/** Ground overlay codes (per tile), written by the client from layouts. */
export const G = Object.freeze({
  NONE: 0,
  PLAZA_EARTH: 1,
  PLAZA_PAVED: 2,
  VEG: 3,
  FLOWERS: 4,
  YARD: 5,
  FIELD: 6,
  YARD_EARTH: 7, // packed earth around work buildings
});

/** Road render codes (per tile). */
export const RC = Object.freeze({ NONE: 0, DIRT: 1, STREET: 2, PATH: 3, COBBLE: 4, PLANK: 5, SAND: 6 });

const CROP_KEYS = Object.keys(CROPS);
export function cropIndex(name) {
  return Math.max(0, CROP_KEYS.indexOf(name)) + 1;
}

// Pack colours to little-endian ABGR uint32 for fast ImageData writes.
const packCache = new Map();
function pack(c) {
  let v = packCache.get(c);
  if (v === undefined) {
    v = packABGR(c);
    packCache.set(c, v);
  }
  return v;
}

const isWaterB = (b) => b <= B.RIVER;

// Relief (slope light) and forest shade strength per biome, in ramp steps.
const RELIEF = new Float32Array(16).fill(12);
RELIEF[B.HILLS] = 24;
RELIEF[B.TAIGA] = 18;
RELIEF[B.MOUNTAIN] = 34;
RELIEF[B.PEAK] = 30;
RELIEF[B.SNOW] = 22;
RELIEF[B.ASH] = 22;
RELIEF[B.MARSH] = 8;
RELIEF[B.BEACH] = 8;
RELIEF[B.DESERT] = 16;
const SHADE = new Float32Array(16).fill(1.4);
SHADE[B.SNOW] = 0.9;
SHADE[B.DESERT] = 1;

/** RGB offset: c + (to - from). */
function offset(c, from, to) {
  const [r, g, b] = rgb(c);
  const [r1, g1, b1] = rgb(from);
  const [r2, g2, b2] = rgb(to);
  return hex([r + r2 - r1, g + g2 - g1, b + b2 - b1]);
}

// Packed 7-step ramps (−3 … +3 around the fill) for both ground tones of
// every biome, and depth ramps for water. Built once.
let RAMPS = null;
function ramps() {
  if (RAMPS) return RAMPS;
  const land = [];
  for (let b = 0; b < 16; b++) {
    const pal = GROUND[b];
    if (!pal) {
      land.push(null);
      continue;
    }
    const a = ramp7(pal.base, pal.dark, pal.light).map((c) => packABGR(c));
    const b2 = ramp7(pal.base2, offset(pal.base2, pal.base, pal.dark), offset(pal.base2, pal.base, pal.light)).map((c) => packABGR(c));
    land.push([Uint32Array.from(a), Uint32Array.from(b2)]);
  }
  const water = {};
  for (const k of Object.keys(WATER_DEPTH)) water[k] = Uint32Array.from(WATER_DEPTH[k].map((c) => packABGR(c)));
  const waterLight = {};
  for (const k of Object.keys(WATER_DEPTH)) waterLight[k] = Uint32Array.from(WATER_DEPTH[k].map((c) => packABGR(mix(c, '#e6f3e6', 0.32))));
  RAMPS = {
    land,
    water,
    waterLight,
    foam: pack(FOAM),
    foam2: pack(FOAM2),
    wet: pack(WET_SAND),
    wet2: pack(mix(WET_SAND, GROUND[B.BEACH].base, 0.5)),
    wetDesert2: pack(mix(WET_SAND, GROUND[B.DESERT].base, 0.5)),
    snow: pack(GROUND[B.MOUNTAIN].snow),
    snow2: pack('#e3e6e0'),
    sparkle: pack('#f4f7ec'),
  };
  return RAMPS;
}

// Scratch canvas for the chunk's shadow mask (painting is single-threaded
// per worker, so one is enough).
let maskCanvas = null;
const SHADOW_ALPHA = 0.36;

/**
 * Render chunk (cx, cy) to a canvas of CHUNK*TILE pixels.
 * ov: { road: Uint8Array, ground: Uint8Array, crop: Uint8Array, cleared: Uint8Array }
 * opts.noObjects: leave out trees and rocks.
 */
export function renderChunk(world, cx, cy, ov, opts = {}) {
  const { width: W, height: H, biome, height01, feature } = world;
  const S = CHUNK * TILE;
  const M = 3; // pixel margin for neighbourhood tests
  const SM = S + 2 * M;
  const X0 = cx * S - M;
  const Y0 = cy * S - M;
  const seed = world.seed | 0;
  const R = ramps();
  const cls = new Uint8Array(SM * SM); // warped biome per pixel
  // Tiles with a river within one tile need the (costlier) channel test.
  const TX0 = Math.floor(X0 / TILE) - 1;
  const TY0 = Math.floor(Y0 / TILE) - 1;
  const TN = Math.ceil(SM / TILE) + 3;
  const nearRiver = new Uint8Array(TN * TN);
  for (let ty = 0; ty < TN; ty++) {
    for (let tx = 0; tx < TN; tx++) {
      let hit = 0;
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = TX0 + tx + dx;
          const y = TY0 + ty + dy;
          if (x >= 0 && y >= 0 && x < W && y < H && biome[y * W + x] === B.RIVER) {
            hit = 1;
            break;
          }
        }
      }
      nearRiver[ty * TN + tx] = hit;
    }
  }
  for (let py = 0; py < SM; py++) {
    const Y = Y0 + py;
    for (let px = 0; px < SM; px++) {
      const X = X0 + px;
      const hh = hash3(X, Y, seed);
      const jx = ((hh & 3) - 1.5) * 0.7;
      const jy = (((hh >> 2) & 3) - 1.5) * 0.7;
      const wx = (valueNoise(X * 0.14, Y * 0.14, seed + 11) - 0.5) * 6 + jx;
      const wy = (valueNoise(X * 0.14 + 31.7, Y * 0.14 - 7.1, seed + 12) - 0.5) * 6 + jy;
      let tx = Math.floor((X + wx) / TILE);
      let ty = Math.floor((Y + wy) / TILE);
      if (tx < 0) tx = 0;
      if (ty < 0) ty = 0;
      if (tx >= W) tx = W - 1;
      if (ty >= H) ty = H - 1;
      let b = biome[ty * W + tx];
      // Rivers are drawn as smooth channels along their centre line instead
      // of tile blocks: a pixel is river if it lies close to a segment joining
      // neighbouring river tiles (diagonal shortcuts round off the bends).
      const ux = Math.floor(X / TILE);
      const uy = Math.floor(Y / TILE);
      const nr = nearRiver[(uy - TY0) * TN + (ux - TX0)];
      if (nr) {
        if (b === B.RIVER) b = riverBank(world, ux, uy);
        if (riverWidthAt(world, X + wx * 0.25, Y + wy * 0.25, ux, uy)) b = B.RIVER;
      }
      cls[py * SM + px] = b;
    }
  }

  const canvas = makeCanvas(S, S);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const buf = new Uint32Array(img.data.buffer);
  const hAt = (fx, fy) => {
    const x0 = Math.max(0, Math.min(W - 2, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(H - 2, Math.floor(fy)));
    const tx = Math.min(1, Math.max(0, fx - x0));
    const ty = Math.min(1, Math.max(0, fy - y0));
    const a = Math.max(0, height01[y0 * W + x0]);
    const b2 = Math.max(0, height01[y0 * W + x0 + 1]);
    const c = Math.max(0, height01[(y0 + 1) * W + x0]);
    const d = Math.max(0, height01[(y0 + 1) * W + x0 + 1]);
    return a + (b2 - a) * tx + (c - a) * ty + (a - b2 - c + d) * tx * ty;
  };
  const { mountT, peakT } = world.thresholds;
  const snowLine = mountT + (peakT - mountT) * 0.65;
  const tx0 = cx * CHUNK;
  const ty0 = cy * CHUNK;
  // Per tile (with a one-tile ring): slope light, height, tree cover and
  // distance to land (water depth). Interpolated per pixel later.
  const GT = CHUNK + 2;
  const gLit = new Float32Array(GT * GT);
  const gH = new Float32Array(GT * GT);
  const gTree = new Float32Array(GT * GT);
  for (let ty = 0; ty < GT; ty++) {
    for (let tx = 0; tx < GT; tx++) {
      const fx = tx0 + tx - 1;
      const fy = ty0 + ty - 1;
      const gx = hAt(fx + 0.5, fy) - hAt(fx - 0.5, fy);
      const gy = hAt(fx, fy + 0.5) - hAt(fx, fy - 0.5);
      gLit[ty * GT + tx] = -(gx * 0.7 + gy * 0.9);
      gH[ty * GT + tx] = hAt(fx, fy);
      let trees = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = fx + dx;
          const y = fy + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const i = y * W + x;
          if (TREE_FEATURES.has(feature[i]) && !ov.cleared[i]) trees += dx || dy ? 1 : 1.5;
        }
      }
      gTree[ty * GT + tx] = Math.min(1, trees / 8);
    }
  }
  // Water depth: chamfer distance (in tiles) to the nearest land tile, over
  // the chunk plus a margin wide enough that chunks agree at their seams.
  const MG = 7;
  const DT = CHUNK + 2 * MG;
  const dist = new Float32Array(DT * DT);
  for (let ty = 0; ty < DT; ty++) {
    for (let tx = 0; tx < DT; tx++) {
      const x = tx0 + tx - MG;
      const y = ty0 + ty - MG;
      const water = x < 0 || y < 0 || x >= W || y >= H || isWaterB(biome[y * W + x]);
      dist[ty * DT + tx] = water ? 99 : 0;
    }
  }
  for (let ty = 0; ty < DT; ty++) {
    for (let tx = 0; tx < DT; tx++) {
      const i = ty * DT + tx;
      let d = dist[i];
      if (d === 0) continue;
      if (tx > 0) d = Math.min(d, dist[i - 1] + 1);
      if (ty > 0) {
        d = Math.min(d, dist[i - DT] + 1);
        if (tx > 0) d = Math.min(d, dist[i - DT - 1] + 1.41);
        if (tx < DT - 1) d = Math.min(d, dist[i - DT + 1] + 1.41);
      }
      dist[i] = d;
    }
  }
  for (let ty = DT - 1; ty >= 0; ty--) {
    for (let tx = DT - 1; tx >= 0; tx--) {
      const i = ty * DT + tx;
      let d = dist[i];
      if (d === 0) continue;
      if (tx < DT - 1) d = Math.min(d, dist[i + 1] + 1);
      if (ty < DT - 1) {
        d = Math.min(d, dist[i + DT] + 1);
        if (tx < DT - 1) d = Math.min(d, dist[i + DT + 1] + 1.41);
        if (tx > 0) d = Math.min(d, dist[i + DT - 1] + 1.41);
      }
      dist[i] = Math.min(d, MG);
    }
  }
  const sampleDist = (fx, fy) => {
    // fx, fy in tile units relative to the chunk origin (tile centres at +0.5).
    const gx = fx - 0.5 + MG;
    const gy = fy - 0.5 + MG;
    const x0 = Math.max(0, Math.min(DT - 2, Math.floor(gx)));
    const y0 = Math.max(0, Math.min(DT - 2, Math.floor(gy)));
    const tx = gx - x0;
    const ty = gy - y0;
    const a = dist[y0 * DT + x0];
    const b2 = dist[y0 * DT + x0 + 1];
    const c = dist[(y0 + 1) * DT + x0];
    const d = dist[(y0 + 1) * DT + x0 + 1];
    return a + (b2 - a) * tx + (c - a) * ty + (a - b2 - c + d) * tx * ty;
  };
  const interp = (arr, X, Y) => {
    const fx = X / TILE - 0.5 - tx0 + 1;
    const fy = Y / TILE - 0.5 - ty0 + 1;
    const x0 = Math.max(0, Math.min(GT - 2, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(GT - 2, Math.floor(fy)));
    const tx = fx - x0;
    const ty = fy - y0;
    const a = arr[y0 * GT + x0];
    const b2 = arr[y0 * GT + x0 + 1];
    const c = arr[(y0 + 1) * GT + x0];
    const d = arr[(y0 + 1) * GT + x0 + 1];
    return a + (b2 - a) * tx + (c - a) * ty + (a - b2 - c + d) * tx * ty;
  };
  // Slowly varying fields, sampled per 4×4 block.
  const BN = S >> 2;
  const lowLand = new Float32Array(BN * BN);
  const lowWater = new Float32Array(BN * BN);
  const blkLit = new Float32Array(BN * BN);
  const blkTree = new Float32Array(BN * BN);
  const blkDepth = new Float32Array(BN * BN);
  for (let by = 0; by < BN; by++) {
    for (let bx = 0; bx < BN; bx++) {
      const X = cx * S + bx * 4 + 2;
      const Y = cy * S + by * 4 + 2;
      const k = by * BN + bx;
      lowLand[k] = valueNoise(X / 26, Y / 26, seed + 22);
      lowWater[k] = valueNoise(X / 20, Y / 20, seed + 21);
      blkLit[k] = interp(gLit, X, Y);
      blkTree[k] = interp(gTree, X, Y);
      blkDepth[k] = sampleDist((bx * 4 + 2) / TILE, (by * 4 + 2) / TILE);
    }
  }
  // Tiles where shore effects can happen (land within reach of water or
  // the other way round); everywhere else skips the neighbourhood tests.
  const shoreTile = new Uint8Array(CHUNK * CHUNK);
  for (let ty = 0; ty < CHUNK; ty++) {
    for (let tx = 0; tx < CHUNK; tx++) {
      let land = 0;
      let water = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = tx0 + tx + dx;
          const y = ty0 + ty + dy;
          const bb = x < 0 || y < 0 || x >= W || y >= H ? B.DEEP : biome[y * W + x];
          if (isWaterB(bb)) water = 1;
          else land = 1;
        }
      }
      const rv = nearRiver[(ty0 + ty - TY0) * TN + (tx0 + tx - TX0)];
      shoreTile[ty * CHUNK + tx] = (land && water) || rv ? 1 : 0;
    }
  }

  for (let py = 0; py < S; py++) {
    const Y = cy * S + py;
    const rowShore = (py >> 4) * CHUNK;
    for (let px = 0; px < S; px++) {
      const X = cx * S + px;
      const ci = (py + M) * SM + px + M;
      const b = cls[ci];
      const bay = BAYER4[(py & 3) * 4 + (px & 3)];
      const blk = (py >> 2) * BN + (px >> 2);
      const shore = shoreTile[rowShore + (px >> 4)];
      const r = hash3(X, Y, seed + 5) / 4294967296;
      let out;
      if (isWaterB(b)) {
        const kind = b === B.RIVER ? 'river' : b === B.LAKE ? 'lake' : 'sea';
        const ramp = R.water[kind];
        let near = 9;
        if (shore) {
          // Pixel distance to the nearest land pixel (foam, shallows).
          for (let dy = -3; dy <= 3 && near > 1; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
              if (!isWaterB(cls[ci + dy * SM + dx])) {
                const d = Math.max(Math.abs(dx), Math.abs(dy));
                if (d < near) near = d;
              }
            }
          }
        }
        if (near === 1) out = r < 0.72 ? R.foam : R.foam2;
        else if (near === 2) out = r < 0.4 ? R.foam2 : ramp[0];
        else {
          const depth = blkDepth[blk];
          let lv;
          if (kind === 'river') lv = 1.2 + Math.min(2, depth) * 0.9;
          else lv = Math.pow(Math.min(1, Math.max(0, (depth - 0.35) / 5.6)), 0.8) * 7.4;
          if (near === 3) lv = Math.min(lv, 0.6);
          // Gentle large-scale variation.
          lv += (lowWater[blk] - 0.5) * 0.9;
          let idx = Math.floor(lv + bay);
          if (idx < 0) idx = 0;
          else if (idx > 7) idx = 7;
          out = ramp[idx];
          // Wave strokes: short light dashes on a staggered lattice.
          const wr = hash3(X >> 3, Y >> 2, seed + 9) & 63;
          if (wr < 4 && (Y & 3) === 0 && (X & 7) < 3) out = r < 0.06 ? R.sparkle : R.waterLight[kind][idx];
        }
      } else {
        const rp = R.land[b];
        const tone = lowLand[blk] > 0.3 + bay * 0.45 ? rp[1] : rp[0];
        let lv = blkLit[blk] * RELIEF[b] - blkTree[blk] * SHADE[b];
        if (r < 0.045) lv -= 1;
        else if (r < 0.085) lv += 1;
        let wet = 0;
        if (shore) {
          // Wet bank next to water: one dark pixel, then a softer one.
          for (let k = 0; k < 4 && wet < 2; k++) {
            const o = k === 0 ? 1 : k === 1 ? -1 : k === 2 ? SM : -SM;
            if (isWaterB(cls[ci + o])) wet = 2;
            else if (!wet && isWaterB(cls[ci + 2 * o])) wet = 1;
          }
        }
        if (wet && (b === B.BEACH || b === B.DESERT)) {
          out = wet === 2 ? R.wet : bay < 0.6 ? (b === B.BEACH ? R.wet2 : R.wetDesert2) : tone[3];
        } else {
          if (wet) lv -= wet === 2 ? 2 : 1;
          let idx = 3 + Math.floor(lv + bay);
          if (idx < 0) idx = 0;
          else if (idx > 6) idx = 6;
          out = tone[idx];
          if (b === B.MOUNTAIN && interp(gH, X, Y) > snowLine + (bay - 0.5) * 0.02) out = r < 0.5 ? R.snow : R.snow2;
        }
      }
      buf[py * S + px] = out;
    }
  }

  const setPx = (X, Y, col) => {
    const px = X - cx * S;
    const py = Y - cy * S;
    if (px < 0 || py < 0 || px >= S || py >= S) return;
    buf[py * S + px] = pack(col);
  };
  const clsAt = (X, Y) => {
    const px = X - X0;
    const py = Y - Y0;
    if (px < 0 || py < 0 || px >= SM || py >= SM) return -1;
    return cls[py * SM + px];
  };

  // Per-tile ground details.
  for (let ty = ty0; ty < ty0 + CHUNK && ty < H; ty++) {
    for (let tx = tx0; tx < tx0 + CHUNK && tx < W; tx++) {
      const i = ty * W + tx;
      if (ov.road[i] || ov.ground[i]) continue;
      const b = biome[i];
      const pal = GROUND[b];
      const h0 = hash3(tx, ty, seed + 77);
      const bx = tx * TILE;
      const by = ty * TILE;
      const spot = (k) => [bx + 2 + ((h0 >> (k * 4)) & 15) % 12, by + 3 + ((h0 >> (k * 4 + 2)) & 15) % 11];
      const same = (X, Y) => clsAt(X, Y) === b;
      switch (b) {
        case B.GRASS:
        case B.MEADOW:
        case B.FOREST:
        case B.HILLS:
        case B.TAIGA: {
          const tufts = 1 + (h0 & 1) + (b === B.MEADOW ? 1 : 0);
          for (let k = 0; k < tufts; k++) {
            const [x, y] = spot(k);
            if (!same(x, y)) continue;
            setPx(x, y - 1, pal.tuft);
            setPx(x - 1, y, pal.tuft);
            setPx(x + 1, y, pal.tuft);
            setPx(x, y, pal.dark);
          }
          if (pal.flowers) {
            const fl = (h0 >>> 20) & 15;
            const fc = b === B.MEADOW ? 6 : b === B.GRASS ? 3 : 1;
            for (let k = 0; k < 2; k++) {
              if (((fl + k * 5) & 15) >= fc) continue;
              const [x, y] = spot(k + 2);
              if (!same(x, y)) continue;
              const c = pal.flowers[(h0 >>> (24 + k * 2)) % pal.flowers.length];
              setPx(x, y, c);
              setPx(x - 1, y, c);
              setPx(x + 1, y, c);
              setPx(x, y - 1, c);
              setPx(x, y + 1, pal.dark);
              setPx(x, y, '#fbe9a8');
            }
          }
          if (b === B.FOREST && (h0 & 31) === 3) {
            // A little toadstool.
            const [x, y] = spot(4);
            if (same(x, y)) {
              setPx(x, y, '#efe3cc');
              setPx(x - 1, y - 1, '#c4523e');
              setPx(x, y - 1, '#e0705a');
              setPx(x + 1, y - 1, '#c4523e');
              setPx(x, y - 2, '#c4523e');
            }
          }
          if ((b === B.FOREST || b === B.TAIGA) && (h0 & 7) === 5) {
            // Fallen leaves / needles.
            const [x, y] = spot(5);
            const c = b === B.FOREST ? ((h0 >>> 9) & 1 ? '#c99a4a' : '#b9703e') : '#8a6a44';
            setPx(x, y, c);
            setPx(x + 2, y + 1, c);
          }
          if (b === B.TAIGA && (h0 & 7) === 0) {
            const [x, y] = spot(1);
            for (let d = -2; d <= 2; d++) setPx(x + d, y, pal.snow);
            setPx(x, y - 1, pal.snow);
          }
          if (b === B.HILLS && (h0 & 3) === 0) {
            const [x, y] = spot(2);
            setPx(x, y, pal.rock);
            setPx(x + 1, y, pal.rock);
            setPx(x, y + 1, '#6c625f');
            setPx(x + 1, y + 1, '#857a74');
          }
          break;
        }
        case B.DESERT:
        case B.BEACH: {
          if ((h0 & 3) === 0) {
            const [x, y] = spot(0);
            for (let d = 0; d < 4; d++) if (same(x + d, y)) setPx(x + d, y, b === B.BEACH ? pal.dark : pal.detail[0]);
            for (let d = 1; d < 3; d++) if (same(x + d, y - 1)) setPx(x + d, y - 1, pal.light);
          }
          if ((h0 & 12) === 0) {
            const [x, y] = spot(1);
            setPx(x, y, pal.detail[1]);
            setPx(x + 1, y, pal.detail[1]);
            setPx(x, y - 1, pal.light);
          }
          if (b === B.BEACH && (h0 & 48) === 16) {
            const [x, y] = spot(2);
            setPx(x, y, pal.detail[0]);
            setPx(x + 1, y, '#e7b8a4');
          }
          break;
        }
        case B.SNOW:
        case B.PEAK: {
          if ((h0 & 3) === 0) {
            const [x, y] = spot(0);
            setPx(x, y, '#ffffff');
          }
          if ((h0 & 15) === 1) {
            const [x, y] = spot(1);
            setPx(x, y, b === B.PEAK ? pal.crack : pal.detail[0]);
            setPx(x + 1, y, b === B.PEAK ? pal.crack : pal.detail[0]);
            setPx(x + 1, y - 1, '#ffffff');
          }
          break;
        }
        case B.MARSH: {
          if ((h0 & 3) !== 3) {
            const [x, y] = spot(0);
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -3; dx <= 3; dx++) {
                if (Math.abs(dx) === 3 && dy !== 0) continue;
                if (same(x + dx, y + dy)) setPx(x + dx, y + dy, dy === -1 && Math.abs(dx) < 3 ? pal.dark : pal.puddle);
              }
            }
            setPx(x - 1, y, pal.puddleLight);
            setPx(x, y, pal.puddleLight);
          }
          const [x2, y2] = spot(2);
          setPx(x2, y2, pal.tuft);
          setPx(x2, y2 - 1, pal.tuft);
          setPx(x2 + 1, y2, pal.dark);
          break;
        }
        case B.MOUNTAIN: {
          const [x, y] = spot(0);
          for (let k = 0; k < 4; k++) {
            setPx(x + k, y + (k >> 1), pal.crack);
            setPx(x + k, y + (k >> 1) + 1, pal.light);
          }
          break;
        }
        case B.ASH: {
          const [x, y] = spot(0);
          for (let k = 0; k < 4; k++) setPx(x + k, y + ((k * 3) % 2), pal.crack);
          if ((h0 & 3) === 0) {
            const [ex, ey] = spot(1);
            setPx(ex, ey, pal.ember[(h0 >>> 8) & 1]);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  // Overlays: plazas, gardens, fields, roads.
  for (let ty = ty0; ty < ty0 + CHUNK && ty < H; ty++) {
    for (let tx = tx0; tx < tx0 + CHUNK && tx < W; tx++) {
      const i = ty * W + tx;
      const g = ov.ground[i];
      if (g) paintGround(setPx, tx, ty, g, ov.crop[i], seed);
      const rc = ov.road[i];
      if (rc) paintRoad(setPx, world, ov.road, tx, ty, rc, seed);
    }
  }
  ctx.putImageData(img, 0, 0);
  // Callers that draw trees themselves (interleaved with their own sprites).
  if (opts.noObjects) return canvas;

  // Natural objects. Include a margin of tiles whose sprites (up to ~2
  // tiles wide, ~3 tall) or shadows overhang into this chunk.
  const objs = [];
  for (let ty = ty0 - 1; ty < ty0 + CHUNK + 3; ty++) {
    if (ty < 0 || ty >= H) continue;
    for (let tx = tx0 - 2; tx < tx0 + CHUNK + 2; tx++) {
      if (tx < 0 || tx >= W) continue;
      const i = ty * W + tx;
      const f = feature[i];
      if (!f || ov.cleared[i] || ov.road[i] || ov.ground[i]) continue;
      const b = biome[i];
      const h0 = hash3(tx, ty, seed + 3);
      const snowy = b === B.MOUNTAIN && height01[i] > snowLine;
      const spr = natureSprite(f, h0, b, snowy);
      if (!spr) continue;
      // Sub-tile jitter so stands of trees do not line up on the grid.
      const jx = ((h0 >>> 17) % 11) - 5;
      const jy = ((h0 >>> 21) % 7) - 4;
      objs.push({ spr, ax: tx * TILE + 8 + jx - cx * S, ay: ty * TILE + 13 + jy - cy * S });
    }
  }
  if (objs.length) {
    // Shadows go into one mask first, so overlapping ones do not stack up.
    if (!maskCanvas || maskCanvas.width !== S) maskCanvas = makeCanvas(S, S);
    const mctx = maskCanvas.getContext('2d');
    mctx.clearRect(0, 0, S, S);
    for (const o of objs) {
      const c = o.spr.cast;
      if (c) mctx.drawImage(c.canvas, o.ax + c.x, o.ay + c.y);
    }
    ctx.globalAlpha = SHADOW_ALPHA;
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.globalAlpha = 1;
    objs.sort((p, q) => p.ay - q.ay || p.ax - q.ax);
    for (const o of objs) ctx.drawImage(o.spr.canvas, o.ax - o.spr.ax, o.ay - o.spr.ay);
  }
  return canvas;
}

const RIVER_HALF = [0, 5.2, 6.6, 7.8];

/** Land biome to show where a river tile's pixels fall outside the channel. */
function riverBank(world, tx, ty) {
  const { width: W, height: H, biome } = world;
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const x = tx + dx;
    const y = ty + dy;
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const nb = biome[y * W + x];
    if (nb > B.RIVER) return nb;
  }
  return B.GRASS;
}

function segDist2(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1)));
  const dx = ax + vx * t - px;
  const dy = ay + vy * t - py;
  return dx * dx + dy * dy;
}

/** Non-zero if world pixel (X, Y) lies inside a river channel. */
function riverWidthAt(world, X, Y, ux, uy) {
  const { width: W, height: H, biome, river } = world;
  let best = 0;
  for (let ty = uy - 1; ty <= uy + 1; ty++) {
    for (let tx = ux - 1; tx <= ux + 1; tx++) {
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
      const i = ty * W + tx;
      if (biome[i] !== B.RIVER) continue;
      const half = RIVER_HALF[river[i]] || 5;
      const ax = tx * TILE + 7.5;
      const ay = ty * TILE + 7.5;
      // Connect to river or open-water neighbours (4-neighbour), plus diagonal shortcuts.
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nb = biome[ny * W + nx];
        const isRiv = nb === B.RIVER;
        const isOpen = nb === B.SEA || nb === B.DEEP || nb === B.LAKE;
        if (!isRiv && !isOpen) continue;
        if (dx && dy) {
          // Diagonal shortcut only when both are river and they share a river corner.
          if (!isRiv) continue;
          const c1 = biome[ty * W + nx] === B.RIVER;
          const c2 = biome[ny * W + tx] === B.RIVER;
          if (!c1 && !c2) continue;
        }
        const bx = nx * TILE + 7.5;
        const by = ny * TILE + 7.5;
        const ex = isOpen ? (ax + bx) / 2 : bx;
        const ey = isOpen ? (ay + by) / 2 : by;
        if (segDist2(X, Y, ax, ay, ex, ey) <= half * half) return half;
      }
      if ((X - ax) ** 2 + (Y - ay) ** 2 <= half * half) best = half;
    }
  }
  return best;
}

function paintGround(setPx, tx, ty, g, crop, seed) {
  const bx = tx * TILE;
  const by = ty * TILE;
  if (g === G.PLAZA_PAVED || g === G.PLAZA_EARTH) {
    const paved = g === G.PLAZA_PAVED;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const X = bx + x;
        const Y = by + y;
        const r = hash3(X, Y, seed + 41) / 4294967296;
        let c;
        if (paved) {
          const joint = (Y % 4 === 0) || ((X + ((Y >> 2) & 1) * 2) % 4 === 0);
          c = joint ? '#8e897f' : r < 0.2 ? '#c9c3b5' : r < 0.35 ? '#a9a395' : '#bab4a6';
        } else {
          c = r < 0.08 ? '#a3895f' : r < 0.14 ? '#d6be8f' : '#c3a878';
        }
        setPx(X, Y, c);
      }
    }
    return;
  }
  if (g === G.YARD_EARTH) {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const r = hash3(bx + x, by + y, seed + 43) / 4294967296;
        if (r < 0.55) setPx(bx + x, by + y, r < 0.08 ? '#9c8258' : r < 0.14 ? '#cdb487' : '#b79c6c');
      }
    }
    return;
  }
  if (g === G.VEG) {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const row = (y % 4) < 2;
        let c = row ? '#6a4a2e' : '#5a3d25';
        if (row && (x % 3) === 1 && y % 4 === 0) c = (hash3(bx + x, by + y, seed) & 1) ? '#6fbf4f' : '#4f9a3a';
        if (row && (x % 3) === 1 && y % 4 === 1) c = '#3f7a2e';
        if (x === 0 || x === 15) c = '#4a8a3c';
        setPx(bx + x, by + y, c);
      }
    }
    return;
  }
  if (g === G.FLOWERS) {
    const cols = ['#ffd74e', '#ff8db6', '#fbf8ee', '#c79bff', '#ff6a5a'];
    for (let k = 0; k < 9; k++) {
      const h = hash3(tx * 9 + k, ty, seed + 51);
      const x = bx + 2 + (h % 12);
      const y = by + 2 + ((h >>> 5) % 12);
      const c = cols[(h >>> 10) % cols.length];
      setPx(x, y, c);
      setPx(x + 1, y, c);
      setPx(x, y + 1, '#2f6a2c');
    }
    return;
  }
  if (g === G.FIELD) {
    const key = Object.keys(CROPS)[Math.max(0, (crop & 15) - 1)] || 'wheat';
    const cp = CROPS[key];
    const vertical = (crop & 16) !== 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const X = bx + x;
        const Y = by + y;
        const a = vertical ? X : Y;
        const b2 = vertical ? Y : X;
        const lane = a % 4;
        let c = lane === 3 ? cp.soilDark : cp.soil;
        if (lane === 0 || lane === 1) {
          const r = hash3(X, Y, seed + 61) & 7;
          if (key === 'cabbage' || key === 'turnip') {
            if (b2 % 4 < 3) c = lane === 0 ? cp.top : cp.plant;
            if (b2 % 4 === 2 && lane === 1) c = cp.plantDark;
          } else if (key === 'rice') {
            c = (b2 % 3 === 0) ? cp.plant : cp.soil;
            if (lane === 0 && b2 % 3 === 0) c = cp.top;
          } else {
            c = lane === 0 ? (r < 2 ? cp.top : cp.plant) : cp.plantDark;
          }
        }
        setPx(X, Y, c);
      }
    }
  }
}

function paintRoad(setPx, world, road, tx, ty, rc, seed) {
  const W = world.width;
  const H = world.height;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : road[y * W + x]);
  const e = at(tx + 1, ty) > 0;
  const w = at(tx - 1, ty) > 0;
  const s = at(tx, ty + 1) > 0;
  const n = at(tx, ty - 1) > 0;
  const onRiver = world.biome[ty * W + tx] === B.RIVER;
  const bx = tx * TILE;
  const by = ty * TILE;
  if (onRiver || rc === RC.PLANK) {
    paintDeck(setPx, bx, by, e || w || !(n || s), onRiver, seed);
    return;
  }
  const kind = rc === RC.COBBLE ? 'cobble' : rc === RC.PATH ? 'path' : rc === RC.SAND ? 'sand' : 'dirt';
  const pal = ROADS[kind];
  const half = rc === RC.COBBLE ? 6.5 : rc === RC.DIRT ? 5.5 : rc === RC.SAND ? 5.5 : rc === RC.STREET ? 4.5 : 2.5;
  const inside = (x, y, hw) => {
    const dx = x - 7.5;
    const dy = y - 7.5;
    if (Math.abs(dx) <= hw && Math.abs(dy) <= hw) return true;
    if (e && x >= 7.5 && Math.abs(dy) <= hw) return true;
    if (w && x <= 7.5 && Math.abs(dy) <= hw) return true;
    if (s && y >= 7.5 && Math.abs(dx) <= hw) return true;
    if (n && y <= 7.5 && Math.abs(dx) <= hw) return true;
    return false;
  };
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const X = bx + x;
      const Y = by + y;
      const hrand = hash3(X, Y, seed + 31);
      const jitter = ((hrand & 3) === 0 ? -0.6 : (hrand & 3) === 1 ? 0.4 : 0);
      if (!inside(x, y, half + jitter)) continue;
      const edge = !inside(x, y, half - 1.1);
      const r = (hrand >>> 8) / 16777216;
      let c;
      if (kind === 'cobble') {
        const joint = (Y % 3 === 0) || ((X + (Math.floor(Y / 3) & 1) * 2) % 4 === 0);
        c = edge ? pal.edge : joint ? pal.dark : r < 0.25 ? pal.light : pal.base;
      } else {
        c = edge ? pal.edge : r < 0.07 ? pal.dark : r < 0.14 ? pal.light : pal.base;
        // Wheel ruts on main dirt roads.
        if (rc === RC.DIRT && !edge && r > 0.6) {
          if ((e || w) && !(n || s) && (y === 5 || y === 10)) c = pal.dark;
          if ((n || s) && !(e || w) && (x === 5 || x === 10)) c = pal.dark;
        }
      }
      setPx(X, Y, c);
    }
  }
}

function paintDeck(setPx, bx, by, horizontal, overWater, seed) {
  const pal = ROADS.plank;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const a = horizontal ? y : x; // across the deck
      const b = horizontal ? x : y; // along the deck
      if (a < 2 || a > 13) continue;
      let c;
      if (a === 2 || a === 13) c = pal.edge; // rails
      else if (a === 3 || a === 12) c = (b % 4 === 0) ? pal.edge : pal.dark;
      else c = (b % 3 === 0) ? pal.dark : ((hash3(bx + x, by + y, seed) & 7) === 0 ? pal.light : pal.base);
      setPx(bx + x, by + y, c);
    }
  }
  if (overWater) {
    // Posts below the rails.
    for (const b of [1, 8, 14]) {
      for (const a of [1, 14]) {
        const x = horizontal ? b : a;
        const y = horizontal ? a : b;
        setPx(bx + x, by + y, pal.edge);
      }
    }
  }
}

