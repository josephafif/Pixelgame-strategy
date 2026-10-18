// Environmental sprites (trees, bushes, rocks, plants), drawn procedurally.
//
// Every species has many shape variants (size, canopy silhouette, trunk
// height and lean, mirrored layouts) and several colourings (hue and
// lightness jitter, autumn, blossom; rock kinds per biome, moss, snow).
// A shape is painted once with tone tokens ('a0'..'a4' foliage, 't0'..'t3'
// bark, 'r0'..'r4' stone, …), then colourized per palette and cached.
// Light comes from the upper left; canopies and rocks are shaded from a
// small heightfield of spheres, so clumps and leaf clusters get their own
// highlights and creases. Each sprite carries a soft cast-shadow mask that
// falls down-right of its base.

import { Pix, srng } from './pix.js';
import { F, B } from '../../engine/world/biomes.js';
import { fromHsl, mix } from './color.js';
import { ROCKS, FOLIAGE, BARK, NATURE_INK } from './palette.js';

/** Shape variants per species (each also comes mirrored). */
export const NATURE_VARIANTS = 16;

const shapeCache = new Map();
const spriteCache = new Map();

// Direction towards the light: upper left and a little towards the viewer.
const L = (() => {
  const v = [-0.52, -0.62, 0.59];
  const k = 1 / Math.hypot(v[0], v[1], v[2]);
  return [v[0] * k, v[1] * k, v[2] * k];
})();

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Colour helpers

/** Five foliage tones (dark → light): shadows lean blue, highlights yellow. */
function tones5(h, s, l, { spread = 0.085, hueDark = 6, hueLight = -8 } = {}) {
  const out = [];
  for (let i = -2; i <= 2; i++) {
    const dh = i < 0 ? -i * hueDark : i * hueLight;
    const ds = i < 0 ? -i * 0.03 : -i * 0.045;
    out.push(fromHsl(h + dh, s + ds, l + i * spread + (i === 2 ? 0.015 : 0)));
  }
  return out;
}

// Per-tree colour jitter: [hue, saturation, lightness] offsets.
const JITTER = [
  [0, 0, 0],
  [-9, 0.03, 0.025],
  [8, -0.03, -0.02],
  [-15, 0.05, 0.035],
  [4, 0, -0.04],
  [-3, -0.06, 0.02],
  [13, -0.05, 0],
  [-6, 0.02, -0.025],
];

function mapTokens(prefix, cols, into) {
  cols.forEach((c, i) => {
    into[prefix + i] = c;
  });
  return into;
}

// ---------------------------------------------------------------------------
// Painting helpers (token Pix)

/**
 * Heightfield of spheres: each pixel takes the sphere whose surface is
 * highest there, and remembers its normal and owner.
 */
function sphereField(W, H, spheres) {
  const n = W * H;
  const hgt = new Float32Array(n).fill(-1e9);
  const nx = new Float32Array(n);
  const ny = new Float32Array(n);
  const nz = new Float32Array(n);
  const own = new Int16Array(n).fill(-1);
  for (const s of spheres) {
    const ry = s.r * (s.sq || 1);
    const x0 = Math.max(0, Math.floor(s.x - s.r));
    const x1 = Math.min(W - 1, Math.ceil(s.x + s.r));
    const y0 = Math.max(0, Math.floor(s.y - ry));
    const y1 = Math.min(H - 1, Math.ceil(s.y + ry));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - s.x) / s.r;
        const dy = (y + 0.5 - s.y) / ry;
        const d2 = dx * dx + dy * dy;
        if (d2 >= 1) continue;
        const k = Math.sqrt(1 - d2);
        const z = s.z + s.r * k;
        const i = y * W + x;
        if (z > hgt[i]) {
          hgt[i] = z;
          nx[i] = dx;
          ny[i] = dy;
          nz[i] = k;
          own[i] = s.id;
        }
      }
    }
  }
  return { hgt, nx, ny, nz, own };
}

/**
 * Leafy canopy from clumps [{x, y, r}]: each clump gets a scalloped rim of
 * small spheres and leaf clusters on its surface; lower clumps sit in front.
 */
function foliage(p, clumps, rnd, o = {}) {
  const { bump = 1, ao = 0.28, accent = 0, sq = 1, rim = 1 } = o;
  const spheres = [];
  let top = Infinity;
  let bottom = -Infinity;
  const y0 = clumps[0].y;
  clumps.forEach((c, id) => {
    c.z = (c.y - y0) * 0.45 + (c.front || 0);
    spheres.push({ x: c.x, y: c.y, r: c.r, z: c.z, id, sq });
    top = Math.min(top, c.y - c.r * sq);
    bottom = Math.max(bottom, c.y + c.r * sq);
  });
  clumps.forEach((c, id) => {
    const nr = Math.max(5, Math.round(c.r * 1.7 * rim));
    for (let k = 0; k < nr; k++) {
      const a = ((k + rnd() * 0.7) / nr) * TAU;
      const rb = Math.max(1.25, c.r * (0.22 + rnd() * 0.14));
      const d = c.r - rb * 0.5;
      const surf = c.r * Math.sqrt(Math.max(0, 1 - (d / c.r) ** 2));
      spheres.push({ x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d * sq, r: rb, z: c.z + surf - rb * 0.55, id, sq });
    }
    const ni = Math.round(c.r * c.r * 0.06 * bump);
    for (let k = 0; k < ni; k++) {
      const rr = c.r * 0.72 * Math.sqrt(rnd());
      const a = rnd() * TAU;
      const rb = Math.max(1.4, c.r * (0.25 + rnd() * 0.12));
      const surf = c.r * Math.sqrt(Math.max(0, 1 - (rr / c.r) ** 2));
      spheres.push({ x: c.x + Math.cos(a) * rr, y: c.y + Math.sin(a) * rr * sq, r: rb, z: c.z + surf - rb * 0.5, id, sq });
    }
  });
  const W = p.w;
  const H = p.h;
  const f = sphereField(W, H, spheres);
  const mid = (top + bottom) / 2;
  const half = Math.max(1, (bottom - top) / 2);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (f.own[i] < 0) continue;
      // Blend the leaf cluster's normal with its clump's, so every clump
      // keeps a clear light side and shadow side.
      const c = clumps[f.own[i]];
      let cx = (x + 0.5 - c.x) / c.r;
      let cy = (y + 0.5 - c.y) / (c.r * sq);
      const cd = Math.hypot(cx, cy);
      if (cd > 0.98) {
        cx *= 0.98 / cd;
        cy *= 0.98 / cd;
      }
      const cz = Math.sqrt(Math.max(0, 1 - cx * cx - cy * cy));
      let nx = cx * 0.6 + f.nx[i] * 0.4;
      let ny = cy * 0.6 + f.ny[i] * 0.4;
      let nz = cz * 0.6 + f.nz[i] * 0.4;
      const nl = 1 / Math.hypot(nx, ny, nz);
      nx *= nl;
      ny *= nl;
      nz *= nl;
      let lit = nx * L[0] + ny * L[1] + nz * L[2];
      lit -= ao * ((y + 0.5 - mid) / half);
      // Clump borders: shade the back clump where a front one starts below
      // or right of it, and give the front clump's top edge a little rim.
      const o = f.own[i];
      const ob = y + 1 < H ? f.own[i + W] : -1;
      const or = x + 1 < W ? f.own[i + 1] : -1;
      const ou = y > 0 ? f.own[i - W] : -1;
      const ol = x > 0 ? f.own[i - 1] : -1;
      if ((ob >= 0 && ob !== o && clumps[ob].z > c.z) || (or >= 0 && or !== o && clumps[or].z > c.z)) lit -= 0.42;
      else if ((ou >= 0 && ou !== o && clumps[ou].z < c.z) || (ol >= 0 && ol !== o && clumps[ol].z < c.z)) lit += 0.18;
      lit += (rnd() - 0.5) * 0.05;
      const t = lit > 0.86 ? 4 : lit > 0.62 ? 3 : lit > 0.32 ? 2 : lit > 0.02 ? 1 : 0;
      p.set(x, y, t >= 2 && rnd() < accent * (t - 1) ? `k${t}` : `a${t}`);
    }
  }
  return { top, bottom };
}

/** A trunk from its base (x0, y0) curving up to (x1, y1), `w` pixels wide. */
function trunk(p, x0, y0, x1, y1, w, rnd, { flare = true, texture = 0.14 } = {}) {
  const n = Math.max(1, Math.round(y0 - y1));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const y = y0 - k;
    const cx = x0 + (x1 - x0) * t * t;
    const ww = w + (flare && k === 0 ? 2 : flare && k === 1 && w > 2 ? 1 : 0);
    const left = Math.round(cx - ww / 2);
    for (let i = 0; i < ww; i++) {
      let tok = i === 0 ? 't3' : i === ww - 1 ? 't1' : 't2';
      if (tok === 't2' && rnd() < texture) tok = 't1';
      if (k === 0 && (i === 0 || i === ww - 1)) tok = 't1';
      p.set(left + i, y, tok);
    }
  }
}

/** A thin branch line in bark tokens (light on its upper-left side). */
function branch(p, x0, y0, x1, y1, w = 1) {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let k = 0; k <= n; k++) {
    const x = x0 + ((x1 - x0) * k) / n;
    const y = y0 + ((y1 - y0) * k) / n;
    if (w <= 1) p.set(x, y, 't2');
    else {
      p.set(x, y, 't3');
      p.set(x + 1, y, 't1');
      if (w > 2) p.set(x + 2, y, 't1');
    }
  }
}

/**
 * Outline every empty pixel touching the shape: the soft 'o1' tone on the
 * lit upper-left rim, the deep 'o0' ink everywhere else.
 */
function outline(p) {
  const marks = [];
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      if (p.get(x, y)) continue;
      const r = p.get(x + 1, y);
      const l = p.get(x - 1, y);
      const d = p.get(x, y + 1);
      const u = p.get(x, y - 1);
      if (!(r || l || d || u)) continue;
      marks.push(x, y, (r || d) && !l && !u ? 'o1' : 'o0');
    }
  }
  for (let k = 0; k < marks.length; k += 3) p.set(marks[k], marks[k + 1], marks[k + 2]);
}

/**
 * Finish a token shape: outline, crop around the anchor (kept horizontally
 * centred), and build the cast-shadow mask.
 */
function finish(p, ax, ay, { castK = 1, noOutline = false } = {}) {
  if (!noOutline) outline(p);
  let minX = p.w;
  let maxX = -1;
  let minY = p.h;
  let maxY = -1;
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      if (!p.d[y * p.w + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const half = Math.max(ax - minX, maxX - ax, 1);
  const w = half * 2 + 1;
  const h = Math.max(ay + 2, maxY + 1) - minY;
  const q = new Pix(w, h);
  q.blit(p, half - ax, -minY);
  const nax = half;
  const nay = ay - minY;
  return { pix: q, ax: nax, ay: nay, cast: castShadow(q, nax, nay, castK) };
}

/**
 * Soft shadow mask: the silhouette squashed onto the ground and pushed
 * down-right (light from the upper left), with a darker contact spot at the
 * base. Returns { pix (alpha mask), x, y } relative to the anchor.
 */
function castShadow(p, ax, ay, k = 1) {
  let minX = p.w;
  let maxX = -1;
  let minY = p.h;
  let maxY = -1;
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      if (!p.d[y * p.w + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const sw = maxX - minX + 1;
  const sh = maxY - minY + 1;
  const cy = (minY + maxY) / 2;
  const zc = Math.max(1, ay - cy);
  // Ground footprint is roughly as deep as the silhouette is wide (3/4 view).
  const squash = Math.min(0.62, (0.5 * sw) / sh) * k;
  const offX = 0.2 * zc + 1;
  const offY = 0.07 * zc + 0.5;
  const pad = 2;
  const W = sw + Math.ceil(offX) + pad * 2 + 2;
  const Hs = Math.ceil(sh * squash) + pad * 2 + 4;
  const ox = minX - pad; // mask x = px - ox
  const top = Math.floor(ay + offY - (cy - minY) * squash) - pad;
  const m = new Pix(W, Hs);
  for (let y = minY; y <= maxY; y++) {
    const sy = Math.round(ay + offY + (y - cy) * squash) - top;
    for (let x = minX; x <= maxX; x++) {
      if (!p.d[y * p.w + x]) continue;
      m.set(Math.round(x + offX) - ox, sy, '#000000', 1);
    }
  }
  // Contact shadow right at the base.
  const cw = Math.max(2, Math.min(5, Math.round(sw * 0.18)));
  for (let dx = -cw; dx <= cw + 1; dx++) m.set(ax + dx - ox, ay - top, '#000000', 1);
  // Soften: edge pixels at partial strength, plus a faint fringe.
  const out = new Pix(W, Hs);
  for (let y = 0; y < Hs; y++) {
    for (let x = 0; x < W; x++) {
      const on = m.get(x, y);
      const nb = (m.get(x - 1, y) ? 1 : 0) + (m.get(x + 1, y) ? 1 : 0) + (m.get(x, y - 1) ? 1 : 0) + (m.get(x, y + 1) ? 1 : 0);
      if (on) out.set(x, y, '#000000', nb === 4 ? 1 : 0.6);
      else if (nb >= 2) out.set(x, y, '#000000', 0.25);
    }
  }
  return { pix: out, x: ox - ax, y: top - ay };
}

// ---------------------------------------------------------------------------
// Tree shapes. Each takes (rnd, m = ±1 mirror, s = size) and returns a token
// Pix with the anchor (trunk base) position.

function sizeOf(v, rnd, lo = 0.65, hi = 1.3) {
  // Stratified over the variants so every pool spans the whole size range.
  return lo + (hi - lo) * (((v * 7) % NATURE_VARIANTS) + rnd()) / NATURE_VARIANTS;
}

function genBroadleaf(rnd, m, s, birch) {
  const R = (birch ? 7.4 : 9.4) * s;
  const trunkH = Math.round((birch ? 4 + rnd() * 4 : 1.5 + rnd() * 3.5) * (0.7 + 0.3 * s));
  const lean = (rnd() - 0.5) * 3.2 * s;
  const twin = birch && rnd() < 0.35;
  const W = Math.ceil(2 * R + Math.abs(lean) * 2 + 14 + (twin ? 8 : 0));
  const H = Math.ceil(trunkH + 2 * R * (birch ? 1.3 : 1) + 10);
  const p = new Pix(W, H);
  const ax = W >> 1;
  const ay = H - 3;
  const ccx = ax + 0.5 + m * lean;
  const ccy = ay - trunkH - R * (birch ? 1.1 : 0.84);
  const tw = s < 0.82 ? 2 : s < 1.12 ? 3 : 4;
  const clumps = [];
  if (birch) {
    const stems = twin ? [-1, 1] : [0];
    for (const st of stems) {
      const sx = ccx + st * m * R * 0.42;
      const sy = ccy + (st > 0 ? R * 0.18 : 0);
      trunk(p, ax + st * m, ay, sx, sy + R * 0.2, twin ? 2 : tw - (s > 1 ? 1 : 0), rnd, { texture: 0 });
      const n = 3 + Math.floor(rnd() * 3);
      clumps.push({ x: sx, y: sy, r: R * (twin ? 0.5 : 0.58) * (0.9 + rnd() * 0.2) });
      for (let k = 0; k < n; k++) {
        const a = rnd() * TAU;
        const d = R * (0.3 + rnd() * 0.32) * (twin ? 0.8 : 1);
        clumps.push({ x: sx + Math.cos(a) * d * 0.72, y: sy + Math.sin(a) * d * 1.25, r: R * (0.32 + rnd() * 0.18) });
      }
    }
    clumps.push({ x: ccx + m * (rnd() - 0.5) * R * 0.3, y: ccy + R * 0.62, r: R * 0.36, front: 0.5 });
    // Birch bark: dark marks across the white stem.
    for (let i = 0; i < p.d.length; i++) {
      if (p.d[i] && rnd() < 0.16) {
        const x = i % W;
        if (p.d[i - 1] === 't3') {
          p.d[i] = 't0';
          if (rnd() < 0.5) p.set(x + 1, (i / W) | 0, 't0');
        }
      }
    }
  } else {
    trunk(p, ax, ay, ccx - 0.5, ccy + R * 0.25, tw, rnd);
    // Two branches reaching into the crown, visible through gaps.
    branch(p, ccx - 1, ccy + R * 0.35, ccx - m * R * 0.5, ccy - R * 0.05, s > 1 ? 2 : 1);
    branch(p, ccx, ccy + R * 0.3, ccx + m * R * 0.45, ccy + R * 0.05, 1);
    clumps.push({ x: ccx, y: ccy, r: R * (0.6 + rnd() * 0.12) });
    const n = 3 + Math.floor(rnd() * 4);
    const a0 = rnd() * TAU;
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * TAU + (rnd() - 0.5) * 0.9;
      const d = R * (0.36 + rnd() * 0.3);
      clumps.push({ x: ccx + m * Math.cos(a) * d * 1.08, y: ccy + Math.sin(a) * d * 0.8, r: R * (0.36 + rnd() * 0.26) });
    }
    clumps.push({ x: ccx + m * (rnd() - 0.5) * R * 0.4, y: ccy + R * 0.4, r: R * (0.42 + rnd() * 0.1), front: 0.5 });
  }
  foliage(p, clumps, rnd, { accent: 0.08, ao: birch ? 0.22 : 0.3 });
  return { p, ax, ay };
}

function genPine(rnd, m, s, snowy) {
  const Ht = Math.round((21 + rnd() * 9) * s);
  const half = (7.4 + rnd() * 2.6) * s;
  const trunkH = Math.max(2, Math.round((2 + rnd() * 3) * s));
  const tiers = Math.max(3, Math.min(5, Math.round(Ht / 8 + rnd() * 0.8 - 0.3)));
  const W = Math.ceil(half * 2 + 10);
  const H = Ht + trunkH + 8;
  const p = new Pix(W, H);
  const ax = W >> 1;
  const ay = H - 3;
  const lean = (rnd() - 0.5) * 1.8 * s * m;
  const topY = ay - trunkH - Ht;
  trunk(p, ax, ay, ax + 0.5 + lean * 0.2, ay - trunkH - 3, s > 1.05 ? 3 : 2, rnd);
  const owner = new Int8Array(W * H).fill(-1);
  const relOf = new Float32Array(W * H);
  const snowAmt = snowy ? 0.45 + rnd() * 0.55 : 0;
  // Bottom tier first: upper tiers overlap the ones below.
  const T = [];
  for (let i = 0; i < tiers; i++) {
    const f0 = i / tiers;
    const f1 = (i + 1) / tiers;
    const yTop = topY + Math.round(Ht * Math.max(0, f0 - 0.16 - rnd() * 0.06));
    const yBot = topY + Math.round(Ht * f1) - (i === tiers - 1 ? 0 : Math.round(rnd() * 1.5));
    const hw = half * (0.32 + 0.68 * f1) * (0.88 + rnd() * 0.24);
    const cx = ax + 0.5 + lean * (1 - f1) + (rnd() - 0.5) * 1.3 * s;
    T.push({ yTop, yBot, hw, cx, droop: rnd() });
  }
  for (let i = tiers - 1; i >= 0; i--) {
    const t = T[i];
    const span = Math.max(1, t.yBot - t.yTop);
    for (let y = t.yTop; y <= t.yBot; y++) {
      const u = (y - t.yTop) / span;
      const w = Math.max(0.6, t.hw * (0.14 + 0.86 * u ** 0.85));
      const x0 = Math.floor(t.cx - w);
      const x1 = Math.ceil(t.cx + w);
      for (let x = x0; x <= x1; x++) {
        const rel = (x + 0.5 - t.cx) / w;
        if (Math.abs(rel) > 1) continue;
        // Branch tips: small teeth along the bottom edge.
        if (y === t.yBot && Math.abs(rel) > 0.25 && (x + i) % 3 === 0) continue;
        if (y === t.yBot - 1 && Math.abs(rel) > 0.85 && (x + i) % 3 === 1) continue;
        const nx = rel * 0.82;
        const ny = -0.42 + u * 0.55;
        const nz = Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny));
        let lit = nx * L[0] + ny * L[1] + nz * L[2];
        if (y >= t.yBot - 1) lit -= 0.22;
        lit += (rnd() - 0.5) * 0.16;
        if (rnd() < 0.1) lit -= 0.3; // needle strokes
        const tone = lit > 0.88 ? 4 : lit > 0.62 ? 3 : lit > 0.34 ? 2 : lit > 0.04 ? 1 : 0;
        p.set(x, y, `a${tone}`);
        owner[y * W + x] = i;
        relOf[y * W + x] = rel;
      }
    }
  }
  // Shade just below each tier's overhang; snow lies on the top edge of
  // every visible skirt of branches instead.
  for (let y = H - 1; y >= 1; y--) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const o = owner[i];
      if (o < 0) continue;
      const above = owner[i - W];
      const rel = relOf[i];
      const leftEdge = x > 0 && owner[i - 1] !== o && rel < -0.4 && rnd() < snowAmt;
      if (snowy && (leftEdge || (above !== o && rel < 0.75 && rnd() < 0.55 + snowAmt * 0.45))) {
        p.d[i] = rel < -0.15 ? 's2' : rel < 0.35 ? 's1' : 's0';
        if (y + 1 < H && owner[i + W] === o && rel < 0.3 && rnd() < snowAmt * 0.8) p.d[i + W] = rel < -0.3 ? 's1' : 's0';
      } else if (above >= 0 && above < o) {
        const c = p.d[i];
        if (c[0] === 'a') p.d[i] = `a${Math.max(0, Number(c[1]) - 2)}`;
      }
    }
  }
  return { p, ax, ay };
}

function genPalm(rnd, m, s) {
  const Ht = Math.round((14 + rnd() * 8) * s);
  const lean = (1.5 + rnd() * 4.5) * s * m * (rnd() < 0.2 ? 0.25 : 1);
  const fl = (7 + rnd() * 3) * s;
  const W = Math.ceil(Math.abs(lean) * 2 + fl * 2.4 + 12);
  const H = Math.ceil(Ht + fl + 12);
  const p = new Pix(W, H);
  const ax = W >> 1;
  const ay = H - 3;
  const tw = s > 1.1 ? 3 : 2;
  for (let k = 0; k <= Ht; k++) {
    const t = k / Ht;
    const x = Math.round(ax + lean * t * t - tw / 2 + 0.5);
    const ring = k % 3 === 0;
    for (let i = 0; i < tw; i++) p.set(x + i, ay - k, ring ? (i === 0 ? 't2' : 't0') : i === 0 ? 't3' : i === tw - 1 ? 't1' : 't2');
  }
  const top = { x: ax + lean + 0.5, y: ay - Ht };
  const n = 6 + Math.floor(rnd() * 3);
  const fronds = [];
  for (let k = 0; k < n; k++) {
    // Spread around the crown, mostly sideways and up.
    const a = -Math.PI / 2 + ((k / (n - 1)) - 0.5) * Math.PI * 1.75 + (rnd() - 0.5) * 0.35;
    fronds.push({ a, len: fl * (0.8 + rnd() * 0.4), droop: 0.5 + rnd() * 0.5 });
  }
  // Back fronds first (pointing up), front ones (pointing down/out) last.
  fronds.sort((f1, f2) => Math.sin(f1.a) - Math.sin(f2.a));
  for (const fr of fronds) {
    const ca = Math.cos(fr.a);
    const sa = Math.sin(fr.a);
    const facing = -ca * 0.6 - sa * 0.5; // towards the light: brighter
    const steps = Math.ceil(fr.len * 1.3);
    for (let st = 0; st <= steps; st++) {
      const t = st / steps;
      const x = top.x + ca * fr.len * t;
      const y = top.y + sa * fr.len * t * 0.75 + fr.droop * fr.len * 0.45 * t * t;
      const tone = facing > 0.25 ? 3 : facing > -0.2 ? 2 : 1;
      p.set(x, y, `a${t < 0.15 ? 2 : tone}`);
      p.set(x, y + 1, `a${Math.max(0, tone - 1)}`);
      // Leaflets hanging from the spine.
      if (t > 0.15 && st % 2 === 0) {
        const ll = t < 0.85 ? 2 : 1;
        for (let j = 1; j <= ll; j++) p.set(x + (ca > 0 ? -j * 0.4 : j * 0.4), y + 1 + j, `a${Math.max(0, tone - 2)}`);
        if (rnd() < 0.5) p.set(x, y - 1, `a${Math.min(4, tone + 1)}`);
      }
    }
  }
  if (rnd() < 0.65) {
    p.set(top.x - 1, top.y + 1, 'c0');
    p.set(top.x + 1, top.y + 1, 'c1');
    if (rnd() < 0.6) p.set(top.x, top.y + 2, 'c0');
  }
  return { p, ax, ay };
}

function genDead(rnd, m, s) {
  const Ht = Math.round((10 + rnd() * 8) * s);
  const W = Math.ceil(Ht * 1.6 + 12);
  const H = Math.ceil(Ht * 1.5 + 10);
  const p = new Pix(W, H);
  const ax = W >> 1;
  const ay = H - 3;
  const limb = (x, y, ang, len, w, depth) => {
    let cx = x;
    let cy = y;
    const n = Math.max(2, Math.round(len));
    for (let k = 0; k < n; k++) {
      cx += Math.cos(ang);
      cy += Math.sin(ang);
      ang += (rnd() - 0.5) * 0.3;
      const ww = Math.max(1, Math.round(w - (k / n) * (w - 1) * 0.6));
      const left = Math.round(cx - ww / 2);
      for (let i = 0; i < ww; i++) p.set(left + i, Math.round(cy), ww === 1 ? 't2' : i === 0 ? 't3' : i === ww - 1 ? 't1' : 't2');
      if (depth > 0 && k > n * 0.45 && rnd() < 0.16) {
        limb(cx, cy, ang + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.5), len * 0.45, Math.max(1, w - 1), depth - 1);
      }
    }
    if (depth > 0) {
      const kids = rnd() < 0.35 ? 3 : 2;
      for (let j = 0; j < kids; j++) {
        const da = (j - (kids - 1) / 2) * (0.6 + rnd() * 0.5);
        limb(cx, cy, ang + da, len * (0.5 + rnd() * 0.2), Math.max(1, w - 1), depth - 1);
      }
    }
  };
  const tw = s > 1.05 ? 3 : 2;
  const ang = -Math.PI / 2 + m * (rnd() - 0.4) * 0.35;
  // Trunk, then crown limbs.
  const tl = Ht * (0.45 + rnd() * 0.2);
  let x = ax + 0.5;
  let y = ay;
  for (let k = 0; k < tl; k++) {
    const ww = tw + (k === 0 ? 2 : 0);
    const left = Math.round(x - ww / 2);
    for (let i = 0; i < ww; i++) p.set(left + i, Math.round(y), i === 0 ? 't3' : i === ww - 1 ? 't1' : 't2');
    x += Math.cos(ang);
    y += Math.sin(ang);
  }
  limb(x, y, ang - m * (0.3 + rnd() * 0.3), Ht * 0.5, tw - 1, 2);
  limb(x, y, ang + m * (0.35 + rnd() * 0.3), Ht * 0.45, tw - 1, 1 + (rnd() < 0.5 ? 1 : 0));
  if (rnd() < 0.5) limb(x - m, y + tl * 0.3, ang - m * 1.1, Ht * 0.3, 1, 1);
  return { p, ax, ay };
}

function genWillow(rnd, m, s) {
  const R = 9.6 * s;
  const trunkH = Math.round((4 + rnd() * 3) * s);
  const W = Math.ceil(R * 2.6 + 12);
  const H = Math.ceil(trunkH + R * 2 + 12);
  const p = new Pix(W, H);
  const ax = W >> 1;
  const ay = H - 3;
  const ccx = ax + 0.5 + m * (rnd() - 0.5) * 2 * s;
  const ccy = ay - trunkH - R * 0.75;
  trunk(p, ax, ay, ccx - 0.5, ccy, s > 1 ? 4 : 3, rnd);
  const clumps = [{ x: ccx, y: ccy - R * 0.1, r: R * 0.62 }];
  const n = 3 + Math.floor(rnd() * 3);
  for (let k = 0; k < n; k++) {
    const a = Math.PI + (k / (n - 1)) * Math.PI + (rnd() - 0.5) * 0.4;
    const d = R * (0.45 + rnd() * 0.2);
    clumps.push({ x: ccx + m * Math.cos(a) * d * 1.2, y: ccy + Math.sin(a) * d * 0.55 + R * 0.12, r: R * (0.38 + rnd() * 0.16) });
  }
  const { bottom } = foliage(p, clumps, rnd, { accent: 0, ao: 0.22, sq: 0.85 });
  // Hanging curtain of thin strands.
  let x0 = W;
  let x1 = 0;
  for (let i = 0; i < p.d.length; i++) {
    if (p.d[i] && p.d[i][0] === 'a') {
      x0 = Math.min(x0, i % W);
      x1 = Math.max(x1, i % W);
    }
  }
  const phase = rnd() * TAU;
  for (let x = x0; x <= x1; x++) {
    if ((x & 1) && rnd() < 0.55) continue;
    let yb = -1;
    for (let y = H - 1; y >= 0; y--) {
      const c = p.get(x, y);
      if (c && c[0] === 'a') {
        yb = y;
        break;
      }
    }
    if (yb < 0) continue;
    const edge = Math.min(x - x0, x1 - x) / Math.max(1, (x1 - x0) / 2);
    const len = Math.round((3 + rnd() * 4 + Math.sin(phase + x * 0.7) * 2 + (1 - edge) * 3) * s);
    const tone = x < ccx - R * 0.3 ? 3 : x < ccx + R * 0.3 ? 2 : 1;
    const start = yb - 1 - Math.floor(rnd() * 3);
    for (let y = start; y < Math.min(bottom + len, ay - 1, start + len + 3); y++) p.set(x, y, `a${y > start + len - 1 ? Math.max(0, tone - 1) : tone}`);
  }
  return { p, ax, ay };
}

function genBush(rnd, m, s) {
  const R = 5 * s;
  const W = Math.ceil(R * 3.2 + 10);
  const H = Math.ceil(R * 2.2 + 8);
  const p = new Pix(W, H);
  const ax = W >> 1;
  const ay = H - 3;
  const n = 2 + Math.floor(rnd() * 3);
  const clumps = [{ x: ax + 0.5, y: ay - R * 0.85, r: R * (0.72 + rnd() * 0.15) }];
  for (let k = 0; k < n; k++) {
    const side = k % 2 ? 1 : -1;
    clumps.push({ x: ax + 0.5 + m * side * R * (0.55 + rnd() * 0.45), y: ay - R * (0.45 + rnd() * 0.35), r: R * (0.48 + rnd() * 0.2) });
  }
  foliage(p, clumps, rnd, { accent: 0.1, ao: 0.32, bump: 0.8, sq: 0.9 });
  // Keep the base on the ground line.
  for (let y = ay + 1; y < H; y++) for (let x = 0; x < W; x++) p.d[y * W + x] = null;
  return { p, ax, ay };
}

function genCactus(rnd, m, v) {
  const kind = v % 8 === 3 ? 'barrel' : 'saguaro';
  const W = 22;
  const H = 26;
  const p = new Pix(W, H);
  const ax = W >> 1;
  const ay = H - 3;
  const shadeCol = (rel, u) => {
    const lit = -rel * 0.8 + 0.3 - u * 0.2;
    return lit > 0.75 ? 4 : lit > 0.35 ? 3 : lit > -0.1 ? 2 : lit > -0.5 ? 1 : 0;
  };
  const column = (cx, yb, yt, hw) => {
    for (let y = yt; y <= yb; y++) {
      const round = y - yt < 1 ? 0.6 : 1;
      for (let x = Math.floor(cx - hw * round); x <= Math.ceil(cx + hw * round) - 1; x++) {
        const rel = (x + 0.5 - cx) / hw;
        let t = shadeCol(rel, (y - yt) / Math.max(1, yb - yt));
        if (Math.abs(rel) < 0.3 && t > 1 && (y & 1)) t--; // rib
        p.set(x, y, `a${t}`);
      }
    }
  };
  if (kind === 'saguaro') {
    const h = 11 + Math.floor(rnd() * 6);
    const hw = 1.8 + rnd() * 0.5;
    const cx = ax + 0.5;
    const arms = rnd() < 0.08 ? 0 : rnd() < 0.45 ? 1 : 2;
    const used = [];
    for (let k = 0; k < arms; k++) {
      const side = (k === 0 ? 1 : -1) * m;
      let ay0 = ay - 4 - Math.floor(rnd() * (h * 0.4));
      if (used.length && Math.abs(used[0] - ay0) < 2) ay0 -= 2;
      used.push(ay0);
      const out = 3 + Math.floor(rnd() * 2);
      const up = 4 + Math.floor(rnd() * 4);
      const ex = side > 0 ? Math.ceil(cx + hw) + out - 1 : Math.floor(cx - hw) - out;
      // Elbow running out from the trunk, then the arm turning upwards.
      for (let x = Math.min(ex, Math.round(cx)); x <= Math.max(ex, Math.round(cx)); x++) {
        p.set(x, ay0, 'a2');
        p.set(x, ay0 + 1, 'a1');
      }
      column(ex + (side > 0 ? 0 : 1), ay0 + 1, ay0 - up, 1.05);
    }
    column(cx, ay, ay - h, hw);
    if (rnd() < 0.35) p.set(cx - 0.5, ay - h - 1, 'k4');
  } else if (kind === 'barrel') {
    const r = 3.2 + rnd() * 1.5;
    p.ellipse(ax + 0.5, ay - r + 1, r, r * 1.05, (dx, dy) => `a${shadeCol(dx, (dy + 1) / 2)}`);
    for (let x = Math.ceil(ax - r); x < ax + r; x += 2) for (let y = Math.round(ay - r * 1.6); y <= ay; y++) if (p.get(x, y) === 'a2' || p.get(x, y) === 'a3') p.set(x, y, 'a1');
    p.set(ax, Math.round(ay - r * 2 + 1), 'k4');
    p.set(ax + 1, Math.round(ay - r * 2 + 1), 'k4');
  }
  return { p, ax, ay };
}

function genReeds(rnd, m, s) {
  const W = 22;
  const H = 22;
  const p = new Pix(W, H);
  const ax = W >> 1;
  const ay = H - 3;
  // A few clumps of blades, spaced so each one reads on its own.
  const slots = [-6, -4, -2, 0, 2, 4, 6].filter(() => rnd() < 0.72);
  if (slots.length < 3) slots.push(-3, 1, 5);
  const blades = slots.map((x) => ({ x: ax + x + (rnd() < 0.5 ? 0 : 1) * m, h: Math.round((6 + rnd() * 8) * s), bend: (rnd() - 0.3) * 3, tail: rnd() < 0.4 }));
  blades.sort((a, b) => b.h - a.h);
  for (const b of blades) {
    for (let j = 0; j < b.h; j++) {
      const t = j / b.h;
      const x = b.x + b.bend * t * t * m;
      p.set(x, ay - j, `a${t < 0.25 ? 1 : t < 0.7 ? 2 : 3}`);
    }
    if (b.tail) {
      const x = b.x + b.bend * 0.75 * m;
      for (let j = 0; j < 3; j++) p.set(x, ay - Math.round(b.h * 0.75) - j, j === 2 ? 'c1' : 'c0');
    }
  }
  return { p, ax, ay };
}

// ---------------------------------------------------------------------------
// Rocks: heightfield of irregular blobs, flat slabs and faceted shards.

function radial(rnd) {
  const a = [];
  for (let k = 2; k <= 4; k++) a.push([k, (0.05 + rnd() * 0.1) / (k - 1), rnd() * TAU]);
  return (th) => {
    let r = 1;
    for (const [k, amp, ph] of a) r += amp * Math.cos(k * th + ph);
    return r;
  };
}

/** Paint one rock primitive into token buffers (painter's order). */
function rockPrim(p, info, prim, rnd) {
  const { kind, cx, cy, rx, ry } = prim;
  const W = p.w;
  const rf = radial(rnd);
  const hgt = prim.h || 0;
  const x0 = Math.floor(cx - rx * 1.3) - 1;
  const x1 = Math.ceil(cx + rx * 1.3) + 1;
  const y0 = Math.floor(cy - ry * 1.3 - hgt - (prim.peak || 0)) - 1;
  const y1 = Math.ceil(cy + ry * 1.3) + 1;
  for (let y = Math.max(0, y0); y <= Math.min(p.h - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      let n = null;
      let up = false;
      if (kind === 'blob') {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const rr = rf(Math.atan2(dy, dx));
        const d2 = (dx * dx + dy * dy) / (rr * rr);
        if (d2 >= 1 || y + 0.5 > prim.ground) continue;
        const k = Math.sqrt(1 - d2);
        n = [dx / rr, (dy / rr) * 0.9 + 0.1, k];
        up = n[1] < -0.2 && k > 0.35;
      } else if (kind === 'slab') {
        // Extruded irregular ellipse: top face at cy - hgt, sides down to cy.
        const dx = (x + 0.5 - cx) / rx;
        const rr = rf(Math.atan2(0, dx) + 0.0001);
        const topDy = (y + 0.5 - (cy - hgt)) / ry;
        const rt = rf(Math.atan2(topDy, dx));
        const inTop = (dx * dx + topDy * topDy) < rt * rt;
        let inSide = false;
        if (!inTop && Math.abs(dx) < rr) {
          const e = Math.sqrt(Math.max(0, 1 - (dx * dx) / (rr * rr))) * ry;
          inSide = y + 0.5 > cy - hgt && y + 0.5 < cy + e * 0.92 && y + 0.5 <= prim.ground;
        }
        if (!inTop && !inSide) continue;
        if (inTop) {
          const edge = (dx * dx + topDy * topDy) / (rt * rt);
          n = [dx * 0.35, -0.5 + topDy * 0.15, 0.85];
          if (edge > 0.6 && topDy > 0) n = [dx * 0.5, 0.05, 0.8]; // rounded front rim
          up = edge < 0.75;
        } else {
          const sx = dx / rr;
          n = [sx * 0.95, 0.45, Math.sqrt(Math.max(0.02, 1 - sx * sx * 0.9)) * 0.6];
        }
      } else {
        // Shard: a pointed prism with a lit left facet and a dark right one.
        const u = (cy - (y + 0.5)) / (prim.peak + 0.001); // 0 at base, 1 at the apex
        if (u > (prim.cut || 1) || y + 0.5 > prim.ground) continue;
        const apx = cx + prim.apex;
        const hw = u < 0 ? rx * Math.sqrt(Math.max(0, 1 - (u * prim.peak / ry) ** 2)) : rx * ((1 - u) ** 0.7 + 0.14 * u);
        const lo = (u < 0 ? cx : cx + (apx - cx) * u) - hw;
        const hi = (u < 0 ? cx : cx + (apx - cx) * u) + hw;
        if (x + 0.5 < lo || x + 0.5 > hi) continue;
        const ridge = cx + (apx - cx) * Math.max(0, u) - rx * 0.18 * (1 - Math.max(0, u));
        const left = x + 0.5 < ridge;
        n = left ? [-0.62, -0.42, 0.66] : [0.66, -0.12, 0.74];
        if (u < 0.18) n = [n[0] * 0.6, 0.45, 0.65];
        up = left && u > 0.45;
      }
      let lit = n[0] * L[0] + n[1] * L[1] + n[2] * L[2];
      lit += (rnd() - 0.5) * 0.12;
      const t = lit > 0.78 ? 4 : lit > 0.48 ? 3 : lit > 0.15 ? 2 : lit > -0.25 ? 1 : 0;
      const i = y * W + x;
      // Separation line where this primitive overlaps an earlier one.
      p.set(x, y, up && info.noise(x, y) ? `U${t}` : `r${t}`);
      info.own[i] = prim.id;
    }
  }
  // Inner outline against primitives painted earlier.
  for (let y = 1; y < p.h - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const o = info.own[i];
      if (o < 0 || o === prim.id) continue;
      if (info.own[i - 1] === prim.id || info.own[i + 1] === prim.id || info.own[i + W] === prim.id || info.own[i - W] === prim.id) {
        p.set(x, y, 'r0');
        info.own[i] = -2;
      }
    }
  }
}

function crack(p, rnd, cx, cy, len) {
  let x = cx;
  let y = cy;
  for (let k = 0; k < len; k++) {
    const c = p.get(Math.round(x), Math.round(y));
    if (!c || c[0] === 'o') break;
    p.set(x, y, 'q0');
    const below = p.get(Math.round(x), Math.round(y) + 1);
    if (below && below[0] !== 'q') p.set(x, y + 1, 'q1');
    x += rnd() < 0.5 ? 1 : 0;
    y += rnd() < 0.7 ? 1 : 0;
  }
}

function genRock(rnd, m, kind, v) {
  const W = kind === 'crag' ? 34 : kind === 'boulder' ? 26 : 20;
  const H = kind === 'crag' ? 36 : kind === 'boulder' ? 22 : 16;
  const p = new Pix(W, H);
  const ax = W >> 1;
  const ay = H - 3;
  const own = new Int16Array(W * H).fill(-1);
  const seed = Math.floor(rnd() * 1e6);
  const info = { own, noise: (x, y) => ((Math.imul(x * 73856093 ^ y * 19349663 ^ seed, 2654435761) >>> 27) & 7) < 5 };
  const prims = [];
  const g = ay + 0.5;
  const style = v % 4;
  if (kind === 'rock') {
    if (style === 3 && v % 8 === 7) {
      // Pebble cluster.
      const n = 3 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const r = 1.3 + rnd() * 1.3;
        const px = ax + 0.5 + (rnd() - 0.5) * 9;
        const py = ay - rnd() * 4;
        prims.push({ kind: 'blob', cx: px, cy: py - r * 0.4, rx: r * 1.15, ry: r * 0.85, ground: py + 0.5 });
      }
    } else if (style === 1) {
      const r = 3.6 + rnd() * 1.6;
      prims.push({ kind: 'slab', cx: ax + 0.5, cy: ay - 0.5, rx: r * 1.25, ry: r * 0.55, h: 1.5 + rnd() * 2, ground: g });
    } else if (style === 2) {
      const r = 3 + rnd() * 1.2;
      prims.push({ kind: 'blob', cx: ax - m * 1.5, cy: ay - r * 0.55, rx: r * 1.1, ry: r * 0.9, ground: g });
      const r2 = 1.8 + rnd() * 0.9;
      prims.push({ kind: 'blob', cx: ax + m * (r + 0.5), cy: ay - r2 * 0.4 + 0.5, rx: r2 * 1.15, ry: r2 * 0.85, ground: g + 0.5 });
    } else {
      const r = 3.4 + rnd() * 2;
      prims.push({ kind: 'blob', cx: ax + 0.5, cy: ay - r * 0.5, rx: r * (1.05 + rnd() * 0.25), ry: r * 0.85, ground: g });
    }
  } else if (kind === 'boulder') {
    if (style === 1 || style === 3) {
      const r = 5 + rnd() * 2.6;
      prims.push({ kind: 'slab', cx: ax + 0.5, cy: ay - 1, rx: r * 1.15, ry: r * 0.55, h: 3 + rnd() * 3, ground: g });
      if (style === 3) prims.push({ kind: 'blob', cx: ax + m * (r + 1), cy: ay - 1.2, rx: 2.4, ry: 2, ground: g + 0.5 });
    } else if (style === 2) {
      const r = 4.2 + rnd() * 1.5;
      prims.push({ kind: 'blob', cx: ax - m * 2, cy: ay - r * 0.6, rx: r * 1.1, ry: r * 0.9, ground: g });
      prims.push({ kind: 'blob', cx: ax + m * 3.2, cy: ay - r * 0.3 + 0.5, rx: r * 0.85, ry: r * 0.7, ground: g + 0.5 });
      if (rnd() < 0.5) prims.unshift({ kind: 'blob', cx: ax + m * 0.5, cy: ay - r * 1.2, rx: r * 0.8, ry: r * 0.65, ground: ay - r * 0.5 });
    } else {
      const r = 5.2 + rnd() * 2.4;
      prims.push({ kind: 'blob', cx: ax + 0.5, cy: ay - r * 0.55, rx: r * (1.05 + rnd() * 0.2), ry: r * 0.86, ground: g });
    }
  } else {
    // Crag: ledges, blunt shards and boulders piled together.
    const base = 7 + rnd() * 3;
    if (style === 0 || style === 2) {
      // Stacked ledges, each sitting on the top face of the one below.
      let cyk = ay - 0.5;
      let rx = base * (1 + rnd() * 0.2);
      let xk = ax + 0.5;
      const n = 2 + Math.floor(rnd() * 2);
      for (let k = 0; k < n; k++) {
        const h = 2.5 + rnd() * 3;
        const ry = rx * (0.42 + rnd() * 0.1);
        prims.push({ kind: 'slab', cx: xk, cy: cyk, rx, ry, h, ground: k === 0 ? g : cyk + ry * 0.8 });
        cyk = cyk - h - ry * 0.15;
        xk += m * (rnd() - 0.5) * rx * 0.6;
        rx *= 0.62 + rnd() * 0.15;
      }
      if (style === 2) prims.push({ kind: 'blob', cx: ax + m * base * 0.95, cy: ay - 1.5, rx: 2.8, ry: 2.3, ground: g + 0.5 });
    } else {
      const n = 2 + Math.floor(rnd() * 2);
      for (let k = 0; k < n; k++) {
        const back = k / Math.max(1, n - 1);
        const rx = base * (0.5 + rnd() * 0.3) * (k === 0 ? 1.1 : 0.85);
        const peak = (8 + rnd() * 7) * (k === 0 ? 1.1 : 0.8);
        prims.push({ kind: 'shard', cx: ax + 0.5 + m * (k === 0 ? 0 : (k % 2 ? 1 : -1) * (3 + rnd() * 4)), cy: ay - 1 - (1 - back) * 2 + (k ? 1.5 : 0), rx, ry: rx * 0.45, peak, apex: m * (rnd() - 0.6) * rx * 0.5, cut: 0.72 + rnd() * 0.2, ground: g });
      }
      prims.sort((a, b) => a.cy - b.cy);
      if (style === 3) prims.unshift({ kind: 'slab', cx: ax + 0.5 - m * base * 0.4, cy: ay - 2.5, rx: base * 0.9, ry: base * 0.4, h: 3 + rnd() * 2, ground: g });
      if (rnd() < 0.6) {
        const r = 2 + rnd() * 1.5;
        prims.push({ kind: 'blob', cx: ax + m * (base * 0.9), cy: ay - r * 0.4, rx: r * 1.1, ry: r * 0.85, ground: g + 0.5 });
      }
    }
  }
  prims.forEach((pr, id) => {
    pr.id = id;
    rockPrim(p, info, pr, rnd);
  });
  // A crack or two on the larger rocks.
  const cracks = kind === 'rock' ? (rnd() < 0.5 ? 1 : 0) : 1 + Math.floor(rnd() * 2);
  for (let k = 0; k < cracks; k++) {
    const pts = [];
    for (let i = 0; i < p.d.length; i++) if (p.d[i] && (p.d[i][1] === '2' || p.d[i][1] === '3')) pts.push(i);
    if (!pts.length) break;
    const i = pts[Math.floor(rnd() * pts.length)];
    crack(p, rnd, i % W, (i / W) | 0, 2 + Math.floor(rnd() * (kind === 'rock' ? 2 : 4)));
  }
  return { p, ax, ay };
}

// ---------------------------------------------------------------------------
// Colour maps

function foliageMap(species, cv, tint, h) {
  const [H0, S0, L0] = FOLIAGE[species] || FOLIAGE.oak;
  const [dh, ds, dl] = JITTER[cv % JITTER.length];
  let a;
  if (tint === 'autumn') {
    const hue = 22 + ((h >>> 12) % 26);
    a = tones5(hue, 0.54, 0.5, { spread: 0.075, hueDark: -4, hueLight: 6 });
  } else {
    a = tones5(H0 + dh, S0 + ds, L0 + dl);
  }
  const map = mapTokens('a', a, {});
  mapTokens('k', a, map);
  if (tint === 'blossom') {
    map.k2 = '#e9a7b6';
    map.k3 = '#f6c4cc';
    map.k4 = '#fdebe8';
  } else if (tint === 'fruit') {
    map.k3 = '#c8503c';
    map.k4 = '#e8744e';
  } else if (tint === 'berries') {
    map.k2 = '#4a3f8c';
    map.k3 = '#6a5bb0';
    map.k4 = '#8f86cf';
  } else if (tint === 'flowers') {
    map.k2 = '#e8d0e8';
    map.k3 = '#f4e3f0';
    map.k4 = '#fff8ec';
  } else if (tint === 'autumn') {
    map.k2 = a[1];
    map.k3 = a[2];
  }
  map.o0 = NATURE_INK;
  map.o1 = mix(a[0], NATURE_INK, 0.45);
  return map;
}

function barkMap(map, kind) {
  return mapTokens('t', BARK[kind] || BARK.oak, map);
}

const ROCK_JITTER = [0, 0.04, -0.04, 0.02, -0.02];

function rockMap(env, cv) {
  const pal = ROCKS[env.stone] || ROCKS.stone;
  const k = ROCK_JITTER[cv % ROCK_JITTER.length];
  const r = pal.tones.map((c) => (k > 0 ? mix(c, '#fff4dc', k) : mix(c, '#2a1c22', -k)));
  const map = mapTokens('r', r, {});
  if (env.snow) mapTokens('U', [r[1], ROCKS.snow[0], ROCKS.snow[1], ROCKS.snow[2], ROCKS.snow[2]], map);
  else if (env.moss) mapTokens('U', [r[0], ROCKS.moss[0], ROCKS.moss[1], ROCKS.moss[2], ROCKS.moss[2]], map);
  else mapTokens('U', r, map);
  map.q0 = env.ember ? ROCKS.ember[0] : mix(r[0], pal.out, 0.4);
  map.q1 = env.ember ? ROCKS.ember[1] : r[3];
  map.o0 = pal.out;
  map.o1 = pal.lit;
  return map;
}

function colorize(shape, map) {
  const src = shape.pix;
  const q = new Pix(src.w, src.h);
  for (let i = 0; i < src.d.length; i++) {
    const t = src.d[i];
    if (!t) continue;
    q.d[i] = map[t] || '#ff00ff';
    q.a[i] = src.a[i];
  }
  return q;
}

function shadowCanvas(cast) {
  const q = new Pix(cast.pix.w, cast.pix.h);
  for (let i = 0; i < q.d.length; i++) {
    if (!cast.pix.d[i]) continue;
    q.d[i] = '#000000';
    q.a[i] = cast.pix.a[i];
  }
  return q.toCanvas();
}

// ---------------------------------------------------------------------------
// Public API

const TREE_SHAPES = {
  [F.OAK]: (rnd, m, v) => genBroadleaf(rnd, m, sizeOf(v, rnd), false),
  [F.BIRCH]: (rnd, m, v) => genBroadleaf(rnd, m, sizeOf(v, rnd, 0.7, 1.25), true),
  [F.PINE]: (rnd, m, v) => genPine(rnd, m, sizeOf(v, rnd), false),
  [F.SNOWPINE]: (rnd, m, v) => genPine(rnd, m, sizeOf(v, rnd, 0.65, 1.2), true),
  [F.PALM]: (rnd, m, v) => genPalm(rnd, m, sizeOf(v, rnd, 0.75, 1.25)),
  [F.DEADTREE]: (rnd, m, v) => genDead(rnd, m, sizeOf(v, rnd, 0.7, 1.3)),
  [F.WILLOW]: (rnd, m, v) => genWillow(rnd, m, sizeOf(v, rnd, 0.75, 1.25)),
  [F.BUSH]: (rnd, m, v) => genBush(rnd, m, sizeOf(v, rnd, 0.7, 1.3)),
  [F.CACTUS]: (rnd, m, v) => genCactus(rnd, m, v),
  [F.REEDS]: (rnd, m, v) => genReeds(rnd, m, sizeOf(v, rnd, 0.7, 1.2)),
  [F.ROCK]: (rnd, m, v) => genRock(rnd, m, 'rock', v),
  [F.BOULDER]: (rnd, m, v) => genRock(rnd, m, 'boulder', v),
  [F.CRAG]: (rnd, m, v) => genRock(rnd, m, 'crag', v),
  [F.ASHROCK]: (rnd, m, v) => genRock(rnd, m, v % 3 ? 'rock' : 'boulder', v),
};

const SPECIES = {
  [F.OAK]: 'oak',
  [F.BIRCH]: 'birch',
  [F.PINE]: 'pine',
  [F.SNOWPINE]: 'pine',
  [F.PALM]: 'palm',
  [F.DEADTREE]: 'dead',
  [F.WILLOW]: 'willow',
  [F.BUSH]: 'bush',
  [F.CACTUS]: 'cactus',
  [F.REEDS]: 'reeds',
};

const ROCK_F = new Set([F.ROCK, F.BOULDER, F.CRAG, F.ASHROCK]);

function shapeOf(f, v, m) {
  const key = `${f}:${v}:${m}`;
  let s = shapeCache.get(key);
  if (s) return s;
  const gen = TREE_SHAPES[f];
  if (!gen) return null;
  const rnd = srng(f * 7919 + v * 104729 + 17);
  const { p, ax, ay } = gen(rnd, m ? -1 : 1, v);
  const castK = ROCK_F.has(f) ? 1.15 : f === F.REEDS || f === F.DEADTREE ? 0.5 : 1;
  s = finish(p, ax, ay, { castK });
  shapeCache.set(key, s);
  return s;
}

function rockEnv(f, b, snowy, h) {
  const stone = f === F.ASHROCK || b === B.ASH ? 'basalt' : b === B.DESERT || b === B.BEACH ? 'sandstone' : b === B.MOUNTAIN || b === B.PEAK || b === B.SNOW || b === B.TAIGA ? 'granite' : 'stone';
  const green = b === B.FOREST || b === B.TAIGA || b === B.MARSH || b === B.GRASS || b === B.MEADOW || b === B.HILLS;
  return {
    stone,
    snow: snowy || b === B.SNOW || b === B.PEAK,
    moss: green && ((h >>> 13) & 3) !== 0,
    ember: stone === 'basalt' && ((h >>> 15) & 1) === 0,
  };
}

/**
 * Sprite for a natural feature standing on a tile.
 * f: feature code; h: a 32-bit hash of the tile (picks shape, mirroring,
 * colouring); b: biome of the tile; snowy: above the snow line.
 * Returns { canvas, w, h, ax, ay, cast: { canvas, x, y } } where (ax, ay)
 * is the ground anchor inside the canvas and the shadow canvas is placed at
 * (anchor + x, anchor + y).
 */
export function natureSprite(f, h, b = B.GRASS, snowy = false) {
  h >>>= 0;
  let v = h % NATURE_VARIANTS;
  // Variant v has size rank (v * 7) % 16 (7 is its own inverse mod 16):
  // closed forests skip the smallest few so the canopy stays dense.
  if ((b === B.FOREST || b === B.TAIGA) && TREE_SHAPES[f] && !ROCK_F.has(f) && f !== F.BUSH) v = ((5 + (h % 11)) * 7) % NATURE_VARIANTS;
  const m = (h >>> 4) & 1;
  const cv = (h >>> 5) & 7;
  let colorKey;
  let mapFn;
  if (ROCK_F.has(f)) {
    const env = rockEnv(f, b, snowy, h);
    colorKey = `${env.stone}${env.snow ? 's' : ''}${env.moss ? 'm' : ''}${env.ember ? 'e' : ''}${cv % 5}`;
    mapFn = () => rockMap(env, cv);
  } else {
    const sp = SPECIES[f];
    if (!sp) return null;
    let tint = '';
    const roll = (h >>> 8) & 127;
    const leafy = b === B.FOREST || b === B.GRASS || b === B.MEADOW || b === B.HILLS;
    if ((f === F.OAK || f === F.BIRCH) && leafy) {
      if (roll < 4) tint = 'autumn';
      else if (f === F.OAK && roll > 125) tint = b === B.FOREST ? 'fruit' : 'blossom';
    } else if (f === F.BUSH) {
      tint = roll < 26 ? 'fruit' : roll < 40 ? 'berries' : roll < 58 ? 'flowers' : '';
    } else if (f === F.CACTUS) {
      tint = roll < 64 ? 'blossom' : '';
    }
    colorKey = `${cv}${tint}${sp === 'dead' && b === B.ASH ? 'x' : ''}`;
    mapFn = () => {
      const map = foliageMap(sp === 'dead' ? 'oak' : sp, cv, tint, h);
      barkMap(map, sp === 'bush' || sp === 'cactus' || sp === 'reeds' ? 'oak' : sp);
      if (sp === 'pine') mapTokens('s', ROCKS.snow, map);
      if (sp === 'palm') {
        map.c0 = '#6b4a2c';
        map.c1 = '#8a6238';
      }
      if (sp === 'reeds') {
        map.c0 = '#6e4527';
        map.c1 = '#8c5d34';
        map.o0 = '#3a3a20';
        map.o1 = '#4a4c2a';
      }
      if (sp === 'cactus' && tint !== 'blossom') map.k4 = map.a3;
      else if (sp === 'cactus') map.k4 = cv & 1 ? '#f2a0b4' : '#f6d064';
      if (sp === 'dead') {
        map.o1 = mix(BARK.dead[0], NATURE_INK, 0.4);
        if (b === B.ASH) mapTokens('t', ['#2b2428', '#40363a', '#57494b', '#6c5c5c'], map);
      }
      return map;
    };
  }
  const key = `${f}:${v}:${m}:${colorKey}`;
  let s = spriteCache.get(key);
  if (s) return s;
  const shape = shapeOf(f, v, m);
  if (!shape) return null;
  const pix = colorize(shape, mapFn());
  let cast = shape.castCanvas;
  if (!cast) {
    cast = { canvas: shadowCanvas(shape.cast), x: shape.cast.x, y: shape.cast.y, w: shape.cast.pix.w, h: shape.cast.pix.h };
    shape.castCanvas = cast;
  }
  s = { canvas: pix.toCanvas(), w: pix.w, h: pix.h, ax: shape.ax, ay: shape.ay, cast, shadow: ROCK_F.has(f) ? 0.6 : 0.9 };
  spriteCache.set(key, s);
  return s;
}

/** Sprite canvas for a feature (cached); `v` picks one of a few stock variants. */
export function featureSprite(f, v = 0) {
  // Stock variants are medium-sized, upright shapes (variant 1 ≈ size 0.95).
  const stock = [1, 6, 9, 14];
  // Neutral tint roll (no autumn/blossom), plain colouring.
  const h = stock[(v | 0) & 3] + ((v | 0) & 1) * 16 + (64 << 8);
  return natureSprite(f, h, B.GRASS, false);
}

/** Small tree used in yards and gardens. */
export function yardTreeSprite() {
  return featureSprite(F.OAK, 2);
}
