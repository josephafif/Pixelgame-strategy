// Small animated people: soldiers of each unit type in their owner's colour,
// villagers at work, and tiny unit glyphs for buttons. Drawn procedurally
// at the map's pixel scale (a tile is 16 px), lit from the upper left,
// outlined in warm ink and cached by key. Every sprite faces right (the
// renderer mirrors it to face left) and returns { canvas, w, h, ax, ay }
// with (ax, ay) the anchor at the feet (bottom centre).

import { Pix } from './pix.js';
import { mix, cozy } from './color.js';

export const UNIT_TYPES = ['shield', 'bow', 'rider', 'knight', 'trebuchet'];

const cache = new Map();

const INK = '#2b1d26';
const STEEL = { dark: '#5d5a62', base: '#8e8a8e', light: '#c3bfbb', hi: '#ece8df' };
const WOOD = { dark: '#4e3420', base: '#74502f', light: '#9a7044', hi: '#bf9561' };
const LEATHER = { dark: '#4a3122', base: '#6e4a30', light: '#8f663f' };
const SKINS = ['#f0c8a0', '#d9a57c', '#b9825c', '#ecbd94', '#8f6044', '#f4d3b2'];
const HAIRS = ['#5a3a22', '#2c2326', '#d4ac5c', '#a5502e', '#9c958e', '#3d2b20'];
const TUNICS = ['#b5673c', '#6f8a4a', '#53708c', '#c99b4a', '#8a5a78', '#d6caa8'];
const TROUSERS = ['#5a4a3a', '#4a4038', '#6a5a48', '#423c40', '#5e5040', '#4a3a2e'];
const HORSES = [
  { dark: '#4a2e1e', base: '#7a4f30', light: '#9c6a42', mane: '#2f1f18' },
  { dark: '#5e554e', base: '#9a928a', light: '#c9c2b8', mane: '#4a423e' },
];

function tones(c) {
  return { dark: cozy(c, -0.3), base: c, light: cozy(c, 0.22), hi: cozy(c, 0.45) };
}

function cached(key, make) {
  let s = cache.get(key);
  if (!s) {
    const r = make();
    const p = r.p;
    s = { canvas: p.toCanvas(), w: p.w, h: p.h, ax: r.ax, ay: r.ay };
    cache.set(key, s);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Figure parts. Coordinates: cx = body centre column, gy = ground row.

/**
 * Legs for walk phase 0..3 (0 and 2 are strides, 1 and 3 pass), plus a
 * standing pose (-1). Returns the bob (0 or 1 px up) for the upper body.
 */
function legs(p, cx, gy, phase, trouser, boot) {
  const bob = phase === 1 || phase === 3 ? 1 : 0;
  const far = cozy(trouser, -0.22);
  let nearFoot = cx;
  let farFoot = cx - 1;
  if (phase === 0) {
    nearFoot = cx + 1;
    farFoot = cx - 2;
  } else if (phase === 2) {
    nearFoot = cx - 2;
    farFoot = cx + 1;
  }
  const leg = (hx, fx, col) => {
    const top = gy - 3 - bob;
    for (let y = top; y < gy; y++) {
      const t = (y - top) / Math.max(1, gy - 1 - top);
      p.set(Math.round(hx + (fx - hx) * t), y, col);
    }
    p.set(fx, gy, boot);
    p.set(fx + 1, gy, boot);
  };
  leg(cx - 1, farFoot, far);
  leg(cx, nearFoot, trouser);
  return bob;
}

/** Torso (4 px wide) with shading, belt row and an optional lower hem. */
function torso(p, cx, top, rows, col, belt = null) {
  const t = tones(col);
  for (let y = top; y < top + rows; y++) {
    for (let x = cx - 2; x <= cx + 1; x++) {
      let c = t.base;
      if (x === cx - 2) c = t.dark;
      else if (x === cx - 1 && y === top) c = t.light;
      else if (x === cx + 1 && y > top) c = t.dark === c ? c : mix(t.base, t.dark, 0.5);
      p.set(x, y, c);
    }
  }
  p.set(cx, top, t.light);
  if (belt) p.hline(cx - 2, cx + 1, top + rows - 2, belt);
}

/** Head 3×3: face on the right (forward) side, hair or headgear on top/back. */
function head(p, cx, top, skin, hair, gear = null) {
  for (let y = top; y < top + 3; y++) for (let x = cx - 1; x <= cx + 1; x++) p.set(x, y, skin);
  p.set(cx + 1, top + 1, INK); // eye
  if (gear === 'helm') {
    p.hline(cx - 1, cx + 1, top - 1, STEEL.light);
    p.hline(cx - 1, cx + 1, top, STEEL.base);
    p.set(cx - 1, top + 1, STEEL.base);
    p.set(cx - 1, top - 1, STEEL.hi);
    p.set(cx + 2, top, STEEL.dark);
  } else if (gear === 'hood') {
    const h = tones(hair);
    p.hline(cx - 1, cx + 1, top - 1, h.light);
    p.hline(cx - 2, cx, top, h.base);
    p.set(cx - 1, top + 1, h.base);
    p.set(cx - 2, top + 1, h.dark);
    p.set(cx - 2, top + 2, h.dark);
    p.set(cx + 1, top, h.base);
  } else if (gear === 'straw') {
    p.hline(cx - 3, cx + 3, top, '#c9a14e');
    p.hline(cx - 1, cx + 1, top - 1, '#e2bf6a');
    p.set(cx, top - 2, '#e2bf6a');
    p.set(cx - 1, top + 1, hair);
  } else if (gear === 'cap') {
    p.hline(cx - 1, cx + 2, top, '#6a4a30');
    p.hline(cx - 1, cx + 1, top - 1, '#8a6440');
    p.set(cx - 1, top + 1, hair);
  } else {
    p.hline(cx - 1, cx + 1, top, hair);
    p.set(cx - 1, top + 1, hair);
    p.set(cx, top - 1, hair);
    p.set(cx - 1, top - 1, hair);
  }
}

/** A thin pole from (x0, y0) to (x1, y1) with an optional tip colour. */
function pole(p, x0, y0, x1, y1, col, tip = null, tipLen = 1) {
  p.line(x0, y0, x1, y1, col);
  if (!tip) return;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  for (let k = 0; k <= tipLen; k++) p.set(Math.round(x1 + (dx / len) * k), Math.round(y1 + (dy / len) * k), k === tipLen ? STEEL.hi : tip);
}

// ---------------------------------------------------------------------------
// Soldiers

function shieldbearer(color, frame) {
  const p = new Pix(22, 20);
  const cx = 8;
  const gy = 18;
  const t = tones(color);
  const phase = frame < 4 ? frame : -1;
  const bob = legs(p, cx, gy, phase, '#5a4a3a', LEATHER.dark);
  const top = gy - 8 - bob;
  // Spear behind the body (walking: upright; attacks are drawn after).
  if (frame < 4) pole(p, cx + 3, gy - 1 - bob, cx + 3, gy - 15 - bob, WOOD.base);
  torso(p, cx, top, 5, color, LEATHER.base);
  head(p, cx, top - 3, SKINS[0], HAIRS[0], 'helm');
  // Big round shield on the near arm, in the owner's colour.
  const sx = frame === 5 ? cx + 2 : cx + 1;
  p.ellipse(sx + 0.5, top + 3, 3.4, 3.6, (dx, dy) => {
    const r = dx * dx + dy * dy;
    if (r > 0.62) return dx + dy < 0 ? WOOD.light : WOOD.dark;
    return dx + dy < -0.6 ? t.light : dx + dy > 0.7 ? t.dark : t.base;
  });
  p.set(sx, top + 3, STEEL.light);
  p.set(sx + 1, top + 3, STEEL.base);
  p.set(sx, top + 2, STEEL.hi);
  p.outline(INK);
  if (frame === 4) {
    // Spear drawn back, ready to thrust.
    p.set(cx + 2, top + 2, SKINS[0]);
    pole(p, cx - 5, top + 3, cx + 5, top + 1, WOOD.base, STEEL.light, 2);
  } else if (frame === 5) {
    pole(p, cx - 1, top + 2, cx + 10, top + 2, WOOD.base, STEEL.light, 2);
    p.set(cx + 4, top + 2, SKINS[0]);
  } else {
    p.set(cx + 3, gy - 15 - bob, STEEL.light);
    p.set(cx + 3, gy - 16 - bob, STEEL.hi);
    p.set(cx + 2, gy - 15 - bob, STEEL.dark);
    p.set(cx + 4, gy - 15 - bob, STEEL.dark);
    p.set(cx + 3, top + 2, SKINS[0]); // hand on the shaft
  }
  return { p, ax: cx, ay: gy };
}

function longbow(color, frame) {
  const p = new Pix(22, 20);
  const cx = 8;
  const gy = 18;
  const phase = frame < 4 ? frame : -1;
  const bob = legs(p, cx, gy, phase, '#4f4a3c', LEATHER.dark);
  const top = gy - 8 - bob;
  // Quiver on the back, arrows sticking out.
  for (let y = top - 1; y <= top + 4; y++) p.set(cx - 3, y, y === top + 4 ? LEATHER.dark : LEATHER.base);
  p.set(cx - 4, top + 1, LEATHER.dark);
  p.set(cx - 3, top - 2, '#e8dcc0');
  p.set(cx - 4, top - 2, '#c8503c');
  p.set(cx - 2, top - 2, '#e8dcc0');
  torso(p, cx, top, 5, color, LEATHER.base);
  head(p, cx, top - 3, SKINS[1], '#5f6b3c', 'hood');
  p.outline(INK);
  const bowCol = WOOD.light;
  const string = '#e9e1cf';
  if (frame < 4) {
    // Tall bow carried upright at the side.
    const bx = cx + 2;
    for (let y = top - 5; y <= gy - 3 - bob; y++) {
      const u = (y - (top - 5)) / (gy - 3 - bob - (top - 5));
      const bend = Math.round(Math.sin(u * Math.PI) * 2);
      p.set(bx + bend, y, bowCol);
      if (bend === 0 && (u < 0.1 || u > 0.9)) p.set(bx, y, WOOD.dark);
    }
    p.vline(bx, top - 4, gy - 4 - bob, string);
    p.set(bx + 2, top + 2, SKINS[1]);
  } else {
    const ay = top + 1; // arrow / draw height
    const bx = cx + 5;
    for (let y = top - 5; y <= top + 7; y++) {
      const u = (y - (top - 5)) / 12;
      p.set(bx + Math.round(Math.sin(u * Math.PI) * 2), y, bowCol);
    }
    p.set(bx + 2, ay, SKINS[1]); // bow hand
    p.hline(cx + 2, bx + 1, ay, SKINS[1]); // arm
    if (frame === 4) {
      // Full draw: string pulled back to the cheek, arrow nocked.
      p.line(bx, top - 5, cx, ay, string);
      p.line(cx, ay, bx, top + 7, string);
      p.hline(cx, bx + 4, ay - 1, WOOD.hi);
      p.set(bx + 5, ay - 1, STEEL.light);
      p.set(cx, ay - 1, '#c8503c');
      p.set(cx, ay, SKINS[1]);
    } else {
      // Loosed: string snaps straight, the arrow is away.
      p.vline(bx, top - 5, top + 7, string);
      p.hline(bx + 4, bx + 8, ay - 2, WOOD.hi);
      p.set(bx + 9, ay - 2, STEEL.hi);
      p.set(bx + 3, ay - 2, '#c8503c');
    }
  }
  return { p, ax: cx, ay: gy };
}

/** Horse in profile facing right; legs animate through phases 0..3 (-1 rears a little). */
function horse(p, x0, gy, phase, big, pal, cloth = null) {
  const L = big ? 1 : 0;
  const bob = phase === 1 || phase === 3 ? 1 : 0;
  const by = gy - 6 - L - bob; // body centre row
  const bx = x0 + 7 + L * 2;
  const rx = 5.4 + L * 1.4;
  const ry = 2.3 + L * 0.6;
  // Legs (far pair darker), drawn first.
  const stride = [[1, -1, -1, 1], [0, 0, 0, 0], [-1, 1, 1, -1], [0, 0, 0, 0]][phase < 0 ? 1 : phase];
  const hips = [bx - rx + 1.5, bx - rx + 2.5, bx + rx - 2.5, bx + rx - 1.5];
  hips.forEach((hx, k) => {
    const far = k === 1 || k === 2;
    const col = far ? pal.dark : pal.base;
    let fx = Math.round(hx + stride[k]);
    let top = Math.round(by + ry - 1);
    let bottom = gy;
    if (phase < 0 && k >= 2) {
      // Rearing: front legs lifted and folded.
      bottom = gy - 3;
      fx = Math.round(hx + 1);
      top -= 1;
    }
    p.line(Math.round(hx), top, fx, bottom - 1, col);
    p.set(fx, bottom, far ? INK : '#3b2a22');
  });
  // Body.
  p.ellipse(bx, by, rx, ry, (dx, dy) => (dx * 0.6 + dy < -0.45 ? pal.light : dy > 0.45 ? pal.dark : pal.base));
  // Neck and head.
  const nx = bx + rx - 1.5;
  const headY = by - 4 - L;
  p.line(Math.round(nx), Math.round(by - 1), Math.round(nx + 2), Math.round(headY + 1), pal.base);
  p.line(Math.round(nx - 1), Math.round(by - 1), Math.round(nx + 1), Math.round(headY + 1), pal.base);
  p.line(Math.round(nx + 1), Math.round(by - 1), Math.round(nx + 3), Math.round(headY + 1), pal.dark);
  const hx = Math.round(nx + 2);
  const hy = Math.round(headY);
  p.rect(hx, hy, 3, 2, pal.base);
  p.set(hx + 3, hy + 1, pal.base);
  p.set(hx + 3, hy + 2, pal.dark);
  p.set(hx + 2, hy + 2, pal.dark);
  p.set(hx, hy - 1, pal.dark); // ear
  p.set(hx + 1, hy, INK); // eye
  // Mane and tail.
  p.line(hx - 1, hy, Math.round(nx - 1), Math.round(by - 2), pal.mane);
  const tx = Math.round(bx - rx);
  p.line(tx, Math.round(by - 1), tx - 1, Math.round(by + 2 + bob), pal.mane);
  p.set(tx - 1, Math.round(by + 3 + bob), pal.mane);
  if (cloth) {
    // Barding: a caparison over the body in the owner's colour, dagged hem.
    const t = tones(cloth);
    p.ellipse(bx - 0.5, by + 0.5, rx + 0.6, ry + 1, (dx, dy) => (dy < -0.4 ? t.light : dy > 0.5 ? t.dark : t.base));
    for (let x = Math.round(bx - rx); x <= Math.round(bx + rx); x++) if (x % 2 === 0) p.set(x, Math.round(by + ry + 2), t.dark);
    // A pale band across it.
    for (let y = Math.round(by - ry); y <= Math.round(by + ry + 1); y++) p.set(Math.round(bx), y, '#efe4c8');
    // Chanfron (head armour) and crinet.
    p.rect(hx, hy, 3, 1, STEEL.light);
    p.set(hx + 2, hy + 1, STEEL.base);
    p.line(Math.round(nx), Math.round(by - 1), hx, hy + 1, t.base);
  }
  return { bx, by, top: by - ry, bob, hx, hy };
}

function rider(color, frame) {
  const p = new Pix(26, 20);
  const gy = 18;
  const phase = frame < 4 ? frame : frame === 5 ? 0 : 2;
  const h = horse(p, 3, gy, phase, false, HORSES[0]);
  const t = tones(color);
  const sx = Math.round(h.bx);
  const seat = Math.round(h.top);
  // Saddle cloth.
  p.hline(sx - 2, sx + 1, seat + 1, t.dark);
  p.hline(sx - 2, sx + 1, seat, t.base);
  // Rider: leg along the flank, torso, head with a leather cap.
  p.vline(sx, seat + 1, seat + 3, '#5a4a3a');
  p.set(sx + 1, seat + 3, LEATHER.dark);
  for (let y = seat - 4; y <= seat - 1; y++) for (let x = sx - 1; x <= sx + 1; x++) p.set(x, y, x === sx - 1 ? t.dark : y === seat - 4 ? t.light : t.base);
  head(p, sx, seat - 7, SKINS[2], HAIRS[1], 'cap');
  p.outline(INK);
  const hand = [sx + 2, seat - 2];
  p.set(hand[0], hand[1], SKINS[2]);
  if (frame < 4) pole(p, hand[0] - 2, hand[1] + 3, hand[0] + 3, hand[1] - 7, WOOD.base, STEEL.light, 1);
  else if (frame === 4) pole(p, hand[0] - 5, hand[1] - 2, hand[0] + 3, hand[1] - 3, WOOD.base, STEEL.light, 1);
  else pole(p, hand[0] - 2, hand[1], hand[0] + 9, hand[1] + 1, WOOD.base, STEEL.light, 2);
  return { p, ax: Math.round(h.bx), ay: gy };
}

function knight(color, frame) {
  const p = new Pix(30, 26);
  const gy = 24;
  const phase = frame < 4 ? frame : frame === 4 ? 1 : -1;
  const h = horse(p, 3, gy, phase, true, HORSES[1], color);
  const t = tones(color);
  const sx = Math.round(h.bx) - 1;
  const seat = Math.round(h.top);
  // Armoured rider with a surcoat and a great helm.
  p.vline(sx, seat + 1, seat + 4, STEEL.base);
  p.set(sx + 1, seat + 4, STEEL.dark);
  for (let y = seat - 5; y <= seat; y++) {
    for (let x = sx - 1; x <= sx + 1; x++) p.set(x, y, x === sx - 1 ? t.dark : y < seat - 3 ? STEEL.light : t.base);
  }
  p.set(sx + 2, seat - 4, STEEL.base); // pauldron
  const hy = seat - 9;
  p.rect(sx - 1, hy, 3, 4, STEEL.base);
  p.hline(sx - 1, sx + 1, hy, STEEL.light);
  p.set(sx - 1, hy + 1, STEEL.light);
  p.set(sx + 1, hy + 2, INK); // eye slit
  p.set(sx, hy + 2, STEEL.dark);
  p.set(sx, hy - 1, t.light); // crest
  p.set(sx - 1, hy - 1, t.base);
  // Shield on the near side.
  p.rect(sx - 3, seat - 4, 2, 4, t.base);
  p.set(sx - 3, seat - 4, t.light);
  p.set(sx - 2, seat, t.dark);
  p.outline(INK);
  const hand = [sx + 2, seat - 2];
  const pennant = (x, y, dx, dy) => {
    // Small swallow-tailed pennant trailing back from the lance head.
    for (let k = 0; k < 4; k++) {
      p.set(x - dx * k, y - dy * k + 1, k % 2 ? t.dark : t.base);
      if (k < 3) p.set(x - dx * k, y - dy * k + 2, t.dark);
    }
  };
  if (frame < 4) {
    const tip = [hand[0] + 3, hand[1] - 14];
    pole(p, hand[0] - 1, hand[1] + 4, tip[0], tip[1], WOOD.light, STEEL.light, 1);
    pennant(tip[0] - 1, tip[1] + 1, 1, 0);
  } else if (frame === 4) {
    const tip = [hand[0] + 10, hand[1] - 8];
    pole(p, hand[0] - 3, hand[1] + 2, tip[0], tip[1], WOOD.light, STEEL.light, 1);
    pennant(tip[0] - 2, tip[1] + 1, 1, -0.5);
  } else {
    const tip = [hand[0] + 13, hand[1] + 1];
    pole(p, hand[0] - 4, hand[1] + 1, tip[0], tip[1], WOOD.light, STEEL.light, 2);
    pennant(tip[0] - 3, tip[1] - 2, 1, 0);
  }
  p.set(hand[0], hand[1], STEEL.light);
  return { p, ax: Math.round(h.bx), ay: gy };
}

function trebuchet(color, frame) {
  const p = new Pix(30, 34);
  const gy = 31;
  const t = tones(color);
  const moving = frame < 4;
  const bob = moving && frame % 2 ? 1 : 0;
  const base = gy - 3 - bob;
  const x0 = 4;
  const x1 = 23;
  // Wheels (spokes turn while moving).
  const wheel = (wx) => {
    p.ellipse(wx + 0.5, gy - 2 + 0.5, 2.6, 2.6, (dx, dy) => (dx * dx + dy * dy > 0.45 ? WOOD.dark : WOOD.base));
    const a = (moving ? frame : 0) * (Math.PI / 4);
    p.set(wx + Math.round(Math.cos(a) * 1.5), gy - 2 + Math.round(Math.sin(a) * 1.5), WOOD.hi);
    p.set(wx - Math.round(Math.cos(a) * 1.5), gy - 2 - Math.round(Math.sin(a) * 1.5), WOOD.hi);
    p.set(wx, gy - 2, STEEL.base);
  };
  // Base beam.
  p.hline(x0, x1, base, WOOD.light);
  p.hline(x0, x1, base + 1, WOOD.dark);
  // A-frame up to the pivot.
  const px = 13;
  const py = base - 13;
  p.line(x0 + 3, base - 1, px, py + 1, WOOD.base);
  p.line(x0 + 4, base - 1, px + 1, py + 1, WOOD.dark);
  p.line(x1 - 3, base - 1, px + 1, py + 1, WOOD.dark);
  p.hline(x0 + 7, x1 - 7, base - 6, WOOD.base);
  // Pennant pole at the back in the owner's colour.
  p.vline(x0, base - 1, base - 11, WOOD.dark);
  p.rect(x0 + 1, base - 11, 3, 2, t.base);
  p.set(x0 + 1, base - 11, t.light);
  p.set(x0 + 4, base - 10, t.dark);
  wheel(x0 + 3);
  wheel(x1 - 3);
  // Throwing arm: long end towards `ang`, counterweight on the short end.
  // Angles in screen space (y down): long arm resting down at the back,
  // cocked right down to the ground, or swung up and over to the front.
  const ang = ((moving ? 150 : frame === 4 ? 116 : -58) * Math.PI) / 180;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const longEnd = [px + ca * 13, py + sa * 13];
  const shortEnd = [px - ca * 4, py - sa * 4];
  p.line(Math.round(shortEnd[0]), Math.round(shortEnd[1]), Math.round(longEnd[0]), Math.round(longEnd[1]), WOOD.light);
  // Counterweight box hangs below the short end, painted with a stripe.
  const cwx = Math.round(shortEnd[0]) - 2;
  const cwy = Math.round(shortEnd[1]) + 1;
  p.rect(cwx, cwy, 5, 4, WOOD.base);
  p.hline(cwx, cwx + 4, cwy, WOOD.light);
  p.hline(cwx, cwx + 4, cwy + 2, t.base);
  p.vline(cwx + 4, cwy, cwy + 3, WOOD.dark);
  p.set(px, py, STEEL.light);
  p.set(px + 1, py, STEEL.base);
  p.outline(INK);
  // Sling and stone.
  const lx = Math.round(longEnd[0]);
  const ly = Math.round(longEnd[1]);
  if (frame === 5) {
    p.line(lx, ly, lx + 3, ly + 2, '#d8ccb0');
    p.ellipse(lx + 6.5, ly - 1.5, 1.4, 1.4, STEEL.base);
    p.set(lx + 6, ly - 2, STEEL.light);
  } else {
    p.line(lx, ly, lx + 1, Math.min(base - 1, ly + 3), '#d8ccb0');
    p.ellipse(lx + 1.5, Math.min(base - 1, ly + 3) + 0.5, 1.2, 1.2, STEEL.base);
  }
  return { p, ax: 13, ay: gy };
}

const UNIT_MAKERS = { shield: shieldbearer, bow: longbow, rider, knight, trebuchet };

/**
 * Soldier sprite of a unit type in the owner's colour ('#rrggbb').
 * frame 0..3 walk / idle cycle, 4..5 attack.
 */
export function unitSprite(type, color, frame = 0) {
  const make = UNIT_MAKERS[type] || shieldbearer;
  const f = ((frame | 0) % 6 + 6) % 6;
  return cached(`u:${type}:${color}:${f}`, () => make(color, f));
}

// ---------------------------------------------------------------------------
// Workers

const JOBS = ['chop', 'mine', 'farm', 'carry', 'walk', 'fish'];

/** Arm from the shoulder towards angle `deg` (0 = forward, 90 = up) with a tool. */
function swing(p, sx, sy, deg, armLen, toolLen, skin, handle) {
  const a = (deg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = -Math.sin(a);
  const hx = Math.round(sx + ca * armLen);
  const hy = Math.round(sy + sa * armLen);
  p.line(sx, sy, hx, hy, skin);
  const ex = Math.round(sx + ca * (armLen + toolLen));
  const ey = Math.round(sy + sa * (armLen + toolLen));
  p.line(hx, hy, ex, ey, handle);
  return { hx, hy, ex, ey, ca, sa };
}

function worker(job, frame, variant) {
  const p = new Pix(24, 20);
  const cx = 9;
  const gy = 18;
  const v = ((variant | 0) % 6 + 6) % 6;
  const skin = SKINS[v];
  const hair = HAIRS[v];
  const tunic = TUNICS[v];
  const trouser = TROUSERS[v];
  const walking = job === 'carry' || job === 'walk';
  const phase = walking ? frame : -1;
  const bob = legs(p, cx, gy, phase, trouser, LEATHER.dark);
  // Working poses lean into the stroke.
  const lean = (job === 'farm' || job === 'mine') && (frame === 2 || frame === 3) ? 1 : 0;
  const top = gy - 8 - bob;
  const pc = cx + lean;
  if (job === 'carry' && v % 2 === 1) {
    // A log over the shoulder, sloping down behind the carrier.
    for (let k = 0; k <= 8; k++) {
      const x = pc + 1 - k;
      const y = top - 2 + (k >> 2);
      p.set(x, y, WOOD.light);
      p.set(x, y + 1, WOOD.base);
      p.set(x, y + 2, k % 3 === 1 ? WOOD.dark : WOOD.base);
    }
    p.set(pc - 7, top, WOOD.hi);
    p.set(pc - 7, top + 1, '#d9b47a');
    p.set(pc - 7, top + 2, WOOD.hi);
  }
  if (job === 'carry' && v % 2 === 0) {
    // A sack slung over the back shoulder.
    p.ellipse(pc - 2.5, top - 0.5, 2.6, 2.4, (dx, dy) => (dx + dy < -0.3 ? '#efe2c4' : dy > 0.3 ? '#bba57e' : '#d9c8a2'));
    p.set(pc - 4, top - 2, '#8a6a44');
  }
  torso(p, pc, top, 5, tunic, job === 'farm' ? '#8a6a44' : LEATHER.base);
  const gear = job === 'farm' ? 'straw' : job === 'mine' ? 'cap' : null;
  head(p, pc, top - 3, skin, hair, gear);
  p.outline(INK);
  const sx = pc + 1;
  const sy = top + 1;
  if (job === 'chop') {
    const deg = [150, 95, 5, -25][frame];
    const s = swing(p, sx, sy, deg, 3, 4, skin, WOOD.base);
    // Axe head: a wedge across the end of the handle, edge outward.
    const nx = -s.sa;
    const ny = s.ca;
    for (let k = -1; k <= 1; k++) {
      p.set(Math.round(s.ex + nx * k), Math.round(s.ey + ny * k), k === 1 ? STEEL.hi : STEEL.light);
      p.set(Math.round(s.ex + nx * k - s.ca), Math.round(s.ey + ny * k - s.sa), STEEL.dark);
    }
    if (frame === 2 || frame === 3) {
      p.set(cx + 9, gy - 9 + frame, '#d9b47a');
      p.set(cx + 8, gy - 11 + frame * 2, '#c49a62');
    }
  } else if (job === 'mine') {
    const deg = [125, 80, -55, -35][frame];
    const s = swing(p, sx, sy, deg, 3, 5, skin, WOOD.base);
    // Pick head: a bar across the end of the handle.
    const nx = -s.sa;
    const ny = s.ca;
    for (let k = -2; k <= 2; k++) {
      p.set(Math.round(s.ex + nx * k), Math.round(s.ey + ny * k), k === -2 ? STEEL.hi : STEEL.light);
      if (k !== 0) p.set(Math.round(s.ex + nx * k + s.ca), Math.round(s.ey + ny * k + s.sa), STEEL.dark);
    }
    if (frame === 2) {
      p.set(s.ex + 2, s.ey - 2, '#ffe08a');
      p.set(s.ex + 1, s.ey - 3, '#ffb44c');
    } else if (frame === 3) {
      p.set(s.ex + 3, s.ey - 1, '#a59b90');
      p.set(s.ex + 2, s.ey - 3, '#c9c0b4');
    }
  } else if (job === 'farm') {
    const deg = [105, 55, -50, -30][frame];
    const s = swing(p, sx, sy, deg, 3, 6, skin, WOOD.light);
    // Hoe blade at a right angle to the handle.
    p.set(s.ex, s.ey, STEEL.light);
    p.set(Math.round(s.ex - s.sa), Math.round(s.ey + s.ca), STEEL.base);
    p.set(Math.round(s.ex - 2 * s.sa), Math.round(s.ey + 2 * s.ca), STEEL.dark);
    if (frame === 2 || frame === 3) {
      p.set(s.ex + 1, gy - 1 - (frame - 2), '#6e4a2c');
      p.set(s.ex - 1, gy - 2 - (frame - 2), '#8a6440');
    }
  } else if (job === 'carry') {
    // Hand up holding the load.
    p.set(sx, sy - 1, skin);
    p.set(sx, sy - 2, skin);
  } else if (job === 'walk') {
    // Arm swings with the stride.
    const swingX = [1, 0, -1, 0][frame];
    p.line(sx, sy, sx + swingX, sy + 3, tunic);
    p.set(sx + swingX, sy + 4, skin);
  } else if (job === 'fish') {
    // Rod held out over the water; the float bobs.
    const dip = frame === 2 ? 1 : 0;
    p.set(sx + 1, sy + 1, skin);
    p.line(sx + 1, sy + 1, sx + 10, sy - 7 + dip, WOOD.light);
    const fx = sx + 12;
    const fy = gy - 2 + (frame === 1 ? -1 : 0);
    p.line(sx + 10, sy - 7 + dip, fx, fy - 1, '#d8d0c0');
    p.set(fx, fy, '#d8503f');
    p.set(fx, fy - 1, '#f4ecdc');
    if (frame === 3) {
      p.set(fx - 2, fy + 1, '#cfe6e2');
      p.set(fx + 2, fy + 1, '#cfe6e2');
    }
  }
  return { p, ax: cx, ay: gy };
}

/**
 * A villager at work. job: 'chop' | 'mine' | 'farm' | 'carry' | 'walk' | 'fish';
 * frame 0..3; variant 0..5 (clothes, hair, skin).
 */
export function workerSprite(job, frame = 0, variant = 0) {
  const j = JOBS.includes(job) ? job : 'walk';
  const f = ((frame | 0) % 4 + 4) % 4;
  const v = ((variant | 0) % 6 + 6) % 6;
  return cached(`w:${j}:${f}:${v}`, () => worker(j, f, v));
}

// ---------------------------------------------------------------------------
// Unit glyphs (12×12, parchment and ink)

const PAPER = '#efe2c2';
const PAPER_DARK = '#c9b083';
const ICON_INK = '#3a2a22';

function icon(type) {
  const p = new Pix(12, 12);
  switch (type) {
    case 'shield': {
      // Heater shield with a dividing stripe.
      for (let y = 1; y <= 10; y++) {
        const half = y <= 5 ? 4 : Math.max(0, 4 - Math.round((y - 5) * 0.8));
        for (let x = 6 - half; x <= 5 + half; x++) p.set(x, y, x < 6 ? PAPER : PAPER_DARK);
      }
      p.vline(5, 2, 9, ICON_INK);
      p.hline(3, 8, 4, ICON_INK);
      break;
    }
    case 'bow':
      // Bow drawn with an arrow on the string.
      for (let y = 1; y <= 10; y++) {
        const u = (y - 1) / 9;
        const x = 2 + Math.round(Math.sin(u * Math.PI) * 5);
        p.set(x, y, PAPER);
        if (u > 0.2 && u < 0.8) p.set(x - 1, y, PAPER);
      }
      p.line(2, 1, 4, 5, PAPER_DARK);
      p.line(4, 5, 2, 10, PAPER_DARK);
      p.hline(4, 9, 5, PAPER_DARK);
      p.set(10, 5, PAPER);
      p.set(9, 4, PAPER);
      p.set(9, 6, PAPER);
      break;
    case 'rider': {
      // Horse head in profile.
      p.line(2, 10, 5, 3, PAPER);
      p.line(3, 10, 6, 3, PAPER);
      p.line(4, 10, 6, 5, PAPER);
      p.rect(5, 2, 3, 3, PAPER);
      p.rect(7, 3, 3, 2, PAPER);
      p.set(10, 4, PAPER_DARK);
      p.set(5, 1, PAPER);
      p.set(7, 3, ICON_INK);
      p.line(1, 9, 4, 2, PAPER_DARK);
      break;
    }
    case 'knight':
      // Great helm with an eye slit and a plume.
      p.rect(3, 3, 6, 7, PAPER);
      p.hline(4, 7, 2, PAPER);
      p.vline(8, 3, 9, PAPER_DARK);
      p.hline(3, 8, 5, ICON_INK);
      p.set(6, 7, ICON_INK);
      p.set(6, 8, ICON_INK);
      p.set(5, 1, PAPER_DARK);
      p.set(6, 0, PAPER_DARK);
      p.set(4, 1, PAPER_DARK);
      break;
    case 'trebuchet':
      p.hline(1, 10, 10, PAPER_DARK);
      p.line(2, 9, 6, 4, PAPER);
      p.line(10, 9, 6, 4, PAPER);
      p.line(2, 6, 10, 1, PAPER);
      p.rect(8, 2, 2, 3, PAPER_DARK);
      p.set(6, 4, ICON_INK);
      p.set(1, 6, PAPER);
      break;
    default:
      p.ellipse(6, 6, 4, 4, PAPER);
  }
  p.outline(ICON_INK);
  return p;
}

/** 12×12 glyph of a unit type for buttons. */
export function unitIcon(type) {
  let s = cache.get(`i:${type}`);
  if (!s) {
    const p = icon(type);
    s = { canvas: p.toCanvas(), w: p.w, h: p.h };
    cache.set(`i:${type}`, s);
  }
  return s;
}
