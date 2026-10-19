// Small moving things at the scale of the new buildings (a person is about
// seven pixels tall): townsfolk, armies in the dress of their age, ships,
// carts, wagons, trains and lorries. Drawn procedurally, outlined, cached.

import { Pix } from '../../client/render/pix.js';
import { cozy, mix } from '../../client/render/color.js';

const INK = '#2b1d26';
const cache = new Map();

function cached(key, make) {
  let s = cache.get(key);
  if (!s) {
    const r = make();
    s = { canvas: r.p.toCanvas(), w: r.p.w, h: r.p.h, ax: r.ax, ay: r.ay };
    cache.set(key, s);
  }
  return s;
}

const SKIN = ['#f0c8a0', '#d9a57c', '#b9825c', '#8f6044', '#ecbd94'];
const DRESS = [
  ['#8a6a44', '#a07a4a', '#6e5236'], // hides and wool
  ['#c8b48a', '#a8603a', '#e0d4b0'],
  ['#8a6a44', '#5a7a4a', '#a85a3a'],
  ['#efe6d0', '#b8403a', '#d9c8a0'],
  ['#a8403a', '#3f6a8a', '#5a8a3a', '#c89a3a'],
  ['#5a3a6a', '#3a5a8a', '#8a3a3a', '#d8c8a0'],
  ['#3a3a42', '#5a4a3a', '#2f3a52', '#6a6a72'],
  ['#3a5a9a', '#c8463a', '#e8c040', '#5a9a6a', '#d8d8d8'],
];

/** A townsperson walking (frame 0/1). */
export function walkerSprite(era, seed, frame) {
  const e = Math.max(0, Math.min(7, era | 0));
  const v = Math.abs(seed | 0) % 20;
  return cached(`w${e}:${v}:${frame}`, () => {
    const p = new Pix(7, 10);
    const dress = DRESS[e][v % DRESS[e].length];
    const skin = SKIN[v % SKIN.length];
    const legs = e >= 6 ? '#2f2a2e' : cozy(dress, -0.35);
    // Legs.
    if (frame === 0) {
      p.set(2, 8, legs);
      p.set(4, 8, legs);
      p.set(2, 9, INK);
      p.set(4, 9, INK);
    } else {
      p.set(3, 8, legs);
      p.set(3, 9, INK);
    }
    // Body and head.
    p.rect(2, 4, 3, 4, dress);
    p.set(2, 4, cozy(dress, 0.2));
    p.set(4, 7, cozy(dress, -0.2));
    p.rect(2, 1, 3, 3, skin);
    p.set(2, 1, mix(skin, '#ffffff', 0.2));
    // Hair or hat.
    const hat = e >= 6 && v % 3 === 0 ? '#2b2a30' : ['#5a3a22', '#2c2326', '#d4ac5c', '#a5502e'][v % 4];
    p.hline(2, 4, 0, hat);
    if (v % 5 === 0) p.set(5, 5, '#8a6a44'); // a bundle
    p.outline(INK);
    return { p, ax: 3, ay: 9 };
  });
}

const GEAR = [
  { body: '#8a6a44', helm: null, shield: null, spear: true },
  { body: '#b8a070', helm: '#c8903a', shield: 'round', spear: true },
  { body: '#7a6a5a', helm: '#8e8a8e', shield: 'round', spear: true },
  { body: '#b8403a', helm: '#c8a040', shield: 'tall', spear: true },
  { body: '#9a9aa2', helm: '#c3bfbb', shield: 'kite', spear: true },
  { body: '#5a4a6a', helm: '#2f2a2e', shield: null, gun: true },
  { body: '#2f3a5a', helm: '#2f3a5a', shield: null, gun: true },
  { body: '#5a6a3a', helm: '#4a5a32', shield: null, gun: true },
];

function soldier(p, x, gy, era, color, frame, k) {
  const g = GEAR[era];
  const legs = cozy(g.body, -0.4);
  const step = (frame + k) % 2;
  p.set(x - 1 + step, gy, legs);
  p.set(x + 1 - step, gy, legs);
  p.set(x - 1 + step, gy + 1, INK);
  p.set(x + 1 - step, gy + 1, INK);
  p.rect(x - 1, gy - 4, 3, 4, g.body);
  p.set(x - 1, gy - 4, cozy(g.body, 0.2));
  p.rect(x - 1, gy - 7, 3, 3, SKIN[k % SKIN.length]);
  if (g.helm) p.hline(x - 1, x + 1, gy - 7, g.helm);
  if (g.spear) {
    p.vline(x + 2, gy - 9, gy, '#74502f');
    p.set(x + 2, gy - 10, '#c3bfbb');
  }
  if (g.gun) {
    p.vline(x + 2, gy - 8, gy - 2, '#4a3a2a');
    p.set(x + 2, gy - 9, '#8e8a8e');
  }
  if (g.shield) {
    const t = color;
    if (g.shield === 'round') {
      p.rect(x - 2, gy - 4, 2, 3, t);
      p.set(x - 2, gy - 4, cozy(t, 0.25));
    } else {
      p.rect(x - 2, gy - 5, 2, 5, t);
      p.set(x - 2, gy - 5, cozy(t, 0.25));
    }
  } else p.set(x, gy - 3, color); // a sash in the realm's colour
}

/** An army in the field: three soldiers and a banner. */
export function armySprite(era, color, frame, siege = false) {
  const e = Math.max(0, Math.min(7, era | 0));
  return cached(`a${e}:${color}:${frame}:${siege ? 1 : 0}`, () => {
    const p = new Pix(20, 18);
    // Banner pole and flag.
    p.vline(3, 2, 15, '#5a3c28');
    p.rect(4, 2, 5, 4, color);
    p.hline(4, 8, 2, cozy(color, 0.25));
    p.hline(4, 8, 5, cozy(color, -0.25));
    soldier(p, 7, 15, e, color, frame, 0);
    soldier(p, 11, 14, e, color, frame, 1);
    soldier(p, 15, 15, e, color, frame, 2);
    if (siege) {
      // Smoke and fire of a siege.
      p.set(17, 3, '#f0a040');
      p.set(18, 2, '#ffd27a');
      p.set(17, 1, '#8a8480');
      p.set(18, 0, '#a8a4a0');
    }
    p.outline(INK);
    return { p, ax: 10, ay: 16 };
  });
}

/** A ship of its age: canoe, galley, cog, carrack, steamer, freighter. */
export function shipSprite(era, color) {
  const e = Math.max(0, Math.min(7, era | 0));
  return cached(`s${e}:${color}`, () => {
    const p = new Pix(20, 16);
    const wood = '#7a5232';
    const woodL = '#9a7044';
    const woodD = '#4e3420';
    if (e === 0) {
      p.hline(4, 14, 12, wood);
      p.hline(5, 13, 13, woodD);
      p.set(8, 11, '#d9a57c');
      p.set(12, 11, '#b9825c');
      p.set(7, 10, '#5a3a22');
    } else if (e <= 3) {
      // A galley: oars and a square sail.
      p.hline(3, 16, 11, woodL);
      p.hline(3, 16, 12, wood);
      p.hline(4, 15, 13, woodD);
      p.set(2, 10, wood);
      p.set(17, 10, wood);
      for (let x = 5; x <= 14; x += 2) p.set(x, 14, woodD);
      p.vline(10, 3, 10, woodD);
      p.rect(7, 4, 7, 5, e === 3 ? '#e8dcc0' : '#d8c8a0');
      p.hline(7, 13, 6, color);
    } else if (e <= 5) {
      // A cog or carrack: high castles, round hull, more sail.
      p.rect(3, 10, 14, 3, wood);
      p.hline(3, 16, 10, woodL);
      p.hline(4, 15, 13, woodD);
      p.rect(3, 8, 3, 2, woodL);
      p.rect(14, 8, 3, 2, woodL);
      p.vline(10, 1, 9, woodD);
      p.rect(7, 2, 7, 6, '#efe6d2');
      p.vline(10, 2, 7, color);
      if (e === 5) {
        p.vline(6, 4, 9, woodD);
        p.rect(4, 5, 4, 3, '#efe6d2');
      }
      p.set(10, 0, color);
      p.set(11, 0, color);
    } else if (e === 6) {
      // A steamer with a funnel and smoke.
      p.rect(2, 10, 16, 3, '#3a3a42');
      p.hline(2, 17, 10, '#5a5a62');
      p.rect(6, 7, 8, 3, '#e8e0d0');
      p.rect(9, 3, 2, 4, color);
      p.set(10, 1, '#8a8480');
      p.set(11, 0, '#a8a4a0');
      p.hline(3, 16, 13, '#2a2a30');
    } else {
      p.rect(1, 10, 18, 3, '#4a5a6a');
      p.hline(1, 18, 10, '#6a7a8a');
      p.rect(12, 6, 5, 4, '#e8e8e0');
      p.rect(3, 7, 3, 3, color);
      p.rect(6, 7, 3, 3, '#c8a040');
      p.rect(9, 8, 3, 2, '#5a8a6a');
      p.hline(2, 17, 13, '#2a3440');
    }
    p.outline(INK);
    return { p, ax: 10, ay: 14 };
  });
}

/** Goods on the road: a cart, a wagon, a train, a lorry. */
export function cartSprite(era) {
  const e = Math.max(0, Math.min(7, era | 0));
  return cached(`c${e}`, () => {
    const p = new Pix(16, 10);
    if (e <= 5) {
      // Ox or horse and a cart with a load.
      const beast = e <= 2 ? '#8a6a4a' : '#6a4630';
      p.rect(1, 4, 4, 3, beast);
      p.set(0, 4, beast);
      p.set(1, 7, INK);
      p.set(4, 7, INK);
      p.hline(5, 6, 5, '#5a3c28');
      p.rect(7, 3, 7, 3, '#9a7044');
      p.rect(8, 1, 5, 2, e >= 4 ? '#e8dcc0' : '#d8b85a');
      p.set(8, 7, INK);
      p.set(12, 7, INK);
      p.set(8, 6, '#5a3c28');
      p.set(12, 6, '#5a3c28');
    } else if (e === 6) {
      // A little train.
      p.rect(0, 3, 5, 4, '#2f2f36');
      p.rect(1, 1, 2, 2, '#2f2f36');
      p.set(1, 0, '#a8a4a0');
      p.rect(6, 3, 4, 4, '#8a3a2a');
      p.rect(11, 3, 4, 4, '#3a5a8a');
      for (const x of [1, 4, 7, 9, 12, 14]) p.set(x, 7, INK);
    } else {
      p.rect(1, 2, 10, 5, '#e8e0d0');
      p.rect(11, 3, 4, 4, '#c8463a');
      p.set(13, 4, '#7ab0d0');
      for (const x of [3, 8, 13]) p.set(x, 7, INK);
    }
    p.outline(INK);
    return { p, ax: 8, ay: 8 };
  });
}
