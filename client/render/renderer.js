// Frame composition: camera, terrain chunks (cached, generated progressively),
// settlement layers, deposits, territory, fog of war, units, selection and
// labels. Zoomed out it switches to a one-pixel-per-tile strategic map.

import { renderChunk, CHUNK, TILE } from './ground.js';
import { renderSettlementLayer } from './settlement-layer.js';
import { PaintPool } from './paint-pool.js';
import { layoutBounds } from '../../engine/settlement/planner.js';
import { buildTerrainOverview, buildTerritory, buildFog, DEPOSIT_COLORS } from './overview.js';
import { soldierSprite, wagonSprite, boatSprite } from './decor.js';
import { Pix } from './pix.js';
import { D } from '../../engine/world/biomes.js';

export const ZOOMS = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
const DETAIL = 8; // pixels per tile at which the pixel-art view takes over
// Cached chunks are 512×512 bitmaps (1 MB each): phones keep fewer.
const MAX_CHUNKS = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 600 ? 48 : 96;

const depositCache = new Map();
function depositSprite(type) {
  if (depositCache.has(type)) return depositCache.get(type);
  const p = new Pix(12, 10);
  const c = DEPOSIT_COLORS[type];
  if (type === D.CRYSTAL) {
    for (const [x, h] of [[3, 6], [6, 9], [9, 5]]) for (let j = 0; j < h; j++) {
      p.set(x, 9 - j, j > h - 3 ? '#f4d8ff' : c);
      p.set(x + 1, 10 - j, '#8a3ad8');
    }
  } else if (type === D.HERBS) {
    for (const x of [3, 6, 9]) {
      p.vline(x, 4, 9, '#3f7a2e');
      p.set(x - 1, 4, c);
      p.set(x + 1, 5, c);
      p.set(x, 3, '#c79bff');
    }
  } else if (type === D.FISH) {
    p.ellipse(6, 6, 4, 2, '#cfe6f5');
    p.set(10, 5, '#cfe6f5');
    p.set(10, 7, '#cfe6f5');
    p.set(4, 5, '#2a4a63');
  } else {
    for (const [x, y, w] of [[1, 5, 4], [6, 4, 5], [3, 7, 4]]) {
      p.rect(x, y, w, 3, c);
      p.hline(x, x + w - 1, y, '#ffffff');
    }
    if (type === D.IRON) p.set(7, 5, '#ffb07a');
  }
  p.outline('#231a16');
  const s = { canvas: p.toCanvas(), w: p.w, h: p.h };
  depositCache.set(type, s);
  return s;
}

export class Renderer {
  constructor(canvas, cw) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cw = cw;
    this.cam = { x: cw.W / 2, y: cw.H / 2, ppt: 4 };
    this.chunks = new Map();
    this.layers = new Map();
    this.overview = buildTerrainOverview(cw.world);
    this.terr = null;
    this.fog = null;
    this.hoverTile = null;
    this.selection = null; // { type: 'settlement'|'army', id }
    this.mode = null; // { kind, ... } set by input/UI
    this.preview = null; // { x, y, ok, radius, text }
    this.frameNo = 0;
    this.pendingQueue = [];
    // Pixel painting happens in workers; the frame only draws finished bitmaps.
    this.pool = new PaintPool(cw.world, (r) => this.painted(r));
    this.resize();
  }

  /** A worker finished a chunk or settlement layer. */
  painted(r) {
    if (r.key.startsWith('c')) {
      const old = this.chunks.get(r.key.slice(1));
      if (old?.canvas?.close) old.canvas.close();
      this.chunks.set(r.key.slice(1), { canvas: r.bmp, used: this.frameNo });
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
  }

  // Camera ------------------------------------------------------------------

  screenToTile(sx, sy) {
    return { x: this.cam.x + (sx - this.vw / 2) / this.cam.ppt, y: this.cam.y + (sy - this.vh / 2) / this.cam.ppt };
  }

  tileToScreen(tx, ty) {
    return { x: (tx - this.cam.x) * this.cam.ppt + this.vw / 2, y: (ty - this.cam.y) * this.cam.ppt + this.vh / 2 };
  }

  zoomAt(sx, sy, dir) {
    const i = ZOOMS.indexOf(this.cam.ppt);
    const ni = Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 4 : i) + dir));
    if (ZOOMS[ni] === this.cam.ppt) return;
    const before = this.screenToTile(sx, sy);
    this.cam.ppt = ZOOMS[ni];
    const after = this.screenToTile(sx, sy);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
    this.clampCam();
  }

  setZoom(ppt) {
    this.cam.ppt = ZOOMS.reduce((a, b) => (Math.abs(b - ppt) < Math.abs(a - ppt) ? b : a));
    this.clampCam();
  }

  centerOn(x, y, ppt = null) {
    this.cam.x = x;
    this.cam.y = y;
    if (ppt) this.setZoom(ppt);
    this.clampCam();
  }

  clampCam() {
    this.cam.x = Math.max(0, Math.min(this.cw.W, this.cam.x));
    this.cam.y = Math.max(0, Math.min(this.cw.H, this.cam.y));
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
      c = { canvas, used: this.frameNo };
      this.chunks.set(key, c);
      this.cw.dirtyChunks.delete(key);
      if (this.chunks.size > MAX_CHUNKS) {
        let old = null;
        for (const [k, v] of this.chunks) if (!old || v.used < old[1].used) old = [k, v];
        if (old) this.chunks.delete(old[0]);
      }
    }
    if (c) c.used = this.frameNo;
    return c;
  }

  layer(s) {
    const L = this.cw.layouts.get(s.id);
    if (!L) return null;
    const color = this.cw.colorOf(s.kingdom);
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
    this.pool.begin();
    const { ctx, cw } = this;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d1b2e';
    ctx.fillRect(0, 0, this.vw, this.vh);
    if (cw.territoryDirty || !this.terr) {
      this.terr = buildTerritory(cw);
      cw.territoryDirty = false;
      this.terrStamp = (this.terrStamp || 0) + 1;
    }
    if (cw.fogDirty || !this.fog) {
      this.fog = buildFog(cw);
      cw.fogDirty = false;
    }
    const ppt = this.cam.ppt;
    const tl = this.screenToTile(0, 0);
    const br = this.screenToTile(this.vw, this.vh);
    this.view = { x0: Math.floor(tl.x) - 1, y0: Math.floor(tl.y) - 1, x1: Math.ceil(br.x) + 1, y1: Math.ceil(br.y) + 2 };
    const ox = this.vw / 2 - this.cam.x * ppt;
    const oy = this.vh / 2 - this.cam.y * ppt;
    this.ox = ox;
    this.oy = oy;
    if (ppt >= DETAIL) this.drawDetail(ox, oy, ppt);
    else this.drawStrategic(ox, oy, ppt);
    this.drawUnits(ox, oy, ppt);
    this.drawSelection(ox, oy, ppt);
    // Fog of war over everything in the world (the whole land is surveyed
    // while capitals are being chosen).
    if (!cw.snap || cw.snap.phase !== 'placement') {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.fog, ox, oy, cw.W * ppt, cw.H * ppt);
    }
    this.drawLabels(ox, oy, ppt);
    this.drawPreview(ox, oy, ppt);
    this.pool.pump();
  }

  drawStrategic(ox, oy, ppt) {
    const { ctx, cw } = this;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.overview, ox, oy, cw.W * ppt, cw.H * ppt);
    ctx.globalAlpha = 0.55;
    ctx.drawImage(this.terr.fill, ox, oy, cw.W * ppt, cw.H * ppt);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.terr.border, ox, oy, cw.W * ppt, cw.H * ppt);
    // Roads and settlement footprints.
    const { x0, y0, x1, y1 } = this.view;
    if (ppt >= 3) {
      ctx.fillStyle = '#7a5a36';
      const road = cw.ov.road;
      for (let y = Math.max(0, y0); y < Math.min(cw.H, y1); y++) {
        for (let x = Math.max(0, x0); x < Math.min(cw.W, x1); x++) {
          if (road[y * cw.W + x]) ctx.fillRect(ox + x * ppt + ppt * 0.25, oy + y * ppt + ppt * 0.25, ppt * 0.5, ppt * 0.5);
        }
      }
    }
    if (cw.snap) {
      for (const s of cw.snap.settlements) {
        const p = { x: ox + (s.x + 0.5) * ppt, y: oy + (s.y + 0.5) * ppt };
        const r = Math.max(3, (2 + s.stage) * ppt * 0.45);
        ctx.fillStyle = '#231a16';
        ctx.fillRect(Math.round(p.x - r - 1), Math.round(p.y - r - 1), Math.round(r * 2 + 2), Math.round(r * 2 + 2));
        ctx.fillStyle = cw.colorOf(s.kingdom);
        ctx.fillRect(Math.round(p.x - r), Math.round(p.y - r), Math.round(r * 2), Math.round(r * 2));
        if (s.capital || s.hub) {
          ctx.fillStyle = '#f6efdc';
          ctx.fillRect(Math.round(p.x - r * 0.4), Math.round(p.y - r * 0.4), Math.round(r * 0.8), Math.round(r * 0.8));
        }
      }
    }
    // Known deposits as coloured dots.
    if (ppt >= 4) this.drawDepositDots(ox, oy, ppt);
  }

  drawDepositDots(ox, oy, ppt) {
    const { ctx, cw } = this;
    const { x0, y0, x1, y1 } = this.view;
    const dep = cw.world.deposit;
    for (let y = Math.max(0, y0); y < Math.min(cw.H, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(cw.W, x1); x++) {
        const i = y * cw.W + x;
        if (!dep[i] || !cw.explored[i]) continue;
        ctx.fillStyle = DEPOSIT_COLORS[dep[i]];
        ctx.fillRect(ox + x * ppt + ppt * 0.2, oy + y * ppt + ppt * 0.2, ppt * 0.6, ppt * 0.6);
      }
    }
  }

  drawDetail(ox, oy, ppt) {
    const { ctx, cw } = this;
    const scale = ppt / TILE;
    ctx.imageSmoothingEnabled = scale < 1;
    // Downscaled chunks (zoomed out) only need a cheap filter; 'high' costs a lot per frame.
    ctx.imageSmoothingQuality = 'low';
    const { x0, y0, x1, y1 } = this.view;
    const cx0 = Math.max(0, Math.floor(x0 / CHUNK));
    const cy0 = Math.max(0, Math.floor(y0 / CHUNK));
    const cx1 = Math.min(Math.ceil(cw.W / CHUNK) - 1, Math.floor(x1 / CHUNK));
    const cy1 = Math.min(Math.ceil(cw.H / CHUNK) - 1, Math.floor(y1 / CHUNK));
    const t0 = performance.now();
    let built = 0;
    // Build visible chunks nearest the centre first, within a time budget.
    const order = [];
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) order.push([cx, cy]);
    const mcx = this.cam.x / CHUNK;
    const mcy = this.cam.y / CHUNK;
    order.sort((a, b) => Math.hypot(a[0] + 0.5 - mcx, a[1] + 0.5 - mcy) - Math.hypot(b[0] + 0.5 - mcx, b[1] + 0.5 - mcy));
    const size = CHUNK * ppt;
    for (const [cx, cy] of order) {
      const allow = built === 0 || performance.now() - t0 < 14;
      const had = this.chunks.has(`${cx},${cy}`);
      const wasDirty = cw.dirtyChunks.has(`${cx},${cy}`);
      const c = this.chunk(cx, cy, allow, Math.hypot(cx + 0.5 - mcx, cy + 0.5 - mcy));
      if ((!had || wasDirty) && c && allow) built++;
      const dx = Math.round(ox + cx * size);
      const dy = Math.round(oy + cy * size);
      if (c) ctx.drawImage(c.canvas, dx, dy, Math.ceil(size), Math.ceil(size));
      else {
        // Placeholder from the overview until the chunk is ready.
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.overview, cx * CHUNK, cy * CHUNK, CHUNK, CHUNK, dx, dy, Math.ceil(size), Math.ceil(size));
        ctx.imageSmoothingEnabled = scale < 1;
      }
    }
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
    // Deposits the kingdom knows about.
    const dep = cw.world.deposit;
    for (let y = Math.max(0, y0); y < Math.min(cw.H, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(cw.W, x1); x++) {
        const i = y * cw.W + x;
        if (!dep[i] || !cw.explored[i] || cw.ov.cleared[i]) continue;
        const spr = depositSprite(dep[i]);
        ctx.drawImage(spr.canvas, ox + (x * TILE + 2) * scale, oy + (y * TILE + 4) * scale, spr.w * scale, spr.h * scale);
      }
    }
    // Territory tint and borders.
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.14;
    ctx.drawImage(this.terr.fill, ox, oy, cw.W * ppt, cw.H * ppt);
    ctx.globalAlpha = 1;
    this.drawBorders(ox, oy, ppt);
    // Settlements (sorted so southern towns overlap northern ones).
    this.layerBudget = 2;
    if (cw.snap) {
      const vis = cw.snap.settlements.filter((s) => s.x > x0 - 30 && s.x < x1 + 30 && s.y > y0 - 30 && s.y < y1 + 30).sort((a, b) => a.y - b.y);
      for (const s of vis) {
        const ly = this.layer(s);
        if (!ly) continue;
        ctx.imageSmoothingEnabled = scale < 1;
        ctx.drawImage(ly.canvas, Math.round(ox + ly.px * scale), Math.round(oy + ly.py * scale), Math.round(ly.canvas.width * scale), Math.round(ly.canvas.height * scale));
      }
    }
  }

  /**
   * Territory borders as one cached path per kingdom colour, in tile units,
   * rebuilt only when territory or zoom changes: a handful of fills per frame.
   */
  borderPaths(ppt) {
    const { cw } = this;
    const key = `${cw.snap?.territoryV ?? 0}:${this.terrStamp}:${ppt}`;
    if (this.borders?.key === key) return this.borders.paths;
    const K = cw.ownerK;
    const W = cw.W;
    const lw = Math.max(1, Math.round(ppt / 20));
    const t = (lw * 2) / ppt; // stroke width in tiles
    const paths = new Map();
    const path = (k) => {
      const c = cw.colorOf(k);
      if (!paths.has(c)) paths.set(c, new Path2D());
      return paths.get(c);
    };
    for (let y = 0; y < cw.H - 1; y++) {
      for (let x = 0; x < W - 1; x++) {
        const i = y * W + x;
        const k = K[i];
        const kr = K[i + 1];
        const kd = K[i + W];
        if (k !== kr) {
          if (k >= 0 || k === -2) path(k).rect(x + 1 - t, y, t, 1);
          if (kr >= 0 || kr === -2) path(kr).rect(x + 1, y, t, 1);
        }
        if (k !== kd) {
          if (k >= 0 || k === -2) path(k).rect(x, y + 1 - t, 1, t);
          if (kd >= 0 || kd === -2) path(kd).rect(x, y + 1, 1, t);
        }
      }
    }
    this.borders = { key, paths };
    return paths;
  }

  drawBorders(ox, oy, ppt) {
    const { ctx } = this;
    const paths = this.borderPaths(ppt);
    const dpr = this.dpr;
    ctx.save();
    ctx.setTransform(dpr * ppt, 0, 0, dpr * ppt, dpr * ox, dpr * oy);
    ctx.globalAlpha = 0.85;
    for (const [color, path] of paths) {
      ctx.fillStyle = color;
      ctx.fill(path);
    }
    ctx.restore();
  }

  /** Interpolated position of a moving entity between the last two snapshots. */
  lerpPos(kind, e) {
    const prev = this.cw.prevSnap;
    if (!prev) return e;
    const list = kind === 'army' ? prev.armies : prev.parties;
    const p = list.find((q) => q.id === e.id);
    if (!p) return e;
    const dt = Math.min(1, (this.now - this.cw.snapAt) / 500);
    return { x: p.x + (e.x - p.x) * dt, y: p.y + (e.y - p.y) * dt };
  }

  drawUnits(ox, oy, ppt) {
    const { ctx, cw } = this;
    if (!cw.snap) return;
    const scale = Math.max(0.5, ppt / TILE);
    const frame = Math.floor(this.now / 300) % 2;
    ctx.imageSmoothingEnabled = false;
    for (const p of cw.snap.parties) {
      const pos = this.lerpPos('party', p);
      const sx = ox + (pos.x + 0.5) * ppt;
      const sy = oy + (pos.y + 0.5) * ppt;
      if (sx < -40 || sy < -40 || sx > this.vw + 40 || sy > this.vh + 40) continue;
      const color = cw.colorOf(p.kid);
      if (ppt < DETAIL) {
        ctx.fillStyle = '#231a16';
        ctx.fillRect(sx - 2, sy - 2, 4, 4);
        ctx.fillStyle = color;
        ctx.fillRect(sx - 1, sy - 1, 2, 2);
        continue;
      }
      const spr = p.sea ? boatSprite(1) : wagonSprite(p.kind === 'caravan' ? 'caravan' : p.kind, color, frame);
      ctx.drawImage(spr.canvas, Math.round(sx - (spr.w * scale) / 2), Math.round(sy - spr.h * scale + 4 * scale), spr.w * scale, spr.h * scale);
    }
    for (const a of cw.snap.armies) {
      const pos = this.lerpPos('army', a);
      const sx = ox + (pos.x + 0.5) * ppt;
      const sy = oy + (pos.y + 0.5) * ppt;
      if (sx < -60 || sy < -60 || sx > this.vw + 60 || sy > this.vh + 60) continue;
      const color = cw.colorOf(a.kid);
      if (ppt < DETAIL) {
        const r = Math.max(3, Math.min(9, 2 + Math.sqrt(a.n)));
        ctx.fillStyle = '#231a16';
        ctx.beginPath();
        ctx.arc(sx, sy, r + 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      // A small formation: up to five figures reflecting the composition.
      const comp = a.units || { inf: a.n };
      const figs = [];
      const order = ['cav', 'inf', 'arch', 'militia', 'siege'];
      const n = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(a.n))));
      const tot = Math.max(1, Object.values(comp).reduce((x, y) => x + y, 0));
      for (const u of order) {
        const k = Math.round(((comp[u] || 0) / tot) * n);
        for (let j = 0; j < k && figs.length < n; j++) figs.push(u);
      }
      if (!figs.length) figs.push('inf');
      const offsets = [[0, 0], [-6, 3], [6, 3], [-3, -4], [3, -4]];
      const placed = figs.map((u, k) => ({ u, dx: offsets[k][0], dy: offsets[k][1] })).sort((p, q) => p.dy - q.dy);
      for (const f of placed) {
        const spr = soldierSprite(f.u, color, (frame + f.dx) & 1);
        ctx.drawImage(spr.canvas, Math.round(sx + f.dx * scale - (spr.w * scale) / 2), Math.round(sy + f.dy * scale - spr.h * scale + 4 * scale), spr.w * scale, spr.h * scale);
      }
      // Banner with the strength.
      const label = String(Math.round(a.n));
      ctx.font = `${Math.max(10, Math.round(9 * scale))}px "Pixelify Sans", monospace`;
      const tw = ctx.measureText(label).width + 6;
      const by = sy - 22 * scale;
      ctx.fillStyle = '#231a16';
      ctx.fillRect(Math.round(sx - tw / 2 - 1), Math.round(by - 1), Math.round(tw + 2), Math.round(12 * Math.max(1, scale * 0.9)) + 2);
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(sx - tw / 2), Math.round(by), Math.round(tw), Math.round(12 * Math.max(1, scale * 0.9)));
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(label, sx, by + 1);
      if (a.state === 'battle' || a.state === 'siege') {
        ctx.fillStyle = (Math.floor(this.now / 200) % 2) ? '#ffe08a' : '#ff6a3a';
        ctx.fillRect(Math.round(sx + tw / 2 + 2), Math.round(by + 2), 4, 4);
      }
    }
  }

  drawSelection(ox, oy, ppt) {
    const { ctx, cw } = this;
    const sel = this.selection;
    if (!sel || !cw.snap) return;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff3c4';
    ctx.setLineDash([6, 4]);
    if (sel.type === 'settlement') {
      const s = cw.settlement(sel.id);
      if (s) {
        const r = (3 + s.stage * 1.5) * ppt;
        ctx.beginPath();
        ctx.arc(ox + (s.x + 0.5) * ppt, oy + (s.y + 0.5) * ppt, Math.max(8, r), 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (sel.type === 'army') {
      const a = cw.army(sel.id);
      if (a) {
        const pos = this.lerpPos('army', a);
        ctx.beginPath();
        ctx.arc(ox + (pos.x + 0.5) * ppt, oy + (pos.y + 0.5) * ppt, Math.max(10, ppt * 0.9), 0, Math.PI * 2);
        ctx.stroke();
        if (a.dest) {
          ctx.strokeStyle = 'rgba(255,243,196,0.8)';
          ctx.beginPath();
          ctx.moveTo(ox + (pos.x + 0.5) * ppt, oy + (pos.y + 0.5) * ppt);
          ctx.lineTo(ox + (a.dest.x + 0.5) * ppt, oy + (a.dest.y + 0.5) * ppt);
          ctx.stroke();
        }
      }
    }
    ctx.setLineDash([]);
  }

  drawLabels(ox, oy, ppt) {
    const { ctx, cw } = this;
    if (!cw.snap) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const s of cw.snap.settlements) {
      if (ppt < 4 && !s.capital && !s.hub && s.stage < 3) continue;
      const sx = ox + (s.x + 0.5) * ppt;
      let sy = oy + (s.y + 0.5) * ppt;
      if (ppt >= DETAIL) {
        const ly = this.layers.get(s.id);
        sy = ly ? oy + ly.bounds.y * ppt - 14 : sy - 4 * ppt;
      } else sy -= Math.max(10, (2 + s.stage) * ppt * 0.6) + 8;
      if (sx < -100 || sx > this.vw + 100 || sy < -30 || sy > this.vh + 30) continue;
      const size = s.capital || s.hub ? 14 : 12;
      ctx.font = `${size}px "Pixelify Sans", monospace`;
      const name = s.name;
      const w = ctx.measureText(name).width + 14;
      ctx.fillStyle = 'rgba(35,26,22,0.82)';
      ctx.fillRect(Math.round(sx - w / 2), Math.round(sy - size / 2 - 3), Math.round(w), size + 6);
      ctx.fillStyle = cw.colorOf(s.kingdom);
      ctx.fillRect(Math.round(sx - w / 2), Math.round(sy - size / 2 - 3), 4, size + 6);
      ctx.fillStyle = s.siege ? '#ffb0a0' : '#f6efdc';
      ctx.fillText(name, sx + 2, sy + 1);
      if (ppt >= 6) {
        ctx.font = '10px "Pixelify Sans", monospace';
        ctx.fillStyle = '#e8dcc0';
        const stage = cw.init.stages[s.stage] || '';
        const sub = s.hub ? 'Free city' : `${stage} · ${Math.round(s.pop)}`;
        const sw = ctx.measureText(sub).width + 8;
        ctx.fillStyle = 'rgba(35,26,22,0.7)';
        ctx.fillRect(Math.round(sx - sw / 2), Math.round(sy + size / 2 + 3), Math.round(sw), 13);
        ctx.fillStyle = '#e8dcc0';
        ctx.fillText(sub, sx, sy + size / 2 + 10);
      }
    }
  }

  drawPreview(ox, oy, ppt) {
    const { ctx } = this;
    const p = this.preview;
    if (!p) return;
    const sx = ox + (p.x + 0.5) * ppt;
    const sy = oy + (p.y + 0.5) * ppt;
    ctx.strokeStyle = p.ok ? '#9cff8a' : '#ff8a7a';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    if (p.radius) {
      ctx.beginPath();
      ctx.arc(sx, sy, p.radius * ppt, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeRect(ox + p.x * ppt, oy + p.y * ppt, ppt, ppt);
    if (p.line) {
      ctx.strokeStyle = 'rgba(255,243,196,0.8)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(ox + (p.line.x + 0.5) * ppt, oy + (p.line.y + 0.5) * ppt);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /** Minimap: whole world, territory, fog and the current view. */
  drawMinimap(mini) {
    const { cw } = this;
    const ctx = mini.getContext('2d');
    const w = mini.width;
    const h = mini.height;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.overview, 0, 0, w, h);
    if (this.terr) {
      ctx.globalAlpha = 0.6;
      ctx.drawImage(this.terr.fill, 0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.drawImage(this.terr.border, 0, 0, w, h);
    }
    if (this.fog) ctx.drawImage(this.fog, 0, 0, w, h);
    const sx = w / cw.W;
    const sy = h / cw.H;
    ctx.strokeStyle = '#fff3c4';
    ctx.lineWidth = 1.5;
    const v = this.view || { x0: 0, y0: 0, x1: 10, y1: 10 };
    ctx.strokeRect(v.x0 * sx, v.y0 * sy, (v.x1 - v.x0) * sx, (v.y1 - v.y0) * sy);
  }
}
