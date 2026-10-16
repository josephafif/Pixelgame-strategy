// Strategic overview images at one pixel per tile: terrain with relief,
// territory fill and borders, fog of war. Used when zoomed out and for the
// minimap.

import { BIOMES, B, D } from '../../engine/world/biomes.js';
import { rgb } from './color.js';
import { makeCanvas } from './pix.js';

export function buildTerrainOverview(world) {
  const { width: W, height: H, biome, height01, feature } = world;
  const cv = makeCanvas(W, H);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const cols = BIOMES.map((b) => rgb(b.color));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const b = biome[i];
      let [r, g, bl] = cols[b];
      if (b > B.RIVER) {
        const up = y > 0 ? height01[i - W] : height01[i];
        const left = x > 0 ? height01[i - 1] : height01[i];
        const k = (Math.max(0, up) - Math.max(0, height01[i])) * 300 + (Math.max(0, left) - Math.max(0, height01[i])) * 200;
        r -= k;
        g -= k;
        bl -= k;
        if (feature[i] >= 1 && feature[i] <= 6) {
          r *= 0.82;
          g *= 0.86;
          bl *= 0.82;
        }
      } else if (b === B.SEA || b === B.LAKE) {
        // Lighter shallows near the shore.
        r += 8;
        g += 10;
        bl += 8;
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

export function buildFog(cw) {
  const { W, H, explored } = cw;
  const cv = makeCanvas(W, H);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    if (explored[i]) continue;
    img.data[i * 4] = 24;
    img.data[i * 4 + 1] = 19;
    img.data[i * 4 + 2] = 14;
    img.data[i * 4 + 3] = 205;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

export const DEPOSIT_COLORS = {
  [D.IRON]: '#c0603a',
  [D.COAL]: '#26222a',
  [D.CRYSTAL]: '#c46cff',
  [D.HERBS]: '#7ad04f',
  [D.FISH]: '#e8f4ff',
  [D.STONE]: '#f2ead6',
};
