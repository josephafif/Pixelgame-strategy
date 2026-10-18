// Frame composition: camera with smooth zoom, the strategic map (one pixel
// per tile: terrain and territory), the pixel-art view (terrain chunks and
// settlement layers, painted in workers), soldiers, villagers at work,
// ships, the realms' names and the player's selection and orders.
//
// Pixel art shows from far out: every chunk and settlement is also kept at a
// quarter of its size (4 px per tile) and those are painted for the whole
// map in the background, so a zoomed-out view is trees and towns rather than
// flat colour. Closer in, half-size and full-size pictures take over.
//
// The camera zooms continuously; when a gesture ends it eases to the nearest
// "crisp" scale so pixel art is never left at an uneven size.

import { renderChunk, CHUNK, TILE } from './ground.js';
import { renderSettlementLayer } from './settlement-layer.js';
import { PaintPool } from './paint-pool.js';
import { TerritoryImage } from './territory.js';
import { layoutBounds, N as LN } from '../../engine/settlement/planner.js';
import { buildTerrainOverview } from './overview.js';
import { shipSprite } from './decor.js';
import { unitSprite, unitIcon } from './people.js';
import { planWorkers, drawWorkers } from './workers.js';
import { Pix, makeCanvas } from './pix.js';
import { shade, rgb } from './color.js';
import { Atlas } from './atlas.js';

export const MIN_PPT = 1;
export const MAX_PPT = 64;
const PIXEL = 2.5; // pixels per tile where pixel art starts to fade in over the flat map
const PIXEL_FULL = 3.5; // ... and covers it
const LINES = 8; // crisp border lines from here (below, the territory image's rims)
const TINT = 0.3; // territory colour over close-up pixel art
const CELL = 16; // tiles per side of the cells in which territory changes are redrawn
// Scales that leave pixel art crisp.
const CRISP = [1, 1.5, 2, 3, 4, 5, 6, 8, 12, 16, 24, 32, 48, 64];
const SMALL_SCREEN = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 600;
// Full and half-size chunks are 1 MB + 256 KB each: phones keep fewer.
const MAX_CHUNKS = SMALL_SCREEN ? 36 : 90;
const MAX_LAYERS = SMALL_SCREEN ? 40 : 80;
const SEA = '#2c5b72'; // deep ocean, beyond the map's edge

const ease = (t) => 1 - Math.pow(1 - t, 3);
const fmt = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);

// Structure markers for the flat map.
const markers = new Map();
function marker(kind, color, level) {
  const key = `${kind}:${color}:${level}`;
  let m = markers.get(key);
  if (m) return m;
  const p = new Pix(13, 13);
  const dark = '#231a16';
  if (kind === 'town') {
    p.rect(1, 6, 11, 6, color);
    for (let x = 1; x < 12; x++) p.vline(x, 6 - Math.max(0, 5 - Math.abs(x - 6)), 6, shade(color, -0.25));
    p.rect(5, 8, 3, 4, dark);
    for (let k = 0; k < level; k++) p.set(2 + k * 3 - (k > 1 ? 1 : 0), 7, '#ffe9a8');
  } else if (kind === 'port') {
    p.rect(1, 1, 11, 11, color);
    p.vline(6, 3, 10, '#f6efdc');
    p.hline(4, 8, 4, '#f6efdc');
    p.hline(3, 9, 9, '#f6efdc');
    p.set(3, 8, '#f6efdc');
    p.set(9, 8, '#f6efdc');
  } else {
    p.rect(3, 2, 7, 10, color);
    for (const x of [2, 4, 6, 8, 10]) p.set(x, 1, color);
    p.rect(5, 6, 3, 3, dark);
  }
  p.outline(dark);
  m = { canvas: p.toCanvas(), w: p.w, h: p.h };
  markers.set(key, m);
  return m;
}

// Squad chips for the flat map: a coloured badge with the unit glyph.
function chip(type, color) {
  const icon = unitIcon(type);
  const cv = makeCanvas(icon.w + 4, icon.h + 4);
  const g = cv.getContext('2d');
  g.fillStyle = '#231a16';
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = color;
  g.fillRect(1, 1, cv.width - 2, cv.height - 2);
  g.drawImage(icon.canvas, 2, 2);
  return { canvas: cv, w: cv.width, h: cv.height };
}

// For measuring text before making a picture of it.
let probeCtx = null;
function probe(font) {
  probeCtx ||= makeCanvas(1, 1).getContext('2d');
  probeCtx.font = font;
  return probeCtx;
}

/** A soldier count on the owner's colour (with a flashing mark while fighting), at `dpr` resolution. */
function badgeSprite(text, color, fight, dpr) {
  const font = `600 ${10 * dpr}px "Pixelify Sans", monospace`;
  const tw = Math.ceil(probe(font).measureText(text).width / dpr) + 6;
  const w = tw + 2 + (fight ? 7 : 0);
  const cv = makeCanvas(Math.ceil(w * dpr), 13 * dpr);
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = '#231a16';
  g.fillRect(0, 0, tw + 2, 13);
  g.fillStyle = color;
  g.fillRect(1, 1, tw, 11);
  const [r, gr, b] = rgb(color);
  g.fillStyle = r * 0.3 + gr * 0.55 + b * 0.15 > 150 ? '#231a16' : '#ffffff';
  g.font = font.replace(`${10 * dpr}px`, '10px');
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.fillText(text, 4, 1);
  if (fight) {
    g.fillStyle = fight === 1 ? '#ffe08a' : '#ff6a3a';
    g.fillRect(tw + 5, 4, 4, 4);
  }
  return { canvas: cv, w: cv.width, h: cv.height, ax: 0, ay: 0 };
}

/** A town's name tag, at `dpr` resolution. */
function nameTag(text, color, dpr) {
  const w = Math.ceil(probe(`${12 * dpr}px "Pixelify Sans", monospace`).measureText(text).width / dpr) + 12;
  const cv = makeCanvas(w * dpr, 18 * dpr);
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = 'rgba(35,26,22,0.8)';
  g.fillRect(0, 0, w, 18);
  g.fillStyle = color;
  g.fillRect(0, 0, 3, 18);
  g.fillStyle = '#f6efdc';
  g.font = '12px "Pixelify Sans", monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2 + 1, 10);
  return { canvas: cv, w: cv.width, h: cv.height, ax: cv.width / 2, ay: cv.height / 2 };
}

// Where the figures of a squad stand, relative to its centre (tiles).
const FORMATION = [[0, 0], [-0.42, 0.22], [0.42, 0.22], [-0.21, -0.25], [0.21, -0.25], [0, 0.46], [-0.63, -0.05], [0.63, -0.05], [0, -0.5]];
// For n figures: their formation slots, back row first.
const ROWS = Array.from({ length: FORMATION.length + 1 }, (_, n) => FORMATION.slice(0, n).map((f, k) => k).sort((a, b) => FORMATION[a][1] - FORMATION[b][1]));
const SPREAD = { rider: 1.3, knight: 1.3, trebuchet: 1.8 };

/** Frame of figure k of a squad: each figure is a little out of step with the others. */
function figureFrame(state, phase, k) {
  if (state === 'f') return 4 + ((phase + Math.floor(k * 0.7)) % 2);
  if (state === 'm') return (phase + Math.floor(k * 1.3)) % 4;
  return (phase + k) % 4 === 0 ? 1 : 0;
}

/**
 * A whole squad as one picture (far zooms, where figures are small and many
 * squads are on screen): n figures in formation, for one animation phase,
 * at device resolution. `scale` and `step` are in CSS pixels.
 */
function formationSprite(type, color, nf, state, phase, scale, step, dpr) {
  const spread = (SPREAD[type] || 1) * step;
  const k = scale * dpr;
  const figs = ROWS[nf].map((slot) => {
    const spr = unitSprite(type, color, figureFrame(state, phase, slot));
    const f = FORMATION[slot];
    const x = f[0] * spread * dpr - spr.ax * k;
    const y = f[1] * spread * dpr - spr.ay * k;
    return { spr, x, y };
  });
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const f of figs) {
    x0 = Math.min(x0, f.x);
    y0 = Math.min(y0, f.y);
    x1 = Math.max(x1, f.x + f.spr.w * k);
    y1 = Math.max(y1, f.y + f.spr.h * k);
  }
  x0 = Math.floor(x0);
  y0 = Math.floor(y0);
  const cv = makeCanvas(Math.ceil(x1 - x0) + 1, Math.ceil(y1 - y0) + 1);
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  for (const f of figs) g.drawImage(f.spr.canvas, Math.round(f.x - x0), Math.round(f.y - y0), f.spr.w * k, f.spr.h * k);
  return { canvas: cv, w: cv.width, h: cv.height, ax: -x0, ay: -y0 };
}

export class Renderer {
  constructor(canvas, cw) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cw = cw;
    this.cam = { x: cw.W / 2, y: cw.H / 2, ppt: 3 };
    this.anim = null;
    this.chunks = new Map(); // full and half size, near the view
    this.low = new Map(); // quarter size, the whole map
    this.layers = new Map(); // full-size settlement pictures, near the view
    this.layersLow = new Map(); // quarter size, every settlement
    this.workerPlans = new Map();
    this.overview = buildTerrainOverview(cw.world);
    this.terr = new TerritoryImage(cw);
    this.labelCache = new Map();
    this.atlas = new Atlas();
    this.labelPos = new Map();
    this.labelArmy = new Map();
    this.facing = new Map();
    this.pings = [];
    this.preview = null; // { x, y, ok, radius }
    this.highlight = null; // player id outlined on the map
    this.selected = new Set(); // own squad ids
    this.box = null; // selection rectangle in screen coordinates
    this.deploy = null; // { x, y, ok, from: {x, y}, type, n }
    this.frameNo = 0;
    this.mc = null; // the map cache
    this.mcDirty = []; // tile rectangles of it to redraw
    this.terrCells = new Set(); // cells of territory changed since the cached lines were drawn (-1: all)
    this.pool = new PaintPool(cw.world, (r) => this.painted(r));
    this.chunksX = Math.ceil(cw.W / CHUNK);
    this.chunksY = Math.ceil(cw.H / CHUNK);
    // ?dpr=1|1.5|2 fixes the drawing resolution (for testing).
    const fixed = typeof location !== 'undefined' ? Number(new URLSearchParams(location.search).get('dpr')) : 0;
    if (fixed > 0) {
      this.dprCap = fixed;
      this.fixedDpr = true;
    }
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.ready.then(() => {
        this.labelCache.clear();
        this.atlas.reset();
      });
    }
    this.resize();
  }

  /** A worker finished a chunk or settlement layer. */
  painted(r) {
    if (r.key.startsWith('c') || r.key.startsWith('q')) {
      const key = r.key.slice(1);
      const [cx, cy] = key.split(',').map(Number);
      this.touch(cx * CHUNK, cy * CHUNK, CHUNK, CHUNK);
      const oldLow = this.low.get(key);
      if (oldLow?.canvas?.close) oldLow.canvas.close();
      this.low.set(key, { canvas: r.low, at: this.now || 0 });
      if (!r.half) return;
      const old = this.chunks.get(key);
      if (old?.canvas?.close) old.canvas.close();
      if (old?.half?.close) old.half.close();
      this.chunks.set(key, { canvas: r.bmp || null, half: r.half, used: this.frameNo, at: this.now || 0 });
      this.evict(this.chunks, this.chunkRoom || MAX_CHUNKS);
    } else {
      const sid = Number(r.key.slice(1));
      const L = this.cw.layouts.get(sid);
      const old = this.layers.get(sid);
      const before = this.layersLow.get(sid);
      if (before) this.touch(Math.floor(before.px / TILE), Math.floor(before.py / TILE), Math.ceil(before.w / TILE) + 1, Math.ceil(before.h / TILE) + 1);
      this.touch(Math.floor(r.px / TILE), Math.floor(r.py / TILE), Math.ceil(r.w / TILE) + 1, Math.ceil(r.h / TILE) + 1);
      const oldLow = this.layersLow.get(sid);
      if (oldLow?.canvas?.close) oldLow.canvas.close();
      if (!L) return;
      this.layersLow.set(sid, { canvas: r.low, px: r.px, py: r.py, w: r.w, h: r.h, v: r.v, color: r.color });
      if (!r.half) return; // only the quarter-size picture was asked for
      if (old?.canvas?.close) old.canvas.close();
      if (old?.half?.close) old.half.close();
      const ly = { canvas: r.bmp || null, half: r.half, w: r.w, h: r.h, px: r.px, py: r.py, v: r.v, color: r.color, bounds: layoutBounds(L), used: this.frameNo };
      this.layers.set(sid, ly);
      this.evict(this.layers, this.layerRoom || MAX_LAYERS);
    }
  }

  /** Drop the least recently drawn pictures beyond `max`. */
  evict(map, max) {
    while (map.size > max) {
      let old = null;
      for (const [k, v] of map) if (!old || v.used < old[1].used) old = [k, v];
      if (!old) break;
      if (old[1].canvas?.close) old[1].canvas.close();
      if (old[1].half?.close) old[1].half.close();
      map.delete(old[0]);
    }
  }

  /** The overlay data a worker needs to paint chunk (cx, cy), with a margin. */
  chunkJob(cx, cy, lowOnly = false, full = true) {
    const { cw } = this;
    const W = cw.W;
    const x0 = Math.max(0, cx * CHUNK - 2);
    const y0 = Math.max(0, cy * CHUNK - 2);
    const x1 = Math.min(W, (cx + 1) * CHUNK + 2);
    const y1 = Math.min(cw.H, (cy + 1) * CHUNK + 2);
    const w = x1 - x0;
    const h = y1 - y0;
    const patch = { x0, y0, w, h };
    const transfer = [];
    for (const k of ['road', 'ground', 'crop', 'cleared']) {
      const out = new Uint8Array(w * h);
      const src = cw.ov[k];
      for (let y = 0; y < h; y++) out.set(src.subarray((y0 + y) * W + x0, (y0 + y) * W + x1), y * w);
      patch[k] = out;
      transfer.push(out.buffer);
    }
    return { msg: { t: 'chunk', cx, cy, patch, lowOnly, full }, transfer };
  }

  destroy() {
    this.pool.destroy();
  }

  resize() {
    // Pixel art gains nothing above 2x, and phones at 3x pay for it in frame time.
    const dev = window.devicePixelRatio || 1;
    const dpr = Math.min(this.dprCap || 2, dev);
    this.dpr = dpr;
    // Enlarged by the browser in whole steps, pixel art stays crisp.
    const k = dev / dpr;
    this.canvas.style.imageRendering = k > 1.01 && Math.abs(k - Math.round(k)) < 0.05 ? 'pixelated' : '';
    this.mc = null;
    this.bc = null;
    this.mcDirty = [];
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.vw = w;
    this.vh = h;
    this.labelCache.clear();
    if (this.atlas && this.atlasDpr !== dpr) this.atlas.reset();
    this.atlasDpr = dpr;
  }

  // Camera ------------------------------------------------------------------

  screenToTile(sx, sy) {
    return { x: this.cam.x + (sx - this.vw / 2) / this.cam.ppt, y: this.cam.y + (sy - this.vh / 2) / this.cam.ppt };
  }

  tileToScreen(tx, ty) {
    return { x: (tx - this.cam.x) * this.cam.ppt + this.vw / 2, y: (ty - this.cam.y) * this.cam.ppt + this.vh / 2 };
  }

  /** Smallest zoom: the whole map fits on screen. */
  get minPpt() {
    return Math.max(MIN_PPT * 0.6, Math.min(this.vw / this.cw.W, this.vh / this.cw.H) * 0.9);
  }

  clampPpt(p) {
    return Math.max(this.minPpt, Math.min(MAX_PPT, p));
  }

  /** Set the zoom at once, keeping the tile under (sx, sy) in place. */
  setPpt(ppt, sx = this.vw / 2, sy = this.vh / 2) {
    const before = this.screenToTile(sx, sy);
    this.cam.ppt = this.clampPpt(ppt);
    const after = this.screenToTile(sx, sy);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
    this.clampCam();
  }

  /** Ease the zoom to `ppt` around (sx, sy). */
  zoomTo(ppt, sx = this.vw / 2, sy = this.vh / 2, dur = 220) {
    this.anim = { from: this.cam.ppt, to: this.clampPpt(ppt), sx, sy, t0: performance.now(), dur };
  }

  /** Zoom by a factor (wheel, keys, buttons), continuing any zoom under way. */
  zoomBy(factor, sx = this.vw / 2, sy = this.vh / 2) {
    const base = this.anim ? this.anim.to : this.cam.ppt;
    let to = this.clampPpt(base * factor);
    // Land on a crisp scale when the step passes one.
    const crisp = CRISP.filter((c) => (factor > 1 ? c > base * 1.02 && c <= to * 1.15 : c < base / 1.02 && c >= to / 1.15));
    if (crisp.length) to = factor > 1 ? crisp[0] : crisp[crisp.length - 1];
    this.zoomTo(to, sx, sy, 200);
  }

  /** One step in or out (double-tap, +/-). */
  zoomStep(dir, sx = this.vw / 2, sy = this.vh / 2) {
    const base = this.anim ? this.anim.to : this.cam.ppt;
    const next = dir > 0 ? CRISP.find((c) => c > base * 1.05) : [...CRISP].reverse().find((c) => c < base / 1.05);
    this.zoomTo(next ?? (dir > 0 ? MAX_PPT : this.minPpt), sx, sy, 240);
  }

  /** After a pinch: ease to the nearest crisp scale. */
  settle(sx = this.vw / 2, sy = this.vh / 2) {
    const p = this.cam.ppt;
    if (p <= this.minPpt * 1.01) return;
    let best = CRISP[0];
    for (const c of CRISP) if (Math.abs(Math.log(c / p)) < Math.abs(Math.log(best / p))) best = c;
    if (Math.abs(best - p) > 0.01) this.zoomTo(best, sx, sy, 160);
  }

  stepAnim(now) {
    const a = this.anim;
    if (!a) return;
    const t = Math.min(1, (now - a.t0) / a.dur);
    // Interpolate in log space so zooming feels even at every scale.
    const p = Math.exp(Math.log(a.from) + (Math.log(a.to) - Math.log(a.from)) * ease(t));
    this.setPpt(t >= 1 ? a.to : p, a.sx, a.sy);
    if (t >= 1) this.anim = null;
  }

  centerOn(x, y, ppt = null) {
    this.cam.x = x;
    this.cam.y = y;
    if (ppt) this.cam.ppt = this.clampPpt(ppt);
    this.clampCam();
  }

  /** Glide to a point (and optionally a zoom). */
  flyTo(x, y, ppt = null) {
    this.fly = { fx: this.cam.x, fy: this.cam.y, tx: x, ty: y, t0: performance.now(), dur: 380 };
    if (ppt) this.zoomTo(ppt, this.vw / 2, this.vh / 2, 380);
  }

  stepFly(now) {
    const f = this.fly;
    if (!f) return;
    const t = Math.min(1, (now - f.t0) / f.dur);
    const k = ease(t);
    this.cam.x = f.fx + (f.tx - f.fx) * k;
    this.cam.y = f.fy + (f.ty - f.fy) * k;
    this.clampCam();
    if (t >= 1) this.fly = null;
  }

  clampCam() {
    this.cam.x = Math.max(0, Math.min(this.cw.W, this.cam.x));
    this.cam.y = Math.max(0, Math.min(this.cw.H, this.cam.y));
  }

  /** A short ring where the player tapped. */
  ping(x, y, color = '#fff3c4') {
    this.pings.push({ x, y, color, t0: performance.now() });
  }

  // Caches ------------------------------------------------------------------

  /** A chunk's half-size (and, when `full`, full-size) pictures, asking a worker for them when missing. */
  chunk(cx, cy, prio = 0, full = true) {
    const key = `${cx},${cy}`;
    let c = this.chunks.get(key);
    const dirty = this.cw.dirtyChunks.has(key);
    if (this.pool.ok) {
      if ((!c || dirty || (full && !c.canvas)) && !this.pool.busy(`c${key}`)) {
        this.pool.want(`c${key}`, prio, () => {
          // The pictures come with a fresh quarter-size one.
          this.cw.dirtyChunks.delete(key);
          this.cw.lowDirty.delete(key);
          return this.chunkJob(cx, cy, false, full);
        });
      }
    } else if (!c || dirty) {
      // No workers: paint here, a few per frame.
      if (this.mainBudget <= 0) return c;
      this.mainBudget--;
      const canvas = renderChunk(this.cw.world, cx, cy, this.cw.ov);
      c = { canvas, half: null, used: this.frameNo, at: this.now };
      this.chunks.set(key, c);
      this.touch(cx * CHUNK, cy * CHUNK, CHUNK, CHUNK);
      this.cw.dirtyChunks.delete(key);
      this.evict(this.chunks, this.chunkRoom || MAX_CHUNKS);
    }
    if (c) c.used = this.frameNo;
    return c;
  }

  /** A chunk's quarter-size picture (for far views). */
  lowChunk(cx, cy, prio) {
    const key = `${cx},${cy}`;
    const l = this.low.get(key);
    const stale = this.cw.lowDirty.has(key);
    if (this.pool.ok && (!l || stale) && !this.pool.busy(`q${key}`) && !this.pool.busy(`c${key}`)) {
      this.pool.want(`q${key}`, prio, () => {
        this.cw.lowDirty.delete(key);
        return this.chunkJob(cx, cy, true);
      });
    }
    return l;
  }

  /** Ask for just the quarter-size picture of a settlement (far views). */
  lowLayer(s) {
    const L = this.cw.layouts.get(s.id);
    if (!L || !this.pool.ok) {
      this.layer(s, false);
      return;
    }
    const color = this.cw.colorOf(s.owner);
    if (this.pool.busy(`s${s.id}`)) return;
    const d = Math.hypot(s.x - this.cam.x, s.y - this.cam.y) / CHUNK;
    this.pool.want(`s${s.id}`, 5 + d, () => {
      this.cw.layerDirty.delete(s.id);
      return { msg: { t: 'layer', L, color, v: L.v, lowOnly: true } };
    });
  }

  /** A settlement's pictures (half size, and full size when `full`), asking a worker for them when missing. */
  layer(s, full = true) {
    const L = this.cw.layouts.get(s.id);
    if (!L) return null;
    const color = this.cw.colorOf(s.owner);
    let ly = this.layers.get(s.id);
    const stale = !ly || ly.v !== L.v || ly.color !== color || this.cw.layerDirty.has(s.id) || (full && !ly.canvas);
    if (stale && this.pool.ok) {
      if (!this.pool.busy(`s${s.id}`)) {
        const d = Math.hypot(s.x - this.cam.x, s.y - this.cam.y) / CHUNK;
        this.pool.want(`s${s.id}`, d - 0.5, () => {
          this.cw.layerDirty.delete(s.id);
          return { msg: { t: 'layer', L, color, v: L.v, full } };
        });
      }
    } else if (stale && this.mainBudget > 0) {
      this.mainBudget--;
      const r = renderSettlementLayer(this.cw.world, L, { color });
      ly = { ...r, half: null, w: r.canvas.width, h: r.canvas.height, color, v: L.v, bounds: layoutBounds(L) };
      this.layers.set(s.id, ly);
      this.touch(Math.floor(r.px / TILE), Math.floor(r.py / TILE), Math.ceil(r.canvas.width / TILE) + 1, Math.ceil(r.canvas.height / TILE) + 1);
      this.cw.layerDirty.delete(s.id);
    }
    if (ly) ly.used = this.frameNo;
    return ly;
  }

  // Frame -------------------------------------------------------------------

  /**
   * A device that cannot keep up gets a lower drawing resolution (2x, 1.5x,
   * then 1x): judged over two seconds of frames once the game has settled.
   */
  watchFrameRate(now) {
    const gap = now - (this.lastFrameAt || now);
    this.lastFrameAt = now;
    this.startedAt ||= now;
    if (gap <= 0 || gap > 120 || now - this.startedAt < 5000 || typeof document !== 'undefined' && document.hidden) return;
    this.gapSum = (this.gapSum || 0) + gap;
    this.gapN = (this.gapN || 0) + 1;
    if (this.gapSum < 2000) return;
    const avg = this.gapSum / this.gapN;
    this.gapSum = 0;
    this.gapN = 0;
    if (avg > 26 && this.dpr > 1 && !this.fixedDpr) {
      this.dprCap = this.dpr > 1.5 ? 1.5 : 1;
      this.resize();
    }
  }

  frame(now) {
    this.frameNo++;
    this.watchFrameRate(now);
    this.now = now;
    this.mainBudget = 2;
    this.stepFly(now);
    this.stepAnim(now);
    this.pool.begin();
    const { ctx } = this;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.terr.highlight(this.highlight);
    if (this.terr.update()) this.noteTerritory();
    const ppt = this.cam.ppt;
    if (ppt !== this.lastPpt) {
      this.lastPpt = ppt;
      this.zoomAt = now;
    }
    if (this.cam.x !== this.lastX || this.cam.y !== this.lastY) {
      this.lastX = this.cam.x;
      this.lastY = this.cam.y;
      this.moveAt = now;
    }
    const tl = this.screenToTile(0, 0);
    const br = this.screenToTile(this.vw, this.vh);
    this.view = { x0: Math.floor(tl.x) - 1, y0: Math.floor(tl.y) - 1, x1: Math.ceil(br.x) + 1, y1: Math.ceil(br.y) + 1 };
    // Whole device pixels for the map origin keep tiles from shimmering while panning.
    const ox = Math.round((this.vw / 2 - this.cam.x * ppt) * dpr) / dpr;
    const oy = Math.round((this.vh / 2 - this.cam.y * ppt) * dpr) / dpr;
    this.ox = ox;
    this.oy = oy;
    const pixel = ppt < PIXEL ? 0 : Math.min(1, (ppt - PIXEL) / (PIXEL_FULL - PIXEL));
    if (pixel > 0) {
      this.requestPictures(ppt);
      this.drawMap(ox, oy, ppt, pixel);
    } else {
      ctx.fillStyle = SEA;
      ctx.fillRect(0, 0, this.vw, this.vh);
      this.drawFlat(ctx, this.view, ox, oy, ppt);
    }
    this.drawTerritory(ox, oy, ppt, pixel);
    if (ppt >= 8) this.drawTownLife(ox, oy, ppt);
    this.drawStructures(ox, oy, ppt, pixel);
    this.drawBoats(ox, oy, ppt);
    this.drawSquads(ox, oy, ppt, now);
    this.drawLabels(ox, oy, ppt);
    this.drawOrders(ox, oy, ppt, now);
    this.drawPreview(ox, oy, ppt);
    this.drawPings(ox, oy, ppt, now);
    this.prefetch();
    this.pool.pump();
  }

  /** Source and destination rectangles for a tile range of a 1-pixel-per-tile image. */
  visibleRect(ox, oy, ppt, view = this.view) {
    const { cw } = this;
    const x0 = Math.max(0, view.x0);
    const y0 = Math.max(0, view.y0);
    const x1 = Math.min(cw.W, view.x1);
    const y1 = Math.min(cw.H, view.y1);
    return { x0, y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0), dx: ox + x0 * ppt, dy: oy + y0 * ppt };
  }

  drawFlat(g, view, ox, oy, ppt) {
    const r = this.visibleRect(ox, oy, ppt, view);
    if (!r.w || !r.h) return;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.overview, r.x0, r.y0, r.w, r.h, r.dx, r.dy, r.w * ppt, r.h * ppt);
  }

  /** Full or half-size pictures from here in (at least 8 device pixels per tile); further out, quarter size. */
  near(ppt) {
    return ppt >= 6 || ppt * this.dpr >= 8;
  }

  /** Ask the paint workers for the pictures the view needs (cheap; nothing is drawn). */
  requestPictures(ppt) {
    const { cw } = this;
    const { x0, y0, x1, y1 } = this.view;
    const near = this.near(ppt);
    const full = (ppt * this.dpr) / TILE > 0.75;
    const mcx = this.cam.x / CHUNK;
    const mcy = this.cam.y / CHUNK;
    const cy0 = Math.max(0, Math.floor(y0 / CHUNK));
    const cy1 = Math.min(this.chunksY - 1, Math.floor(y1 / CHUNK));
    const cx0 = Math.max(0, Math.floor(x0 / CHUNK));
    const cx1 = Math.min(this.chunksX - 1, Math.floor(x1 / CHUNK));
    // Room for every chunk on screen, so they never push each other out.
    this.chunkRoom = Math.max(MAX_CHUNKS, (cx1 - cx0 + 1) * (cy1 - cy0 + 1) + 8);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const d = Math.hypot(cx + 0.5 - mcx, cy + 0.5 - mcy);
        if (!(near && this.chunk(cx, cy, d, full))) this.lowChunk(cx, cy, near ? 5 + d : d);
      }
    }
    if (!cw.snap) return;
    let n = 0;
    for (const s of cw.snap.structures) {
      const L = cw.layouts.get(s.id);
      if (!L || L.ox > x1 + 2 || L.oy > y1 + 2 || L.ox + LN < x0 - 2 || L.oy + LN < y0 - 2) continue;
      n++;
      if (near) this.layer(s, full);
      else {
        const low = this.layersLow.get(s.id);
        if (!low || low.v !== cw.layouts.get(s.id)?.v || low.color !== cw.colorOf(s.owner) || this.cw.layerDirty.has(s.id)) this.lowLayer(s);
      }
    }
    // Room for every settlement in view, so they never push each other out.
    if (near) this.layerRoom = Math.max(MAX_LAYERS, n + 8);
  }

  // Map cache ----------------------------------------------------------------
  //
  // Terrain and settlements change rarely, so they are drawn into a picture a
  // little larger than the screen and copied each frame. Panning shifts the
  // picture and draws only the strips that come into view; a picture that
  // arrives from a worker redraws just its own rectangle; while a zoom is
  // under way the old picture is stretched, and redrawn once it settles.

  /** Is the view inside the cached picture? */
  covers(mc) {
    const v = this.view;
    return v.x0 >= mc.tx0 && v.y0 >= mc.ty0 && v.x1 <= mc.tx0 + mc.tw && v.y1 <= mc.ty0 + mc.th;
  }

  drawMap(ox, oy, ppt, pixel) {
    const { ctx } = this;
    const dpr = this.dpr;
    let mc = this.mc;
    const same = mc && mc.ppt === ppt && mc.dpr === dpr && mc.pixel === pixel;
    if (!same) {
      const zooming = this.anim || this.now - this.zoomAt < 140;
      if (mc && zooming && mc.dpr === dpr && mc.ppt / ppt > 0.45 && mc.ppt / ppt < 2.2) {
        // Stretch the last picture over the flat map until the zoom settles.
        ctx.fillStyle = SEA;
        ctx.fillRect(0, 0, this.vw, this.vh);
        this.drawFlat(ctx, this.view, ox, oy, ppt);
        ctx.imageSmoothingEnabled = ppt < mc.ppt;
        ctx.drawImage(mc.canvas, ox + mc.tx0 * ppt, oy + mc.ty0 * ppt, mc.tw * ppt, mc.th * ppt);
        return;
      }
      mc = this.compose(ppt, pixel, null);
    } else if (!this.covers(mc)) mc = this.compose(ppt, pixel, mc);
    else if (this.mcDirty.length && this.now - (this.refreshAt || 0) > 200) {
      // New pictures are put in a few times a second, not every frame: a
      // changed cache picture costs a copy the next time it is drawn.
      this.refreshAt = this.now;
      this.refresh(mc);
    }
    ctx.imageSmoothingEnabled = false;
    const dx = Math.round((ox + mc.tx0 * ppt) * dpr) / dpr;
    const dy = Math.round((oy + mc.ty0 * ppt) * dpr) / dpr;
    ctx.drawImage(mc.canvas, dx, dy, mc.canvas.width / dpr, mc.canvas.height / dpr);
  }

  /**
   * A new cached picture around the view; `old` (same scale) is shifted into
   * it where it overlaps. Close in there is a second picture over it: the
   * territory tint and border lines, kept the same way.
   */
  compose(ppt, pixel, old) {
    const dpr = this.dpr;
    const margin = Math.round(Math.max(this.vw, this.vh) * 0.2);
    const tl = this.screenToTile(-margin, -margin);
    const tx0 = Math.floor(tl.x);
    const ty0 = Math.floor(tl.y);
    const tw = Math.ceil((this.vw + 2 * margin) / ppt) + 2;
    const th = Math.ceil((this.vh + 2 * margin) / ppt) + 2;
    const pw = Math.ceil(tw * ppt * dpr);
    const ph = Math.ceil(th * ppt * dpr);
    const lines = ppt >= LINES;
    this.mcBufs ||= [{}, {}];
    this.mcFront = (this.mcFront ?? 0) ^ 1;
    const buf = this.mcBufs[this.mcFront];
    const sheet = (name) => {
      if (!buf[name]) buf[name] = makeCanvas(pw, ph);
      const cv = buf[name];
      if (cv.width !== pw || cv.height !== ph) {
        cv.width = pw;
        cv.height = ph;
      }
      buf[`${name}G`] ||= cv.getContext('2d');
      return [cv, buf[`${name}G`]];
    };
    const [canvas, g] = sheet('base');
    const [over, og] = lines ? sheet('over') : [null, null];
    const mc = { canvas, g, over, og, lines, ppt, dpr, pixel, tx0, ty0, tw, th, id: (this.mc?.id || 0) + 1, overAt: this.now };
    const step = ppt * dpr;
    const all = { x: tx0, y: ty0, w: tw, h: th };
    let rects = [all];
    let overRects = [all];
    const ix0 = old ? Math.max(old.tx0, tx0) : 0;
    const iy0 = old ? Math.max(old.ty0, ty0) : 0;
    const ix1 = old ? Math.min(old.tx0 + old.tw, tx0 + tw) : 0;
    const iy1 = old ? Math.min(old.ty0 + old.th, ty0 + th) : 0;
    if (old && old.lines === lines && Math.abs(step - Math.round(step)) < 1e-6 && ix1 > ix0 && iy1 > iy0) {
      // Keep what is still in view, then draw the strips around it.
      const shift = (to, from) => {
        to.setTransform(1, 0, 0, 1, 0, 0);
        to.globalCompositeOperation = 'copy';
        to.drawImage(from, (old.tx0 - tx0) * step, (old.ty0 - ty0) * step);
        to.globalCompositeOperation = 'source-over';
      };
      shift(g, old.canvas);
      if (lines) shift(og, old.over);
      const strips = [
        { x: tx0, y: ty0, w: tw, h: iy0 - ty0 },
        { x: tx0, y: iy1, w: tw, h: ty0 + th - iy1 },
        { x: tx0, y: iy0, w: ix0 - tx0, h: iy1 - iy0 },
        { x: ix1, y: iy0, w: tx0 + tw - ix1, h: iy1 - iy0 },
      ].filter((r) => r.w > 0 && r.h > 0);
      rects = [...strips, ...this.mcDirty];
      overRects = strips;
    } else this.terrCells.clear();
    this.mc = mc;
    this.mcDirty = [];
    for (const r of rects) this.renderRect(mc, r);
    if (lines) for (const r of overRects) this.renderOver(mc, r);
    return mc;
  }

  /** Redraw the parts of the picture whose pictures changed. */
  refresh(mc) {
    const rects = this.mcDirty;
    this.mcDirty = [];
    for (const r of rects) this.renderRect(mc, r);
  }

  /** Clip `g` to tile rectangle r of the cache; returns the clipped tile range, or null. */
  clipTo(mc, g, r) {
    const x0 = Math.max(r.x, mc.tx0);
    const y0 = Math.max(r.y, mc.ty0);
    const x1 = Math.min(r.x + r.w, mc.tx0 + mc.tw);
    const y1 = Math.min(r.y + r.h, mc.ty0 + mc.th);
    if (x1 <= x0 || y1 <= y0) return null;
    const { ppt, dpr } = mc;
    g.save();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.beginPath();
    g.rect((x0 - mc.tx0) * ppt, (y0 - mc.ty0) * ppt, (x1 - x0) * ppt, (y1 - y0) * ppt);
    g.clip();
    return { x0, y0, x1, y1 };
  }

  /** Draw tile rectangle r of the map into the cached picture. */
  renderRect(mc, r) {
    const { g, ppt } = mc;
    const view = this.clipTo(mc, g, r);
    if (!view) return;
    const ox = -mc.tx0 * ppt;
    const oy = -mc.ty0 * ppt;
    g.fillStyle = SEA;
    g.fillRect(ox + view.x0 * ppt, oy + view.y0 * ppt, (view.x1 - view.x0) * ppt, (view.y1 - view.y0) * ppt);
    if (mc.pixel < 1) this.drawFlat(g, view, ox, oy, ppt);
    this.drawPixel(g, view, ox, oy, ppt, mc.pixel);
    g.restore();
  }

  /** Draw tile rectangle r of the territory tint and border lines into the cached picture over the map. */
  renderOver(mc, r) {
    const { og: g, ppt } = mc;
    const view = this.clipTo(mc, g, r);
    if (!view) return;
    const { cw } = this;
    g.clearRect((view.x0 - mc.tx0) * ppt, (view.y0 - mc.ty0) * ppt, (view.x1 - view.x0) * ppt, (view.y1 - view.y0) * ppt);
    // From here on in tile units.
    g.setTransform(mc.dpr * ppt, 0, 0, mc.dpr * ppt, -mc.tx0 * ppt * mc.dpr, -mc.ty0 * ppt * mc.dpr);
    const tr = this.visibleRect(0, 0, 1, view);
    if (tr.w && tr.h) {
      g.imageSmoothingEnabled = false;
      g.globalAlpha = TINT;
      g.drawImage(this.terr.canvas, tr.x0, tr.y0, tr.w, tr.h, tr.x0, tr.y0, tr.w, tr.h);
      g.globalAlpha = 1;
    }
    const O = cw.owner;
    const W = cw.W;
    const t = Math.max(1.5, ppt / 10) / ppt; // line width in tiles
    const paths = new Map();
    const path = (o) => {
      let p = paths.get(o);
      if (!p) paths.set(o, (p = new Path2D()));
      return p;
    };
    for (let y = Math.max(0, view.y0 - 1); y < Math.min(cw.H - 1, view.y1); y++) {
      for (let x = Math.max(0, view.x0 - 1); x < Math.min(W - 1, view.x1); x++) {
        const i = y * W + x;
        const k = O[i];
        const kr = O[i + 1];
        const kd = O[i + W];
        if (k !== kr) {
          if (k >= 0) path(k).rect(x + 1 - t, y, t, 1);
          if (kr >= 0) path(kr).rect(x + 1, y, t, 1);
        }
        if (k !== kd) {
          if (k >= 0) path(k).rect(x, y + 1 - t, 1, t);
          if (kd >= 0) path(kd).rect(x, y + 1, 1, t);
        }
      }
    }
    for (const [o, p] of paths) {
      g.fillStyle = o === cw.you ? '#fff3c4' : shade(cw.colorOf(o), -0.15);
      g.fill(p);
    }
    g.restore();
  }

  /** Something in tile rectangle r looks different now. */
  touch(x, y, w, h) {
    const mc = this.mc;
    if (!mc || x > mc.tx0 + mc.tw || y > mc.ty0 + mc.th || x + w < mc.tx0 || y + h < mc.ty0) return;
    this.mcDirty.push({ x, y, w, h });
  }

  /** Note which parts of the territory changed (for the cached tint and lines). */
  noteTerritory() {
    const t = this.terr;
    if (t.changedAll) this.terrCells.add(-1);
    else {
      const W = this.cw.W;
      const cols = Math.ceil(W / CELL);
      for (const i of t.changed) this.terrCells.add(Math.floor(((i / W) | 0) / CELL) * cols + Math.floor((i % W) / CELL));
    }
    t.changed = [];
    t.changedAll = false;
  }

  /** Terrain chunks and settlements at the level of detail the zoom needs, for tile range `view`. */
  drawPixel(g, view, ox, oy, ppt, alpha) {
    const { cw } = this;
    const scale = ppt / TILE;
    const { x0, y0, x1, y1 } = view;
    const cx0 = Math.max(0, Math.floor(x0 / CHUNK));
    const cy0 = Math.max(0, Math.floor(y0 / CHUNK));
    const cx1 = Math.min(this.chunksX - 1, Math.floor((x1 - 1) / CHUNK));
    const cy1 = Math.min(this.chunksY - 1, Math.floor((y1 - 1) / CHUNK));
    const near = this.near(ppt);
    const size = CHUNK * ppt;
    const dscale = scale * this.dpr; // device pixels per art pixel
    g.imageSmoothingQuality = 'low';
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const dx = ox + cx * size;
        const dy = oy + cy * size;
        let pic = null;
        let res = 1; // art pixels per picture pixel
        if (near) {
          // Only what is already painted: requests come from the visible part (requestPictures).
          const c = this.chunks.get(`${cx},${cy}`);
          if (c) {
            c.used = this.frameNo;
            const half = c.half && (dscale <= 0.75 || !c.canvas);
            pic = half ? c.half : c.canvas;
            res = half ? 2 : 1;
          }
        }
        if (!pic) {
          const l = this.low.get(`${cx},${cy}`);
          if (l) {
            pic = l.canvas;
            res = 4;
          }
        }
        if (!pic) {
          if (alpha >= 1) {
            g.imageSmoothingEnabled = false;
            g.drawImage(this.overview, cx * CHUNK, cy * CHUNK, CHUNK, CHUNK, dx, dy, size, size);
          }
          continue;
        }
        // Smooth only when the picture is shrunk on screen; enlarged pixel art stays crisp.
        g.imageSmoothingEnabled = dscale * res < 1;
        g.globalAlpha = alpha;
        g.drawImage(pic, dx, dy, size, size);
        g.globalAlpha = 1;
      }
    }
    // Settlements, sorted so southern ones overlap northern ones.
    if (!cw.snap) return;
    const vis = cw.snap.structures.filter((s) => s.x > x0 - 30 && s.x < x1 + 30 && s.y > y0 - 30 && s.y < y1 + 30).sort((a, b) => a.y - b.y);
    g.globalAlpha = alpha;
    for (const s of vis) {
      const ly = near ? this.layers.get(s.id) : null;
      if (ly) {
        ly.used = this.frameNo;
        const half = ly.half && (dscale <= 0.75 || !ly.canvas);
        g.imageSmoothingEnabled = dscale * (half ? 2 : 1) < 1;
        g.drawImage(half ? ly.half : ly.canvas, ox + ly.px * scale, oy + ly.py * scale, ly.w * scale, ly.h * scale);
      } else {
        const low = this.layersLow.get(s.id);
        if (low) {
          g.imageSmoothingEnabled = dscale * 4 < 1;
          g.drawImage(low.canvas, ox + low.px * scale, oy + low.py * scale, low.w * scale, low.h * scale);
        }
      }
    }
    g.globalAlpha = 1;
  }

  /** Villagers at work in the towns on screen. */
  drawTownLife(ox, oy, ppt) {
    const { cw } = this;
    if (!cw.snap) return;
    const { x0, y0, x1, y1 } = this.view;
    this.ctx.imageSmoothingEnabled = false;
    for (const s of cw.snap.structures) {
      if (s.x < x0 - 12 || s.x > x1 + 12 || s.y < y0 - 12 || s.y > y1 + 12) continue;
      const L = cw.layouts.get(s.id);
      if (!L) continue;
      let plan = this.workerPlans.get(s.id);
      if (!plan || plan.v !== L.v) {
        plan = { v: L.v, list: planWorkers(cw.world, cw.ov, L) };
        this.workerPlans.set(s.id, plan);
      }
      drawWorkers(this.ctx, this.atlas, plan.list, ox, oy, ppt, this.now);
    }
  }

  /** Background work for idle workers: quarter-size pictures of the whole map, nearest first. */
  prefetch() {
    // One at a time, and not while the player is moving the map: phones have few cores to spare.
    if (!this.pool.ok || this.pool.wanted.size || this.pool.flight.size > 1) return;
    if (this.now - (this.moveAt || 0) < 400 || this.now - (this.zoomAt || 0) < 400) return;
    const mcx = this.cam.x / CHUNK;
    const mcy = this.cam.y / CHUNK;
    for (let r = 0; r < Math.max(this.chunksX, this.chunksY); r++) {
      for (let cy = Math.floor(mcy) - r; cy <= Math.floor(mcy) + r; cy++) {
        for (let cx = Math.floor(mcx) - r; cx <= Math.floor(mcx) + r; cx++) {
          if (cx < 0 || cy < 0 || cx >= this.chunksX || cy >= this.chunksY) continue;
          if (Math.max(Math.abs(cx - Math.floor(mcx)), Math.abs(cy - Math.floor(mcy))) !== r) continue;
          const key = `${cx},${cy}`;
          if (this.low.has(key) && !this.cw.lowDirty.has(key)) continue;
          this.lowChunk(cx, cy, 100 + r);
          return;
        }
      }
    }
  }

  /** Territory: the image (fill and rims) over the flat map, a tint and crisp lines over pixel art. */
  drawTerritory(ox, oy, ppt, pixel) {
    const { ctx } = this;
    const r = this.visibleRect(ox, oy, ppt);
    if (!r.w || !r.h) return;
    ctx.imageSmoothingEnabled = false;
    // Close in, the tint and the border lines come as one cached picture.
    if (!(ppt >= LINES && this.drawBorders(ox, oy, ppt))) {
      ctx.globalAlpha = pixel <= 0 ? 1 : ppt < LINES ? 1 - pixel * 0.4 : TINT;
      ctx.drawImage(this.terr.canvas, r.x0, r.y0, r.w, r.h, r.dx, r.dy, r.w * ppt, r.h * ppt);
      ctx.globalAlpha = 1;
    }
    if (this.highlight != null) this.drawHighlight(r, ppt);
  }

  /**
   * Close in: the territory tint and border lines from the cached picture
   * over the map, with the parts where land changed hands redrawn (at most
   * a few times a second). Returns false when there is no such picture.
   */
  drawBorders(ox, oy, ppt) {
    const { ctx } = this;
    const mc = this.mc;
    if (!mc || !mc.lines) return false;
    if (mc.ppt !== ppt) {
      // Zooming: stretch it with the map.
      ctx.drawImage(mc.over, ox + mc.tx0 * ppt, oy + mc.ty0 * ppt, mc.tw * ppt, mc.th * ppt);
      return true;
    }
    if (this.terrCells.size && this.now - mc.overAt > 150) {
      mc.overAt = this.now;
      if (this.terrCells.has(-1)) this.renderOver(mc, { x: mc.tx0, y: mc.ty0, w: mc.tw, h: mc.th });
      else {
        const cols = Math.ceil(this.cw.W / CELL);
        for (const c of this.terrCells) this.renderOver(mc, { x: (c % cols) * CELL - 1, y: Math.floor(c / cols) * CELL - 1, w: CELL + 2, h: CELL + 2 });
      }
      this.terrCells.clear();
    }
    const dpr = this.dpr;
    ctx.drawImage(mc.over, Math.round((ox + mc.tx0 * ppt) * dpr) / dpr, Math.round((oy + mc.ty0 * ppt) * dpr) / dpr, mc.over.width / dpr, mc.over.height / dpr);
    return true;
  }

  /** The chosen target realm, rimmed in pulsing light. */
  drawHighlight(r, ppt) {
    const { ctx } = this;
    ctx.globalAlpha = 0.55 + 0.35 * Math.sin(this.now / 160);
    ctx.drawImage(this.terr.hlCanvas, r.x0, r.y0, r.w, r.h, r.dx, r.dy, r.w * ppt, r.h * ppt);
    ctx.globalAlpha = 1;
  }

  drawStructures(ox, oy, ppt, pixel) {
    const { ctx, cw } = this;
    if (!cw.snap) return;
    ctx.imageSmoothingEnabled = false;
    const k = ppt < 2 ? 1 : 1.5;
    for (const s of cw.snap.structures) {
      const sx = ox + (s.x + 0.5) * ppt;
      const sy = oy + (s.y + 0.5) * ppt;
      if (sx < -30 || sy < -30 || sx > this.vw + 30 || sy > this.vh + 30) continue;
      if (pixel < 1) {
        if (ppt < 1.6 && s.kind !== 'town') continue;
        const m = marker(s.kind, cw.colorOf(s.owner), s.level);
        ctx.globalAlpha = 1 - pixel;
        ctx.drawImage(m.canvas, Math.round(sx - (m.w * k) / 2), Math.round(sy - (m.h * k) / 2), m.w * k, m.h * k);
        ctx.globalAlpha = 1;
      }
      // The garrison, when it is not at full strength.
      if (s.gmax && s.garrison < s.gmax) {
        const w = Math.max(16, Math.min(40, ppt * 2.5));
        const by = sy - Math.max(10, ppt * 2.2);
        ctx.fillStyle = 'rgba(20,14,10,0.8)';
        ctx.fillRect(Math.round(sx - w / 2 - 1), Math.round(by - 1), Math.round(w + 2), 5);
        ctx.fillStyle = s.garrison <= 0 ? '#ff6a4a' : s.garrison < s.gmax * 0.35 ? '#ffb04a' : '#9cdc6a';
        ctx.fillRect(Math.round(sx - w / 2), Math.round(by), Math.round((w * Math.max(0, s.garrison)) / s.gmax), 3);
      }
    }
  }

  /** Interpolated position of a ship between the last two snapshots. */
  lerpBoat(b) {
    const prev = this.cw.prevSnap;
    if (!prev) return b;
    const p = prev.boats.find((q) => q.id === b.id);
    if (!p) return b;
    const t = Math.min(1, (this.now - this.cw.snapAt) / this.cw.snapGap);
    return { x: p.x + (b.x - p.x) * t, y: p.y + (b.y - p.y) * t };
  }

  drawBoats(ox, oy, ppt) {
    const { ctx, cw, atlas } = this;
    if (!cw.snap) return;
    ctx.imageSmoothingEnabled = false;
    const scale = Math.max(1, Math.min(3, ppt / 5));
    for (const b of cw.snap.boats) {
      const pos = this.lerpBoat(b);
      const sx = ox + (pos.x + 0.5) * ppt;
      const sy = oy + (pos.y + 0.5) * ppt;
      if (sx < -40 || sy < -40 || sx > this.vw + 40 || sy > this.vh + 40) continue;
      const color = cw.colorOf(b.owner);
      const e = atlas.get(`s:${b.kind}:${color}`, () => {
        const spr = shipSprite(b.kind, color);
        return { canvas: spr.canvas, w: spr.w, h: spr.h, ax: spr.w / 2, ay: spr.h - 3 };
      });
      atlas.draw(ctx, e, sx, sy, scale, b.dir < 0);
    }
  }

  /** A cached count badge, drawn with its top-left corner at (x, y). */
  badge(n, x, y, color, fighting) {
    const fight = fighting ? (Math.floor(this.now / 200) % 2 ? 1 : 2) : 0;
    const text = fmt(n);
    const dpr = this.dpr;
    const e = this.atlas.get(`b:${text}:${color}:${fight}`, () => badgeSprite(text, color, fight, dpr));
    this.atlas.draw(this.ctx, e, x, y, 1 / dpr);
  }

  /**
   * Far out, squads of one realm close together share one chip with their
   * total. The groups are worked out once per snapshot (in map cells, so
   * they hold still while the map pans); each frame only moves them.
   */
  drawSquadChips(ox, oy, ppt, t, ring) {
    const { ctx, cw, atlas } = this;
    const snap = cw.snap;
    let sel = this.selected.size;
    for (const id of this.selected) sel += id * 7;
    const key = `${snap.tick}:${ppt}:${sel}`;
    let gs = this.chipGroups;
    if (!gs || gs.key !== key) {
      const cell = 22 / ppt; // tiles
      const prevMap = cw.prevSquads;
      const byCell = new Map();
      const list = [];
      for (const q of snap.squads) {
        const p = prevMap?.get(q.id) || q;
        const selected = this.selected.has(q.id);
        const k = selected ? -q.id : (q.owner + 1) * 1e8 + Math.floor(q.y / cell) * 1e4 + Math.floor(q.x / cell);
        let g = byCell.get(k);
        if (!g) {
          byCell.set(k, (g = { owner: q.owner, color: cw.colorOf(q.owner), n: 0, type: q.type, big: 0, fight: false, sel: selected, m: [] }));
          list.push(g);
        }
        g.n += q.n;
        g.m.push(p.x, p.y, q.x, q.y);
        if (q.n > g.big) {
          g.big = q.n;
          g.type = q.type;
        }
        if (q.state === 'fight') g.fight = true;
      }
      list.sort((a, b) => a.m[3] - b.m[3]);
      gs = this.chipGroups = { key, list };
    }
    const k = ppt < 2 ? 1 : 1.25;
    for (const g of gs.list) {
      const m = g.m;
      let x = 0;
      let y = 0;
      for (let j = 0; j < m.length; j += 4) {
        x += m[j] + (m[j + 2] - m[j]) * t;
        y += m[j + 1] + (m[j + 3] - m[j + 1]) * t;
      }
      const c = m.length / 4;
      const sx = ox + (x / c + 0.5) * ppt;
      const sy = oy + (y / c + 0.5) * ppt;
      if (sx < -40 || sy < -40 || sx > this.vw + 40 || sy > this.vh + 40) continue;
      if (g.sel) ring(sx, sy);
      g.chip ||= atlas.get(`c:${g.type}:${g.color}`, () => chip(g.type, g.color));
      const e = g.chip;
      atlas.draw(ctx, e, sx, sy + (e.h * k) / 2, k);
      this.badge(g.n, sx + (e.w * k) / 2 - 2, sy - (e.h * k) / 2 - 4, g.color, g.fight);
    }
  }

  /**
   * Squads: chips far out (squads close together on screen share one, with
   * their total), a small formation of figures closer in. Only squads on
   * screen are touched, and every picture comes from the atlas.
   */
  drawSquads(ox, oy, ppt, now) {
    const { ctx, cw, atlas } = this;
    const snap = cw.snap;
    if (!snap) return;
    ctx.imageSmoothingEnabled = false;
    const t = Math.min(1, (now - cw.snapAt) / cw.snapGap);
    const ring = (sx, sy) => {
      ctx.strokeStyle = '#fff3c4';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(sx, sy + 2, Math.max(9, ppt * 0.9), Math.max(5, ppt * 0.45), 0, 0, Math.PI * 2);
      ctx.stroke();
    };
    if (ppt < 5) {
      this.drawSquadChips(ox, oy, ppt, t, ring);
      return;
    }
    const prevMap = cw.prevSquads;
    const vis = [];
    for (const q of snap.squads) {
      const p = prevMap?.get(q.id);
      const x = p ? p.x + (q.x - p.x) * t : q.x;
      const y = p ? p.y + (q.y - p.y) * t : q.y;
      const sx = ox + (x + 0.5) * ppt;
      const sy = oy + (y + 0.5) * ppt;
      if (sx < -60 || sy < -60 || sx > this.vw + 60 || sy > this.vh + 60) continue;
      vis.push({ q, p, sx, sy });
    }
    vis.sort((a, b) => a.sy - b.sy);
    // Figures are never drawn smaller than this, so armies stay readable from afar.
    const scale = Math.max(0.8, ppt / TILE);
    const step = ppt * Math.max(1, 8 / ppt) * 0.9;
    const tt = now / 1000;
    const dpr = this.dpr;
    // Below 8 px per tile figures have a fixed size: whole squads come as one picture.
    const whole = ppt < 8;
    const phases = { f: Math.floor(tt * 3) % 2, m: Math.floor(tt * 8) % 4, i: Math.floor(tt * 1.2) % 4 };
    for (const v of vis) {
      const { q, p, sx, sy } = v;
      const color = cw.colorOf(q.owner);
      if (this.selected.has(q.id)) ring(sx, sy);
      // Facing follows movement; fighting squads face their last way.
      let face = this.facing.get(q.id) ?? 1;
      if (p && Math.abs(q.x - p.x) > 0.02) face = q.x < p.x ? -1 : 1;
      this.facing.set(q.id, face);
      const nf = Math.max(1, Math.min(q.type === 'trebuchet' ? 3 : 9, Math.ceil(Math.sqrt(q.n))));
      const fighting = q.state === 'fight';
      const moving = q.state === 'moving' || (p && Math.hypot(q.x - p.x, q.y - p.y) > 0.02);
      const state = fighting ? 'f' : moving ? 'm' : 'i';
      if (whole) {
        const phase = phases[state];
        const e = atlas.get(`F:${q.type}:${color}:${nf}:${state}:${phase}:${dpr}`, () => formationSprite(q.type, color, nf, state, phase, scale, step, dpr));
        atlas.draw(ctx, e, sx, sy, 1 / dpr, face < 0);
      } else {
        const spread = (SPREAD[q.type] || 1) * step;
        // Back row first, so nearer figures overlap the ones behind.
        for (const k of ROWS[nf]) {
          const f = FORMATION[k];
          const frame = figureFrame(state, phases[state], k);
          const e = atlas.get(`u:${q.type}:${color}:${frame}`, () => unitSprite(q.type, color, frame));
          atlas.draw(ctx, e, sx + f[0] * face * spread, sy + f[1] * spread, scale, face < 0);
        }
      }
      this.badge(q.n, sx + 8 * scale, sy - 20 * scale, color, fighting);
    }
  }

  /** Where selected squads are heading, the deploy preview and the selection box. */
  drawOrders(ox, oy, ppt, now) {
    const { ctx, cw } = this;
    if (cw.snap && this.selected.size) {
      ctx.strokeStyle = 'rgba(255,243,196,0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -now / 60;
      for (const id of this.selected) {
        const q = cw.squad(id);
        if (!q || !q.dest) continue;
        const pos = cw.squadPos(q, now);
        ctx.beginPath();
        ctx.moveTo(ox + (pos.x + 0.5) * ppt, oy + (pos.y + 0.5) * ppt);
        ctx.lineTo(ox + (q.dest[0] + 0.5) * ppt, oy + (q.dest[1] + 0.5) * ppt);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    const d = this.deploy;
    if (d) {
      const tx = ox + (d.x + 0.5) * ppt;
      const ty = oy + (d.y + 0.5) * ppt;
      if (d.from) {
        ctx.strokeStyle = d.ok ? 'rgba(156,255,138,0.8)' : 'rgba(255,138,122,0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(ox + (d.from.x + 0.5) * ppt, oy + (d.from.y + 0.5) * ppt);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = d.ok ? '#9cff8a' : '#ff8a7a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(tx, ty, 10 + 2 * Math.sin(now / 150), 0, Math.PI * 2);
      ctx.stroke();
    }
    const b = this.box;
    if (b) {
      ctx.fillStyle = 'rgba(255,243,196,0.12)';
      ctx.strokeStyle = 'rgba(255,243,196,0.9)';
      ctx.lineWidth = 2;
      const x = Math.min(b.x0, b.x1);
      const y = Math.min(b.y0, b.y1);
      ctx.fillRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
    }
  }

  /** A realm's name and army, rendered once per text and size. */
  label(p, size) {
    // The army figure changes all the time; the picture is redone at most once a second.
    let shown = this.labelArmy.get(p.id);
    if (!shown || (shown.v !== p.army && this.now - shown.at > 1000)) this.labelArmy.set(p.id, (shown = { v: p.army, at: this.now }));
    const army = `⚔ ${fmt(shown.v)}`;
    const key = `${p.id}:${p.name}:${army}:${size}:${p.traitor ? 1 : 0}`;
    let c = this.labelCache.get(key);
    if (c) return c;
    if (this.labelCache.size > 300) this.labelCache.clear();
    const dpr = this.dpr;
    const font = `700 ${size}px "Pixelify Sans", monospace`;
    const small = Math.max(8, Math.round(size * 0.66));
    const m = this.ctx;
    m.font = font;
    const w1 = m.measureText(p.name).width;
    m.font = `600 ${small}px "Pixelify Sans", monospace`;
    const w2 = m.measureText(army).width;
    const w = Math.ceil(Math.max(w1, w2) + 8);
    const h = Math.ceil(size + small + 8);
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(w * dpr);
    cv.height = Math.ceil(h * dpr);
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.lineJoin = 'round';
    g.lineWidth = Math.max(2, size / 6);
    g.strokeStyle = 'rgba(20,14,10,0.85)';
    g.font = font;
    g.strokeText(p.name, w / 2, 2);
    g.fillStyle = p.traitor ? '#ffb0a0' : '#ffffff';
    g.fillText(p.name, w / 2, 2);
    g.font = `600 ${small}px "Pixelify Sans", monospace`;
    g.strokeText(army, w / 2, size + 4);
    g.fillStyle = '#f0e6c8';
    g.fillText(army, w / 2, size + 4);
    c = { canvas: cv, w, h };
    this.labelCache.set(key, c);
    return c;
  }

  drawLabels(ox, oy, ppt) {
    const { ctx, cw } = this;
    const snap = cw.snap;
    if (!snap) return;
    ctx.imageSmoothingEnabled = true;
    for (const p of snap.players) {
      const spot = snap.labels[p.id];
      if (!spot || !p.alive) continue;
      // Labels glide when their spot moves.
      let pos = this.labelPos.get(p.id);
      if (!pos || Math.hypot(pos.x - spot[0], pos.y - spot[1]) > 60) pos = { x: spot[0], y: spot[1], r: spot[2] };
      pos.x += (spot[0] - pos.x) * 0.08;
      pos.y += (spot[1] - pos.y) * 0.08;
      pos.r += (spot[2] - pos.r) * 0.08;
      this.labelPos.set(p.id, pos);
      // Names are big on the flat map and stay modest over the pixel art.
      const size = Math.round(Math.min(ppt >= 6 ? 20 : 36, pos.r * ppt * 0.5));
      // Close in, town names take over.
      if (size < 9 || ppt >= 12) continue;
      const sx = ox + (pos.x + 0.5) * ppt;
      const sy = oy + (pos.y + 0.5) * ppt;
      if (sx < -200 || sx > this.vw + 200 || sy < -60 || sy > this.vh + 60) continue;
      const l = this.label(p, size);
      ctx.globalAlpha = ppt >= PIXEL ? 0.8 : 1;
      ctx.drawImage(l.canvas, Math.round(sx - l.w / 2), Math.round(sy - l.h / 2), l.w, l.h);
    }
    ctx.globalAlpha = 1;
    // Town names when close in.
    if (ppt < 16) return;
    ctx.imageSmoothingEnabled = false;
    const dpr = this.dpr;
    for (const s of snap.structures) {
      const ly = this.layers.get(s.id);
      const sx = ox + (s.x + 0.5) * ppt;
      const sy = ly ? oy + ly.bounds.y * ppt - 12 : oy + (s.y - 4) * ppt;
      if (sx < -100 || sx > this.vw + 100 || sy < -30 || sy > this.vh + 30) continue;
      const kind = s.kind === 'town' ? ['', 'Hamlet', 'Village', 'Town', 'City'][s.level] : s.kind === 'port' ? 'Port' : 'Outpost';
      const text = `${s.name} · ${kind}`;
      const color = cw.colorOf(s.owner);
      const e = this.atlas.get(`t:${text}:${color}`, () => nameTag(text, color, dpr));
      this.atlas.draw(ctx, e, sx, sy, 1 / dpr);
    }
  }

  drawPreview(ox, oy, ppt) {
    const { ctx } = this;
    if (this.sites) {
      // Suggested starting spots while choosing.
      ctx.fillStyle = 'rgba(255,243,196,0.85)';
      ctx.strokeStyle = '#231a16';
      ctx.lineWidth = 1.5;
      for (const s of this.sites) {
        const sx = ox + (s.x + 0.5) * ppt;
        const sy = oy + (s.y + 0.5) * ppt;
        ctx.beginPath();
        ctx.moveTo(sx, sy - 6);
        ctx.lineTo(sx + 5, sy);
        ctx.lineTo(sx, sy + 6);
        ctx.lineTo(sx - 5, sy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
    const p = this.preview;
    if (!p) return;
    const sx = ox + (p.x + 0.5) * ppt;
    const sy = oy + (p.y + 0.5) * ppt;
    ctx.strokeStyle = p.ok ? '#9cff8a' : '#ff8a7a';
    ctx.lineWidth = 2;
    if (p.radius) {
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(sx, sy, p.radius * ppt, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const r = Math.max(6, ppt * 1.5);
    ctx.strokeRect(Math.round(sx - r), Math.round(sy - r), Math.round(r * 2), Math.round(r * 2));
  }

  drawPings(ox, oy, ppt, now) {
    const { ctx } = this;
    if (!this.pings.length) return;
    this.pings = this.pings.filter((p) => now - p.t0 < 450);
    for (const p of this.pings) {
      const t = (now - p.t0) / 450;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(ox + (p.x + 0.5) * ppt, oy + (p.y + 0.5) * ppt, 6 + t * 22, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Minimap: whole world, territory and the current view. */
  drawMinimap(mini) {
    const { cw } = this;
    const ctx = mini.getContext('2d');
    const w = mini.width;
    const h = mini.height;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.overview, 0, 0, w, h);
    ctx.drawImage(this.terr.canvas, 0, 0, w, h);
    const sx = w / cw.W;
    const sy = h / cw.H;
    ctx.strokeStyle = '#fff3c4';
    ctx.lineWidth = 1.5;
    const v = this.view || { x0: 0, y0: 0, x1: 10, y1: 10 };
    ctx.strokeRect(v.x0 * sx, v.y0 * sy, (v.x1 - v.x0) * sx, (v.y1 - v.y0) * sy);
  }
}
