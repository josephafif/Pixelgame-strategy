// Building sprites for the civilization simulator, built as small 3D models
// (model.js) and rendered once per kind, size, era, climate and variant.
//
// Sizes are in town cells (8 px); a small house stands on a 2×2-cell lot.
// Eras: 0 stone age, 1 bronze, 2 iron, 3 classical, 4 medieval,
// 5 renaissance, 6 industrial, 7 modern. Climates: temperate, arid, cold,
// tropical, wetland. A town keeps the buildings of earlier eras until they
// are rebuilt, so old quarters keep their look.

import { Model, renderModel } from './model.js';
import { mat, rampOf } from './materials.js';
import { srng } from '../../client/render/pix.js';

export const CELL = 8;
export const ERA_NAMES = ['Stone Age', 'Bronze Age', 'Iron Age', 'Classical Age', 'Middle Ages', 'Renaissance', 'Industrial Age', 'Modern Age'];
export const CLIMATES = ['temperate', 'arid', 'cold', 'tropical', 'wetland'];

const cache = new Map();
const MAX = 3000;

/**
 * The sprite of a building: { canvas, w, h, ox, oy, shadow } where (ox, oy)
 * is where the north-west corner of the footprint falls on the canvas.
 * spec: { kind, w, d (cells), era, climate, v (variant), color (realm
 * colour for banners), state ('ok' | 'ruin' | 'build'), snow }
 */
export function buildingSprite(spec) {
  const key = `${spec.kind}|${spec.w}|${spec.d}|${spec.era}|${spec.climate}|${spec.v | 0}|${spec.color || ''}|${spec.state || 'ok'}|${spec.snow ? 1 : 0}`;
  let s = cache.get(key);
  if (s !== undefined) return s;
  if (cache.size >= MAX) cache.clear();
  const make = KINDS[spec.kind] || KINDS.house;
  const m = new Model();
  const rnd = srng(((spec.v | 0) + 1) * 7919 + spec.era * 131 + spec.w * 17 + spec.d * 3);
  const W = spec.w * CELL;
  const D = spec.d * CELL;
  make(m, { ...spec, W, D, rnd, era: spec.era | 0, climate: spec.climate || 'temperate' });
  const state = spec.state || 'ok';
  if (state === 'ruin') ruin(m, rnd);
  else if (state === 'build') construction(m, rnd);
  s = renderModel(m, { seed: spec.v | 0, snow: spec.snow && state === 'ok', ruin: state === 'ruin' ? 1 : 0 });
  cache.set(key, s);
  return s;
}

// ---------------------------------------------------------------------------
// Helpers

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
const R = (c) => rampOf(c);

const GLASS = R('#3c4a5e');
const GLASS_MODERN = R('#4d6a82');
const DOORS = ['#6a4024', '#5a3a22', '#3f5f46', '#3e5672', '#7a3a2a'];
const SHUTTERS = ['#3f6a4a', '#365a7a', '#7a3a2a', '#5a4632', '#2f4a3a'];
const STUCCO = ['#e2c78e', '#e6d3a6', '#dca890', '#c9d0c4', '#e9e2d2', '#d9b97a', '#c8b6a0', '#e8c9b4'];
const PAINT_MODERN = ['#e9e4d8', '#d8d2c6', '#c9d4d8', '#e6d9b8', '#d4c0aa', '#bfc9b4'];

/** Window/door decals for a facade. */
function facade(o) {
  const d = {};
  if (o.door) d.door = { ramp: R(o.doorColor || DOORS[0]), w: o.doorW || 2, h: o.doorH || 4, u: o.doorU, arch: o.arch };
  if (o.floors) {
    const rows = [];
    for (let k = 0; k < o.floors; k++) {
      if (k === 0 && o.groundWin === false) continue;
      rows.push((o.z0 || 0) + k * o.floorH + (o.sill ?? 2));
    }
    d.win = { ramp: o.glass || GLASS, w: o.winW || 1, h: o.winH || 2, bay: o.bay || 4, rows, lit: o.lit, sill: o.sillRamp, arch: o.arch, margin: o.margin };
    d.skip = !!o.door;
  }
  if (o.shutters) d.shutters = R(o.shutters);
  if (o.boxes) d.boxes = true;
  if (o.band) {
    d.band = o.band;
    d.bandRamp = o.bandRamp;
  }
  return d;
}

/** A door: a small quad standing just in front of a wall. */
function door(m, x, y, z, w, h, color, arch = false) {
  const mm = mat('door', color);
  m.quad([x, y + 0.05, z], [x + w, y + 0.05, z], [x + w, y + 0.05, z + h], [x, y + 0.05, z + h], mm, { n: [0, 1, 0], part: 'detail', bias: 0.3, shadow: false });
  if (arch && w >= 3) m.tri([x, y + 0.05, z + h], [x + w, y + 0.05, z + h], [x + w / 2, y + 0.05, z + h + w / 2], mm, { n: [0, 1, 0], part: 'detail', bias: 0.3, shadow: false });
}

/** A flag on a pole in the realm's colour. */
function flag(m, x, y, z, h, color) {
  m.pole(x, y, z, z + h, mat('beam'));
  if (!color) return;
  const cl = mat('cloth', color);
  m.quad([x + 1, y + 0.6, z + h - 0.5], [x + 5, y + 0.6, z + h - 1.2], [x + 5, y + 0.6, z + h - 3.6], [x + 1, y + 0.6, z + h - 3], cl, { n: [0, 1, 0], part: 'detail', shadow: true });
}

function chimney(m, x, y, z0, z1, material = 'rubble') {
  m.box(x, y, z0, x + 2, y + 2, z1, mat(material), { top: mat('iron'), part: 'detail' });
}

/** A ring of short crenellations on top of a box. */
function battlements(m, x0, y0, x1, y1, z, material, step = 2) {
  const mm = mat(material);
  for (let x = x0; x < x1 - 0.5; x += step * 2) m.box(x, y1 - 1, z, Math.min(x + step, x1), y1, z + 1.5, mm, { part: 'roof' });
  for (let x = x0; x < x1 - 0.5; x += step * 2) m.box(x, y0, z, Math.min(x + step, x1), y0 + 1, z + 1.5, mm, { part: 'roof' });
  for (let y = y0 + step * 2; y < y1 - 1; y += step * 2) {
    m.box(x0, y, z, x0 + 1, Math.min(y + step, y1), z + 1.5, mm, { part: 'roof' });
    m.box(x1 - 1, y, z, x1, Math.min(y + step, y1), z + 1.5, mm, { part: 'roof' });
  }
}

/** Columns in a row along y = const. */
function colonnade(m, x0, x1, y, z0, z1, n, material = 'marble') {
  const mm = mat(material);
  if (n < 2) return;
  const step = (x1 - x0 - 1.4) / (n - 1);
  for (let k = 0; k < n; k++) m.cyl(x0 + 0.7 + k * step, y, 0.7, z0, z1, mm, { seg: 8 });
}

// ---------------------------------------------------------------------------
// Houses by era and climate

function houseStyle(era, climate, rnd, dense) {
  const s = { floors: 1, floorH: 5, wall: 'daub', roof: 'thatch', shape: 'gableX', pitch: 0.75, over: 1, base: null, chimney: false, shutters: null, boxes: false, lit: false, bay: 4, winH: 2, winW: 1, stilts: 0, doorColor: pick(rnd, DOORS) };
  const T = climate;
  switch (era) {
    case 0:
    case 1:
      if (T === 'arid') Object.assign(s, { wall: era === 0 ? 'mud' : pick(rnd, ['mudbrick', 'adobe']), roof: 'gravel', shape: 'flat', floors: era === 1 && dense && rnd() < 0.5 ? 2 : 1, floorH: 5, roofMat: 'adobe' });
      else if (T === 'cold') Object.assign(s, { wall: 'logsDark', roof: 'turf', shape: 'gableX', pitch: 0.55, floorH: 4 });
      else if (T === 'tropical' || T === 'wetland') Object.assign(s, { wall: 'bamboo', roof: T === 'wetland' ? 'reed' : 'palm', shape: rnd() < 0.5 ? 'gableY' : 'gableX', pitch: 1.0, stilts: 3, floorH: 4 });
      else Object.assign(s, { wall: era === 0 ? 'wattle' : pick(rnd, ['daub', 'wattle']), roof: 'thatch', shape: rnd() < 0.5 ? 'gableY' : 'hip', pitch: 0.95, floorH: 4 });
      break;
    case 2:
      if (T === 'arid') Object.assign(s, { wall: pick(rnd, ['whitewash', 'adobe', 'mudbrick']), shape: 'flat', floors: dense && rnd() < 0.6 ? 2 : 1, roofMat: 'adobe' });
      else if (T === 'cold') Object.assign(s, { wall: 'logs', roof: pick(rnd, ['turf', 'shingle']), shape: 'gableX', pitch: 0.8 });
      else if (T === 'tropical' || T === 'wetland') Object.assign(s, { wall: 'planks', roof: 'palm', shape: 'gableY', pitch: 1, stilts: T === 'wetland' ? 3 : 2 });
      else Object.assign(s, { wall: pick(rnd, ['daub', 'rubble']), base: 'rubble', roof: pick(rnd, ['thatch', 'thatch', 'shingle']), shape: pick(rnd, ['gableY', 'gableY', 'hip', 'gableX']), pitch: 1.0 });
      break;
    case 3:
      if (T === 'cold') Object.assign(s, { wall: 'logs', roof: 'shingle', shape: 'gableX', pitch: 0.8, chimney: true });
      else if (T === 'tropical' || T === 'wetland') Object.assign(s, { wall: 'plaster', roof: pick(rnd, ['palm', 'clay']), shape: 'hip', pitch: 0.7, stilts: T === 'wetland' ? 2 : 0 });
      else Object.assign(s, { wall: pick(rnd, ['whitewash', 'stucco', 'stucco']), stucco: pick(rnd, STUCCO), roof: pick(rnd, ['clay', 'clayOrange']), shape: dense ? pick(rnd, ['gableX', 'hip']) : 'hip', pitch: 0.42, floors: dense ? 2 + (rnd() < 0.4 ? 1 : 0) : 1, over: 1 });
      if (T === 'arid' && rnd() < 0.5) Object.assign(s, { shape: 'flat', wall: 'whitewash', roofMat: 'whitewash' });
      break;
    case 4:
      if (T === 'arid') Object.assign(s, { wall: pick(rnd, ['whitewash', 'adobe']), shape: rnd() < 0.2 ? 'dome' : 'flat', floors: dense ? 2 : 1, roofMat: 'whitewash' });
      else if (T === 'cold') Object.assign(s, { wall: pick(rnd, ['faluRed', 'faluRed', 'logs']), roof: pick(rnd, ['shingle', 'turf', 'slateDark']), shape: dense ? 'gableY' : 'gableX', pitch: 1.1, floors: dense ? 2 : 1, chimney: true, shutters: null });
      else if (T === 'tropical' || T === 'wetland') Object.assign(s, { wall: 'plaster', roof: 'clay', shape: 'hip', pitch: 0.7, floors: dense ? 2 : 1, stilts: T === 'wetland' ? 2 : 0 });
      else {
        const stone = rnd() < 0.3;
        Object.assign(s, { wall: stone ? 'rubbleWarm' : 'halftimber', roof: pick(rnd, ['clay', 'clayBrown', 'slate', dense ? 'clay' : 'thatch']), shape: dense ? 'gableY' : rnd() < 0.5 ? 'gableX' : 'gableY', pitch: 1.25, floors: dense ? 2 + (rnd() < 0.35 ? 1 : 0) : 1 + (rnd() < 0.4 ? 1 : 0), chimney: rnd() < 0.5, boxes: !stone && rnd() < 0.3 });
      }
      break;
    case 5:
      if (T === 'arid') Object.assign(s, { wall: 'stucco', stucco: pick(rnd, ['#ece4d2', '#e6d3a6', '#e2c78e']), shape: rnd() < 0.25 ? 'dome' : 'flat', floors: dense ? 3 : 2, roofMat: 'whitewash', shutters: rnd() < 0.5 ? pick(rnd, SHUTTERS) : null });
      else if (T === 'cold') Object.assign(s, { wall: pick(rnd, ['faluRed', 'planksColor']), plank: pick(rnd, ['#d9b04a', '#e8e0cc', '#9b3a2a']), roof: pick(rnd, ['slateDark', 'shingleRed']), shape: dense ? 'gableY' : 'gableX', pitch: 1.0, floors: 2, chimney: true });
      else if (T === 'tropical' || T === 'wetland') Object.assign(s, { wall: 'stucco', stucco: pick(rnd, STUCCO), roof: 'clay', shape: 'hip', pitch: 0.6, floors: dense ? 2 : 1, shutters: pick(rnd, SHUTTERS) });
      else if (dense && rnd() < 0.45) Object.assign(s, { wall: pick(rnd, ['brick', 'brickDark']), roof: pick(rnd, ['slate', 'clay']), shape: 'gableY', pitch: 1.4, floors: 3, stepGable: true, chimney: true });
      else Object.assign(s, { wall: 'stucco', stucco: pick(rnd, STUCCO), roof: pick(rnd, ['slate', 'clay', 'slateBlue']), shape: rnd() < 0.6 ? 'hip' : 'gableX', pitch: 0.75, floors: dense ? 3 : 2, shutters: rnd() < 0.5 ? pick(rnd, SHUTTERS) : null, boxes: rnd() < 0.3, chimney: true });
      break;
    case 6:
      if (T === 'arid' || T === 'tropical') Object.assign(s, { wall: 'stucco', stucco: pick(rnd, STUCCO), shape: dense ? 'flat' : 'hip', roof: 'clay', roofMat: 'whitewash', floors: dense ? 3 + (rnd() < 0.5 ? 1 : 0) : 2, shutters: pick(rnd, SHUTTERS) });
      else Object.assign(s, { wall: pick(rnd, ['brick', 'brick', 'brickDark', T === 'cold' ? 'faluRed' : 'brickYellow']), roof: pick(rnd, ['slate', 'slateDark']), shape: 'gableX', pitch: 0.75, floors: dense ? 3 + (rnd() < 0.4 ? 1 : 0) : 2, chimney: true, lit: true, winH: 3 });
      break;
    default:
      if (dense) Object.assign(s, { wall: pick(rnd, ['concrete', 'concrete', 'stucco']), stucco: pick(rnd, PAINT_MODERN), shape: 'flat', roofMat: 'tar', floors: 4 + Math.floor(rnd() * 4), floorH: 4, lit: true, winW: 2, bay: 3, modern: true });
      else Object.assign(s, { wall: 'paint', paint: pick(rnd, PAINT_MODERN), roof: pick(rnd, ['slateDark', 'clay', 'shingle', 'clayBrown']), shape: pick(rnd, ['gableX', 'hip', 'gableY']), pitch: 0.6, floors: 1 + (rnd() < 0.5 ? 1 : 0), winW: 2, lit: true });
      break;
  }
  return s;
}

function wallMat(s) {
  if (s.wall === 'stucco') return mat('stucco', s.stucco);
  if (s.wall === 'paint') return mat('paint', s.paint);
  if (s.wall === 'planksColor') return mat('planksColor', s.plank);
  if (s.wall === 'halftimber') return mat('halftimber', null, { floorH: s.floorH });
  return mat(s.wall);
}

function round(m, o) {
  const { W, D, era, climate, rnd } = o;
  const cx = W / 2;
  const cy = D / 2 + 0.5;
  const r = Math.min(W, D) * (W <= CELL ? 0.42 : 0.36);
  if (climate === 'cold' && era === 0 && rnd() < 0.6) {
    // A hide tent.
    m.cone(cx, cy, r + 0.3, 0, r * 2.1, mat('hide'), { seg: 12 });
    m.pole(cx - 0.5, cy - 0.5, r * 2, r * 2 + 2, mat('beam'));
    door(m, cx - 1, cy + r * 0.62, 0, 2, 2.5, '#3a2a20');
    return;
  }
  const stilt = climate === 'tropical' || climate === 'wetland' ? 2.5 : 0;
  if (stilt) {
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) m.pole(cx + dx * r * 0.6 - 0.5, cy + dy * r * 0.6 - 0.5, 0, stilt, mat('beam'));
    m.box(cx - r, cy - r, stilt - 0.6, cx + r, cy + r, stilt, mat('planks'), { top: mat('planks'), part: 'detail' });
  }
  const wall = climate === 'arid' ? mat('mud') : climate === 'tropical' || climate === 'wetland' ? mat('bamboo') : mat(era === 0 ? 'wattle' : 'daub');
  const wh = 4.2 + (era > 0 ? 0.8 : 0);
  m.cyl(cx, cy, r - 0.4, stilt, stilt + wh, wall, { seg: 14 });
  const roof = climate === 'arid' ? mat('thatchOld') : climate === 'tropical' ? mat('palm') : climate === 'wetland' ? mat('reed') : climate === 'cold' ? mat('turf') : mat('thatch');
  m.cone(cx, cy, r + 0.7, stilt + wh - 0.3, r * (climate === 'arid' ? 1.2 : 1.6), roof, { seg: 14 });
  door(m, cx - 1, cy + r - 0.35, stilt, 2, 3, '#3a2a20');
}

function house(m, o) {
  const { W, D, era, climate, rnd } = o;
  const dense = !!o.dense;
  const s = houseStyle(era, climate, rnd, dense);
  if (era === 0 && W <= 2 * CELL && D <= 2 * CELL) return round(m, o);
  if (era <= 1 && !dense && climate === 'temperate' && W <= 2 * CELL && D <= 2 * CELL && rnd() < 0.45) return round(m, o);
  // Footprint inside the lot.
  const inset = dense ? 0 : W >= 3 * CELL ? 2 : 1.5;
  const insetB = dense ? 1 : 2;
  let x0 = inset;
  let x1 = W - inset;
  let y0 = insetB + (dense ? 0 : 1);
  let y1 = D - (dense ? 0.5 : 1.5);
  if (!dense && rnd() < 0.5 && x1 - x0 > 9) {
    // Some houses are a little narrower than their lot (a side yard).
    const cut = 1 + Math.floor(rnd() * 3);
    if (rnd() < 0.5) x0 += cut;
    else x1 -= cut;
  }
  const st = s.stilts;
  if (st) {
    for (const [px, py] of [[x0, y0], [x1 - 1, y0], [x0, y1 - 1], [x1 - 1, y1 - 1]]) m.pole(px, py, 0, st, mat('beam'));
    m.box(x0 - 0.5, y0 - 0.5, st - 0.7, x1 + 0.5, y1 + 1.5, st, mat('planks'), { top: mat('planks'), part: 'detail' });
  }
  const z0 = st;
  const wallH = s.floors * s.floorH + (s.base ? 1 : 0);
  const zTop = z0 + wallH;
  const wm = wallMat(s);
  const doorW = W <= CELL ? 2 : 2;
  const doorU = Math.floor((x1 - x0 - doorW) / 2 + (rnd() < 0.5 ? -1 : 1) * (x1 - x0 > 10 ? 2 : 0));
  const deco = facade({
    door: !st,
    doorColor: s.doorColor,
    doorW,
    doorH: Math.min(4, s.floorH - 1),
    doorU,
    floors: s.floors,
    floorH: s.floorH,
    z0: s.base ? 1 : 0,
    winW: s.winW,
    winH: s.winH,
    bay: s.bay,
    lit: s.lit,
    shutters: s.shutters,
    boxes: s.boxes,
    glass: s.modern ? GLASS_MODERN : GLASS,
    sill: s.floorH <= 4 ? 1 : 2,
    sillRamp: era >= 3 && era <= 6 ? R('#e8e0d0') : null,
    groundWin: true,
  });
  if (s.base) {
    m.box(x0, y0, z0, x1, y1, z0 + 1, mat(s.base), { top: false });
    m.box(x0, y0, z0 + 1, x1, y1, zTop, wm, { top: false, south: { ...deco }, part: 'wall' });
  } else m.box(x0, y0, z0, x1, y1, zTop, wm, { top: false, south: deco, part: 'wall' });
  if (st) {
    // Ladder up to the door.
    door(m, Math.floor((x0 + x1) / 2) - 1, y1, z0, 2, Math.min(4, s.floorH - 1), '#3a2a20');
    m.quad([Math.floor((x0 + x1) / 2) - 1, y1 + 2.5, 0], [Math.floor((x0 + x1) / 2) + 1, y1 + 2.5, 0], [Math.floor((x0 + x1) / 2) + 1, y1 + 0.2, z0], [Math.floor((x0 + x1) / 2) - 1, y1 + 0.2, z0], mat('woodLight'), { n: [0, 0.6, 0.8], part: 'detail' });
  }
  const roofM = mat(s.roof);
  const w = x1 - x0;
  const d = y1 - y0;
  const gm = wm;
  switch (s.shape) {
    case 'flat': {
      const rm = mat(s.roofMat || 'adobe');
      m.flat(x0, y0, x1, y1, zTop, mat(s.roofMat === 'tar' ? 'tar' : 'gravel', null), { parapet: era >= 6 ? 1 : 1, parapetMat: rm });
      if (era <= 2 && rnd() < 0.5) m.box(x0 + 1, y0 + 1, zTop, x0 + 3, y0 + 3, zTop + 0.2, mat('beam'), { part: 'roof' });
      if (dense && era <= 4 && rnd() < 0.4 && w > 8) {
        // A roof room on part of the roof.
        m.box(x0 + 1, y0 + 1, zTop, x0 + Math.floor(w / 2), y0 + Math.floor(d / 2), zTop + 3, wm, { top: mat('gravel'), part: 'wall' });
      }
      if (era >= 6 && rnd() < 0.6) m.box(x1 - 4, y0 + 1, zTop, x1 - 2, y0 + 3, zTop + 2, mat('concreteDark'), { top: mat('iron'), part: 'detail' });
      if (era <= 4 && rnd() < 0.3) {
        // Drying cloth on a line.
        m.quad([x0 + 2, y1 - 2, zTop + 2], [x0 + 5, y1 - 2, zTop + 2], [x0 + 5, y1 - 2, zTop + 0.5], [x0 + 2, y1 - 2, zTop + 0.5], mat('cloth', pick(rnd, ['#c84a3a', '#e8d8b0', '#4a7aa8'])), { n: [0, 1, 0], part: 'detail' });
      }
      break;
    }
    case 'dome': {
      m.flat(x0, y0, x1, y1, zTop, mat('gravel'), { parapet: 0.8, parapetMat: wm });
      const r = Math.min(w, d) / 2 - 1.5;
      m.dome((x0 + x1) / 2, (y0 + y1) / 2, r, zTop, r * 0.9, mat('stucco', '#d9cdb6'));
      break;
    }
    case 'hip':
      m.hip(x0, y0, x1, y1, zTop, Math.min(w, d) / 2 * s.pitch, roofM, { over: s.over });
      break;
    case 'gableY':
      m.gable(x0, y0, x1, y1, zTop, (w / 2) * s.pitch, 'y', roofM, { over: s.over, gable: s.stepGable ? null : gm, edge: era >= 2 ? mat('beam') : null, gableDeco: s.floors >= 1 && w >= 8 ? facade({ floors: 1, floorH: 4, z0: 0.5, winW: 1, winH: 2, bay: 4, lit: s.lit, sill: 0 }) : null });
      if (s.stepGable) stepGable(m, x0, x1, y1, zTop, (w / 2) * s.pitch, wm);
      break;
    default:
      m.gable(x0, y0, x1, y1, zTop, (d / 2) * Math.min(0.7, s.pitch), 'x', roofM, { over: s.over, gable: gm, edge: era >= 3 ? mat('beam') : null });
      if (dense && era >= 4 && w >= 12 && rnd() < 0.5) dormer(m, x0 + Math.floor(w / 2) - 2, y1, zTop, (d / 2) * s.pitch, roofM, wm);
  }
  if (s.chimney && s.shape !== 'flat') {
    const cx = rnd() < 0.5 ? x0 + 2 : x1 - 4;
    const rise = s.shape === 'gableY' ? (w / 2) * s.pitch : (d / 2) * s.pitch;
    chimney(m, cx, y0 + d / 2 - 1, zTop, zTop + rise + 1.5, era >= 6 ? 'brick' : 'rubble');
  }
  if (!dense && era >= 1 && rnd() < 0.35 && !st) yardThing(m, o, x0, x1, y1, rnd);
}

/** A stepped (Dutch) gable over the front wall, for brick townhouses. */
function stepGable(m, x0, x1, y, z, rise, wm) {
  const w = x1 - x0;
  const steps = Math.max(2, Math.floor(rise / 2));
  for (let k = 0; k < steps; k++) {
    const inset = (k * w) / (2 * steps + 1);
    m.box(x0 + inset, y - 1, z + (k * rise) / steps, x1 - inset, y, z + ((k + 1) * rise) / steps + 0.5, wm, { top: mat('stone'), part: 'wall', south: k === 0 ? facade({ floors: 1, floorH: 3, z0: 0, winW: 1, winH: 2, bay: 4, sill: 0.5 }) : null });
  }
}

function dormer(m, x, y1, z, rise, roofM, wm) {
  const yd = y1 - rise * 0.5;
  m.box(x, yd - 2, z + rise * 0.25, x + 4, yd, z + rise * 0.25 + 3, wm, { top: false, south: facade({ floors: 1, floorH: 3, z0: 0, winW: 2, winH: 2, bay: 4, sill: 0.5 }), part: 'wall' });
  m.gable(x, yd - 2, x + 4, yd, z + rise * 0.25 + 3, 1.5, 'y', roofM, { over: 0.3, gable: wm });
}

function yardThing(m, o, x0, x1, y1, rnd) {
  const k = Math.floor(rnd() * 4);
  if (k === 0) {
    // Woodpile.
    m.box(x1 - 3, y1 - 0.5, 0, x1, y1 + 1, 1.5, mat('logs'), { top: mat('woodLight'), part: 'detail' });
  } else if (k === 1 && o.era <= 5) {
    // Barrel.
    m.cyl(x0 + 1, y1 + 0.8, 0.8, 0, 1.6, mat('wood'), { top: mat('woodLight'), seg: 8, part: 'detail' });
  } else if (k === 2 && o.era >= 3) {
    // Bench or cart.
    m.box(x0 + 1, y1 + 0.2, 0, x0 + 4, y1 + 1, 1, mat('woodLight'), { part: 'detail' });
  }
}

// ---------------------------------------------------------------------------
// Rural and working buildings

function farm(m, o) {
  const { W, D, era, climate, rnd } = o;
  // A farmhouse with a barn beside it.
  const s = houseStyle(era, climate, rnd, false);
  const barnW = Math.min(W - 6, Math.max(8, Math.floor(W * 0.55)));
  const bx0 = W - barnW - 1;
  const roof = era >= 6 ? mat('metalRust') : era >= 4 && climate === 'cold' ? mat('shingle') : era >= 3 && climate !== 'cold' ? mat(s.roof === 'gravel' ? 'clay' : s.roof) : mat('thatch');
  const bw = climate === 'cold' || era >= 4 ? mat(climate === 'temperate' && era >= 4 ? 'planks' : climate === 'cold' ? 'faluRed' : 'planks') : mat('wattle');
  m.box(bx0, 3, 0, W - 1, D - 2, 6, bw, { top: false, south: facade({ door: true, doorW: 4, doorH: 4, doorColor: '#5a3a22' }) });
  m.gable(bx0, 3, W - 1, D - 2, 6, (D - 5) / 2 * 0.9, 'x', roof, { over: 1, gable: bw });
  const hx1 = Math.max(6, bx0 - 1);
  house(m, { ...o, W: hx1 + 1, D, dense: false });
  if (era >= 4 && climate !== 'arid' && rnd() < 0.5) m.cyl(bx0 - 1, 3, 1.6, 0, 8, mat(era >= 6 ? 'concrete' : 'planks'), { top: mat('metal'), seg: 10 });
  if (rnd() < 0.6) m.box(1, D - 2, 0, 4, D - 0.5, 2, mat('hay'), { top: mat('hay'), part: 'detail' });
}

function granary(m, o) {
  const { W, D, era, climate } = o;
  if (era <= 2) {
    // Granaries raised on posts, thatched.
    const n = W >= 3 * CELL ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const cx = (W / (n * 2)) * (2 * k + 1);
      const cy = D / 2;
      const r = Math.min(W / n, D) / 2 - 2;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) m.pole(cx + dx * r * 0.5 - 0.5, cy + dy * r * 0.5 - 0.5, 0, 2, mat('beam'));
      m.cyl(cx, cy, r, 2, 2 + r * 1.1, mat(climate === 'arid' ? 'mud' : 'wattle'), { seg: 12 });
      m.cone(cx, cy, r + 0.8, 2 + r * 1.1 - 0.4, r * 1.2, mat(climate === 'arid' ? 'thatchOld' : 'thatch'), { seg: 12 });
    }
    return;
  }
  const wm = era >= 6 ? mat('brick') : era >= 4 ? mat(climate === 'cold' ? 'faluRed' : 'rubble') : mat(climate === 'arid' ? 'adobe' : 'ashlar');
  const x0 = 1;
  const x1 = W - 1;
  const y0 = 2;
  const y1 = D - 1;
  const h = era >= 6 ? 12 : 8;
  m.box(x0, y0, 0, x1, y1, h, wm, { top: false, south: facade({ door: true, doorW: 3, doorH: 5, floors: Math.floor(h / 5), floorH: 5, z0: 1, winW: 1, winH: 1, bay: 5, sill: 3 }) });
  const roof = era >= 6 ? mat('slate') : climate === 'cold' ? mat('shingle') : mat('clay');
  m.gable(x0, y0, x1, y1, h, (y1 - y0) / 2 * 0.6, 'x', roof, { over: 1, gable: wm });
}

function workshop(m, o) {
  const { W, D, era, climate, rnd } = o;
  // A house with a big chimney and an open shed with a forge glow.
  house(m, { ...o, W: Math.max(CELL * 2, W - CELL), dense: false });
  const sx0 = W - CELL + 0.5;
  m.pole(sx0, D - 4, 0, 5, mat('beam'));
  m.pole(W - 1.5, D - 4, 0, 5, mat('beam'));
  m.shed(sx0, 3, W - 0.5, D - 3, 5, 2, 's', mat(era >= 6 ? 'metal' : climate === 'arid' ? 'thatchOld' : 'shingle'));
  m.box(sx0 + 1.5, D - 7, 0, sx0 + 4.5, D - 5, 2, mat('rubble'), { top: mat('iron'), part: 'detail' });
  m.quad([sx0 + 2, D - 4.9, 1.2], [sx0 + 4, D - 4.9, 1.2], [sx0 + 4, D - 4.9, 2], [sx0 + 2, D - 4.9, 2], { ramp: rampOf('#f08a3a') }, { n: [0, 1, 0], part: 'detail', bias: 0.5 });
  chimney(m, sx0 + 1, 3, 0, 9 + Math.floor(rnd() * 2), era >= 6 ? 'brick' : 'rubble');
}

// ---------------------------------------------------------------------------
// Temples and churches

function temple(m, o) {
  const { W, D, era, climate, rnd } = o;
  if (era === 0) {
    // A ring of standing stones round a fire.
    const cx = W / 2;
    const cy = D / 2 + 1;
    const r = Math.min(W, D) / 2 - 2;
    const n = 9;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const h = 4 + (k % 3);
      m.box(cx + Math.cos(a) * r - 0.8, cy + Math.sin(a) * r * 0.85 - 0.6, 0, cx + Math.cos(a) * r + 0.8, cy + Math.sin(a) * r * 0.85 + 0.6, h, mat('rubble'), { top: mat('stone') });
    }
    m.box(cx - 2.5, cy - 0.6, 6, cx + 2.5, cy + 0.6, 7, mat('rubble'), { top: mat('stone') });
    m.pole(cx - 3, cy - 0.5, 0, 6, mat('rubble'));
    m.pole(cx + 2, cy - 0.5, 0, 6, mat('rubble'));
    return;
  }
  if (era === 1 && (climate === 'arid' || rnd() < 0.3)) return ziggurat(m, o);
  if (era <= 2) {
    // A long hall of the gods, thatched, with carved gable posts.
    const wm = climate === 'arid' ? mat('mudbrick') : climate === 'cold' ? mat('logsDark') : mat('daub');
    m.box(2, 3, 0, W - 2, D - 2, 6, wm, { top: false, south: facade({ door: true, doorW: 3, doorH: 4, doorColor: '#4a2a1a' }) });
    m.gable(2, 3, W - 2, D - 2, 6, (W - 4) / 2 * 1.1, 'y', mat(climate === 'cold' ? 'turf' : 'thatch'), { over: 1.2, gable: wm, edge: mat('beam') });
    m.pole(W / 2 - 0.5, D - 1.6, 6 + (W - 4) / 2 * 1.1 - 1, 6 + (W - 4) / 2 * 1.1 + 3, mat('beam'));
    return;
  }
  if (era === 3 || (climate === 'arid' && era <= 4 && rnd() < 0.3)) return classicalTemple(m, o);
  if (climate === 'arid' || (climate === 'tropical' && rnd() < 0.5)) return domeTemple(m, o);
  if (era === 4 && W >= 5 * CELL) return cathedral(m, o);
  if (era >= 5 && W >= 4 * CELL && rnd() < 0.6) return domeChurch(m, o);
  return church(m, o);
}

function ziggurat(m, o) {
  const { W, D } = o;
  const steps = 3 + (W >= 5 * CELL ? 1 : 0);
  const mm = mat('mudbrick');
  let x0 = 1;
  let y0 = 2;
  let x1 = W - 1;
  let y1 = D - 1;
  let z = 0;
  for (let k = 0; k < steps; k++) {
    m.box(x0, y0, z, x1, y1, z + 4, mm, { top: mat('adobe'), south: k === 0 ? facade({ band: [3] }) : null });
    z += 4;
    x0 += 2.5;
    x1 -= 2.5;
    y0 += 2;
    y1 -= 2.5;
  }
  m.box(x0, y0, z, x1, y1, z + 4, mat('whitewash'), { top: false, south: facade({ door: true, doorW: 2, doorH: 3, doorColor: '#3a5a8a' }) });
  m.flat(x0, y0, x1, y1, z + 4, mat('gravel'), { parapet: 0.6, parapetMat: mat('whitewash') });
  // Stair up the front.
  const cx = W / 2;
  m.quad([cx - 1.5, D - 0.5, 0], [cx + 1.5, D - 0.5, 0], [cx + 1.5, D - 3, z], [cx - 1.5, D - 3, z], mat('adobe', '#e2c08a'), { n: [0, 0.8, 0.5], part: 'detail', bias: 0.4 });
}

function classicalTemple(m, o) {
  const { W, D, color } = o;
  const st = mat('marble');
  // Stepped platform.
  m.box(0.5, 1, 0, W - 0.5, D - 0.5, 1, st);
  m.box(1.5, 2, 1, W - 1.5, D - 1.5, 2, st);
  const x0 = 2.5;
  const x1 = W - 2.5;
  const y0 = 3;
  const y1 = D - 2.5;
  const h = 7 + (W >= 4 * CELL ? 2 : 0);
  // Cella behind the columns.
  m.box(x0 + 2, y0 + 1, 2, x1 - 2, y1 - 4, 2 + h, st, { top: false, south: facade({ door: true, doorW: 3, doorH: 5, doorColor: '#6a4a2a' }) });
  const n = Math.max(4, Math.round((x1 - x0) / 3.2));
  colonnade(m, x0, x1, y1 - 1, 2, 2 + h, n);
  colonnade(m, x0, x1, y0 + 0.5, 2, 2 + h, n);
  // Entablature and the pediment facing the street.
  m.box(x0 - 0.5, y0 - 0.5, 2 + h, x1 + 0.5, y1 + 0.2, 2 + h + 1.5, st, { top: false, south: facade({ band: [0.5] }) });
  m.gable(x0 - 0.5, y0 - 0.5, x1 + 0.5, y1 + 0.2, 2 + h + 1.5, (x1 - x0) / 2 * 0.36, 'y', mat('clay'), { over: 0.5, gable: st, edge: st });
  if (color) flag(m, W - 2, D - 2, 0, 4, null);
}

function domeTemple(m, o) {
  const { W, D, era } = o;
  const wm = era >= 5 ? mat('marble') : mat('whitewash');
  const x0 = 2;
  const x1 = W - 2;
  const y0 = 3;
  const y1 = D - 2;
  const h = 8;
  m.box(x0, y0, 0, x1, y1, h, wm, { top: false, south: facade({ door: true, doorW: 3, doorH: 6, arch: true, floors: 1, floorH: 6, z0: 1, winW: 1, winH: 3, bay: 4, arch2: true }) });
  m.flat(x0, y0, x1, y1, h, mat('gravel'), { parapet: 1, parapetMat: wm });
  const r = Math.min(x1 - x0, y1 - y0) / 2 - 1;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  m.cyl(cx, cy, r * 0.9, h, h + 2, wm, { seg: 16 });
  m.dome(cx, cy, r, h + 2, r * 1.05, era >= 4 ? mat(o.v % 2 ? 'copper' : 'gold') : mat('stucco', '#d6c9b0'));
  // A slender tower at a corner.
  const tx = x1 - 0.5;
  const ty = y1 - 1;
  m.cyl(tx, ty, 1.4, 0, h + r * 2 + 4, wm, { seg: 10 });
  m.cyl(tx, ty, 1.9, h + r * 2 + 1, h + r * 2 + 1.8, wm, { seg: 10, top: wm });
  m.cone(tx, ty, 1.5, h + r * 2 + 4, 3, mat(era >= 4 ? 'copper' : 'whitewash'), { seg: 10 });
}

function church(m, o) {
  const { W, D, era, climate } = o;
  const wm = climate === 'cold' && era <= 5 ? mat(era <= 4 ? 'faluRed' : 'whitewash') : era >= 6 ? mat('brick') : mat(era >= 5 ? 'stucco' : 'ashlarWarm', era >= 5 ? '#ece4d2' : null);
  const roof = climate === 'cold' ? mat('shingle') : mat(era >= 5 ? 'slate' : 'clay');
  // Nave running back from the street, a tower at the front.
  const tw = 6;
  const x0 = Math.floor((W - Math.min(W - 2, 12)) / 2);
  const x1 = W - x0;
  const nh = 9;
  m.box(x0, 2, 0, x1, D - 6, nh, wm, { top: false, south: facade({ floors: 1, floorH: 8, z0: 1, winW: 1, winH: 4, bay: 4 }) });
  m.gable(x0, 2, x1, D - 6, nh, (x1 - x0) / 2 * 1.1, 'y', roof, { over: 0.8, gable: wm });
  const tx0 = W / 2 - tw / 2;
  const th = nh + 10;
  m.box(tx0, D - 7, 0, tx0 + tw, D - 1, th, wm, { top: false, south: facade({ door: true, doorW: 2, doorH: 5, arch: true, floors: 1, floorH: 8, z0: 9, winW: 2, winH: 3, bay: 6, doorColor: '#5a3a22' }) });
  if (climate === 'cold' || era === 4) m.hip(tx0, D - 7, tx0 + tw, D - 1, th, 9, roof, { over: 0.4 });
  else {
    m.box(tx0 + 0.5, D - 6.5, th, tx0 + tw - 0.5, D - 1.5, th + 3, wm, { top: false, south: facade({ floors: 1, floorH: 3, z0: 0, winW: 2, winH: 2, bay: 5, sill: 0.5 }) });
    m.dome(W / 2, D - 4, tw / 2 - 0.3, th + 3, 3, mat('copper'));
  }
}

function cathedral(m, o) {
  const { W, D, climate } = o;
  const wm = mat(climate === 'cold' ? 'ashlar' : 'ashlarWarm');
  const roof = mat(climate === 'cold' ? 'slateDark' : 'slate');
  const cx = W / 2;
  const nw = Math.min(14, W - 10);
  const nh = 13;
  // Nave.
  m.box(cx - nw / 2, 3, 0, cx + nw / 2, D - 8, nh, wm, { top: false });
  m.gable(cx - nw / 2, 3, cx + nw / 2, D - 8, nh, nw / 2 * 1.3, 'y', roof, { over: 0.8, gable: wm });
  // Aisles with buttresses.
  m.box(cx - nw / 2 - 4, 4, 0, cx - nw / 2, D - 9, 7, wm, { top: false, south: facade({ floors: 1, floorH: 6, z0: 1, winW: 1, winH: 3, bay: 3 }) });
  m.box(cx + nw / 2, 4, 0, cx + nw / 2 + 4, D - 9, 7, wm, { top: false, south: facade({ floors: 1, floorH: 6, z0: 1, winW: 1, winH: 3, bay: 3 }) });
  m.shed(cx - nw / 2 - 4, 4, cx - nw / 2, D - 9, 7, 3, 'w', roof);
  m.shed(cx + nw / 2, 4, cx + nw / 2 + 4, D - 9, 7, 3, 'e', roof);
  // Transept.
  const ty0 = Math.floor(D * 0.25);
  m.box(1, ty0, 0, W - 1, ty0 + 8, nh - 1, wm, { top: false, south: facade({ floors: 1, floorH: 9, z0: 2, winW: 2, winH: 5, bay: 5 }) });
  m.gable(1, ty0, W - 1, ty0 + 8, nh - 1, 4 * 1.3, 'x', roof, { over: 0.6, gable: wm });
  // Twin towers on the west front, facing the street.
  for (const tx of [cx - nw / 2 - 3, cx + nw / 2 - 3]) {
    m.box(tx, D - 9, 0, tx + 6, D - 2, nh + 9, wm, { top: false, south: facade({ floors: 3, floorH: 7, z0: 4, winW: 1, winH: 4, bay: 6 }) });
    m.hip(tx, D - 9, tx + 6, D - 2, nh + 9, 10, roof, { over: 0.3 });
  }
  // Front between the towers: portal and rose window.
  m.box(cx - nw / 2 + 3, D - 8.5, 0, cx + nw / 2 - 3, D - 3, nh + 2, wm, { top: false, south: facade({ door: true, doorW: 4, doorH: 7, arch: true, doorColor: '#4a2e1c', floors: 1, floorH: 6, z0: 9, winW: 4, winH: 4, bay: 8, sill: 0 }) });
  m.gable(cx - nw / 2 + 3, D - 8.5, cx + nw / 2 - 3, D - 3, nh + 2, 3, 'y', roof, { over: 0.2, gable: wm });
}

function domeChurch(m, o) {
  const { W, D, era } = o;
  const wm = era >= 6 ? mat('ashlar') : mat('stucco', '#ece4d2');
  const cx = W / 2;
  const cy = D / 2;
  const h = 10;
  m.box(2, 3, 0, W - 2, D - 2, h, wm, { top: false, south: facade({ door: true, doorW: 3, doorH: 6, arch: true, floors: 1, floorH: 7, z0: 2, winW: 1, winH: 4, bay: 5, doorColor: '#5a3a22' }) });
  m.flat(2, 3, W - 2, D - 2, h, mat('lead'), { parapet: 1, parapetMat: wm });
  // Portico with a pediment.
  colonnade(m, cx - 6, cx + 6, D - 1.5, 0, h - 1, 4);
  m.box(cx - 6.5, D - 3, h - 1, cx + 6.5, D - 1, h, wm, { top: false });
  m.gable(cx - 6.5, D - 3, cx + 6.5, D - 1, h, 2.5, 'y', mat('lead'), { over: 0.3, gable: wm });
  const r = Math.min(W, D) / 2 - 4;
  m.cyl(cx, cy, r, h, h + 5, wm, { seg: 20, deco: facade({ floors: 1, floorH: 4, z0: 1, winW: 1, winH: 3, bay: 3 }) });
  m.dome(cx, cy, r + 0.3, h + 5, r * 1.1, mat('copper'));
  m.cyl(cx, cy, 1.2, h + 5 + r * 1.1 - 0.5, h + 5 + r * 1.1 + 2.5, wm, { seg: 8 });
  m.cone(cx, cy, 1.4, h + 5 + r * 1.1 + 2.5, 2, mat('gold'), { seg: 8 });
}

// ---------------------------------------------------------------------------
// Seats of power

function palace(m, o) {
  const { era, climate } = o;
  if (era <= 1) return era === 1 && climate === 'arid' ? mudPalace(m, o) : longhall(m, o);
  if (era === 2) return longhall(m, o);
  if (era === 3) return villaPalace(m, o);
  if (era === 4) return castle(m, o);
  if (era === 5) return renPalace(m, o);
  return townHall(m, o);
}

function longhall(m, o) {
  const { W, D, climate, color, era } = o;
  const wm = climate === 'arid' ? mat('mudbrick') : climate === 'cold' ? mat('logsDark') : mat(era >= 2 ? 'rubble' : 'daub');
  const roof = climate === 'cold' ? mat('turf') : mat('thatch');
  // Palisade round the yard.
  palisade(m, 0.5, 1, W - 0.5, D - 0.5, 4);
  m.box(4, 5, 0, W - 4, D - 6, 6, wm, { top: false, south: facade({ door: true, doorW: 3, doorH: 4, doorColor: '#4a2a1a' }) });
  m.gable(4, 5, W - 4, D - 6, 6, (D - 11) / 2 * 1.2, 'x', roof, { over: 1.4, gable: wm, edge: mat('beam') });
  flag(m, W - 4, D - 5, 0, 12, color);
}

function palisade(m, x0, y0, x1, y1, h, gate = true) {
  const wd = mat('logs');
  const cx = (x0 + x1) / 2;
  m.box(x0, y0, 0, x1, y0 + 1, h, wd, { top: mat('woodLight') });
  m.box(x0, y0, 0, x0 + 1, y1, h, wd, { top: mat('woodLight') });
  m.box(x1 - 1, y0, 0, x1, y1, h, wd, { top: mat('woodLight') });
  if (gate) {
    m.box(x0, y1 - 1, 0, cx - 2, y1, h, wd, { top: mat('woodLight') });
    m.box(cx + 2, y1 - 1, 0, x1, y1, h, wd, { top: mat('woodLight') });
  } else m.box(x0, y1 - 1, 0, x1, y1, h, wd, { top: mat('woodLight') });
}

function mudPalace(m, o) {
  const { W, D, color } = o;
  const wm = mat('mudbrick');
  m.box(1, 2, 0, W - 1, D - 1, 5, wm, { top: false, south: facade({ door: true, doorW: 3, doorH: 4, doorColor: '#3a5a8a', band: [4] }) });
  m.flat(1, 2, W - 1, D - 1, 5, mat('adobe'), { parapet: 1, parapetMat: mat('adobe') });
  m.box(W / 2 - 6, 5, 5, W / 2 + 6, D - 5, 10, wm, { top: false, south: facade({ floors: 1, floorH: 5, z0: 0, winW: 1, winH: 2, bay: 3 }) });
  m.flat(W / 2 - 6, 5, W / 2 + 6, D - 5, 10, mat('adobe'), { parapet: 1, parapetMat: mat('whitewash') });
  flag(m, W / 2, 6, 10, 6, color);
}

function villaPalace(m, o) {
  const { W, D, color, climate } = o;
  const wm = climate === 'cold' ? mat('ashlar') : mat('stucco', '#ede6da');
  const roof = mat('clay');
  // A courtyard house: wings round an open court with a colonnade.
  const x0 = 1;
  const x1 = W - 1;
  const y0 = 2;
  const y1 = D - 1;
  const wing = 6;
  const h = 7;
  m.box(x0, y0, 0, x1, y0 + wing, h + 2, wm, { top: false });
  m.hip(x0, y0, x1, y0 + wing, h + 2, 3, roof, { over: 0.8 });
  m.box(x0, y0 + wing, 0, x0 + wing, y1, h, wm, { top: false, south: facade({ floors: 1, floorH: 5, z0: 1, winW: 1, winH: 2, bay: 4 }) });
  m.gable(x0, y0 + wing, x0 + wing, y1, h, 2.5, 'y', roof, { over: 0.8, gable: wm });
  m.box(x1 - wing, y0 + wing, 0, x1, y1, h, wm, { top: false, south: facade({ floors: 1, floorH: 5, z0: 1, winW: 1, winH: 2, bay: 4 }) });
  m.gable(x1 - wing, y0 + wing, x1, y1, h, 2.5, 'y', roof, { over: 0.8, gable: wm });
  m.box(x0 + wing, y1 - 1, 0, x1 - wing, y1, 3, wm, { top: mat('stone'), south: facade({ door: true, doorW: 3, doorH: 3, doorColor: '#6a4a2a' }) });
  // Court with a pool and columns.
  m.box(x0 + wing + 2, y0 + wing + 2, 0, x1 - wing - 2, y1 - 3, 0.3, mat('stone'), { top: mat('water'), part: 'detail' });
  colonnade(m, x0 + wing, x1 - wing, y0 + wing + 0.8, 0, h - 1, Math.max(3, Math.round((x1 - x0 - 2 * wing) / 3)));
  flag(m, x0 + 2, y0 + 1, h + 4, 6, color);
}

function castle(m, o) {
  const { W, D, color, climate } = o;
  const wm = mat(climate === 'cold' ? 'ashlar' : climate === 'arid' ? 'ashlarWarm' : 'rubble');
  const roof = mat(climate === 'cold' ? 'slateDark' : climate === 'arid' ? 'clay' : 'slate');
  const x0 = 1;
  const x1 = W - 1;
  const y0 = 2;
  const y1 = D - 1;
  const wh = 7;
  // Curtain walls.
  m.box(x0, y0, 0, x1, y0 + 2, wh, wm, { top: mat('stone') });
  m.box(x0, y0, 0, x0 + 2, y1, wh, wm, { top: mat('stone') });
  m.box(x1 - 2, y0, 0, x1, y1, wh, wm, { top: mat('stone') });
  m.box(x0, y1 - 2, 0, x1, y1, wh, wm, { top: mat('stone'), south: facade({ door: true, doorW: 3, doorH: 5, arch: true, doorColor: '#3a2a1e' }) });
  battlements(m, x0, y0, x1, y1, wh, climate === 'cold' ? 'ashlar' : 'rubble');
  // Keep.
  const kx0 = x0 + 5;
  const kx1 = x1 - 9;
  const ky0 = y0 + 3;
  const ky1 = y1 - 6;
  const kh = 17;
  m.box(kx0, ky0, 0, kx1, ky1, kh, wm, { top: mat('stone'), south: facade({ floors: 3, floorH: 5, z0: 2, winW: 1, winH: 2, bay: 4 }) });
  battlements(m, kx0, ky0, kx1, ky1, kh, climate === 'cold' ? 'ashlar' : 'rubble');
  // Hall along the east wall.
  m.box(kx1 + 1, ky0 + 1, 0, x1 - 2, ky1, 9, wm, { top: false, south: facade({ floors: 1, floorH: 6, z0: 2, winW: 1, winH: 3, bay: 3 }) });
  m.gable(kx1 + 1, ky0 + 1, x1 - 2, ky1, 9, 3.5, 'y', roof, { over: 0.5, gable: wm });
  // Corner towers with conical roofs.
  for (const [tx, ty] of [[x0 + 1.5, y0 + 1.5], [x1 - 1.5, y0 + 1.5], [x0 + 1.5, y1 - 1.5], [x1 - 1.5, y1 - 1.5]]) {
    m.cyl(tx, ty, 2.6, 0, wh + 5, wm, { seg: 12, deco: facade({ floors: 1, floorH: 4, z0: 6, winW: 1, winH: 2, bay: 8 }) });
    m.cone(tx, ty, 3.2, wh + 5, 6, roof, { seg: 12 });
  }
  flag(m, (kx0 + kx1) / 2, ky0 + 2, kh, 7, color);
}

function renPalace(m, o) {
  const { W, D, color, climate } = o;
  const wm = climate === 'cold' ? mat('stucco', '#e8d7a8') : mat('stucco', '#efe6d6');
  const roof = mat(climate === 'arid' ? 'clay' : 'slateBlue');
  const x0 = 1;
  const x1 = W - 1;
  const y0 = 3;
  const y1 = D - 3;
  const h = 15;
  m.box(x0, y0, 0, x1, y1, h, wm, { top: false, south: facade({ door: true, doorW: 3, doorH: 5, arch: true, floors: 3, floorH: 5, z0: 0, winW: 1, winH: 3, bay: 3, shutters: null, sillRamp: R('#f4efe4'), band: [5, 10], doorColor: '#4a3a2a' }) });
  m.hip(x0, y0, x1, y1, h, 6, roof, { over: 0.6 });
  // Central pavilion with a pediment and dome.
  const cx = W / 2;
  m.box(cx - 6, y1 - 1, 0, cx + 6, y1 + 1.5, h + 1, wm, { top: false, south: facade({ door: true, doorW: 4, doorH: 6, arch: true, floors: 3, floorH: 5, z0: 0, winW: 1, winH: 3, bay: 3, doorColor: '#4a3a2a' }) });
  m.gable(cx - 6, y1 - 1, cx + 6, y1 + 1.5, h + 1, 3, 'y', roof, { over: 0.3, gable: wm });
  m.cyl(cx, (y0 + y1) / 2, 3.5, h + 3, h + 5, wm, { seg: 14 });
  m.dome(cx, (y0 + y1) / 2, 3.8, h + 5, 4, mat('copper'));
  // Formal garden strip in front.
  m.box(x0 + 2, y1 + 1.6, 0, cx - 7, D - 0.3, 0.6, mat('turf'), { top: mat('turf'), part: 'detail' });
  m.box(cx + 7, y1 + 1.6, 0, x1 - 2, D - 0.3, 0.6, mat('turf'), { top: mat('turf'), part: 'detail' });
  flag(m, cx, (y0 + y1) / 2, h + 9, 5, color);
}

function townHall(m, o) {
  const { W, D, color, era } = o;
  const wm = era >= 7 ? mat('concrete') : mat('brick');
  const roof = era >= 7 ? mat('tar') : mat('slate');
  const x0 = 1;
  const x1 = W - 1;
  const y0 = 3;
  const y1 = D - 2;
  const h = 13;
  m.box(x0, y0, 0, x1, y1, h, wm, { top: false, south: facade({ door: true, doorW: 4, doorH: 5, arch: era < 7, floors: 3, floorH: 4.3, z0: 0, winW: era >= 7 ? 2 : 1, winH: 3, bay: 3, lit: true, band: era >= 7 ? null : [4.5], bandRamp: R('#d8cfc0'), doorColor: '#3a3a3a' }) });
  if (era >= 7) m.flat(x0, y0, x1, y1, h, roof, { parapet: 1, parapetMat: wm });
  else m.hip(x0, y0, x1, y1, h, 5, roof, { over: 0.5 });
  // Clock tower.
  const cx = W / 2;
  m.box(cx - 3, y1 - 6, 0, cx + 3, y1, h + 12, wm, { top: false, south: facade({ floors: 1, floorH: 4, z0: h + 5, winW: 2, winH: 2, bay: 6, sill: 0 }) });
  m.cyl(cx, y1 - 0.2, 1.6, h + 7, h + 8.5, mat('trim'), { seg: 10, top: mat('trim') });
  if (era >= 7) m.flat(cx - 3, y1 - 6, cx + 3, y1, h + 12, roof, { parapet: 0.8, parapetMat: wm });
  else m.hip(cx - 3, y1 - 6, cx + 3, y1, h + 12, 6, mat('copper'), { over: 0.3 });
  flag(m, cx, y1 - 3, h + 18, 5, color);
}

// ---------------------------------------------------------------------------
// Markets, harbours and works

function market(m, o) {
  const { W, D, era, rnd } = o;
  if (era === 3) {
    // A stoa: a long colonnaded hall.
    const st = mat('marble');
    m.box(1, 2, 0, W - 1, D - 1, 1, st);
    m.box(2, 3, 1, W - 2, 7, 8, st, { top: false });
    colonnade(m, 2, W - 2, D - 2.5, 1, 8, Math.round((W - 4) / 3));
    m.box(1.5, 2.5, 8, W - 1.5, D - 1.5, 9, st, { top: false });
    m.gable(1.5, 2.5, W - 1.5, D - 1.5, 9, 3, 'x', mat('clay'), { over: 0.5, gable: st });
    return;
  }
  if (era === 4 || era === 5) {
    // A market hall: open arcade below, a room above.
    const wm = era === 5 ? mat('stucco', '#e6d3a6') : mat('halftimber', null, { floorH: 6 });
    m.box(2, 3, 0, W - 2, D - 3, 1, mat('ashlar'));
    const n = Math.max(3, Math.round((W - 4) / 4));
    for (let k = 0; k <= n; k++) {
      const x = 2 + (k * (W - 5)) / n;
      m.box(x, D - 4, 1, x + 1, D - 3, 6, mat('ashlar'));
      m.box(x, 3, 1, x + 1, 4, 6, mat('ashlar'));
    }
    m.box(2, 3, 6, W - 2, D - 3, 12, wm, { top: false, south: facade({ floors: 1, floorH: 6, z0: 1, winW: 1, winH: 3, bay: 3 }) });
    m.gable(2, 3, W - 2, D - 3, 12, (D - 6) / 2 * 1.0, 'x', mat(era === 5 ? 'slate' : 'clay'), { over: 0.8, gable: wm });
    if (era === 5) m.cyl(W / 2, (D) / 2, 1.2, 12 + (D - 6) / 2 - 1, 12 + (D - 6) / 2 + 2, mat('trim'), { seg: 8, top: mat('copper') });
    return;
  }
  if (era >= 6) {
    // An iron and glass market hall.
    const wm = era >= 7 ? mat('concrete') : mat('brickYellow');
    m.box(1, 2, 0, W - 1, D - 1, 7, wm, { top: false, south: facade({ door: true, doorW: 4, doorH: 5, arch: true, floors: 1, floorH: 6, z0: 0, winW: 2, winH: 4, bay: 4, lit: true }) });
    m.gable(1, 2, W - 1, D - 1, 7, (D - 3) / 2 * 0.7, 'x', mat('glassRoof'), { over: 0.4, gable: wm });
    return;
  }
  // Stalls with striped awnings round a little square.
  const colors = ['#c84a3a', '#d9a640', '#4a7aa8', '#6a9a4a', '#a85a8a'];
  const n = Math.max(2, Math.floor(W / 7));
  for (let row = 0; row < 2; row++) {
    for (let k = 0; k < n; k++) {
      const x0 = 1 + (k * (W - 2)) / n;
      const x1 = x0 + (W - 2) / n - 1.5;
      const y0 = row === 0 ? 3 : D - 7;
      const y1 = y0 + 4;
      const c = colors[Math.floor(rnd() * colors.length)];
      m.box(x0 + 0.5, y0 + 1, 0, x1 - 0.5, y1 - 1, 2, mat('woodLight'), { top: mat('wood'), part: 'detail' });
      m.pole(x0, y1 - 0.8, 0, 4, mat('beam'));
      m.pole(x1 - 1, y1 - 0.8, 0, 4, mat('beam'));
      m.shed(x0 - 0.3, y0, x1 + 0.3, y1, 3.5, 1.5, 's', mat('cloth', c, { stripe: '#efe6d2' }), { over: 0.3 });
      if (rnd() < 0.6) m.box(x0 + 1, y1 - 0.5, 0, x0 + 2.5, y1 + 0.8, 1.2, mat('hay'), { top: mat('hay'), part: 'detail' });
    }
  }
}

function harbor(m, o) {
  const { W, D, era, climate } = o;
  // A warehouse on the quay; piers are drawn by the town on the water.
  const wm = era >= 6 ? mat('brick') : era >= 4 ? mat(climate === 'cold' ? 'faluRed' : climate === 'arid' ? 'adobe' : 'planks') : mat(climate === 'arid' ? 'mudbrick' : 'planks');
  const roof = era >= 6 ? mat('slate') : era >= 3 ? mat(climate === 'cold' ? 'shingle' : 'clay') : mat('thatch');
  const h = era >= 5 ? 11 : 7;
  m.box(1, 2, 0, W - 1, D - 2, h, wm, { top: false, south: facade({ door: true, doorW: 4, doorH: 5, floors: Math.floor(h / 5), floorH: 5, z0: 1, winW: 2, winH: 2, bay: 5, groundWin: false }) });
  m.gable(1, 2, W - 1, D - 2, h, (W - 2) / 2 * 0.8, 'y', roof, { over: 0.8, gable: wm, gableDeco: facade({ floors: 1, floorH: 3, z0: 1, winW: 2, winH: 2, bay: 4, sill: 0 }) });
  if (era >= 6) {
    // A crane.
    m.pole(W - 3, D - 1, 0, h + 6, mat('iron'));
    m.box(W - 3, D - 1, h + 5, W + 3, D, h + 6, mat('iron'), { part: 'detail' });
  } else {
    m.box(2, D - 1.6, 0, 4, D - 0.2, 1.6, mat('wood'), { top: mat('woodLight'), part: 'detail' });
    m.cyl(5.5, D - 0.8, 0.8, 0, 1.6, mat('wood'), { top: mat('woodLight'), seg: 8, part: 'detail' });
  }
}

function lighthouse(m, o) {
  const { W, D, era } = o;
  const cx = W / 2;
  const cy = D / 2 + 1;
  if (era <= 3) {
    // A tall stepped stone tower with a fire on top.
    const st = mat(era === 3 ? 'marble' : 'ashlar');
    m.box(cx - 5, cy - 4, 0, cx + 5, cy + 4, 12, st, { top: mat('stone'), south: facade({ door: true, doorW: 2, doorH: 4, floors: 2, floorH: 5, z0: 1, winW: 1, winH: 2, bay: 4 }) });
    m.box(cx - 3.5, cy - 2.5, 12, cx + 3.5, cy + 2.5, 21, st, { top: mat('stone'), south: facade({ floors: 2, floorH: 4, z0: 1, winW: 1, winH: 2, bay: 3 }) });
    m.cyl(cx, cy, 2.2, 21, 26, st, { seg: 10, top: mat('stone') });
    m.cone(cx, cy, 1.4, 26, 2.5, { ramp: rampOf('#f0a040') }, { seg: 8 });
    return;
  }
  const band = mat('stucco', '#c84a3a');
  const wh = mat('stucco', '#f2eee4');
  const h = 26;
  for (let k = 0; k < 4; k++) m.cyl(cx, cy, 3 - k * 0.3, (k * h) / 4, ((k + 1) * h) / 4, k % 2 ? band : wh, { seg: 12 });
  m.cyl(cx, cy, 3.4, h, h + 0.8, mat('iron'), { seg: 12, top: mat('iron') });
  m.cyl(cx, cy, 2, h + 0.8, h + 3.5, { ramp: rampOf('#f6d27a') }, { seg: 10 });
  m.cone(cx, cy, 2.6, h + 3.5, 2.5, mat('copper'), { seg: 10 });
  door(m, cx - 1, cy + 2.9, 0, 2, 3.5, '#3a3a3a');
}

function windmill(m, o) {
  const { W, D, era, climate } = o;
  const cx = W / 2;
  const cy = D / 2 + 1;
  const body = climate === 'cold' ? mat('faluRed') : era >= 5 ? mat('brick') : mat('whitewash');
  m.cyl(cx, cy, 3.6, 0, 6, body, { seg: 12 });
  m.cyl(cx, cy, 3, 6, 12, body, { seg: 12 });
  m.cone(cx, cy, 3.6, 12, 4, mat(climate === 'cold' ? 'shingle' : 'thatch'), { seg: 12 });
  door(m, cx - 1, cy + 3.5, 0, 2, 3.5, '#4a3020');
  // Sails, a cross in front of the cap.
  const sy = cy + 3.9;
  const sz = 12.5;
  const sail = mat('cloth', '#e8dcc0');
  const arm = mat('beam');
  for (const a of [0.6, 0.6 + Math.PI / 2, 0.6 + Math.PI, 0.6 + Math.PI * 1.5]) {
    const ex = Math.cos(a);
    const ez = Math.sin(a);
    const L = 9;
    const nx = -ez;
    const nz = ex;
    m.quad([cx + ex * 1, sy, sz + ez * 1], [cx + ex * L, sy, sz + ez * L], [cx + ex * L + nx * 2.2, sy, sz + ez * L + nz * 2.2], [cx + ex * 2 + nx * 2.2, sy, sz + ez * 2 + nz * 2.2], sail, { n: [0, 1, 0], part: 'detail', bias: 0.6 });
    m.quad([cx - nx * 0.4, sy + 0.1, sz - nz * 0.4], [cx + ex * L - nx * 0.4, sy + 0.1, sz + ez * L - nz * 0.4], [cx + ex * L + nx * 0.4, sy + 0.1, sz + ez * L + nz * 0.4], [cx + nx * 0.4, sy + 0.1, sz + nz * 0.4], arm, { n: [0, 1, 0], part: 'detail', bias: 0.7 });
  }
}

function factory(m, o) {
  const { W, D, era } = o;
  const wm = era >= 7 ? mat('concrete') : mat('brickDark');
  const h = 9;
  m.box(1, 3, 0, W - 1, D - 1, h, wm, { top: false, south: facade({ door: true, doorW: 4, doorH: 5, floors: 2, floorH: 4.5, z0: 0, winW: 2, winH: 3, bay: 4, lit: true, groundWin: true }) });
  // Sawtooth roof: a row of lean-tos facing north light.
  const n = Math.max(2, Math.floor((D - 4) / 5));
  const step = (D - 4) / n;
  for (let k = 0; k < n; k++) {
    const y0 = 3 + k * step;
    m.shed(1, y0, W - 1, y0 + step, h, 3, 'n', mat(era >= 7 ? 'metal' : 'slateDark'), { over: 0.1, wall: mat('glassRoof') });
  }
  // Chimney stacks.
  const stacks = W >= 5 * CELL ? 2 : 1;
  for (let k = 0; k < stacks; k++) {
    const cx = W - 4 - k * 9;
    m.cyl(cx, 3.5, 1.8, 0, h + 16, era >= 7 ? mat('concrete') : mat('brick'), { seg: 10 });
    m.cyl(cx, 3.5, 2.1, h + 15, h + 16.5, mat('iron'), { seg: 10, top: mat('iron') });
  }
}

function station(m, o) {
  const { W, D, era } = o;
  const wm = era >= 7 ? mat('concrete') : mat('brickYellow');
  // Train hall behind a front building with a clock.
  m.box(3, 2, 0, W - 3, D - 8, 9, wm, { top: false });
  m.gable(3, 2, W - 3, D - 8, 9, (W - 6) / 2 * 0.55, 'y', mat('glassRoof'), { over: 0.3, gable: wm });
  m.box(1, D - 9, 0, W - 1, D - 2, 10, wm, { top: false, south: facade({ door: true, doorW: 4, doorH: 6, arch: true, floors: 2, floorH: 5, z0: 0, winW: 2, winH: 3, bay: 4, lit: true, band: [5] }) });
  m.hip(1, D - 9, W - 1, D - 2, 10, 3, mat('slate'), { over: 0.5 });
  m.box(W / 2 - 2.5, D - 6, 10, W / 2 + 2.5, D - 2, 16, wm, { top: false, south: facade({ floors: 1, floorH: 4, z0: 1.5, winW: 2, winH: 2, bay: 5, sill: 0 }) });
  m.hip(W / 2 - 2.5, D - 6, W / 2 + 2.5, D - 2, 16, 3, mat('copper'), { over: 0.3 });
}

function apartment(m, o) {
  const { W, D, era, rnd } = o;
  const floors = era >= 7 ? 5 + Math.floor(rnd() * 6) : 4 + Math.floor(rnd() * 2);
  const fh = era >= 7 ? 4 : 4.5;
  const wk = era >= 7 ? pick(rnd, ['concrete', 'concrete', 'brick', 'concreteDark', 'stucco']) : pick(rnd, ['brick', 'brickDark', 'stucco']);
  const wm = wk === 'stucco' ? mat('stucco', pick(rnd, era >= 7 ? PAINT_MODERN : STUCCO)) : mat(wk);
  const h = floors * fh;
  m.box(1, 1, 0, W - 1, D - 1, h, wm, { top: false, south: facade({ door: true, doorW: 2, doorH: 4, floors, floorH: fh, z0: 0, winW: 2, winH: 2, bay: 3, lit: true, glass: GLASS_MODERN }) });
  m.flat(1, 1, W - 1, D - 1, h, mat('tar'), { parapet: 0.8, parapetMat: wm });
  if (rnd() < 0.6) m.box(W / 2 - 2, D / 2 - 2, h, W / 2 + 2, D / 2 + 1, h + 3, wm, { top: mat('tar'), part: 'detail' });
}

function office(m, o) {
  const { W, D, rnd } = o;
  const floors = 10 + Math.floor(rnd() * 14);
  const h = floors * 4;
  const glass = rnd() < 0.6;
  const wm = glass ? mat('glasswall', pick(rnd, ['#6f8fa5', '#7a9a8a', '#8a95a8'])) : mat('concrete');
  m.box(2, 2, 0, W - 2, D - 2, h, wm, { top: false, south: glass ? null : facade({ floors, floorH: 4, z0: 0, winW: 2, winH: 2, bay: 3, lit: true, glass: GLASS_MODERN }) });
  m.flat(2, 2, W - 2, D - 2, h, mat('gravel'), { parapet: 1, parapetMat: mat('concreteDark') });
  m.box(W / 2 - 3, D / 2 - 3, h, W / 2 + 3, D / 2 + 2, h + 3, mat('concreteDark'), { top: mat('tar'), part: 'detail' });
  if (rnd() < 0.5) m.pole(W / 2, D / 2, h + 3, h + 10, mat('iron'));
}

function university(m, o) {
  const { W, D, era } = o;
  const wm = era >= 6 ? mat('brick') : mat('ashlarWarm');
  const roof = mat('slate');
  const h = 12;
  m.box(1, 3, 0, W - 1, D - 2, h, wm, { top: false, south: facade({ door: true, doorW: 3, doorH: 5, arch: true, floors: 2, floorH: 5.5, z0: 0.5, winW: 1, winH: 3, bay: 3, lit: era >= 6 }) });
  m.gable(1, 3, W - 1, D - 2, h, (D - 5) / 2 * 0.9, 'x', roof, { over: 0.6, gable: wm });
  m.box(W / 2 - 2.5, D - 5, 0, W / 2 + 2.5, D - 1, h + 9, wm, { top: false, south: facade({ floors: 1, floorH: 5, z0: h + 2, winW: 2, winH: 3, bay: 5 }) });
  m.hip(W / 2 - 2.5, D - 5, W / 2 + 2.5, D - 1, h + 9, 7, mat('copper'), { over: 0.3 });
}

function amphitheater(m, o) {
  const { W, D } = o;
  const st = mat('ashlarWarm');
  const cx = W / 2;
  const cy = D / 2 + 1;
  const r = Math.min(W, D) / 2 - 1;
  m.cyl(cx, cy, r, 0, 10, st, { seg: 28, deco: facade({ floors: 2, floorH: 4.5, z0: 0.5, winW: 1, winH: 3, bay: 3, arch: true }) });
  // Seating: rings stepping down to the arena.
  for (let k = 0; k < 4; k++) m.cyl(cx, cy, r - 1 - k * 1.6, 0, 9.5 - k * 2, mat('marble'), { seg: 28, top: mat('marble') });
  m.cyl(cx, cy, r - 7.5, 0, 0.6, mat('earth'), { seg: 24, top: { ramp: rampOf('#d8c08a') } });
}

function monument(m, o) {
  const { W, D, era, climate, color } = o;
  const cx = W / 2;
  const cy = D / 2 + 0.5;
  if (era <= 2 && climate === 'arid') {
    // A pyramid.
    const s = Math.min(W, D) / 2 - 1;
    m.hip(cx - s, cy - s, cx + s, cy + s, 0, s * 1.25, mat('adobe', '#e2c48c'), { over: 0 });
    return;
  }
  if (era <= 3) {
    // An obelisk on a plinth.
    m.box(cx - 3, cy - 3, 0, cx + 3, cy + 3, 2, mat('marble'));
    m.box(cx - 1.4, cy - 1.4, 2, cx + 1.4, cy + 1.4, 18, mat(climate === 'arid' ? 'ashlarWarm' : 'ashlar'));
    m.hip(cx - 1.4, cy - 1.4, cx + 1.4, cy + 1.4, 18, 2.5, mat('gold'), { over: 0 });
    return;
  }
  // A statue on a column in a square.
  m.box(cx - 3, cy - 3, 0, cx + 3, cy + 3, 2.5, mat('ashlar'));
  m.cyl(cx, cy, 1.4, 2.5, 13, mat('marble'), { seg: 10 });
  m.box(cx - 1.5, cy - 1.5, 13, cx + 1.5, cy + 1.5, 14, mat('marble'));
  m.box(cx - 0.8, cy - 0.6, 14, cx + 0.8, cy + 0.6, 17, mat(era >= 5 ? 'copper' : 'gold'));
  m.box(cx - 0.6, cy - 0.5, 17, cx + 0.6, cy + 0.5, 18.2, mat(era >= 5 ? 'copper' : 'gold'));
  if (color) flag(m, cx + 3.5, cy + 2, 0, 9, color);
}

function well(m, o) {
  const { W, D, era } = o;
  const cx = W / 2;
  const cy = D / 2 + 1;
  if (era >= 5) {
    // A fountain.
    m.cyl(cx, cy, 3.5, 0, 1.2, mat('ashlar'), { seg: 16, top: mat('water') });
    m.cyl(cx, cy, 0.8, 1.2, 4, mat('marble'), { seg: 8, top: mat('marble') });
    m.cyl(cx, cy, 1.6, 4, 4.6, mat('marble'), { seg: 10, top: mat('water') });
    return;
  }
  m.cyl(cx, cy, 2, 0, 1.6, mat('rubble'), { seg: 12, top: mat('water') });
  m.pole(cx - 2, cy - 0.5, 1, 5, mat('beam'));
  m.pole(cx + 1, cy - 0.5, 1, 5, mat('beam'));
  m.gable(cx - 2.5, cy - 1.5, cx + 2.5, cy + 0.5, 5, 1.2, 'x', mat('shingle'), { over: 0.2 });
}

// ---------------------------------------------------------------------------
// City walls: a piece per cell, joined towards its wall neighbours.

function wallPiece(m, o) {
  const { era, climate, links = 0 } = o;
  const C = CELL;
  const palis = era <= 1 || (era === 2 && climate !== 'arid');
  const wm = palis ? mat('logs') : era >= 5 ? mat('brick') : mat(climate === 'arid' ? 'mudbrick' : 'rubble');
  const h = palis ? 5 : era >= 5 ? 6 : 8;
  const t = palis ? 1.2 : 2.6;
  const c0 = C / 2 - t / 2;
  const c1 = C / 2 + t / 2;
  const top = palis ? mat('woodLight') : mat('stone');
  m.box(c0, c0, 0, c1, c1, h, wm, { top });
  if (links & 1) m.box(c0, 0, 0, c1, c0, h, wm, { top }); // north
  if (links & 2) m.box(c1, c0, 0, C, c1, h, wm, { top }); // east
  if (links & 4) m.box(c0, c1, 0, c1, C, h, wm, { top }); // south
  if (links & 8) m.box(0, c0, 0, c0, c1, h, wm, { top }); // west
  if (!palis) {
    const mm = era >= 5 ? 'brick' : climate === 'arid' ? 'mudbrick' : 'rubble';
    if (links & 10) for (let x = 0.5; x < C; x += 3) m.box(x, c1 - 0.8, h, x + 1.5, c1, h + 1.3, mat(mm), { part: 'roof' });
    if (links & 5) for (let y = 0.5; y < C; y += 3) m.box(c1 - 0.8, y, h, c1, y + 1.5, h + 1.3, mat(mm), { part: 'roof' });
  } else {
    // Sharpened stakes along the top.
    if (links & 10) for (let x = 0.5; x < C; x += 1.5) m.cone(x + 0.5, C / 2, 0.6, h, 1.2, mat('logs'), { seg: 4 });
  }
}

function wallTower(m, o) {
  const { era, climate, color } = o;
  const C = CELL * (o.w || 1);
  const palis = era <= 1 || (era === 2 && climate !== 'arid');
  if (palis) {
    for (const [x, y] of [[1, 1], [C - 2, 1], [1, C - 2], [C - 2, C - 2]]) m.pole(x, y, 0, 8, mat('beam'));
    m.box(0.5, 0.5, 6, C - 0.5, C - 0.5, 7, mat('planks'), { top: mat('planks') });
    m.hip(1, 1, C - 1, C - 1, 9, 3, mat('thatch'), { over: 0.6 });
    for (const [x, y] of [[1, 1], [C - 2, 1], [1, C - 2], [C - 2, C - 2]]) m.pole(x, y, 7, 9, mat('beam'));
    return;
  }
  const wm = era >= 5 ? mat('brick') : mat(climate === 'arid' ? 'mudbrick' : 'rubble');
  const h = era >= 5 ? 9 : 12;
  if (era === 4 && climate !== 'arid') {
    m.cyl(C / 2, C / 2, C / 2 - 0.5, 0, h, wm, { seg: 14, deco: facade({ floors: 1, floorH: 4, z0: 6, winW: 1, winH: 2, bay: 8 }) });
    m.cone(C / 2, C / 2, C / 2 + 0.3, h, C / 2 + 2, mat(climate === 'cold' ? 'slateDark' : 'slate'), { seg: 14 });
  } else {
    m.box(0, 0, 0, C, C, h, wm, { top: mat('stone'), south: facade({ floors: 1, floorH: 4, z0: 6, winW: 1, winH: 2, bay: 8 }) });
    battlements(m, 0, 0, C, C, h, era >= 5 ? 'brick' : climate === 'arid' ? 'mudbrick' : 'rubble', 1.5);
  }
  if (color && C > CELL) flag(m, C / 2, C / 2, h, 6, color);
}

function gate(m, o) {
  const { era, climate, links = 5 } = o;
  const C = CELL;
  const palis = era <= 1 || (era === 2 && climate !== 'arid');
  const wm = palis ? mat('logs') : era >= 5 ? mat('brick') : mat(climate === 'arid' ? 'mudbrick' : 'rubble');
  const h = palis ? 6 : 10;
  if (links & 10) {
    // The wall runs east-west: an arch over a north-south road.
    m.box(0, 1.5, 0, 2, C - 1.5, h, wm, { top: mat('stone') });
    m.box(C - 2, 1.5, 0, C, C - 1.5, h, wm, { top: mat('stone') });
    m.box(0, 1.5, h - 3, C, C - 1.5, h, wm, { top: mat('stone'), south: facade({ floors: 1, floorH: 2, z0: 0.5, winW: 1, winH: 1, bay: 3 }) });
    if (!palis) m.hip(-0.5, 1, C + 0.5, C - 1, h, 3.5, mat(era >= 5 ? 'slate' : 'clay'), { over: 0.3 });
  } else {
    m.box(1.5, 0, 0, C - 1.5, 2, h, wm, { top: mat('stone') });
    m.box(1.5, C - 2, 0, C - 1.5, C, h, wm, { top: mat('stone') });
    m.box(1.5, 0, h - 3, C - 1.5, C, h, wm, { top: mat('stone') });
    if (!palis) m.hip(1, -0.5, C - 1, C + 0.5, h, 3.5, mat(era >= 5 ? 'slate' : 'clay'), { over: 0.3 });
  }
}

// ---------------------------------------------------------------------------
// Ruins and building sites

/** Clip a face to Z <= zc (Sutherland-Hodgman); returns null when nothing is left. */
function clipFace(pts, zc) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const ain = a[2] <= zc;
    const bin = b[2] <= zc;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (zc - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, zc]);
    }
  }
  return out.length >= 3 ? out : null;
}

function ruin(m, rnd) {
  const faces = m.faces;
  m.faces = [];
  for (const f of faces) {
    if (f.part === 'roof' && f.n[2] > 0.2) continue;
    const zc = 1.5 + rnd() * 4;
    const pts = clipFace(f.pts, zc);
    if (!pts) continue;
    const g = m.face(pts, f.mat, { n: f.n, normal: f.normal, part: f.part === 'roof' ? 'wall' : f.part });
    if (g && f.part !== 'detail' && f.n[2] < 0.5 && Math.abs(f.n[1]) > 0.5) g.deco = null;
  }
  // Rubble heaps.
  for (let k = 0; k < 3; k++) {
    const x = 2 + rnd() * 10;
    const y = 4 + rnd() * 8;
    m.box(x, y, 0, x + 2 + rnd() * 2, y + 1.5, 1 + rnd(), mat('rubble'), { top: mat('stone'), part: 'detail' });
  }
}

function construction(m, rnd) {
  const faces = m.faces;
  let top = 0;
  for (const f of faces) for (const p of f.pts) top = Math.max(top, p[2]);
  const zc = Math.max(2, top * 0.45);
  m.faces = [];
  let bx0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (const f of faces) {
    if (f.part === 'roof' && f.n[2] > 0.2) continue;
    const pts = clipFace(f.pts, zc);
    if (!pts) continue;
    m.face(pts, f.mat, { n: f.n, normal: f.normal, part: f.part === 'roof' ? 'wall' : f.part });
    for (const p of pts) {
      bx0 = Math.min(bx0, p[0]);
      bx1 = Math.max(bx1, p[0]);
      by1 = Math.max(by1, p[1]);
    }
  }
  if (!Number.isFinite(bx0)) return;
  // Scaffolding poles along the front.
  for (let x = bx0; x <= bx1; x += 4) m.pole(x, by1 + 0.6, 0, zc + 3, mat('woodLight'));
  m.box(bx0, by1 + 0.4, zc + 1, bx1 + 1, by1 + 1.6, zc + 1.6, mat('woodLight'), { part: 'detail' });
}

// ---------------------------------------------------------------------------

export const KINDS = {
  hut: round,
  house,
  rowhouse: (m, o) => house(m, { ...o, dense: true }),
  farm,
  granary,
  workshop,
  temple,
  palace,
  market,
  harbor,
  lighthouse,
  windmill,
  factory,
  station,
  apartment,
  office,
  university,
  amphitheater,
  monument,
  well,
  wall: wallPiece,
  tower: wallTower,
  gate,
};

/** Footprints (cells) a kind may take, smallest first. */
export const SIZES = {
  hut: [[1, 1], [2, 2]],
  house: [[2, 2], [3, 2], [2, 3], [3, 3]],
  rowhouse: [[1, 2], [2, 2], [2, 3]],
  farm: [[4, 3], [5, 3]],
  granary: [[3, 2], [3, 3]],
  workshop: [[3, 2], [4, 3]],
  temple: [[4, 4], [5, 5], [6, 7]],
  palace: [[6, 5], [7, 6], [8, 7]],
  market: [[4, 3], [5, 4]],
  harbor: [[3, 3], [4, 3]],
  lighthouse: [[2, 2]],
  windmill: [[2, 2]],
  factory: [[5, 4], [6, 5]],
  station: [[6, 5]],
  apartment: [[2, 2], [3, 2], [3, 3]],
  office: [[3, 3]],
  university: [[5, 4]],
  amphitheater: [[6, 6]],
  monument: [[2, 2], [3, 3], [4, 4]],
  well: [[1, 1]],
  wall: [[1, 1]],
  tower: [[1, 1], [2, 2]],
  gate: [[1, 1]],
};
