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
import { layoutBounds } from '../../engine/settlement/planner.js';
import { buildTerrainOverview } from './overview.js';
import { shipSprite } from './decor.js';
import { unitSprite, unitIcon } from './people.js';
import { planWorkers, drawWorkers } from './workers.js';
import { Pix, makeCanvas } from './pix.js';
import { shade, rgb } from './color.js';

export const MIN_PPT = 1;
export const MAX_PPT = 64;
const PIXEL = 2.5; // pixels per tile where pixel art starts to fade in over the flat map
const PIXEL_FULL = 3.5; // ... and covers it
const LINES = 8; // crisp border lines from here (below, the territory image's rims)
// Scales that leave pixel art crisp.
const CRISP = [1, 1.5, 2, 3, 4, 5, 6, 8, 12, 16, 24, 32, 48, 64];
const SMALL_SCREEN = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 600;
// Full and half-size chunks are 1 MB + 256 KB each: phones keep fewer.
const MAX_CHUNKS = SMALL_SCREEN ? 36 : 90;
const MAX_LAYERS = SMALL_SCREEN ? 24 : 60;
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
const chips = new Map();
function chip(type, color) {
  const key = `${type}:${color}`;
  let c = chips.get(key);
  if (c) return c;
  const icon = unitIcon(type);
  const cv = makeCanvas(icon.w + 4, icon.h + 4);
  const g = cv.getContext('2d');
  g.fillStyle = '#231a16';
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = color;
  g.fillRect(1, 1, cv.width - 2, cv.height - 2);
  g.drawImage(icon.canvas, 2, 2);
  c = { canvas: cv, w: cv.width, h: cv.height };
  chips.set(key, c);
  return c;
}

// Where the figures of a squad stand, relative to its centre (tiles).
const FORMATION = [[0, 0], [-0.42, 0.22], [0.42, 0.22], [-0.21, -0.25], [0.21, -0.25], [0, 0.46], [-0.63, -0.05], [0.63, -0.05], [0, -0.5]];

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
    this.labelPos = new Map();
    this.facing = new Map();
    this.pings = [];
    this.preview = null; // { x, y, ok, radius }
    this.highlight = null; // player id outlined on the map
    this.selected = new Set(); // own squad ids
    this.box = null; // selection rectangle in screen coordinates
    this.deploy = null; // { x, y, ok, from: {x, y}, type, n }
    this.frameNo = 0;
    this.borderCache = null;
    this.pool = new PaintPool(cw.world, (r) => this.painted(r));
    this.chunksX = Math.ceil(cw.W / CHUNK);
    this.chunksY = Math.ceil(cw.H / CHUNK);
    if (typeof document !== 'undefined' && document.fonts) document.fonts.ready.then(() => this.labelCache.clear());
    this.resize();
  }

  /** A worker finished a chunk or settlement layer. */
  painted(r) {
    if (r.key.startsWith('c') || r.key.startsWith('q')) {
      const key = r.key.slice(1);
      const oldLow = this.low.get(key);
      if (oldLow?.canvas?.close) oldLow.canvas.close();
      this.low.set(key, { canvas: r.low, at: this.now || 0 });
      if (!r.bmp) return;
      const old = this.chunks.get(key);
      if (old?.canvas?.close) old.canvas.close();
      if (old?.half?.close) old.half.close();
      this.chunks.set(key, { canvas: r.bmp, half: r.half, used: this.frameNo, at: this.now || 0 });
      this.evict(this.chunks, MAX_CHUNKS);
    } else {
      const sid = Number(r.key.slice(1));
      const L = this.cw.layouts.get(sid);
      const old = this.layers.get(sid);
      if (old?.canvas?.close) old.canvas.close();
      const oldLow = this.layersLow.get(sid);
      if (oldLow?.canvas?.close) oldLow.canvas.close();
      if (!L) return;
      const ly = { canvas: r.bmp, px: r.px, py: r.py, v: r.v, color: r.color, bounds: layoutBounds(L), used: this.frameNo };
      this.layers.set(sid, ly);
      this.layersLow.set(sid, { canvas: r.low, px: r.px, py: r.py, w: r.bmp.width, h: r.bmp.height, v: r.v, color: r.color });
      this.evict(this.layers, MAX_LAYERS);
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
  chunkJob(cx, cy, lowOnly = false) {
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
    return { msg: { t: 'chunk', cx, cy, patch, lowOnly }, transfer };
  }

  destroy() {
    this.pool.destroy();
  }

  resize() {
    // Pixel art gains nothing above 2x, and phones at 3x pay for it in frame time.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.vw = w;
    this.vh = h;
    this.labelCache.clear();
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

  /** A chunk's full/half pictures, asking a worker for them when missing. */
  chunk(cx, cy, prio = 0) {
    const key = `${cx},${cy}`;
    let c = this.chunks.get(key);
    const dirty = this.cw.dirtyChunks.has(key);
    if (this.pool.ok) {
      if ((!c || dirty) && !this.pool.busy(`c${key}`)) {
        this.pool.want(`c${key}`, prio, () => {
          // The full picture comes with a fresh quarter-size one.
          this.cw.dirtyChunks.delete(key);
          this.cw.lowDirty.delete(key);
          return this.chunkJob(cx, cy);
        });
      }
    } else if (!c || dirty) {
      // No workers: paint here, a few per frame.
      if (this.mainBudget <= 0) return c;
      this.mainBudget--;
      const canvas = renderChunk(this.cw.world, cx, cy, this.cw.ov);
      c = { canvas, used: this.frameNo, at: this.now };
      this.chunks.set(key, c);
      this.cw.dirtyChunks.delete(key);
      this.evict(this.chunks, MAX_CHUNKS);
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

  layer(s) {
    const L = this.cw.layouts.get(s.id);
    if (!L) return null;
    const color = this.cw.colorOf(s.owner);
    let ly = this.layers.get(s.id);
    const stale = !ly || ly.v !== L.v || ly.color !== color || this.cw.layerDirty.has(s.id);
    if (stale && this.pool.ok) {
      if (!this.pool.busy(`s${s.id}`)) {
        const d = Math.hypot(s.x - this.cam.x, s.y - this.cam.y) / CHUNK;
        this.pool.want(`s${s.id}`, d - 0.5, () => {
          this.cw.layerDirty.delete(s.id);
          return { msg: { t: 'layer', L, color, v: L.v } };
        });
      }
    } else if (stale && this.mainBudget > 0) {
      this.mainBudget--;
      const r = renderSettlementLayer(this.cw.world, L, { color });
      ly = { ...r, color, v: L.v, bounds: layoutBounds(L) };
      this.layers.set(s.id, ly);
      this.cw.layerDirty.delete(s.id);
    }
    if (ly) ly.used = this.frameNo;
    return ly;
  }

  // Frame -------------------------------------------------------------------

  frame(now) {
    this.frameNo++;
    this.now = now;
    this.mainBudget = 2;
    this.stepFly(now);
    this.stepAnim(now);
    this.pool.begin();
    const { ctx } = this;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = SEA;
    ctx.fillRect(0, 0, this.vw, this.vh);
    this.terr.update();
    const ppt = this.cam.ppt;
    const tl = this.screenToTile(0, 0);
    const br = this.screenToTile(this.vw, this.vh);
    this.view = { x0: Math.floor(tl.x) - 1, y0: Math.floor(tl.y) - 1, x1: Math.ceil(br.x) + 1, y1: Math.ceil(br.y) + 1 };
    // Whole device pixels for the map origin keep tiles from shimmering while panning.
    const ox = Math.round((this.vw / 2 - this.cam.x * ppt) * dpr) / dpr;
    const oy = Math.round((this.vh / 2 - this.cam.y * ppt) * dpr) / dpr;
    this.ox = ox;
    this.oy = oy;
    const pixel = ppt < PIXEL ? 0 : Math.min(1, (ppt - PIXEL) / (PIXEL_FULL - PIXEL));
    if (pixel < 1) this.drawFlat(ox, oy, ppt);
    if (pixel > 0) this.drawPixel(ox, oy, ppt, pixel);
    this.drawTerritory(ox, oy, ppt, pixel);
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

  /** Source and destination rectangles for the visible part of a 1-pixel-per-tile image. */
  visibleRect(ox, oy, ppt) {
    const { cw } = this;
    const x0 = Math.max(0, this.view.x0);
    const y0 = Math.max(0, this.view.y0);
    const x1 = Math.min(cw.W, this.view.x1);
    const y1 = Math.min(cw.H, this.view.y1);
    return { x0, y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0), dx: ox + x0 * ppt, dy: oy + y0 * ppt };
  }

  drawFlat(ox, oy, ppt) {
    const r = this.visibleRect(ox, oy, ppt);
    if (!r.w || !r.h) return;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.overview, r.x0, r.y0, r.w, r.h, r.dx, r.dy, r.w * ppt, r.h * ppt);
  }

  /** Terrain chunks and settlements at the level of detail the zoom needs. */
  drawPixel(ox, oy, ppt, alpha) {
    const { ctx, cw } = this;
    const scale = ppt / TILE;
    const { x0, y0, x1, y1 } = this.view;
    const cx0 = Math.max(0, Math.floor(x0 / CHUNK));
    const cy0 = Math.max(0, Math.floor(y0 / CHUNK));
    const cx1 = Math.min(this.chunksX - 1, Math.floor(x1 / CHUNK));
    const cy1 = Math.min(this.chunksY - 1, Math.floor(y1 / CHUNK));
    const mcx = this.cam.x / CHUNK;
    const mcy = this.cam.y / CHUNK;
    const near = ppt >= 6; // full or half pictures; below that, quarter size
    const size = CHUNK * ppt;
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.imageSmoothingQuality = 'low';
    let missing = false;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const d = Math.hypot(cx + 0.5 - mcx, cy + 0.5 - mcy);
        const dx = ox + cx * size;
        const dy = oy + cy * size;
        let pic = null;
        let at = 0;
        if (near) {
          const c = this.chunk(cx, cy, d);
          if (c) {
            pic = scale < 0.75 && c.half ? c.half : c.canvas;
            at = c.at;
          }
        }
        if (!pic) {
          const l = this.lowChunk(cx, cy, near ? 5 + d : d);
          if (l) {
            pic = l.canvas;
            at = l.at;
          }
        }
        if (!pic) {
          missing = true;
          if (alpha >= 1) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(this.overview, cx * CHUNK, cy * CHUNK, CHUNK, CHUNK, dx, dy, size, size);
            ctx.imageSmoothingEnabled = scale < 1;
          }
          continue;
        }
        // A freshly painted picture fades in instead of popping.
        const fade = Math.min(1, (this.now - at) / 180);
        if (fade < 1 && alpha >= 1) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(this.overview, cx * CHUNK, cy * CHUNK, CHUNK, CHUNK, dx, dy, size, size);
          ctx.imageSmoothingEnabled = scale < 1;
        }
        ctx.globalAlpha = alpha * fade;
        ctx.drawImage(pic, dx, dy, size, size);
        ctx.globalAlpha = 1;
      }
    }
    this.chunksPending = missing;
    // Settlements, sorted so southern ones overlap northern ones.
    if (!cw.snap) return;
    const vis = cw.snap.structures.filter((s) => s.x > x0 - 30 && s.x < x1 + 30 && s.y > y0 - 30 && s.y < y1 + 30).sort((a, b) => a.y - b.y);
    ctx.globalAlpha = alpha;
    for (const s of vis) {
      const ly = near ? this.layer(s) : null;
      if (ly) {
        ctx.drawImage(ly.canvas, ox + ly.px * scale, oy + ly.py * scale, ly.canvas.width * scale, ly.canvas.height * scale);
      } else {
        const low = this.layersLow.get(s.id);
        if (!low || low.v !== cw.layouts.get(s.id)?.v || low.color !== cw.colorOf(s.owner)) this.layer(s);
        if (low) ctx.drawImage(low.canvas, ox + low.px * scale, oy + low.py * scale, low.w * scale, low.h * scale);
      }
      // Villagers at work, close enough to see them.
      if (ppt >= 6) this.drawTownLife(s, ox, oy, ppt);
    }
    ctx.globalAlpha = 1;
  }

  drawTownLife(s, ox, oy, ppt) {
    const L = this.cw.layouts.get(s.id);
    if (!L) return;
    let plan = this.workerPlans.get(s.id);
    if (!plan || plan.v !== L.v) {
      plan = { v: L.v, list: planWorkers(this.cw.world, this.cw.ov, L) };
      this.workerPlans.set(s.id, plan);
    }
    this.ctx.imageSmoothingEnabled = false;
    drawWorkers(this.ctx, plan.list, ox, oy, ppt, this.now);
  }

  /** Background work for idle workers: quarter-size pictures of the whole map, nearest first. */
  prefetch() {
    if (!this.pool.ok || this.pool.wanted.size > 2) return;
    const mcx = this.cam.x / CHUNK;
    const mcy = this.cam.y / CHUNK;
    let n = 0;
    for (let r = 0; r < Math.max(this.chunksX, this.chunksY) && n < 2; r++) {
      for (let cy = Math.floor(mcy) - r; cy <= Math.floor(mcy) + r && n < 2; cy++) {
        for (let cx = Math.floor(mcx) - r; cx <= Math.floor(mcx) + r && n < 2; cx++) {
          if (cx < 0 || cy < 0 || cx >= this.chunksX || cy >= this.chunksY) continue;
          if (Math.max(Math.abs(cx - Math.floor(mcx)), Math.abs(cy - Math.floor(mcy))) !== r) continue;
          const key = `${cx},${cy}`;
          if (this.low.has(key) && !this.cw.lowDirty.has(key)) continue;
          this.lowChunk(cx, cy, 100 + r);
          n++;
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
    const alpha = pixel <= 0 ? 1 : ppt < LINES ? 1 - pixel * 0.4 : 0.3;
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.terr.canvas, r.x0, r.y0, r.w, r.h, r.dx, r.dy, r.w * ppt, r.h * ppt);
    ctx.globalAlpha = 1;
    if (ppt >= LINES) this.drawBorders(ox, oy, ppt);
    if (this.highlight != null) this.drawHighlight(r, ppt);
  }

  /**
   * Border lines of the visible tiles, one path per colour, rebuilt when the
   * territory or the visible tile range changes.
   */
  borderPaths(ppt) {
    const { cw } = this;
    const { x0, y0, x1, y1 } = this.view;
    const key = `${this.terr.v}:${x0}:${y0}:${x1}:${y1}:${Math.round(ppt * 4)}`;
    if (this.borderCache?.key === key) return this.borderCache.paths;
    const O = cw.owner;
    const W = cw.W;
    const t = Math.max(1.5, ppt / 10) / ppt; // line width in tiles
    const paths = new Map();
    const path = (o) => {
      const c = o === cw.you ? '#fff3c4' : shade(cw.colorOf(o), -0.15);
      if (!paths.has(c)) paths.set(c, new Path2D());
      return paths.get(c);
    };
    for (let y = Math.max(0, y0); y < Math.min(cw.H - 1, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(W - 1, x1); x++) {
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
    this.borderCache = { key, paths };
    return paths;
  }

  drawBorders(ox, oy, ppt) {
    const { ctx } = this;
    const paths = this.borderPaths(ppt);
    const dpr = this.dpr;
    ctx.save();
    ctx.setTransform(dpr * ppt, 0, 0, dpr * ppt, dpr * ox, dpr * oy);
    for (const [color, path] of paths) {
      ctx.fillStyle = color;
      ctx.fill(path);
    }
    ctx.restore();
  }

  /** The chosen target realm, rimmed in pulsing light (an image rebuilt twice a second at most). */
  drawHighlight(r, ppt) {
    const { cw } = this;
    const pid = this.highlight;
    const h = this.hl;
    if (!h || h.pid !== pid || (h.v !== this.terr.v && this.now - h.at > 500)) {
      const cv = h?.canvas || makeCanvas(cw.W, cw.H);
      const g = cv.getContext('2d');
      const img = g.createImageData(cw.W, cw.H);
      const d = img.data;
      const O = cw.owner;
      const W = cw.W;
      for (let i = W; i < O.length - W; i++) {
        if (O[i] !== pid) continue;
        if (O[i - 1] === pid && O[i + 1] === pid && O[i - W] === pid && O[i + W] === pid) continue;
        d[i * 4] = 255;
        d[i * 4 + 1] = 243;
        d[i * 4 + 2] = 196;
        d[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      this.hl = { pid, v: this.terr.v, at: this.now, canvas: cv };
    }
    const { ctx } = this;
    ctx.globalAlpha = 0.55 + 0.35 * Math.sin(this.now / 160);
    ctx.drawImage(this.hl.canvas, r.x0, r.y0, r.w, r.h, r.dx, r.dy, r.w * ppt, r.h * ppt);
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
    const { ctx, cw } = this;
    if (!cw.snap) return;
    ctx.imageSmoothingEnabled = false;
    const scale = Math.max(1, Math.min(3, ppt / 5));
    for (const b of cw.snap.boats) {
      const pos = this.lerpBoat(b);
      const sx = ox + (pos.x + 0.5) * ppt;
      const sy = oy + (pos.y + 0.5) * ppt;
      if (sx < -40 || sy < -40 || sx > this.vw + 40 || sy > this.vh + 40) continue;
      const spr = shipSprite(b.kind, cw.colorOf(b.owner));
      const w = spr.w * scale;
      const h = spr.h * scale;
      ctx.save();
      ctx.translate(Math.round(sx), Math.round(sy));
      if (b.dir < 0) ctx.scale(-1, 1);
      ctx.drawImage(spr.canvas, -w / 2, -h + 3 * scale, w, h);
      ctx.restore();
    }
  }

  /** Squads: a chip on the flat map, a small formation of figures closer in. */
  drawSquads(ox, oy, ppt, now) {
    const { ctx, cw } = this;
    if (!cw.snap) return;
    ctx.imageSmoothingEnabled = false;
    const list = [...cw.snap.squads].sort((a, b) => a.y - b.y);
    const figures = ppt >= 5;
    // Figures are never drawn smaller than this, so armies stay readable from afar.
    const scale = Math.max(0.8, ppt / TILE);
    for (const q of list) {
      const pos = cw.squadPos(q, now);
      const sx = ox + (pos.x + 0.5) * ppt;
      const sy = oy + (pos.y + 0.5) * ppt;
      if (sx < -60 || sy < -60 || sx > this.vw + 60 || sy > this.vh + 60) continue;
      const color = cw.colorOf(q.owner);
      const sel = this.selected.has(q.id);
      // Facing follows movement; fighting squads face their last way.
      const prev = cw.prevSquads?.get(q.id);
      let face = this.facing.get(q.id) ?? 1;
      if (prev && Math.abs(q.x - prev.x) > 0.02) face = q.x < prev.x ? -1 : 1;
      this.facing.set(q.id, face);
      if (sel) {
        ctx.strokeStyle = '#fff3c4';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(sx, sy + 2, Math.max(9, ppt * 0.9), Math.max(5, ppt * 0.45), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (!figures) {
        const c = chip(q.type, color);
        const k = ppt < 2 ? 1 : 1.25;
        ctx.drawImage(c.canvas, Math.round(sx - (c.w * k) / 2), Math.round(sy - (c.h * k) / 2), c.w * k, c.h * k);
        this.badge(q, sx + (c.w * k) / 2 - 2, sy - (c.h * k) / 2 - 4, color);
        continue;
      }
      const nf = Math.max(1, Math.min(q.type === 'trebuchet' ? 3 : 9, Math.ceil(Math.sqrt(q.n))));
      const spread = q.type === 'rider' || q.type === 'knight' ? 1.3 : q.type === 'trebuchet' ? 1.8 : 1;
      const t = now / 1000;
      const fighting = q.state === 'fight';
      const moving = q.state === 'moving' || (prev && Math.hypot(q.x - prev.x, q.y - prev.y) > 0.02);
      const order = FORMATION.slice(0, nf).map((f, k) => [f[0] * face, f[1], k]).sort((a, b) => a[1] - b[1]);
      for (const [fx, fy, k] of order) {
        const frame = fighting ? 4 + (Math.floor(t * 3 + k * 0.7) % 2) : moving ? Math.floor(t * 8 + k * 1.3) % 4 : (Math.floor(t * 1.2 + k) % 4 === 0 ? 1 : 0);
        const spr = unitSprite(q.type, color, frame);
        const px = sx + fx * spread * ppt * Math.max(1, 8 / ppt) * 0.9;
        const py = sy + fy * spread * ppt * Math.max(1, 8 / ppt) * 0.9;
        const dw = spr.w * scale;
        const dh = spr.h * scale;
        if (face < 0) {
          ctx.save();
          ctx.translate(Math.round(px), Math.round(py));
          ctx.scale(-1, 1);
          ctx.drawImage(spr.canvas, -spr.ax * scale, -spr.ay * scale, dw, dh);
          ctx.restore();
        } else ctx.drawImage(spr.canvas, Math.round(px - spr.ax * scale), Math.round(py - spr.ay * scale), dw, dh);
      }
      this.badge(q, sx + 8 * scale, sy - 20 * scale, color);
    }
  }

  /** The soldier count over a squad. */
  badge(q, x, y, color) {
    const { ctx } = this;
    const text = fmt(q.n);
    ctx.font = '600 10px "Pixelify Sans", monospace';
    const tw = Math.ceil(ctx.measureText(text).width) + 6;
    ctx.fillStyle = '#231a16';
    ctx.fillRect(Math.round(x - 1), Math.round(y - 1), tw + 2, 13);
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), tw, 11);
    const [r, g, b] = rgb(color);
    ctx.fillStyle = r * 0.3 + g * 0.55 + b * 0.15 > 150 ? '#231a16' : '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(text, Math.round(x + 3), Math.round(y));
    if (q.state === 'fight') {
      ctx.fillStyle = Math.floor(this.now / 200) % 2 ? '#ffe08a' : '#ff6a3a';
      ctx.fillRect(Math.round(x + tw + 3), Math.round(y + 3), 4, 4);
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
    const army = `⚔ ${fmt(p.army)}`;
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
    ctx.font = '12px "Pixelify Sans", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const s of snap.structures) {
      const ly = this.layers.get(s.id);
      const sx = ox + (s.x + 0.5) * ppt;
      const sy = ly ? oy + ly.bounds.y * ppt - 12 : oy + (s.y - 4) * ppt;
      if (sx < -100 || sx > this.vw + 100 || sy < -30 || sy > this.vh + 30) continue;
      const kind = s.kind === 'town' ? ['', 'Hamlet', 'Village', 'Town', 'City'][s.level] : s.kind === 'port' ? 'Port' : 'Outpost';
      const text = `${s.name} · ${kind}`;
      const w = ctx.measureText(text).width + 12;
      ctx.fillStyle = 'rgba(35,26,22,0.8)';
      ctx.fillRect(Math.round(sx - w / 2), Math.round(sy - 9), Math.round(w), 18);
      ctx.fillStyle = cw.colorOf(s.owner);
      ctx.fillRect(Math.round(sx - w / 2), Math.round(sy - 9), 3, 18);
      ctx.fillStyle = '#f6efdc';
      ctx.fillText(text, sx + 1, sy + 1);
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
