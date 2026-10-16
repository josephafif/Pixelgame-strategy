// Environmental sprites (trees, rocks, plants), drawn procedurally in a
// style compatible with the reference: clustered canopies with per-clump
// highlights, dark outlines, small trunks and rounded boulders.

import { Pix, srng } from './pix.js';
import { F } from '../../engine/world/biomes.js';

const OUTLINE = '#1c3420';
const ROCK_OUT = '#34343e';

const cache = new Map();

function canopy(p, clumps, cols, rnd) {
  // Each pixel belongs to the clump it is deepest inside; shade per clump.
  const { dark, base, light, hi } = cols;
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      let best = null;
      let bd = 1;
      for (const c of clumps) {
        const dx = (x + 0.5 - c.x) / c.r;
        const dy = (y + 0.5 - c.y) / c.r;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = { c, dx, dy };
        }
      }
      if (!best) continue;
      const { dx, dy } = best;
      const lit = -dx * 0.55 - dy * 0.85; // light from the upper left
      let col = base;
      if (lit > 0.55 && bd < 0.55) col = hi;
      else if (lit > 0.15) col = light;
      else if (lit < -0.55 || bd > 0.82 && dy > 0.1) col = dark;
      if (col === base && rnd() < 0.08) col = rnd() < 0.5 ? dark : light;
      p.set(x, y, col);
    }
  }
}

function trunk(p, x, y0, y1, col = '#6a4a2d', dark = '#4b331f') {
  p.vline(x, y0, y1, dark);
  p.vline(x + 1, y0, y1, col);
  p.vline(x + 2, y0, y1, col);
  p.vline(x + 3, y0, y1, dark);
  p.set(x - 1, y1, dark);
  p.set(x + 4, y1, dark);
}

function oak(v, birch = false) {
  const rnd = srng(1000 + v * 17 + (birch ? 500 : 0));
  const p = new Pix(24, 30);
  if (birch) {
    p.vline(11, 17, 28, '#e9e6dc');
    p.vline(12, 17, 28, '#d3cfc2');
    p.vline(10, 17, 28, '#8f8b80');
    p.vline(13, 17, 28, '#8f8b80');
    for (let y = 18; y < 28; y += 3) p.set(11 + (y % 2), y, '#3b3a36');
  } else {
    trunk(p, 10, 18, 28);
  }
  const clumps = birch
    ? [
      { x: 12, y: 9, r: 6.2 },
      { x: 8.5, y: 13, r: 4.6 },
      { x: 15.5, y: 13, r: 4.6 },
      { x: 12, y: 16, r: 4.4 },
    ]
    : [
      { x: 12 + rnd() * 1.5 - 0.7, y: 9, r: 7.2 },
      { x: 6.5, y: 13.5, r: 5.2 + rnd() },
      { x: 17.5, y: 13.5, r: 5.2 + rnd() },
      { x: 12, y: 16.5, r: 5.6 },
    ];
  if (!birch && v % 2) clumps.push({ x: 12 + (rnd() - 0.5) * 6, y: 5.5, r: 4 });
  const cols = birch
    ? { dark: '#5b8a2e', base: '#78a83c', light: '#93c24e', hi: '#b4d86c' }
    : v === 3
      ? { dark: '#2f5f2a', base: '#3e7b35', light: '#539743', hi: '#6eb456' }
      : { dark: '#2e6a2b', base: '#3f8a37', light: '#56a447', hi: '#74bd58' };
  canopy(p, clumps, cols, rnd);
  p.outline(OUTLINE);
  return p;
}

function pine(v, snowy = false) {
  const rnd = srng(2000 + v * 31 + (snowy ? 7 : 0));
  const p = new Pix(18, 32);
  trunk(p, 7, 25, 30, '#5d3f27', '#3f2a1a');
  const tiers = [
    { top: 2, bottom: 12, half: 4.5 },
    { top: 7, bottom: 19, half: 6.5 },
    { top: 13, bottom: 26, half: 8.2 },
  ];
  const dark = '#21503a';
  const base = '#2f6a47';
  const light = '#3f8455';
  for (const t of tiers) {
    for (let y = t.top; y <= t.bottom; y++) {
      const f = (y - t.top) / (t.bottom - t.top);
      const half = Math.max(0.6, t.half * f + 0.4);
      for (let x = Math.floor(9 - half); x <= Math.ceil(8 + half); x++) {
        const rel = (x + 0.5 - 9) / half;
        let col = rel < -0.25 ? light : rel > 0.35 ? dark : base;
        if (y === t.bottom && (x + v) % 2 === 0) col = dark;
        if (snowy && y - t.top < 2 + f * 2 && rel < 0.5) col = y - t.top < 1 + f ? '#f4f8fb' : '#d6e2ec';
        if (col === base && rnd() < 0.07) col = dark;
        p.set(x, y, col);
      }
    }
  }
  if (snowy) {
    for (const t of tiers) {
      for (let x = 4; x < 14; x++) if (p.get(x, t.bottom) && rnd() < 0.45) p.set(x, t.bottom, '#e8eff5');
    }
  }
  p.outline('#132a20');
  return p;
}

function palm(v) {
  const rnd = srng(3000 + v * 13);
  const p = new Pix(24, 30);
  const lean = v % 2 ? 1 : -1;
  for (let y = 12; y < 29; y++) {
    const x = Math.round(11 + lean * ((29 - y) / 17) ** 2 * 3);
    const ring = y % 3 === 0;
    p.set(x, y, ring ? '#7a5632' : '#a07446');
    p.set(x + 1, y, ring ? '#5e4126' : '#86603a');
  }
  const top = { x: Math.round(11 + lean * 3), y: 11 };
  const fronds = [[-9, 2], [-6, -4], [0, -6], [6, -4], [9, 2], [-4, 5], [4, 5]];
  for (const [fx, fy] of fronds) {
    const steps = 9;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = top.x + fx * t;
      const y = top.y + fy * t + Math.sin(t * Math.PI) * -2 + t * t * 3;
      p.set(x, y, '#3e8a36');
      p.set(x, y + 1, t > 0.3 ? '#2e6a2a' : '#4fa443');
      if (rnd() < 0.3) p.set(x, y - 1, '#5fb24c');
    }
  }
  p.set(top.x, top.y + 1, '#6b4a2a');
  p.set(top.x + 1, top.y + 2, '#6b4a2a');
  p.outline(OUTLINE);
  return p;
}

function deadtree(v) {
  const rnd = srng(4000 + v * 7);
  const p = new Pix(20, 26);
  const col = '#6a5a52';
  const dark = '#4a3e3a';
  p.vline(9, 8, 24, col);
  p.vline(10, 8, 24, dark);
  const branch = (x, y, dx, len) => {
    for (let s = 0; s < len; s++) p.set(x + dx * s, y - s * 0.8, s % 3 === 2 ? dark : col);
  };
  branch(9, 14, -1, 6 + Math.floor(rnd() * 2));
  branch(10, 12, 1, 6);
  branch(9, 10, -1, 3);
  branch(10, 18, 1, 4);
  p.outline('#26201e');
  return p;
}

function willow(v) {
  const rnd = srng(5000 + v * 3);
  const p = new Pix(24, 28);
  trunk(p, 10, 18, 26, '#6e5838', '#4e3e28');
  canopy(p, [{ x: 12, y: 10, r: 8 }, { x: 7, y: 13, r: 5 }, { x: 17, y: 13, r: 5 }], { dark: '#3d6a32', base: '#548a40', light: '#6ea54f', hi: '#8cbf63' }, rnd);
  for (let x = 4; x < 21; x += 2) {
    const len = 4 + Math.floor(rnd() * 5);
    for (let y = 14; y < 14 + len; y++) if (y < 25) p.set(x, y, y % 2 ? '#3d6a32' : '#548a40');
  }
  p.outline(OUTLINE);
  return p;
}

function bush(v) {
  const rnd = srng(6000 + v * 11);
  const p = new Pix(14, 11);
  canopy(p, [{ x: 4.5, y: 6, r: 3.6 }, { x: 9.5, y: 6, r: 3.6 }, { x: 7, y: 4, r: 3.4 }], { dark: '#2f6a2c', base: '#418c39', light: '#58a648', hi: '#74bd58' }, rnd);
  if (v % 2) for (let k = 0; k < 3; k++) p.over(3 + Math.floor(rnd() * 8), 3 + Math.floor(rnd() * 5), '#d24a4a');
  p.outline(OUTLINE);
  return p;
}

function rock(v, size = 'rock', palette = null) {
  const rnd = srng(7000 + v * 19 + size.length * 101);
  const dims = size === 'boulder' ? [17, 14] : size === 'crag' ? [22, 22] : [12, 10];
  const p = new Pix(dims[0], dims[1]);
  const pal = palette || { dark: '#6a6b74', base: '#8b8c94', light: '#a7a8af', hi: '#c3c4ca' };
  const cx = dims[0] / 2;
  const cy = dims[1] * 0.58;
  const rx = dims[0] / 2 - 1.2;
  const ry = dims[1] * 0.42 - 0.5;
  const shadeFn = (dx, dy) => {
    const lit = -dx * 0.6 - dy * 0.9;
    if (lit > 0.75) return pal.hi;
    if (lit > 0.2) return pal.light;
    if (lit < -0.45) return pal.dark;
    return pal.base;
  };
  if (size === 'crag') {
    // Jagged: several overlapping ellipses with a peaked top.
    p.ellipse(cx, cy + 2, rx, ry * 0.85, shadeFn);
    p.ellipse(cx - 3, cy - 3, rx * 0.55, ry * 0.9, shadeFn);
    p.ellipse(cx + 4, cy - 1, rx * 0.5, ry * 0.75, shadeFn);
    for (let y = 1; y < cy; y++) {
      const half = (y / cy) * 4;
      for (let x = Math.floor(cx - 3 - half); x <= cx - 3 + half; x++) p.set(x, y, x < cx - 3 ? pal.light : pal.base);
    }
    if (v % 2 === 0) for (let y = 1; y < 5; y++) for (let x = Math.floor(cx - 3 - y); x <= cx - 3 + y * 0.6; x++) p.set(x, y, y < 3 ? '#f4f8fb' : '#d8e2ec');
  } else {
    p.ellipse(cx, cy, rx, ry, shadeFn);
    if (size === 'boulder') p.ellipse(cx + 3, cy + 1.5, rx * 0.5, ry * 0.6, shadeFn);
  }
  // A crack or two.
  const crackX = Math.floor(cx + (rnd() - 0.5) * rx);
  for (let k = 0; k < 3; k++) p.over(crackX + (k % 2), Math.floor(cy - 1 + k), pal.dark);
  p.outline(ROCK_OUT);
  return p;
}

function cactus(v) {
  const p = new Pix(12, 18);
  const g = '#4f9a42';
  const gl = '#6cb756';
  const gd = '#3a7a32';
  p.rect(5, 2, 3, 15, g);
  p.vline(5, 2, 16, gl);
  p.vline(7, 2, 16, gd);
  if (v % 2 === 0) {
    p.rect(2, 7, 2, 5, g);
    p.rect(2, 11, 3, 2, g);
    p.vline(2, 7, 12, gl);
  }
  p.rect(9, 5, 2, 5, g);
  p.rect(8, 9, 2, 2, g);
  p.vline(10, 5, 10, gd);
  if (v === 1) p.set(6, 1, '#ff7aa8');
  p.outline('#1f3d1e');
  return p;
}

function reeds(v) {
  const rnd = srng(9000 + v);
  const p = new Pix(14, 16);
  for (let k = 0; k < 6; k++) {
    const x = 2 + Math.floor(rnd() * 10);
    const top = 3 + Math.floor(rnd() * 6);
    for (let y = top; y < 15; y++) p.set(x + (y < top + 3 && k % 2 ? 1 : 0), y, y > 11 ? '#4f7a3a' : '#6f9a48');
    if (k % 2 === 0) {
      p.set(x, top - 1, '#7a4f2a');
      p.set(x, top - 2, '#7a4f2a');
      p.set(x, top, '#5e3a1e');
    }
  }
  return p;
}

const ASH_ROCK = { dark: '#27232d', base: '#3b3642', light: '#4f4957', hi: '#625c6b' };

function ashrock(v) {
  const p = rock(v, v % 2 ? 'boulder' : 'rock', ASH_ROCK);
  for (let k = 0; k < p.w; k++) {
    const y = Math.floor(p.h * 0.55 + Math.sin(k + v) * 1.5);
    if (k % 2 === 0) p.over(k, y, k % 4 === 0 ? '#ff7a3a' : '#ffb44c');
  }
  return p;
}

/** Sprite canvas for a feature (cached), with anchor offset to the tile's bottom-centre. */
export function featureSprite(f, v) {
  const key = `${f}:${v}`;
  let s = cache.get(key);
  if (s) return s;
  let p;
  switch (f) {
    case F.OAK: p = oak(v); break;
    case F.BIRCH: p = oak(v, true); break;
    case F.PINE: p = pine(v); break;
    case F.SNOWPINE: p = pine(v, true); break;
    case F.PALM: p = palm(v); break;
    case F.DEADTREE: p = deadtree(v); break;
    case F.WILLOW: p = willow(v); break;
    case F.BUSH: p = bush(v); break;
    case F.ROCK: p = rock(v, 'rock'); break;
    case F.BOULDER: p = rock(v, 'boulder'); break;
    case F.CRAG: p = rock(v, 'crag'); break;
    case F.CACTUS: p = cactus(v); break;
    case F.REEDS: p = reeds(v); break;
    case F.ASHROCK: p = ashrock(v); break;
    default: return null;
  }
  const tall = f !== F.BUSH && f !== F.ROCK && f !== F.REEDS && f !== F.ASHROCK;
  s = { canvas: p.toCanvas(), w: p.w, h: p.h, shadow: tall ? 0.9 : 0.6 };
  cache.set(key, s);
  return s;
}

/** Small tree used in yards and gardens. */
export function yardTreeSprite() {
  return featureSprite(F.OAK, 2);
}
