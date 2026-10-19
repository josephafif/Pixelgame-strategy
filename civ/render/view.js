// The map view: terrain and towns from painted chunk pictures (full, half
// or quarter size by zoom, painted off the main thread), realm colours and
// borders, trade routes, armies, battles, labels and the selection.

import { PaintPool } from '../../client/render/paint-pool.js';
import { buildTerrainOverview } from '../../client/render/overview.js';
import { makeCanvas } from '../../client/render/pix.js';
import { rgb } from '../../client/render/color.js';
import { CHUNK } from '../../client/render/ground.js';
import { armySprite, shipSprite, cartSprite, walkerSprite } from './life.js';

const TS = 4; // territory canvas pixels per tile
const MAX_FULL = 36;
const MAX_HALF = 90;

export class View {
  constructor(canvas, mirror) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d', { alpha: false });
    this.m = mirror;
    const { W, H } = mirror;
    this.W = W;
    this.H = H;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cx = W / 2;
    this.cy = H / 2;
    this.ppt = 2;
    this.mode = 'political';
    this.pics = new Map();
    this.pool = new PaintPool(mirror.world, (r) => this.onPic(r), { url: new URL('./paint-worker.js', import.meta.url) });
    this.overview = buildTerrainOverview(mirror.world);
    this.fill = makeCanvas(W * TS, H * TS);
    this.lines = makeCanvas(W * TS, H * TS);
    this.selTown = 0;
    this.selCiv = 0;
    this.selArmy = 0;
    this.labels = new Map();
    this.labelCache = new Map();
    this.centroids = new Map();
    this.centroidAt = 0;
    this.pings = [];
    this.anim = null;
    this.preview = null;
    this.lastFrame = 0;
    this.lastInput = 0;
    this.resize();
    this.fitWorld();
  }

  destroy() {
    this.pool.destroy();
    for (const p of this.pics.values()) closePic(p);
    this.pics.clear();
  }

  // -------------------------------------------------------------------------
  // Camera

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.vw = Math.max(1, r.width);
    this.vh = Math.max(1, r.height);
    this.canvas.width = Math.round(this.vw * this.dpr);
    this.canvas.height = Math.round(this.vh * this.dpr);
  }

  fitWorld() {
    this.ppt = Math.max(0.8, Math.min(this.vw / this.W, this.vh / this.H) * 1.05);
    this.cx = this.W / 2;
    this.cy = this.H / 2;
  }

  minPpt() {
    return Math.max(0.5, Math.min(this.vw / this.W, this.vh / this.H) * 0.8);
  }

  screenToTile(sx, sy) {
    return [this.cx + (sx - this.vw / 2) / this.ppt, this.cy + (sy - this.vh / 2) / this.ppt];
  }

  tileToScreen(tx, ty) {
    return [(tx - this.cx) * this.ppt + this.vw / 2, (ty - this.cy) * this.ppt + this.vh / 2];
  }

  zoomAt(f, sx = this.vw / 2, sy = this.vh / 2) {
    const [tx, ty] = this.screenToTile(sx, sy);
    this.ppt = Math.max(this.minPpt(), Math.min(48, this.ppt * f));
    this.cx = tx - (sx - this.vw / 2) / this.ppt;
    this.cy = ty - (sy - this.vh / 2) / this.ppt;
    this.anim = null;
    this.clamp();
  }

  pan(dx, dy) {
    this.cx -= dx / this.ppt;
    this.cy -= dy / this.ppt;
    this.anim = null;
    this.clamp();
  }

  clamp() {
    this.cx = Math.max(0, Math.min(this.W, this.cx));
    this.cy = Math.max(0, Math.min(this.H, this.cy));
  }

  flyTo(x, y, ppt = null) {
    this.anim = { t0: performance.now(), dur: 700, fx: this.cx, fy: this.cy, fp: this.ppt, tx: x + 0.5, ty: y + 0.5, tp: ppt ?? Math.max(this.ppt, 10) };
  }

  stepAnim(now) {
    const a = this.anim;
    if (!a) return;
    const k = Math.min(1, (now - a.t0) / a.dur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    // Zoom out a little on long flights, like a camera would.
    const far = Math.hypot(a.tx - a.fx, a.ty - a.fy);
    const lp = Math.log(a.fp) + (Math.log(a.tp) - Math.log(a.fp)) * e - Math.sin(Math.PI * e) * Math.min(1.2, far / 120);
    this.ppt = Math.max(this.minPpt(), Math.exp(lp));
    this.cx = a.fx + (a.tx - a.fx) * e;
    this.cy = a.fy + (a.ty - a.fy) * e;
    if (k >= 1) this.anim = null;
  }

  ping(x, y, kind) {
    this.pings.push({ x, y, kind, t: performance.now() });
  }

  // -------------------------------------------------------------------------
  // Chunk pictures

  level() {
    const d = this.ppt * this.dpr;
    return d >= 11 ? 'full' : d >= 5.5 ? 'half' : 'low';
  }

  onPic(r) {
    let p = this.pics.get(r.key);
    if (!p) this.pics.set(r.key, (p = { full: null, half: null, low: null, vf: -1, vh: -1, vl: -1, used: 0 }));
    if (r.bmp) {
      if (p.full) p.full.close?.();
      p.full = r.bmp;
      p.vf = r.ver;
    }
    if (r.half) {
      if (p.half) p.half.close?.();
      p.half = r.half;
      p.vh = r.ver;
    }
    if (r.low) {
      if (p.low) p.low.close?.();
      p.low = r.low;
      p.vl = r.ver;
    }
  }

  want(k, level, prio, now) {
    const p = this.pics.get(k);
    const ver = this.m.chunkVer[k];
    const have = p ? (level === 'full' ? p.vf : level === 'half' ? p.vh : p.vl) : -1;
    if (have === ver) return;
    // Repaint changed chunks only now and then (towns change all the time).
    if (have >= 0 && p.asked && now - p.asked < (level === 'full' ? 1200 : 2500)) return;
    const full = level === 'full';
    this.pool.want(k, prio, () => {
      const job = this.m.chunkJob(k);
      let q = this.pics.get(k);
      if (!q) this.pics.set(k, (q = { full: null, half: null, low: null, vf: -1, vh: -1, vl: -1, used: 0 }));
      q.asked = performance.now();
      return { msg: { t: 'chunk', ...job, full, half: full || level === 'half', ver: this.m.chunkVer[k] } };
    });
  }

  evict() {
    const fulls = [];
    const halves = [];
    for (const [k, p] of this.pics) {
      if (p.full) fulls.push([k, p]);
      if (p.half) halves.push([k, p]);
    }
    if (fulls.length > MAX_FULL) {
      fulls.sort((a, b) => a[1].used - b[1].used);
      for (const [, p] of fulls.slice(0, fulls.length - MAX_FULL)) {
        p.full.close?.();
        p.full = null;
        p.vf = -1;
      }
    }
    if (halves.length > MAX_HALF) {
      halves.sort((a, b) => a[1].used - b[1].used);
      for (const [, p] of halves.slice(0, halves.length - MAX_HALF)) {
        p.half.close?.();
        p.half = null;
        p.vh = -1;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Territory

  updateTerritory() {
    const m = this.m;
    if (m.ownerAll) {
      m.ownerAll = false;
      m.ownerList.length = 0;
      this.paintTerritory(0, 0, this.W, this.H);
      this.centroidAt = 0;
      return;
    }
    if (!m.ownerList.length) return;
    let x0 = this.W;
    let y0 = this.H;
    let x1 = 0;
    let y1 = 0;
    for (const i of m.ownerList) {
      const x = i % this.W;
      const y = (i / this.W) | 0;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    m.ownerList.length = 0;
    this.paintTerritory(Math.max(0, x0 - 1), Math.max(0, y0 - 1), Math.min(this.W, x1 + 2), Math.min(this.H, y1 + 2));
  }

  /** Repaint the territory fill and border pictures for tiles [x0, x1) × [y0, y1). */
  paintTerritory(x0, y0, x1, y1) {
    const m = this.m;
    const W = this.W;
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    const fctx = this.fill.getContext('2d');
    const lctx = this.lines.getContext('2d');
    const fi = fctx.createImageData(w * TS, h * TS);
    const li = lctx.createImageData(w * TS, h * TS);
    const f32 = new Uint32Array(fi.data.buffer);
    const l32 = new Uint32Array(li.data.buffer);
    const religion = this.mode === 'religion';
    const keyAt = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= this.H) return 0;
      const i = y * W + x;
      if (religion) {
        const o = m.owner[i];
        const t = o && m.towns.get(o);
        return t ? t.religion || 0 : 0;
      }
      return m.civAt(i);
    };
    const cache = new Map();
    const colorOf = (k) => {
      let c = cache.get(k);
      if (!c) {
        const hex = religion ? m.faiths[k]?.color || '#cccccc' : m.colorOf(k);
        const [r, g, b] = rgb(hex);
        c = { fill: ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0, line: ((255 << 24) | ((b * 0.55) << 16) | ((g * 0.55) << 8) | (r * 0.55)) >>> 0, lite: ((255 << 24) | (Math.min(255, b * 0.6 + 100) << 16) | (Math.min(255, g * 0.6 + 100) << 8) | Math.min(255, r * 0.6 + 100)) >>> 0 };
        cache.set(k, c);
      }
      return c;
    };
    const RW = w * TS;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const k = keyAt(x, y);
        if (!k) continue;
        const c = colorOf(k);
        const n = keyAt(x, y - 1) !== k;
        const s = keyAt(x, y + 1) !== k;
        const e = keyAt(x + 1, y) !== k;
        const ww = keyAt(x - 1, y) !== k;
        const bx = (x - x0) * TS;
        const by = (y - y0) * TS;
        for (let py = 0; py < TS; py++) {
          for (let px = 0; px < TS; px++) {
            const o = (by + py) * RW + bx + px;
            f32[o] = c.fill;
            const edge = (py === 0 && n) || (py === TS - 1 && s) || (px === 0 && ww) || (px === TS - 1 && e);
            const inner = (py === 1 && n) || (py === TS - 2 && s) || (px === 1 && ww) || (px === TS - 2 && e);
            if (edge) l32[o] = c.line;
            else if (inner) l32[o] = c.lite;
          }
        }
      }
    }
    fctx.putImageData(fi, x0 * TS, y0 * TS);
    lctx.putImageData(li, x0 * TS, y0 * TS);
  }

  setMode(mode) {
    this.mode = mode;
    this.m.ownerAll = true;
  }

  // -------------------------------------------------------------------------
  // Drawing

  frame(now) {
    const g = this.g;
    const dpr = this.dpr;
    this.stepAnim(now);
    this.updateTerritory();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#2c5a72';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    const ppt = this.ppt;
    const [vx0, vy0] = this.screenToTile(0, 0);
    const [vx1, vy1] = this.screenToTile(this.vw, this.vh);
    // Terrain overview underneath everything.
    const [ox, oy] = this.tileToScreen(0, 0);
    g.drawImage(this.overview, ox, oy, this.W * ppt, this.H * ppt);
    // Chunk pictures.
    this.pool.begin();
    const level = this.level();
    const kx0 = Math.max(0, Math.floor(vx0 / CHUNK));
    const ky0 = Math.max(0, Math.floor(vy0 / CHUNK));
    const kx1 = Math.min(this.m.chunksX - 1, Math.floor(vx1 / CHUNK));
    const ky1 = Math.min(this.m.chunksY - 1, Math.floor(vy1 / CHUNK));
    const cxm = (vx0 + vx1) / 2;
    const cym = (vy0 + vy1) / 2;
    if (ppt * dpr >= 1.4) {
      g.imageSmoothingEnabled = ppt * dpr < 3.5;
      for (let ky = ky0; ky <= ky1; ky++) {
        for (let kx = kx0; kx <= kx1; kx++) {
          const k = ky * this.m.chunksX + kx;
          const p = this.pics.get(k);
          const prio = Math.hypot(kx * CHUNK + CHUNK / 2 - cxm, ky * CHUNK + CHUNK / 2 - cym);
          this.want(k, level, prio, now);
          if (!p) continue;
          p.used = now;
          const img = level === 'full' ? p.full || p.half || p.low : level === 'half' ? p.half || p.full || p.low : p.low || p.half || p.full;
          if (!img) continue;
          const [sx, sy] = this.tileToScreen(kx * CHUNK, ky * CHUNK);
          const size = CHUNK * ppt;
          g.drawImage(img, Math.floor(sx), Math.floor(sy), Math.ceil(size + (sx - Math.floor(sx))), Math.ceil(size + (sy - Math.floor(sy))));
        }
      }
      g.imageSmoothingEnabled = false;
      // Pre-paint the ring round the view at low size, for quick panning.
      if (level !== 'low') {
        for (let ky = Math.max(0, ky0 - 1); ky <= Math.min(this.m.chunksY - 1, ky1 + 1); ky++) {
          for (let kx = Math.max(0, kx0 - 1); kx <= Math.min(this.m.chunksX - 1, kx1 + 1); kx++) {
            if (kx >= kx0 && kx <= kx1 && ky >= ky0 && ky <= ky1) continue;
            const k = ky * this.m.chunksX + kx;
            if (!this.pics.get(k)?.low) this.want(k, 'low', 1000 + Math.hypot(kx * CHUNK - cxm, ky * CHUNK - cym), now);
          }
        }
      }
    }
    this.pool.pump();
    if (((now / 1000) | 0) % 3 === 0) this.evict();
    // Realm colours and borders.
    if (this.mode !== 'terrain') {
      const fillA = ppt < 3 ? 0.42 : ppt < 8 ? 0.26 : 0.1;
      g.globalAlpha = fillA;
      g.drawImage(this.fill, ox, oy, this.W * ppt, this.H * ppt);
      if (ppt < 6) {
        g.globalAlpha = ppt < 3 ? 0.9 : 0.75;
        g.drawImage(this.lines, ox, oy, this.W * ppt, this.H * ppt);
        g.globalAlpha = 1;
      } else this.drawBorders(g, vx0, vy0, vx1, vy1);
    }
    if (this.mode === 'trade' || (this.selCiv && ppt >= 3 && false)) this.drawRoutes(g, now);
    if (ppt >= 5) this.drawTraffic(g, now, vx0, vy0, vx1, vy1);
    this.drawArmies(g, now, vx0, vy0, vx1, vy1);
    this.drawBattles(g, now);
    this.drawSelection(g, now);
    this.drawLabels(g, now, vx0, vy0, vx1, vy1);
    this.drawPings(g, now);
    if (this.preview) this.drawPreview(g, now);
  }

  /** Close up: borders as thin lines along tile edges, in each realm's colour. */
  drawBorders(g, vx0, vy0, vx1, vy1) {
    const m = this.m;
    const W = this.W;
    const x0 = Math.max(0, Math.floor(vx0));
    const y0 = Math.max(0, Math.floor(vy0));
    const x1 = Math.min(W - 1, Math.ceil(vx1));
    const y1 = Math.min(this.H - 1, Math.ceil(vy1));
    const religion = this.mode === 'religion';
    const keyAt = (i) => {
      if (!religion) return m.civAt(i);
      const o = m.owner[i];
      const t = o && m.towns.get(o);
      return t ? t.religion || 0 : 0;
    };
    const paths = new Map();
    const seg = (k, ax, ay, bx, by) => {
      if (!k) return;
      let p = paths.get(k);
      if (!p) paths.set(k, (p = []));
      p.push(ax, ay, bx, by);
    };
    const ppt = this.ppt;
    const ins = Math.min(2.5, ppt * 0.12) / ppt; // inset each side's line into its own land
    let row = new Int32Array(x1 - x0 + 2);
    let next = new Int32Array(x1 - x0 + 2);
    for (let x = x0; x <= x1 + 1 && x < W; x++) row[x - x0] = keyAt(y0 * W + x);
    for (let y = y0; y <= y1; y++) {
      if (y + 1 < this.H) for (let x = x0; x <= x1 + 1 && x < W; x++) next[x - x0] = keyAt((y + 1) * W + x);
      for (let x = x0; x <= x1; x++) {
        const a = row[x - x0];
        const r = x + 1 < W ? row[x + 1 - x0] : 0;
        const b = y + 1 < this.H ? next[x - x0] : 0;
        if (a !== r) {
          seg(a, x + 1 - ins, y, x + 1 - ins, y + 1);
          seg(r, x + 1 + ins, y, x + 1 + ins, y + 1);
        }
        if (a !== b) {
          seg(a, x, y + 1 - ins, x + 1, y + 1 - ins);
          seg(b, x, y + 1 + ins, x + 1, y + 1 + ins);
        }
      }
      const t = row;
      row = next;
      next = t;
    }
    g.lineWidth = Math.max(1.5, Math.min(3, ppt * 0.14));
    g.lineCap = 'round';
    for (const [k, p] of paths) {
      const color = religion ? m.faiths[k]?.color || '#ccc' : m.colorOf(k);
      g.strokeStyle = color;
      g.globalAlpha = 0.85;
      g.beginPath();
      for (let i = 0; i < p.length; i += 4) {
        const [ax, ay] = this.tileToScreen(p[i], p[i + 1]);
        const [bx, by] = this.tileToScreen(p[i + 2], p[i + 3]);
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  drawRoutes(g, now) {
    const m = this.m;
    const ppt = this.ppt;
    g.lineWidth = Math.max(1, Math.min(3, ppt * 0.25));
    g.setLineDash([Math.max(2, ppt * 0.5), Math.max(2, ppt * 0.5)]);
    g.lineDashOffset = -(now / 60) % 100;
    for (const r of m.routes) {
      g.strokeStyle = r.sea ? 'rgba(220,240,255,0.7)' : 'rgba(255,230,160,0.75)';
      g.beginPath();
      const p = r.path;
      for (let k = 0; k < p.length; k += Math.max(1, Math.floor(2 / ppt))) {
        const [sx, sy] = this.tileToScreen((p[k] % this.W) + 0.5, ((p[k] / this.W) | 0) + 0.5);
        if (k === 0) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
      }
      g.stroke();
    }
    g.setLineDash([]);
  }

  /** Carts on the roads and ships on the sea routes. */
  drawTraffic(g, now, vx0, vy0, vx1, vy1) {
    const m = this.m;
    const ppt = this.ppt;
    const k = ppt / 16;
    const W = this.W;
    let n = 0;
    for (let ri = 0; ri < m.routes.length && n < 160; ri++) {
      const r = m.routes[ri];
      const p = r.path;
      if (p.length < 3) continue;
      const a = m.towns.get(r.a);
      const civ = a ? m.civs.get(a.civ) : null;
      const era = civ ? civ.era : 0;
      if (era < 1 && !r.sea) continue;
      const per = r.sea ? 30 : 14;
      const count = Math.max(1, Math.floor(p.length / per));
      for (let j = 0; j < count; j++) {
        const speed = r.sea ? 0.0016 : 0.0009;
        let f = ((now * speed + j / count + ri * 0.37) % 1) * (p.length - 1);
        const back = (ri + j) % 2 === 1;
        if (back) f = p.length - 1 - f;
        const i0 = Math.floor(f);
        const i1 = Math.min(p.length - 1, i0 + 1);
        const t = f - i0;
        const x = (p[i0] % W) * (1 - t) + (p[i1] % W) * t + 0.5;
        const y = ((p[i0] / W) | 0) * (1 - t) + ((p[i1] / W) | 0) * t + 0.5;
        if (x < vx0 - 1 || y < vy0 - 1 || x > vx1 + 1 || y > vy1 + 1) continue;
        const dx = (p[i1] % W) - (p[i0] % W);
        const flip = back ? dx > 0 : dx < 0;
        const spr = r.sea ? shipSprite(era, civ ? civ.color : '#ccc') : cartSprite(era);
        const [sx, sy] = this.tileToScreen(x, y);
        drawSprite(g, spr, sx, sy, k, flip);
        n++;
      }
    }
    // People about the town centres when close.
    if (ppt >= 14) {
      for (const t of m.towns.values()) {
        if (!t.alive || t.x < vx0 - 2 || t.y < vy0 - 2 || t.x > vx1 + 2 || t.y > vy1 + 2) continue;
        const civ = m.civs.get(t.civ);
        const folk = Math.min(10, 2 + Math.floor(Math.sqrt(t.urban) / 6));
        for (let j = 0; j < folk; j++) {
          const seed = t.id * 31 + j * 7;
          const ang = (seed * 2.3) % (Math.PI * 2);
          const rad = 0.6 + ((seed * 13) % 17) / 6;
          const ph = (now / (2600 + (seed % 7) * 300) + j * 0.31) % 1;
          const tri = ph < 0.5 ? ph * 2 : 2 - ph * 2;
          const x = t.x + 0.5 + Math.cos(ang) * rad * (tri - 0.5) * 2;
          const y = t.y + 0.5 + Math.sin(ang) * rad * 0.6 * (tri - 0.5) * 2;
          const [sx, sy] = this.tileToScreen(x, y);
          const frame = Math.floor(now / 160 + j) % 2;
          drawSprite(g, walkerSprite(civ ? civ.era : 0, seed, frame), sx, sy, k, ph >= 0.5 ? Math.cos(ang) > 0 : Math.cos(ang) < 0);
        }
      }
    }
  }

  drawArmies(g, now, vx0, vy0, vx1, vy1) {
    const m = this.m;
    const ppt = this.ppt;
    for (const a of m.armies) {
      const [id, civ, x, y, size, mode, era] = a;
      if (x < vx0 - 2 || y < vy0 - 2 || x > vx1 + 2 || y > vy1 + 2) continue;
      const c = m.civs.get(civ);
      if (!c) continue;
      const [sx, sy] = this.tileToScreen(x + 0.5, y + 0.5);
      const ti = Math.round(y) * this.W + Math.round(x);
      const water = m.world.biome[ti] <= 2;
      const scale = Math.max(0.6, Math.min(2.2, ppt / 9));
      if (water) drawSprite(g, shipSprite(era, c.color), sx, sy + 3 * scale, scale * 1.2, false);
      else drawSprite(g, armySprite(era, c.color, Math.floor(now / 220 + id) % 2, mode === 'siege'), sx, sy, scale, false);
      // Strength badge.
      const label = size >= 1000 ? `${(size / 1000).toFixed(size >= 10000 ? 0 : 1)}k` : `${size}`;
      const tag = this.tag(label, c.color, 10);
      g.drawImage(tag, Math.round(sx - tag.width / 4), Math.round(sy + 4 * scale), tag.width / 2, tag.height / 2);
      if (this.selArmy === id) {
        g.strokeStyle = '#fff3c4';
        g.lineWidth = 2;
        g.beginPath();
        g.ellipse(sx, sy, 10 * scale, 5 * scale, 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }

  drawBattles(g, now) {
    const ppt = this.ppt;
    for (const b of this.m.battles) {
      const [sx, sy] = this.tileToScreen(b.x + 0.5, b.y + 0.5);
      const r = Math.max(4, ppt * 0.6) * (1 + 0.2 * Math.sin(now / 90));
      g.strokeStyle = 'rgba(255,220,120,0.85)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(sx - r, sy - r);
      g.lineTo(sx + r, sy + r);
      g.moveTo(sx + r, sy - r);
      g.lineTo(sx - r, sy + r);
      g.stroke();
    }
  }

  drawSelection(g, now) {
    const t = this.selTown ? this.m.towns.get(this.selTown) : null;
    if (t) {
      const [sx, sy] = this.tileToScreen(t.x + 0.5, t.y + 0.5);
      const r = Math.max(8, this.ppt * 2.2) + Math.sin(now / 250) * 2;
      g.strokeStyle = '#fff3c4';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(sx, sy, r, 0, Math.PI * 2);
      g.stroke();
    }
  }

  /** A small rounded text tag (cached), drawn at half its pixel size. */
  tag(text, color, size = 11) {
    const key = `${text}|${color}|${size}`;
    let c = this.labelCache.get(key);
    if (c) return c;
    if (this.labelCache.size > 3000) this.labelCache.clear();
    const s = size * 2;
    const font = `600 ${s}px system-ui, sans-serif`;
    const probe = makeCanvas(4, 4).getContext('2d');
    probe.font = font;
    const w = Math.ceil(probe.measureText(text).width) + s;
    c = makeCanvas(w, Math.ceil(s * 1.5));
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(30,22,26,0.82)';
    roundRect(g, 0, 0, w, c.height, s * 0.5);
    g.fill();
    g.fillStyle = color;
    g.fillRect(s * 0.3, c.height * 0.25, s * 0.18, c.height * 0.5);
    g.font = font;
    g.fillStyle = '#fbf2dc';
    g.textBaseline = 'middle';
    g.fillText(text, s * 0.65, c.height / 2 + 1);
    this.labelCache.set(key, c);
    return c;
  }

  /** Plain outlined text (cached), drawn at half its pixel size. */
  text(text, size, color = '#fbf2dc', weight = 700, italic = false) {
    const key = `t|${text}|${size}|${color}|${weight}|${italic}`;
    let c = this.labelCache.get(key);
    if (c) return c;
    const s = Math.round(size * 2);
    const font = `${italic ? 'italic ' : ''}${weight} ${s}px Georgia, 'Times New Roman', serif`;
    const probe = makeCanvas(4, 4).getContext('2d');
    probe.font = font;
    const w = Math.ceil(probe.measureText(text).width) + s;
    c = makeCanvas(w, Math.ceil(s * 1.45));
    const g = c.getContext('2d');
    g.font = font;
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = Math.max(3, s * 0.22);
    g.strokeStyle = 'rgba(30,20,24,0.85)';
    g.strokeText(text, s / 2, c.height / 2);
    g.fillStyle = color;
    g.fillText(text, s / 2, c.height / 2);
    this.labelCache.set(key, c);
    return c;
  }

  centroidsNow(now) {
    if (now - this.centroidAt < 2000 && this.centroids.size) return this.centroids;
    this.centroidAt = now;
    const m = this.m;
    const acc = new Map();
    const W = this.W;
    for (let i = 0; i < m.owner.length; i += 1) {
      const o = m.owner[i];
      if (!o) continue;
      const t = m.towns.get(o);
      if (!t) continue;
      let a = acc.get(t.civ);
      if (!a) acc.set(t.civ, (a = { x: 0, y: 0, n: 0, x0: 1e9, x1: -1, y0: 1e9, y1: -1 }));
      const x = i % W;
      const y = (i / W) | 0;
      a.x += x;
      a.y += y;
      a.n++;
    }
    this.centroids = acc;
    return acc;
  }

  drawLabels(g, now, vx0, vy0, vx1, vy1) {
    const m = this.m;
    const ppt = this.ppt;
    const placed = [];
    const free = (x, y, w, h) => {
      for (const r of placed) if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) return false;
      placed.push({ x, y, w, h });
      return true;
    };
    // Realm names when zoomed out.
    if (ppt < 7) {
      const cents = this.centroidsNow(now);
      const list = [...cents].sort((a, b) => b[1].n - a[1].n);
      for (const [civId, a] of list.slice(0, 24)) {
        if (a.n < (ppt < 3 ? 70 : 30)) continue;
        const c = m.civs.get(civId);
        if (!c || !c.alive) continue;
        const x = a.x / a.n + 0.5;
        const y = a.y / a.n + 0.5;
        if (x < vx0 || y < vy0 || x > vx1 || y > vy1) continue;
        const size = Math.max(8, Math.min(26, Math.sqrt(a.n) * ppt * 0.16));
        const name = ppt < 2.2 ? c.names.land : c.name;
        const img = this.text(name.toUpperCase(), size, '#fff6e0', 700);
        const [sx, sy] = this.tileToScreen(x, y);
        const w = img.width / 2;
        const h = img.height / 2;
        if (!free(sx - w / 2, sy - h / 2, w, h)) continue;
        g.globalAlpha = ppt < 4 ? 0.95 : 0.8;
        g.drawImage(img, Math.round(sx - w / 2), Math.round(sy - h / 2), w, h);
        g.globalAlpha = 1;
      }
    }
    // Town names, the largest first; smaller towns as you zoom in.
    const minUrban = ppt < 2 ? 20000 : ppt < 4 ? 4000 : ppt < 8 ? 600 : 0;
    const towns = [...m.towns.values()].filter((t) => t.alive && t.x >= vx0 - 1 && t.y >= vy0 - 1 && t.x <= vx1 + 1 && t.y <= vy1 + 1 && (t.urban >= minUrban || (t.capital && ppt >= 3)));
    towns.sort((a, b) => b.pop - a.pop);
    for (const t of towns.slice(0, 160)) {
      const c = m.civs.get(t.civ);
      const [sx, sy] = this.tileToScreen(t.x + 0.5, t.y + 0.5);
      const size = t.capital ? 12 : t.pop > 50000 ? 11 : 10;
      if (ppt < 6) {
        // A dot for the town.
        const r = Math.max(1.6, Math.min(4.5, Math.sqrt(t.urban) / 18)) * Math.min(1.6, Math.max(0.8, ppt / 3));
        g.fillStyle = '#2b1d26';
        g.beginPath();
        g.arc(sx, sy, r + 1, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = t.capital ? '#ffe9a8' : c ? c.color : '#ddd';
        g.beginPath();
        g.arc(sx, sy, r, 0, Math.PI * 2);
        g.fill();
      }
      const img = this.text(t.name, size, t.capital ? '#ffe9a8' : '#fbf2dc', t.capital ? 700 : 600);
      const w = img.width / 2;
      const h = img.height / 2;
      const ly = sy + (ppt < 6 ? 4 : ppt * 0.9);
      if (!free(sx - w / 2, ly, w, h)) continue;
      g.drawImage(img, Math.round(sx - w / 2), Math.round(ly), w, h);
    }
  }

  drawPings(g, now) {
    this.pings = this.pings.filter((p) => now - p.t < 2400);
    for (const p of this.pings) {
      const [sx, sy] = this.tileToScreen(p.x + 0.5, p.y + 0.5);
      const k = (now - p.t) / 2400;
      g.strokeStyle = `rgba(255,243,196,${1 - k})`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(sx, sy, 6 + k * 40, 0, Math.PI * 2);
      g.stroke();
    }
  }

  drawPreview(g) {
    const p = this.preview;
    const [sx, sy] = this.tileToScreen(p.x + 0.5, p.y + 0.5);
    const r = Math.max(6, (p.r || 1) * this.ppt);
    g.strokeStyle = p.ok ? 'rgba(255,243,196,0.9)' : 'rgba(255,120,100,0.9)';
    g.lineWidth = 2;
    g.setLineDash([4, 4]);
    g.beginPath();
    g.arc(sx, sy, r, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }
}

function drawSprite(g, s, x, y, k, flip) {
  if (!s) return;
  const w = s.w * k;
  const h = s.h * k;
  if (flip) {
    g.save();
    g.translate(Math.round(x), 0);
    g.scale(-1, 1);
    g.drawImage(s.canvas, Math.round(-s.ax * k), Math.round(y - s.ay * k), w, h);
    g.restore();
  } else g.drawImage(s.canvas, Math.round(x - s.ax * k), Math.round(y - s.ay * k), w, h);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function closePic(p) {
  for (const k of ['full', 'half', 'low']) if (p[k]) p[k].close?.();
}
