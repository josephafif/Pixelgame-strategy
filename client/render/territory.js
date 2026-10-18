// Territory as an image with one pixel per tile: a translucent fill in the
// owner's colour and an opaque rim along every border. Changed tiles (and
// their neighbours, whose rim may change) are repainted in place, and only
// the touched rectangle is uploaded, so an expanding border costs little.

import { rgb, shade } from './color.js';
import { makeCanvas } from './pix.js';

const FILL = 96;
const RIM = 235;

export class TerritoryImage {
  constructor(cw) {
    this.cw = cw;
    this.canvas = makeCanvas(cw.W, cw.H);
    this.ctx = this.canvas.getContext('2d');
    this.img = this.ctx.createImageData(cw.W, cw.H);
    this.colors = new Map();
    this.v = 0;
    // The rim of one chosen realm (the player's target), kept up to date the same way.
    this.hlCanvas = makeCanvas(cw.W, cw.H);
    this.hlCtx = this.hlCanvas.getContext('2d');
    this.hlImg = this.hlCtx.createImageData(cw.W, cw.H);
    this.hl = null;
    this.hlNext = null;
    this.changed = []; // tiles repainted since the renderer last looked
    this.changedAll = false;
  }

  /** Outline realm `pid` (null: none). */
  highlight(pid) {
    this.hlNext = pid ?? null;
  }

  /** [fill r, g, b, rim r, g, b] for a player. */
  color(o) {
    let c = this.colors.get(o);
    if (!c) {
      const p = this.cw.player(o);
      if (!p) return [128, 128, 128, 90, 90, 90];
      const base = p.color;
      const rim = o === this.cw.you ? shade(base, 0.45) : shade(base, -0.3);
      c = [...rgb(base), ...rgb(rim)];
      this.colors.set(o, c);
    }
    return c;
  }

  paint(i) {
    const { owner, W } = this.cw;
    const d = this.img.data;
    const o = owner[i];
    const k = i * 4;
    if (o < 0) {
      d[k + 3] = 0;
      if (this.hl !== null) this.hlImg.data[k + 3] = 0;
      return;
    }
    const x = i % W;
    const rim = x === 0 || x === W - 1 || i < W || i >= owner.length - W || owner[i - 1] !== o || owner[i + 1] !== o || owner[i - W] !== o || owner[i + W] !== o;
    if (this.hl !== null) {
      const h = this.hlImg.data;
      const on = rim && o === this.hl;
      h[k] = 255;
      h[k + 1] = 243;
      h[k + 2] = 196;
      h[k + 3] = on ? 255 : 0;
    }
    const c = this.color(o);
    if (rim) {
      d[k] = c[3];
      d[k + 1] = c[4];
      d[k + 2] = c[5];
      d[k + 3] = RIM;
    } else {
      d[k] = c[0];
      d[k + 1] = c[1];
      d[k + 2] = c[2];
      d[k + 3] = FILL;
    }
  }

  /** Bring the image up to date; returns true when it changed. */
  update() {
    const { cw } = this;
    if (!cw.snap) return false;
    if (!this.ready) {
      // Colours come with the first snapshot.
      this.ready = true;
      cw.terrAll = true;
    }
    const { W, H } = cw;
    if (this.hlNext !== this.hl) {
      this.hl = this.hlNext;
      if (this.hl !== null) cw.terrAll = true;
    }
    if (cw.terrAll) {
      if (this.hl !== null) this.hlImg.data.fill(0);
      for (let i = 0; i < W * H; i++) this.paint(i);
      this.ctx.putImageData(this.img, 0, 0);
      if (this.hl !== null) this.hlCtx.putImageData(this.hlImg, 0, 0);
      cw.terrAll = false;
      cw.terrTiles = [];
      this.changedAll = true;
      this.v++;
      return true;
    }
    const list = cw.terrTiles;
    if (!list.length) return false;
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    for (const i of list) {
      const x = i % W;
      const y = (i / W) | 0;
      this.paint(i);
      if (x > 0) this.paint(i - 1);
      if (x < W - 1) this.paint(i + 1);
      if (y > 0) this.paint(i - W);
      if (y < H - 1) this.paint(i + W);
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    cw.terrTiles = [];
    for (const i of list) this.changed.push(i);
    x0 = Math.max(0, x0 - 1);
    y0 = Math.max(0, y0 - 1);
    x1 = Math.min(W - 1, x1 + 1);
    y1 = Math.min(H - 1, y1 + 1);
    this.ctx.putImageData(this.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    if (this.hl !== null) this.hlCtx.putImageData(this.hlImg, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    this.v++;
    return true;
  }
}
