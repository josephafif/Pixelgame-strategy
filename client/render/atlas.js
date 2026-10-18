// A cache of small finished pictures (soldiers, villagers, chips, count
// badges, name tags), each with a mirrored copy made on first use. Every
// picture is its own small canvas that is never drawn to again once made:
// browsers copy a canvas before using it as an image whenever it changed,
// so one big shared sheet that keeps growing would be copied over and over.
// Text is rendered once per string instead of every frame.

import { makeCanvas } from './pix.js';

const MAX = 4000; // pictures kept before the cache starts over

export class Atlas {
  constructor() {
    this.map = new Map();
  }

  reset() {
    this.map.clear();
  }

  /**
   * The entry for `key`: { canvas, w, h, ax, ay }. `make()` returns
   * { canvas, w, h, ax?, ay? } and is called once per key.
   */
  get(key, make) {
    let e = this.map.get(key);
    if (e) return e;
    if (this.map.size >= MAX) this.map.clear();
    const s = make();
    e = { canvas: s.canvas, flipped: null, w: s.w, h: s.h, ax: s.ax ?? s.w / 2, ay: s.ay ?? s.h };
    this.map.set(key, e);
    return e;
  }

  /** Draw an entry with its anchor at (x, y), scaled by k, mirrored when flip. */
  draw(ctx, e, x, y, k = 1, flip = false) {
    if (!e) return;
    let src = e.canvas;
    let ax = e.ax;
    if (flip) {
      if (!e.flipped) {
        const cv = makeCanvas(e.w, e.h);
        const g = cv.getContext('2d');
        g.translate(e.w, 0);
        g.scale(-1, 1);
        g.drawImage(e.canvas, 0, 0);
        e.flipped = cv;
      }
      src = e.flipped;
      ax = e.w - e.ax;
    }
    ctx.drawImage(src, Math.round(x - ax * k), Math.round(y - e.ay * k), e.w * k, e.h * k);
  }
}
