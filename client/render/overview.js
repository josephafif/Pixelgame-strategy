// Strategic overview images at one pixel per tile: terrain with relief,
// territory fill and borders. Used when zoomed out and for the
// minimap.

import { B, D, TREE_FEATURES, F } from '../../engine/world/biomes.js';
import { rgb } from './color.js';
import { makeCanvas } from './pix.js';

// Average colours of painted chunks per biome (measured from renderChunk),
// so the zoomed-out map and chunk placeholders match the pixel view:
// [open ground, under trees, with rocks, with bushes/reeds/cacti].
const LAND = {
  [B.BEACH]: ['#dfc691', '#a99a62', '#cdb07f', '#cdb886'],
  [B.GRASS]: ['#6f9049', '#577139', '#708450', '#5f7b41'],
  [B.MEADOW]: ['#7c9a51', '#59733b', '#788b55', '#658045'],
  [B.FOREST]: ['#57723d', '#5b753d', '#607547', '#57713e'],
  [B.TAIGA]: ['#415940', '#38523b', '#485c48', '#415940'],
  [B.MARSH]: ['#5e6a48', '#5d6a3a', '#5e6a48', '#5b643e'],
  [B.DESERT]: ['#d2b47c', '#8f8053', '#bd9f70', '#999261'],
  [B.HILLS]: ['#778851', '#55693d', '#767f57', '#637646'],
  [B.MOUNTAIN]: ['#9a958f', '#596556', '#868280', '#86847a'],
  [B.PEAK]: ['#d1d2ce', '#9aa29a', '#b8b9b5', '#b8b9b5'],
  [B.SNOW]: ['#c6cdc9', '#758478', '#a9adaa', '#a9adaa'],
  [B.ASH]: ['#443c45', '#3e343a', '#413941', '#413941'],
};
// Sea by distance to land (tiles), then lake and river.
const SEA = ['#6ba09e', '#6ba09e', '#52939f', '#448495', '#3b768a', '#346a80', '#2d5c73'];
const LAKE = ['#6a9f9b', '#5a9597', '#4f8a92', '#457e8b'];
const RIVER = '#709e93';
const SNOWCAP = '#dcdfd9';
const ROCKS = new Set([F.ROCK, F.BOULDER, F.CRAG, F.ASHROCK]);

/** Chamfer distance (tiles, capped) from every water tile to the nearest land. */
function waterDepth(world) {
  const { width: W, height: H, biome } = world;
  const d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = biome[i] <= B.RIVER ? 99 : 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - W] + 1);
        if (x > 0) v = Math.min(v, d[i - W - 1] + 1.41);
        if (x < W - 1) v = Math.min(v, d[i - W + 1] + 1.41);
      }
      d[i] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x < W - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < H - 1) {
        v = Math.min(v, d[i + W] + 1);
        if (x < W - 1) v = Math.min(v, d[i + W + 1] + 1.41);
        if (x > 0) v = Math.min(v, d[i + W - 1] + 1.41);
      }
      d[i] = v;
    }
  }
  return d;
}

export function buildTerrainOverview(world) {
  const { width: W, height: H, biome, height01, feature } = world;
  const cv = makeCanvas(W, H);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const land = {};
  for (const k of Object.keys(LAND)) land[k] = LAND[k].map((c) => rgb(c));
  const sea = SEA.map((c) => rgb(c));
  const lake = LAKE.map((c) => rgb(c));
  const river = rgb(RIVER);
  const snowcap = rgb(SNOWCAP);
  const depth = waterDepth(world);
  const th = world.thresholds;
  const snowLine = th ? th.mountT + (th.peakT - th.mountT) * 0.65 : Infinity;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const b = biome[i];
      let r;
      let g;
      let bl;
      if (b === B.RIVER) [r, g, bl] = river;
      else if (b === B.LAKE) [r, g, bl] = lake[Math.min(3, Math.max(0, Math.round(depth[i] - 1)))];
      else if (b <= B.RIVER) [r, g, bl] = sea[Math.min(6, Math.round(depth[i]))];
      else {
        const f = feature[i];
        const set = land[b] || land[B.GRASS];
        [r, g, bl] = set[TREE_FEATURES.has(f) ? 1 : ROCKS.has(f) ? 2 : f ? 3 : 0];
        if (b === B.MOUNTAIN && height01[i] > snowLine && !TREE_FEATURES.has(f)) [r, g, bl] = snowcap;
        // Relief: slopes facing the light (upper left) brighter.
        const up = y > 0 ? height01[i - W] : height01[i];
        const left = x > 0 ? height01[i - 1] : height01[i];
        const k = (Math.max(0, up) - Math.max(0, height01[i])) * 300 + (Math.max(0, left) - Math.max(0, height01[i])) * 200;
        r -= k;
        g -= k;
        bl -= k * 0.9;
      }
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = bl;
      img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Territory fill (translucent) and border (opaque) images. */
export function buildTerritory(cw, fillAlpha = 110) {
  const { W, H, ownerK } = cw;
  const fill = makeCanvas(W, H);
  const border = makeCanvas(W, H);
  const fctx = fill.getContext('2d');
  const bctx = border.getContext('2d');
  const fi = fctx.createImageData(W, H);
  const bi = bctx.createImageData(W, H);
  const colorCache = new Map();
  const col = (k) => {
    if (!colorCache.has(k)) colorCache.set(k, rgb(cw.colorOf(k)));
    return colorCache.get(k);
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const k = ownerK[i];
      if (k === -1 || k === -3) continue;
      const [r, g, b] = col(k);
      fi.data[i * 4] = r;
      fi.data[i * 4 + 1] = g;
      fi.data[i * 4 + 2] = b;
      fi.data[i * 4 + 3] = fillAlpha;
      const edge = (x > 0 && ownerK[i - 1] !== k) || (x < W - 1 && ownerK[i + 1] !== k) || (y > 0 && ownerK[i - W] !== k) || (y < H - 1 && ownerK[i + W] !== k);
      if (edge) {
        bi.data[i * 4] = r;
        bi.data[i * 4 + 1] = g;
        bi.data[i * 4 + 2] = b;
        bi.data[i * 4 + 3] = 255;
      }
    }
  }
  fctx.putImageData(fi, 0, 0);
  bctx.putImageData(bi, 0, 0);
  return { fill, border };
}

export const DEPOSIT_COLORS = {
  [D.IRON]: '#c0603a',
  [D.COAL]: '#26222a',
  [D.CRYSTAL]: '#c46cff',
  [D.HERBS]: '#7ad04f',
  [D.FISH]: '#e8f4ff',
  [D.STONE]: '#f2ead6',
};
