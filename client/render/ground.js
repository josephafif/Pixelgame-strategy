// Chunk renderer for the ground layer: per-pixel terrain with ragged biome
// transitions, relief shading, shore foam, small ground details, roads,
// bridges, plazas, fields and gardens, plus the natural objects standing on
// tiles (trees, rocks). A chunk is drawn once into a canvas and cached.

import { valueNoise } from '../../engine/core/noise.js';
import { hash3 } from '../../engine/core/rng.js';
import { B } from '../../engine/world/biomes.js';
import { GROUND, FOAM, FOAM2, WET_SAND, ROADS, CROPS } from './palette.js';
import { rgb, BAYER4 } from './color.js';
import { makeCanvas } from './pix.js';
import { featureSprite } from './nature.js';

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
function pack(hex) {
  let v = packCache.get(hex);
  if (v === undefined) {
    const [r, g, b] = rgb(hex);
    v = (255 << 24) | (b << 16) | (g << 8) | r;
    packCache.set(hex, v >>> 0);
    v >>>= 0;
  }
  return v;
}

const isWaterB = (b) => b <= B.RIVER;

/**
 * Render chunk (cx, cy) to a canvas of CHUNK*TILE pixels.
 * ov: { road: Uint8Array, ground: Uint8Array, crop: Uint8Array, cleared: Uint8Array }
 */
export function renderChunk(world, cx, cy, ov) {
  const { width: W, height: H, biome, height01, feature } = world;
  const S = CHUNK * TILE;
  const M = 3; // pixel margin for neighbourhood tests
  const SM = S + 2 * M;
  const X0 = cx * S - M;
  const Y0 = cy * S - M;
  const seed = world.seed | 0;
  const cls = new Uint8Array(SM * SM); // warped biome per pixel
  for (let py = 0; py < SM; py++) {
    const Y = Y0 + py;
    for (let px = 0; px < SM; px++) {
      const X = X0 + px;
      const jx = ((hash3(X, Y, seed) & 3) - 1.5) * 0.7;
      const jy = (((hash3(X, Y, seed) >> 2) & 3) - 1.5) * 0.7;
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
      if (b === B.RIVER) b = riverBank(world, ux, uy);
      const rw = riverWidthAt(world, X + wx * 0.25, Y + wy * 0.25, ux, uy);
      if (rw) b = B.RIVER;
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

  for (let py = 0; py < S; py++) {
    const Y = cy * S + py;
    for (let px = 0; px < S; px++) {
      const X = cx * S + px;
      const ci = (py + M) * SM + px + M;
      const b = cls[ci];
      const pal = GROUND[b];
      const bay = BAYER4[(py & 3) * 4 + (px & 3)];
      const r = hash3(X, Y, seed + 5) / 4294967296;
      let col;
      if (isWaterB(b)) {
        // Shore foam: distance to the nearest land pixel.
        let near = 9;
        for (let dy = -2; dy <= 2 && near > 1; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nb = cls[ci + dy * SM + dx];
            if (!isWaterB(nb)) {
              const d = Math.max(Math.abs(dx), Math.abs(dy));
              if (d < near) near = d;
            }
          }
        }
        if (near === 1) col = r < 0.75 ? FOAM : FOAM2;
        else if (near === 2) col = r < 0.4 ? FOAM2 : pal.light;
        else {
          const low = valueNoise(X / 20, Y / 20, seed + 21);
          col = low > 0.35 + bay * 0.3 ? pal.base2 : pal.base;
          if (r < 0.03) col = pal.dark;
          // Wave strokes: short light dashes on a staggered lattice.
          const wr = hash3(X >> 3, Y >> 2, seed + 9) & 63;
          if (wr < 4 && (Y & 3) === 0 && ((X & 7) < 3)) col = pal.wave;
        }
      } else {
        const low = valueNoise(X / 26, Y / 26, seed + 22);
        col = low > 0.3 + bay * 0.45 ? pal.base2 : pal.base;
        if (r < 0.045) col = pal.dark;
        else if (r < 0.085) col = pal.light;
        // Relief shading on rough ground.
        if (b === B.HILLS || b === B.MOUNTAIN || b === B.PEAK || b === B.SNOW || b === B.TAIGA || b === B.ASH) {
          const fx = X / TILE - 0.5;
          const fy = Y / TILE - 0.5;
          const gx = hAt(fx + 0.5, fy) - hAt(fx - 0.5, fy);
          const gy = hAt(fx, fy + 0.5) - hAt(fx, fy - 0.5);
          const k = b === B.MOUNTAIN || b === B.PEAK ? 34 : 22;
          const lit = -(gx * 0.7 + gy * 0.9) * k;
          if (lit > 0.25 + bay * 0.5) col = pal.light;
          else if (lit < -0.25 - bay * 0.5) col = pal.dark;
          if (b === B.MOUNTAIN && hAt(fx, fy) > mountT + (peakT - mountT) * 0.65 + (bay - 0.5) * 0.02) col = r < 0.5 ? pal.snow : '#dfe7ef';
        }
        // Wet edge next to water.
        let wet = false;
        for (let k = 0; k < 4 && !wet; k++) {
          const nb = cls[ci + (k === 0 ? 1 : k === 1 ? -1 : k === 2 ? SM : -SM)];
          if (isWaterB(nb)) wet = true;
        }
        if (wet) col = b === B.BEACH || b === B.DESERT ? WET_SAND : pal.dark;
      }
      buf[py * S + px] = pack(col);
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
  const tx0 = cx * CHUNK;
  const ty0 = cy * CHUNK;
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
              setPx(x, y + 1, '#2f6a2c');
            }
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
            setPx(x, y + 1, '#5e5f66');
          }
          break;
        }
        case B.DESERT:
        case B.BEACH: {
          if ((h0 & 3) === 0) {
            const [x, y] = spot(0);
            for (let d = 0; d < 4; d++) if (same(x + d, y)) setPx(x + d, y, pal.detail[0] === '#f5eedf' ? pal.dark : pal.detail[0]);
          }
          if ((h0 & 12) === 0) {
            const [x, y] = spot(1);
            setPx(x, y, pal.detail[1]);
            setPx(x + 1, y, pal.detail[1]);
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
                if (same(x + dx, y + dy)) setPx(x + dx, y + dy, pal.puddle);
              }
            }
            setPx(x - 1, y - 1, pal.puddleLight);
            setPx(x, y - 1, pal.puddleLight);
          }
          const [x2, y2] = spot(2);
          setPx(x2, y2, pal.tuft);
          setPx(x2, y2 - 1, pal.tuft);
          break;
        }
        case B.MOUNTAIN: {
          const [x, y] = spot(0);
          for (let k = 0; k < 4; k++) setPx(x + k, y + (k >> 1), pal.crack);
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

  // Natural objects: shadows first, then sprites, in row order. Include a
  // margin of tiles whose sprites overhang into this chunk.
  const objs = [];
  for (let ty = ty0 - 1; ty < ty0 + CHUNK + 2; ty++) {
    if (ty < 0 || ty >= H) continue;
    for (let tx = tx0 - 1; tx < tx0 + CHUNK + 1; tx++) {
      if (tx < 0 || tx >= W) continue;
      const i = ty * W + tx;
      const f = feature[i];
      if (!f || ov.cleared[i] || ov.road[i] || ov.ground[i]) continue;
      const h0 = hash3(tx, ty, seed + 3);
      const spr = featureSprite(f, h0 & 3);
      if (!spr) continue;
      const jx = ((h0 >>> 4) % 7) - 3;
      const jy = ((h0 >>> 8) % 5) - 3;
      const ax = tx * TILE + 8 + jx - cx * S;
      const ay = ty * TILE + 15 + jy - cy * S;
      objs.push({ spr, ax, ay, f });
    }
  }
  ctx.fillStyle = 'rgba(10,25,15,0.22)';
  for (const o of objs) {
    const sw = Math.max(6, Math.round(o.spr.w * 0.62 * o.spr.shadow));
    ellipse(ctx, o.ax + 1, o.ay - 1, sw / 2, 2.2);
  }
  objs.sort((p, q) => p.ay - q.ay || p.ax - q.ax);
  for (const o of objs) {
    ctx.drawImage(o.spr.canvas, Math.round(o.ax - o.spr.w / 2), Math.round(o.ay - o.spr.h + 1));
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

function ellipse(ctx, cx, cy, rx, ry) {
  for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) {
    const hw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
    if (hw > 0) ctx.fillRect(Math.round(cx - hw), Math.round(cy + y), hw * 2, 1);
  }
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

