// Frame composition: camera with smooth zoom, the strategic map (one pixel
// per tile: terrain and territory), the pixel-art view when zoomed in
// (terrain chunks and settlement layers, painted in workers), towns, boats
// and the realms' names.
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
import { Pix } from './pix.js';
import { shade } from './color.js';

export const MIN_PPT = 1;
export const MAX_PPT = 64;
const DETAIL = 8; // pixels per tile where the pixel-art view starts to fade in
const DETAIL_FULL = 11; // ... and is fully opaque
// Scales that leave pixel art crisp: whole pixels per tile, and whole
// multiples or halves of the 16-pixel chunk tiles.
const CRISP = [1, 1.5, 2, 3, 4, 5, 6, 8, 12, 16, 24, 32, 48, 64];
// Cached chunks are 512×512 bitmaps (1 MB each): phones keep fewer.
const MAX_CHUNKS = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 600 ? 40 : 96;
const SEA = '#1f4f8f'; // deep ocean, beyond the map's edge

const ease = (t) => 1 - Math.pow(1 - t, 3);
const fmt = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);

// Structure markers for the strategic map.
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

export class Renderer {
  constructor(canvas, cw) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cw = cw;
    this.cam = { x: cw.W / 2, y: cw.H / 2, ppt: 3 };
    this.anim = null;
    this.chunks = new Map();
    this.layers = new Map();
    this.overview = buildTerrainOverview(cw.world);
    this.terr = new TerritoryImage(cw);
    this.labelCache = new Map();
    this.labelPos = new Map();
    this.pings = [];
    this.preview = null; // { x, y, ok, radius }
    this.highlight = null; // player id outlined on the map
    this.frameNo = 0;
    this.borderCache = null;
    this.pool = new PaintPool(cw.world, (r) => this.painted(r));
    if (typeof document !== 'undefined' && document.fonts) document.fonts.ready.then(() => this.labelCache.clear());
    this.resize();
  }

  /** A worker finished a chunk or settlement layer. */
  painted(r) {
    if (r.key.startsWith('c')) {
      const old = this.chunks.get(r.key.slice(1));
      if (old?.canvas?.close) old.canvas.close();
      this.chunks.set(r.key.slice(1), { canvas: r.bmp, used: this.frameNo, at: this.now || 0 });
      this.evictChunks();
    } else {
      const sid = Number(r.key.slice(1));
      const L = this.cw.layouts.get(sid);
      const old = this.layers.get(sid);
      if (old?.canvas?.close) old.canvas.close();
      if (!L) return;
      this.layers.set(sid, { canvas: r.bmp, px: r.px, py: r.py, v: r.v, color: r.color, bounds: layoutBounds(L) });
    }
  }

  evictChunks() {
    while (this.chunks.size > MAX_CHUNKS) {
      let old = null;
      for (const [k, v] of this.chunks) if (!old || v.used < old[1].used) old = [k, v];
      if (!old) break;
      if (old[1].canvas.close) old[1].canvas.close();
      this.chunks.delete(old[0]);
    }
  }

  /** The overlay data a worker needs to paint chunk (cx, cy), with a margin. */
  chunkJob(cx, cy) {
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
    return { msg: { t: 'chunk', cx, cy, patch }, transfer };
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
    return Math.max(MIN_PPT, Math.min(this.vw / this.cw.W, this.vh / this.cw.H) * 0.9);
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
    const to = this.clampPpt(ppt);
    this.anim = { from: this.cam.ppt, to, sx, sy, t0: performance.now(), dur };
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

  chunk(cx, cy, allowBuild, prio = 0) {
    const key = `${cx},${cy}`;
    let c = this.chunks.get(key);
    const dirty = this.cw.dirtyChunks.has(key);
    if (this.pool.ok) {
      // Ask a worker; meanwhile the old picture (or a placeholder) is shown.
      if ((!c || dirty) && !this.pool.busy(`c${key}`)) {
        this.pool.want(`c${key}`, prio, () => {
          this.cw.dirtyChunks.delete(key);
          return this.chunkJob(cx, cy);
        });
      }
      if (c) c.used = this.frameNo;
      return c;
    }
    if ((!c || dirty) && allowBuild) {
      const canvas = renderChunk(this.cw.world, cx, cy, this.cw.ov);
      c = { canvas, used: this.frameNo, at: this.now };
      this.chunks.set(key, c);
      this.cw.dirtyChunks.delete(key);
      this.evictChunks();
    }
    if (c) c.used = this.frameNo;
    return c;
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
      return ly || null;
    }
    if (stale) {
      if (this.layerBudget <= 0 && ly) return ly;
      this.layerBudget--;
      const r = renderSettlementLayer(this.cw.world, L, { color });
      ly = { ...r, color, v: L.v, bounds: layoutBounds(L) };
      this.layers.set(s.id, ly);
      this.cw.layerDirty.delete(s.id);
    }
    return ly;
  }

  // Frame -------------------------------------------------------------------

  frame(now) {
    this.frameNo++;
    this.now = now;
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
    const detail = ppt < DETAIL ? 0 : Math.min(1, (ppt - DETAIL) / (DETAIL_FULL - DETAIL));
    if (detail < 1) this.drawStrategic(ox, oy, ppt, detail);
    if (ppt >= DETAIL * 0.75) this.drawDetail(ox, oy, ppt, detail);
    this.drawStructures(ox, oy, ppt, detail);
    this.drawBoats(ox, oy, ppt, now);
    this.drawLabels(ox, oy, ppt);
    this.drawPreview(ox, oy, ppt);
    this.drawPings(ox, oy, ppt, now);
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

  drawStrategic(ox, oy, ppt) {
    const { ctx } = this;
    const r = this.visibleRect(ox, oy, ppt);
    if (!r.w || !r.h) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.overview, r.x0, r.y0, r.w, r.h, r.dx, r.dy, r.w * ppt, r.h * ppt);
    ctx.drawImage(this.terr.canvas, r.x0, r.y0, r.w, r.h, r.dx, r.dy, r.w * ppt, r.h * ppt);
    if (this.highlight != null) this.drawOutline(ox, oy, ppt, this.highlight);
  }

  drawDetail(ox, oy, ppt, alpha) {
    const { ctx, cw } = this;
    const scale = ppt / TILE;
    const { x0, y0, x1, y1 } = this.view;
    const cx0 = Math.max(0, Math.floor(x0 / CHUNK));
    const cy0 = Math.max(0, Math.floor(y0 / CHUNK));
    const cx1 = Math.min(Math.ceil(cw.W / CHUNK) - 1, Math.floor(x1 / CHUNK));
    const cy1 = Math.min(Math.ceil(cw.H / CHUNK) - 1, Math.floor(y1 / CHUNK));
    const mcx = this.cam.x / CHUNK;
    const mcy = this.cam.y / CHUNK;
    // Approaching the detail zoom, workers paint the view in advance; nothing is drawn yet.
    if (alpha <= 0) {
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) this.chunk(cx, cy, false, 20 + Math.hypot(cx + 0.5 - mcx, cy + 0.5 - mcy));
      return;
    }
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.imageSmoothingQuality = 'low';
    const t0 = performance.now();
    const size = CHUNK * ppt;
    const order = [];
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) order.push([cx, cy, Math.hypot(cx + 0.5 - mcx, cy + 0.5 - mcy)]);
    order.sort((a, b) => a[2] - b[2]);
    let built = 0;
    for (const [cx, cy, d] of order) {
      const allow = built === 0 || performance.now() - t0 < 10;
      const had = this.chunks.has(`${cx},${cy}`);
      const c = this.chunk(cx, cy, allow, d);
      if (!had && c) built++;
      const dx = ox + cx * size;
      const dy = oy + cy * size;
      if (c) {
        // A freshly painted chunk fades in instead of popping.
        const fade = Math.min(1, (this.now - (c.at || 0)) / 180);
        ctx.globalAlpha = alpha * fade;
        ctx.drawImage(c.canvas, dx, dy, size, size);
        if (fade < 1 && alpha >= 1) {
          ctx.globalAlpha = 1 - fade;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(this.overview, cx * CHUNK, cy * CHUNK, CHUNK, CHUNK, dx, dy, size, size);
          ctx.imageSmoothingEnabled = scale < 1;
        }
      } else if (alpha >= 1) {
        // Placeholder from the overview until the chunk is ready.
        ctx.globalAlpha = 1;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.overview, cx * CHUNK, cy * CHUNK, CHUNK, CHUNK, dx, dy, size, size);
        ctx.imageSmoothingEnabled = scale < 1;
      }
    }
    ctx.globalAlpha = 1;
    this.chunksPending = order.some(([cx, cy]) => !this.chunks.has(`${cx},${cy}`) || cw.dirtyChunks.has(`${cx},${cy}`));
    // Workers paint one ring beyond the view in advance, so panning finds it ready.
    if (this.pool.ok) {
      const nx = Math.ceil(cw.W / CHUNK);
      const ny = Math.ceil(cw.H / CHUNK);
      for (let cy = cy0 - 1; cy <= cy1 + 1; cy++) {
        for (let cx = cx0 - 1; cx <= cx1 + 1; cx++) {
          if (cx < 0 || cy < 0 || cx >= nx || cy >= ny || (cx >= cx0 && cx <= cx1 && cy >= cy0 && cy <= cy1)) continue;
          if (!this.chunks.has(`${cx},${cy}`)) this.chunk(cx, cy, false, 50 + Math.hypot(cx + 0.5 - mcx, cy + 0.5 - mcy));
        }
      }
    }
    // Towns, ports and outposts (sorted so southern ones overlap northern ones).
    this.layerBudget = 2;
    if (cw.snap) {
      const vis = cw.snap.structures.filter((s) => s.x > x0 - 30 && s.x < x1 + 30 && s.y > y0 - 30 && s.y < y1 + 30).sort((a, b) => a.y - b.y);
      ctx.globalAlpha = alpha;
      for (const s of vis) {
        const ly = this.layer(s);
        if (!ly) continue;
        ctx.imageSmoothingEnabled = scale < 1;
        ctx.drawImage(ly.canvas, ox + ly.px * scale, oy + ly.py * scale, ly.canvas.width * scale, ly.canvas.height * scale);
      }
      ctx.globalAlpha = 1;
    }
    // Territory: a light tint and crisp border lines.
    const r = this.visibleRect(ox, oy, ppt);
    if (r.w && r.h) {
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.32 * alpha;
      ctx.drawImage(this.terr.canvas, r.x0, r.y0, r.w, r.h, r.dx, r.dy, r.w * ppt, r.h * ppt);
      ctx.globalAlpha = alpha;
      this.drawBorders(ox, oy, ppt);
      ctx.globalAlpha = 1;
    }
    if (this.highlight != null) this.drawOutline(ox, oy, ppt, this.highlight);
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

  /** A pulsing outline around one player's land (who you are looking at). */
  drawOutline(ox, oy, ppt, pid) {
    const { ctx, cw } = this;
    const { x0, y0, x1, y1 } = this.view;
    const step = ppt < 2 ? 2 : 1;
    const W = cw.W;
    const O = cw.owner;
    ctx.fillStyle = `rgba(255,243,196,${0.55 + 0.35 * Math.sin(this.now / 160)})`;
    const s = Math.max(1, ppt * 0.35);
    for (let y = Math.max(1, y0); y < Math.min(cw.H - 1, y1); y += step) {
      for (let x = Math.max(1, x0); x < Math.min(W - 1, x1); x += step) {
        const i = y * W + x;
        if (O[i] !== pid) continue;
        if (O[i - 1] !== pid || O[i + 1] !== pid || O[i - W] !== pid || O[i + W] !== pid) ctx.fillRect(ox + x * ppt, oy + y * ppt, Math.max(s, ppt * step), Math.max(s, ppt * step));
      }
    }
  }

  drawStructures(ox, oy, ppt, detail) {
    const { ctx, cw } = this;
    if (!cw.snap || detail >= 1) return;
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1 - detail;
    const k = ppt < 2 ? 1 : ppt < 5 ? 1.5 : 2;
    for (const s of cw.snap.structures) {
      const sx = ox + (s.x + 0.5) * ppt;
      const sy = oy + (s.y + 0.5) * ppt;
      if (sx < -20 || sy < -20 || sx > this.vw + 20 || sy > this.vh + 20) continue;
      if (ppt < 1.6 && s.kind !== 'town') continue;
      const m = marker(s.kind, cw.colorOf(s.owner), s.level);
      ctx.drawImage(m.canvas, Math.round(sx - (m.w * k) / 2), Math.round(sy - (m.h * k) / 2), m.w * k, m.h * k);
    }
    ctx.globalAlpha = 1;
  }

  /** Interpolated position of a boat between the last two snapshots. */
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
    const scale = Math.max(1, Math.min(3, ppt / 8));
    for (const b of cw.snap.boats) {
      const pos = this.lerpBoat(b);
      const sx = ox + (pos.x + 0.5) * ppt;
      const sy = oy + (pos.y + 0.5) * ppt;
      if (sx < -40 || sy < -40 || sx > this.vw + 40 || sy > this.vh + 40) continue;
      const color = cw.colorOf(b.owner);
      const spr = shipSprite(b.kind, color);
      const w = spr.w * scale;
      const h = spr.h * scale;
      ctx.save();
      ctx.translate(Math.round(sx), Math.round(sy));
      if (b.dir < 0) ctx.scale(-1, 1);
      ctx.drawImage(spr.canvas, -w / 2, -h + 3 * scale, w, h);
      ctx.restore();
      if (b.kind === 'transport' && b.troops) {
        const text = fmt(b.troops);
        ctx.font = '600 11px "Pixelify Sans", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const tw = ctx.measureText(text).width + 6;
        ctx.fillStyle = 'rgba(35,26,22,0.85)';
        ctx.fillRect(Math.round(sx - tw / 2), Math.round(sy + 4), Math.round(tw), 13);
        ctx.fillStyle = '#fff';
        ctx.fillText(text, sx, sy + 5);
      }
    }
  }

  /** A realm's name and troops, rendered once per text and size. */
  label(p, size) {
    const troops = fmt(p.troops);
    const key = `${p.id}:${p.name}:${troops}:${size}:${p.traitor ? 1 : 0}`;
    let c = this.labelCache.get(key);
    if (c) return c;
    if (this.labelCache.size > 300) this.labelCache.clear();
    const dpr = this.dpr;
    const font = `700 ${size}px "Pixelify Sans", monospace`;
    const small = Math.max(8, Math.round(size * 0.72));
    const m = this.ctx;
    m.font = font;
    const w1 = m.measureText(p.name).width;
    m.font = `600 ${small}px "Pixelify Sans", monospace`;
    const w2 = m.measureText(troops).width;
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
    g.strokeText(troops, w / 2, size + 4);
    g.fillStyle = '#f0e6c8';
    g.fillText(troops, w / 2, size + 4);
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
      // Names are big on the strategic map and stay modest over the pixel-art towns.
      const size = Math.round(Math.min(ppt >= DETAIL ? 22 : 40, pos.r * ppt * 0.55));
      if (size < 9) continue;
      const sx = ox + (pos.x + 0.5) * ppt;
      const sy = oy + (pos.y + 0.5) * ppt;
      if (sx < -200 || sx > this.vw + 200 || sy < -60 || sy > this.vh + 60) continue;
      const l = this.label(p, size);
      ctx.globalAlpha = ppt >= DETAIL ? 0.8 : 1;
      ctx.drawImage(l.canvas, Math.round(sx - l.w / 2), Math.round(sy - l.h / 2), l.w, l.h);
    }
    ctx.globalAlpha = 1;
    // Town names when zoomed in on the pixel-art view.
    if (ppt < 16) return;
    ctx.font = '12px "Pixelify Sans", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const s of snap.structures) {
      if (s.kind !== 'town') continue;
      const ly = this.layers.get(s.id);
      const sx = ox + (s.x + 0.5) * ppt;
      const sy = ly ? oy + ly.bounds.y * ppt - 12 : oy + (s.y - 4) * ppt;
      if (sx < -100 || sx > this.vw + 100 || sy < -30 || sy > this.vh + 30) continue;
      const text = `${s.name} · ${['', 'Hamlet', 'Village', 'Town', 'City'][s.level]}`;
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
