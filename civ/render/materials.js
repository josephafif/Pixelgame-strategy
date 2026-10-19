// Materials for building sprites: a seven-tone ramp around a base colour
// plus a texture that nudges the tone per pixel (roof courses, brick
// joints, timber framing, thatch strands). Textures work in pixel units:
// `u` runs along a face, `v` up it, and (sx, sy) is the screen pixel, so
// courses stay crisp whatever the face's angle.

import { ramp7, cozy, mix } from '../../client/render/color.js';
import { hashp } from './model.js';

const cache = new Map();

function ramp(base, step = 0.13) {
  return ramp7(base, null, null, step);
}

/** Courses of a roof face: rows on slopes that face the viewer, columns on side slopes. */
function courses(f, sx, sy) {
  const vx = f.V[0];
  const vy = f.V[1] - f.V[2];
  if (Math.abs(vx) > Math.abs(vy) * 1.2) return { c: vx > 0 ? -sx : sx, a: sy, side: true };
  return { c: sy, a: sx, side: false };
}

const TEX = {
  clay(u, v, f, X, Y, Z, sx, sy, ctx) {
    if (f.n[2] > 0.97) return 0;
    const { c, a } = courses(f, sx, sy);
    const row = Math.floor(c / 2);
    if (((c % 2) + 2) % 2 === 1) return -0.85;
    const j = (a + row * 2) % 4;
    if (j === 0) return -0.45;
    return (hashp(a >> 1, row + ctx.seed) & 15) === 0 ? 0.5 : 0;
  },
  slate(u, v, f, X, Y, Z, sx, sy, ctx) {
    if (f.n[2] > 0.97) return 0;
    const { c, a } = courses(f, sx, sy);
    const row = Math.floor(c / 2);
    if (((c % 2) + 2) % 2 === 1) return -0.7;
    const h = hashp(Math.floor((a + row) / 3), row + ctx.seed);
    return (h & 7) === 0 ? 0.45 : (h & 7) === 1 ? -0.35 : 0;
  },
  shingle(u, v, f, X, Y, Z, sx, sy, ctx) {
    if (f.n[2] > 0.97) return 0;
    const { c, a } = courses(f, sx, sy);
    const row = Math.floor(c / 2);
    if (((c % 2) + 2) % 2 === 1) return -0.75;
    if ((a + row) % 3 === 0) return -0.4;
    return (hashp(a, row + ctx.seed) & 7) === 0 ? 0.45 : 0;
  },
  thatch(u, v, f, X, Y, Z, sx, sy, ctx) {
    const { c, a } = courses(f, sx, sy);
    let d = ((hashp(a, Math.floor(c / 3) + ctx.seed) & 3) - 1.5) * 0.28;
    if (((c % 3) + 3) % 3 === 2) d -= 0.5;
    if (v < 1.1) d -= 0.7;
    return d;
  },
  turf(u, v, f, X, Y, Z, sx, sy, ctx) {
    const h = hashp(sx, sy + ctx.seed);
    if (v < 1.1) return { ramp: EARTH, d: -0.3 };
    return (h & 7) === 0 ? 0.7 : (h & 7) === 1 ? -0.6 : 0;
  },
  palm(u, v, f, X, Y, Z, sx, sy, ctx) {
    const { c, a } = courses(f, sx, sy);
    let d = ((hashp(a, Math.floor(c / 4) + ctx.seed) & 3) - 1.5) * 0.35;
    if (((c % 4) + 4) % 4 === 3) d -= 0.7;
    return d;
  },
  metal(u, v, f, X, Y, Z, sx, sy) {
    const { a } = courses(f, sx, sy);
    return a % 2 === 0 ? 0.35 : -0.25;
  },
  copper(u, v, f, X, Y, Z, sx, sy, ctx) {
    const h = hashp(sx, sy + ctx.seed);
    return (h & 15) === 0 ? 0.6 : (h & 15) === 1 ? -0.5 : 0;
  },
  gravel(u, v, f, X, Y, Z, sx, sy, ctx) {
    const h = hashp(sx, sy + ctx.seed);
    return (h & 7) === 0 ? 0.5 : (h & 7) === 1 ? -0.5 : 0;
  },
  plaster(u, v, f, X, Y, Z, sx, sy, ctx) {
    const h = hashp(sx, sy + ctx.seed);
    return (h & 31) === 0 ? -0.4 : (h & 31) === 1 ? 0.3 : 0;
  },
  adobe(u, v, f, X, Y, Z, sx, sy, ctx) {
    const h = hashp(sx, sy + ctx.seed);
    let d = (h & 15) === 0 ? -0.45 : (h & 15) === 1 ? 0.35 : 0;
    if (Z - f.z0 < 1.5) d -= 0.35;
    return d;
  },
  mudbrick(u, v, f, X, Y, Z, sx, sy, ctx) {
    const z = Math.floor(Z);
    if (z % 3 === 2 && (hashp(Math.floor(u / 5), z + ctx.seed) & 3) !== 0) return -0.45;
    if (z % 3 !== 2 && (Math.floor(u) + (Math.floor(z / 3) % 2) * 2) % 5 === 0 && (hashp(Math.floor(u), z) & 1)) return -0.35;
    return (hashp(sx, sy + ctx.seed) & 15) === 0 ? 0.35 : 0;
  },
  brick(u, v, f, X, Y, Z, sx, sy, ctx) {
    const z = Math.floor(Z);
    if (z % 2 === 1) return 0.75;
    const j = (Math.floor(u) + (Math.floor(z / 2) % 2) * 2) % 4;
    if (j === 0) return 0.55;
    return (hashp(Math.floor(u / 4), z + ctx.seed) & 7) === 0 ? -0.45 : 0;
  },
  ashlar(u, v, f, X, Y, Z, sx, sy, ctx) {
    const z = Math.floor(Z);
    if (z % 3 === 2) return -0.6;
    const row = Math.floor(z / 3);
    const j = (Math.floor(u) + (row % 2) * 3) % 6;
    if (j === 0) return -0.5;
    return (hashp(Math.floor((u + (row % 2) * 3) / 6), row + ctx.seed) & 3) === 0 ? 0.35 : 0;
  },
  rubble(u, v, f, X, Y, Z, sx, sy, ctx) {
    const z = Math.floor(Z);
    const row = Math.floor(z / 2);
    const w = 2 + (hashp(row, ctx.seed + 7) % 3);
    const off = hashp(row, ctx.seed + 3) % 4;
    const k = Math.floor((u + off) / w);
    const edge = (Math.floor(u) + off) % w === 0 || z % 2 === 1;
    const tone = ((hashp(k, row + ctx.seed) & 3) - 1.5) * 0.35;
    return edge ? -0.7 : tone;
  },
  marble(u, v, f, X, Y, Z, sx, sy, ctx) {
    const z = Math.floor(Z);
    if (z % 6 === 5) return -0.35;
    return (hashp(sx, sy + ctx.seed) & 31) === 0 ? -0.3 : 0;
  },
  logs(u, v, f, X, Y, Z, sx, sy, ctx) {
    const z = Math.floor(Z);
    const r = ((z % 3) + 3) % 3;
    const w = f.uMax - f.uMin;
    if (u < 1 || u > w - 1) return { ramp: LOGEND, t: r === 1 ? 4 : r === 0 ? 3 : 2 };
    if (r === 2) return -1.1;
    if (r === 0) return 0.45;
    return (hashp(Math.floor(u / 3), z + ctx.seed) & 7) === 0 ? -0.5 : 0;
  },
  planks(u, v, f, X, Y, Z, sx, sy, ctx) {
    const k = Math.floor(u);
    const w = f.uMax - f.uMin;
    if (f.mat.trim && (u < 1 || u > w - 1)) return { ramp: f.mat.trim, t: 4 };
    if (k % 3 === 2) return -0.7;
    return (hashp(k, Math.floor(Z / 4) + ctx.seed) & 15) === 0 ? -0.4 : 0;
  },
  halftimber(u, v, f, X, Y, Z, sx, sy, ctx) {
    const fh = f.mat.floorH || 5;
    const w = f.uMax - f.uMin;
    const z = Z - f.z0;
    const fz = ((z % fh) + fh) % fh;
    const beam = { ramp: TIMBER, t: 2.4 };
    if (z < 1.2) return { ramp: STONE_BASE, t: 3 };
    if (fz < 1 && z > 2) return beam;
    if (u < 1 || u > w - 1) return beam;
    const bay = w > 10 ? 4 : 3;
    const bu = u % bay;
    if (bu < 1) return beam;
    // Diagonal braces in alternate panels.
    const panel = Math.floor(u / bay) + Math.floor(z / fh);
    if (panel % 3 === 0 && Math.abs(bu - 1 - fz * ((bay - 1) / fh)) < 0.6) return beam;
    return (hashp(sx, sy + ctx.seed) & 31) === 0 ? -0.3 : 0;
  },
  stucco(u, v, f, X, Y, Z, sx, sy, ctx) {
    const z = Z - f.z0;
    if (z < 1.5) return { ramp: STONE_BASE, t: 3 };
    return (hashp(sx, sy + ctx.seed) & 31) === 0 ? -0.3 : 0;
  },
  concrete(u, v, f, X, Y, Z, sx, sy, ctx) {
    const z = Math.floor(Z);
    if (z % 5 === 4) return -0.4;
    const h = hashp(sx, sy + ctx.seed);
    return (h & 31) === 0 ? -0.4 : 0;
  },
  glasswall(u, v, f, X, Y, Z, sx, sy) {
    const k = Math.floor(u);
    if (k % 3 === 2) return { ramp: STEEL, t: 4 };
    if (Math.floor(Z) % 4 === 3) return { ramp: STEEL, t: 3 };
    return ((Z / 3 + k * 0.2) % 2) < 0.5 ? 0.6 : 0;
  },
  hide(u, v, f, X, Y, Z, sx, sy, ctx) {
    const { a } = courses(f, sx, sy);
    return (a % 5 === 0 ? -0.5 : 0) + ((hashp(sx, sy + ctx.seed) & 15) === 0 ? 0.4 : 0);
  },
  wattle(u, v, f, X, Y, Z, sx, sy, ctx) {
    const k = Math.floor(u);
    if (k % 3 === 0 && (hashp(k, ctx.seed) & 1)) return { ramp: TIMBER, t: 3 };
    const h = hashp(sx, sy + ctx.seed);
    return (h & 7) === 0 ? -0.4 : 0;
  },
  bamboo(u, v, f, X, Y, Z, sx, sy) {
    const k = Math.floor(u);
    if (k % 2 === 1) return -0.6;
    return Math.floor(Z) % 4 === 0 ? -0.35 : 0.2;
  },
  cloth(u, v, f, X, Y, Z, sx, sy) {
    const k = Math.floor(f.n[2] > 0.5 ? sx : u);
    return f.mat.stripe && k % 4 < 2 ? { ramp: f.mat.stripe } : 0;
  },
};

const TIMBER = ramp('#5b3c28', 0.12);
const STONE_BASE = ramp('#8f877e', 0.11);
const LOGEND = ramp('#b48a5c', 0.12);
const EARTH = ramp('#6a5038', 0.12);
const STEEL = ramp('#6b7178', 0.12);

const BASES = {
  // Roofs
  thatch: ['#c39a52', 'thatch'],
  thatchOld: ['#9f8250', 'thatch'],
  reed: ['#b8a466', 'thatch'],
  palm: ['#93944c', 'palm'],
  turf: ['#6f8c48', 'turf'],
  clay: ['#b9573c', 'clay'],
  clayOrange: ['#c8703f', 'clay'],
  clayBrown: ['#9b5638', 'clay'],
  slate: ['#5b6474', 'slate'],
  slateBlue: ['#4e6684', 'slate'],
  slateDark: ['#454b58', 'slate'],
  shingle: ['#6e5442', 'shingle'],
  shingleRed: ['#8a4434', 'shingle'],
  copper: ['#5f9f8a', 'copper'],
  lead: ['#7b8189', 'copper'],
  gold: ['#d9ae44', 'copper'],
  tar: ['#5a5652', 'gravel'],
  gravel: ['#8e8a82', 'gravel'],
  metal: ['#8b8f93', 'metal'],
  metalRust: ['#9a6a4a', 'metal'],
  glassRoof: ['#93b6bf', 'metal'],
  hide: ['#b08a62', 'hide'],
  // Walls
  wattle: ['#bba57d', 'wattle'],
  daub: ['#c9b58f', 'plaster'],
  mud: ['#a9805a', 'adobe'],
  adobe: ['#d8b07a', 'adobe'],
  mudbrick: ['#c39a6a', 'mudbrick'],
  whitewash: ['#ece5d4', 'plaster'],
  plaster: ['#e8dcc0', 'plaster'],
  rubble: ['#9b938a', 'rubble'],
  rubbleWarm: ['#a99a84', 'rubble'],
  ashlar: ['#b6ad9f', 'ashlar'],
  ashlarWarm: ['#c4b394', 'ashlar'],
  marble: ['#e6e0d3', 'marble'],
  logs: ['#8a5d38', 'logs'],
  logsDark: ['#6a4630', 'logs'],
  planks: ['#8e6a46', 'planks'],
  faluRed: ['#9b3a2a', 'planks'],
  halftimber: ['#eee4cc', 'halftimber'],
  brick: ['#a65a40', 'brick'],
  brickDark: ['#7d4838', 'brick'],
  brickYellow: ['#c9a86c', 'brick'],
  concrete: ['#b9b5ac', 'concrete'],
  concreteDark: ['#8f8b84', 'concrete'],
  glasswall: ['#6f8fa5', 'glasswall'],
  bamboo: ['#b49a58', 'bamboo'],
  basalt: ['#4f4854', 'ashlar'],
  // Details
  wood: ['#6d4529', null],
  woodLight: ['#9a7044', null],
  beam: ['#5b3c28', null],
  door: ['#6a4024', null],
  doorGreen: ['#3f5f46', null],
  doorBlue: ['#3e5672', null],
  glass: ['#3c4a5e', null],
  stone: ['#a39b92', null],
  trim: ['#efe7d6', null],
  iron: ['#4c4a50', null],
  water: ['#5b9ab0', null],
  earth: ['#7a5a3c', null],
  hay: ['#d8b85a', 'thatch'],
  smoke: ['#5c5450', null],
};

/** A named material (cached). Stucco and cloth take a colour: mat('stucco', '#d9b26a'). */
export function mat(name, color = null, extra = null) {
  const key = `${name}:${color || ''}${extra ? ':' + JSON.stringify(extra) : ''}`;
  let m = cache.get(key);
  if (m) return m;
  if (name === 'stucco') m = { ramp: ramp(color), tex: TEX.stucco };
  else if (name === 'cloth') m = { ramp: ramp(color, 0.15), tex: TEX.cloth, stripe: extra?.stripe ? ramp(extra.stripe, 0.15) : null, noSnow: true };
  else if (name === 'paint') m = { ramp: ramp(color), tex: TEX.plaster };
  else if (name === 'planksColor') m = { ramp: ramp(color), tex: TEX.planks, trim: ramp('#efe8da', 0.1) };
  else {
    const b = BASES[name];
    if (!b) throw new Error(`unknown material ${name}`);
    const base = color || b[0];
    m = { ramp: ramp(base), tex: b[1] ? TEX[b[1]] : null };
    if (name === 'faluRed') m.trim = ramp('#efe8da', 0.1);
    if (name === 'glass' || name === 'water') m.noSnow = true;
  }
  if (extra?.floorH) m.floorH = extra.floorH;
  m.name = key;
  cache.set(key, m);
  return m;
}

/** Ramp of a colour (for decals). */
export function rampOf(color, step = 0.13) {
  const key = `ramp:${color}:${step}`;
  let r = cache.get(key);
  if (!r) {
    r = ramp(color, step);
    cache.set(key, r);
  }
  return r;
}

export { cozy, mix };
