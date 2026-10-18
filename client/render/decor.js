// Decoration, fortification, pier and unit sprites.

import { Pix, srng } from './pix.js';
import { shade } from './color.js';
import { featureSprite } from './nature.js';
import { F } from '../../engine/world/biomes.js';

const cache = new Map();
const OUT = '#231a16';

function cached(key, make) {
  let s = cache.get(key);
  if (!s) {
    const p = make();
    s = { canvas: p.toCanvas(), w: p.w, h: p.h };
    cache.set(key, s);
  }
  return s;
}

/** Decor sprites are anchored at the bottom-centre of their tile. */
export function decorSprite(kind, color = '#c83a3a', style = 'farm') {
  if (kind === 'yardtree') return featureSprite(F.OAK, 1);
  return cached(`d:${kind}:${color}:${style}`, () => {
    const p = new Pix(18, 22);
    const r = srng(kind.length * 131 + kind.charCodeAt(0));
    const by = 20; // ground line
    switch (kind) {
      case 'well': {
        p.ellipse(9, by - 3, 6, 3.2, (dx, dy) => (dy < -0.2 ? '#716a67' : '#a39d97'));
        p.ellipse(9, by - 4, 4, 2, '#2f5a6e');
        p.vline(4, by - 13, by - 4, '#6f5030');
        p.vline(14, by - 13, by - 4, '#6f5030');
        for (let x = 3; x <= 15; x++) p.set(x, by - 14, '#a8452f');
        for (let x = 4; x <= 14; x++) p.set(x, by - 15, '#c0573c');
        p.vline(9, by - 13, by - 7, '#8f8a86');
        p.rect(8, by - 8, 3, 2, '#7a5632');
        break;
      }
      case 'fountain': {
        p.ellipse(9, by - 3, 8, 3.6, (dx, dy) => (dy < 0 ? '#948d88' : '#b8b1a9'));
        p.ellipse(9, by - 4, 6.5, 2.4, '#5094a8');
        p.rect(8, by - 11, 3, 8, '#b8b1a9');
        p.ellipse(9, by - 11, 3, 1.4, '#a39d97');
        p.set(9, by - 14, '#d6efe9');
        p.set(8, by - 13, '#d6efe9');
        p.set(10, by - 13, '#d6efe9');
        p.set(6, by - 6, '#d6efe9');
        p.set(12, by - 6, '#d6efe9');
        break;
      }
      case 'stall': {
        const cols = [['#d24a3a', '#f4ecdc'], ['#3a68c8', '#f4ecdc'], ['#2f9a5a', '#f4ecdc']][Math.floor(r() * 3)];
        for (let x = 2; x <= 15; x++) {
          p.set(x, by - 12, cols[(x >> 1) % 2]);
          p.set(x, by - 11, cols[(x >> 1) % 2]);
          p.set(x, by - 10, shade(cols[(x >> 1) % 2], -0.25));
        }
        p.vline(3, by - 9, by, '#6f5030');
        p.vline(14, by - 9, by, '#6f5030');
        p.rect(3, by - 4, 12, 3, '#8f6a3e');
        const goods = ['#e05a3a', '#7cbf5a', '#e8c060', '#a05a32', '#d88ac0'];
        for (let x = 4; x < 14; x++) p.set(x, by - 5, goods[(x + kind.length) % goods.length]);
        break;
      }
      case 'logs':
        for (const [x, y] of [[5, by - 2], [10, by - 2], [7.5, by - 5]]) {
          p.ellipse(x, y, 4, 2, (dx) => (dx < -0.6 ? '#d8b07a' : '#8f6a3e'));
          p.set(Math.round(x - 3), Math.round(y), '#c49a62');
        }
        break;
      case 'stump':
        p.ellipse(9, by - 2, 4, 2.4, '#6f5030');
        p.ellipse(9, by - 3, 3.4, 1.6, '#d8b07a');
        p.set(9, by - 3, '#8f6a3e');
        break;
      case 'stones':
        for (const [x, y, w] of [[4, by - 4, 5], [10, by - 4, 5], [7, by - 8, 5]]) {
          p.rect(x, y, w, 4, '#a39d97');
          p.hline(x, x + w - 1, y, '#c9c2b8');
          p.vline(x + w - 1, y, y + 3, '#7c7570');
        }
        break;
      case 'crystals':
        for (const [x, h] of [[6, 8], [9, 11], [12, 7]]) {
          for (let j = 0; j < h; j++) {
            p.set(x, by - j, j > h - 3 ? '#f0c8ff' : '#b45aff');
            p.set(x + 1, by - j + 1, '#8a3ad8');
          }
        }
        break;
      case 'cart':
        p.rect(3, by - 7, 11, 4, '#8f6a3e');
        p.hline(3, 13, by - 7, '#b48b5a');
        p.ellipse(5, by - 2, 2, 2, '#4a3a2a');
        p.ellipse(12, by - 2, 2, 2, '#4a3a2a');
        p.line(14, by - 5, 17, by - 3, '#6f5030');
        p.rect(5, by - 9, 6, 2, '#a39d97');
        break;
      case 'charcoal':
        p.ellipse(9, by - 3, 6, 3.5, (dx, dy) => (dy < -0.3 ? '#4a4450' : '#2a262f'));
        p.set(8, by - 5, '#5e5866');
        break;
      case 'hay':
        p.ellipse(9, by - 4, 6, 4.5, (dx, dy) => (dx + dy < -0.4 ? '#f0d27a' : dx + dy > 0.6 ? '#b8932f' : '#d9b54a'));
        for (let x = 4; x < 15; x += 3) p.over(x, by - 4, '#b8932f');
        break;
      case 'sacks':
        for (const x of [5, 10]) {
          p.ellipse(x, by - 3, 3, 3.5, (dx) => (dx < -0.3 ? '#e8dcc0' : '#c8b898'));
          p.set(x, by - 7, '#8a6a44');
        }
        break;
      case 'crates':
        for (const [x, y] of [[3, by - 6], [9, by - 6], [6, by - 12]]) {
          p.rect(x, y, 6, 6, '#a07446');
          p.hline(x, x + 5, y, '#c49a62');
          p.line(x, y + 5, x + 5, y, '#6f5030');
          p.vline(x + 5, y, y + 5, '#6f5030');
        }
        break;
      case 'barrels':
        for (const x of [5, 11]) {
          p.ellipse(x, by - 4, 3, 4.5, (dx) => (dx < -0.4 ? '#b48b5a' : '#8a5a32'));
          p.hline(x - 3, x + 2, by - 6, '#4a3a2a');
          p.hline(x - 3, x + 2, by - 2, '#4a3a2a');
        }
        break;
      case 'anvil':
        p.rect(5, by - 6, 9, 3, '#5e5856');
        p.hline(5, 13, by - 6, '#8f8a86');
        p.rect(7, by - 3, 5, 3, '#4e4846');
        p.rect(3, by - 5, 2, 2, '#5e5856');
        break;
      case 'dummy':
        p.vline(9, by - 14, by, '#6f5030');
        p.hline(5, 13, by - 10, '#6f5030');
        p.ellipse(9, by - 13, 2.5, 2.5, '#d9b54a');
        p.rect(7, by - 10, 5, 6, '#c8b898');
        break;
      case 'rack':
        p.hline(3, 15, by - 8, '#6f5030');
        p.hline(3, 15, by - 2, '#6f5030');
        for (let x = 4; x < 15; x += 3) {
          p.vline(x, by - 15, by - 1, '#8f8a86');
          p.set(x, by - 16, '#c9c2b8');
        }
        break;
      case 'trough':
        p.rect(3, by - 4, 13, 4, '#8f6a3e');
        p.hline(4, 14, by - 4, '#5094a8');
        break;
      case 'herbbed':
        p.rect(2, by - 4, 14, 4, '#6a4a2e');
        for (let x = 3; x < 15; x += 2) {
          p.set(x, by - 5, x % 4 === 1 ? '#c79bff' : '#6aa848');
          p.set(x, by - 6, '#4f8a3a');
        }
        break;
      case 'nets':
        p.vline(3, by - 12, by, '#6f5030');
        p.vline(15, by - 12, by, '#6f5030');
        for (let y = by - 11; y < by - 3; y += 2) for (let x = 4; x < 15; x += 2) p.set(x + ((y >> 1) % 2), y, '#c8c0a8');
        break;
      case 'banner':
        p.vline(8, by - 18, by, '#4a3a2a');
        p.rect(9, by - 18, 6, 6, color);
        p.hline(9, 14, by - 12, shade(color, -0.3));
        p.set(10, by - 17, shade(color, 0.35));
        p.set(15, by - 16, color);
        break;
      case 'campfire':
        for (const [x, y] of [[5, by - 1], [13, by - 1], [9, by - 3]]) p.ellipse(x, y, 2.4, 1.2, '#6f5030');
        p.ellipse(9, by - 4, 3, 3.6, '#ff8a3a');
        p.ellipse(9, by - 4, 1.6, 2.4, '#ffe08a');
        p.set(9, by - 9, '#ff8a3a');
        break;
      case 'lamp':
        p.vline(9, by - 14, by, '#3e3836');
        p.rect(7, by - 17, 5, 4, '#3e3836');
        p.rect(8, by - 16, 3, 2, '#ffe08a');
        break;
      default:
        p.ellipse(9, by - 3, 3, 3, '#9a7a4a');
    }
    p.outline(OUT);
    return p;
  });
}

// ---------------------------------------------------------------------------
// Fortifications

/**
 * Wall segment for a cell given its neighbours (n, e, s, w booleans meaning
 * "wall or gate continues that way"). level: 1 palisade, 2 stone, 3 fortress.
 */
export function wallSprite(level, n, e, s, w, tower, style) {
  return cached(`w:${level}:${+n}${+e}${+s}${+w}:${+tower}:${style}`, () => {
    const p = new Pix(18, 34);
    const ox = 1;
    const by = 32; // bottom of tile in sprite
    const H = level === 1 ? 12 : level === 2 ? 14 : 17;
    const stone = style === 'adobe' ? ['#d3ad78', '#b48c5c', '#e6c694', '#a07c50'] : style === 'ash' ? ['#4a4450', '#35303a', '#5e5866', '#2a262f'] : ['#a19b95', '#7c7570', '#bcb5ac', '#69615e'];
    const [base, dark, light, mortar] = stone;
    if (level === 1) {
      // Palisade: sharpened stakes.
      const stakes = [];
      if (e || w || !(n || s)) for (let x = (w ? 0 : 4); x < (e ? 16 : 12); x += 2) stakes.push([x, by - 4]);
      if (n || s) for (let y = (n ? -8 : 2); y <= (s ? 12 : 8); y += 2) stakes.push([7, by - 8 + y]);
      stakes.sort((a, b) => a[1] - b[1]);
      for (const [x, y] of stakes) {
        for (let j = 0; j < H; j++) {
          p.set(ox + x, y - j, j === H - 1 ? '#c49a62' : '#8f6a3e');
          p.set(ox + x + 1, y - j, j === H - 1 ? '#8f6a3e' : '#6f5030');
        }
        p.set(ox + x, y - H, '#6f5030');
      }
    } else {
      // Stone: walkway top + exposed front face where the run turns or ends.
      const front = !s;
      const x0 = w ? 0 : 3;
      const x1 = e ? 15 : 12;
      const topY = by - H - (n ? 16 : 6);
      for (let y = topY; y <= by; y++) {
        for (let x = x0; x <= x1; x++) {
          const inNS = (n || s) && x >= 3 && x <= 12;
          const inEW = (e || w || !(n || s)) && y >= by - H - 6;
          if (!inNS && !inEW) continue;
          if (inNS && !n && y < by - H - 6) continue;
          const isFront = front && y > by - H + 1 && (inEW || (inNS && y > by - H + 1));
          let c;
          if (isFront && y >= by - H + 2) {
            const ry = y - (by - H);
            c = ry % 4 === 3 || (x + (Math.floor(ry / 4) % 2) * 3) % 6 === 0 ? mortar : base;
          } else {
            c = (x + y) % 9 === 0 ? dark : shade(base, -0.08);
            if (x === x0 || x === x1) c = light;
          }
          p.set(ox + x, y, c);
        }
      }
      // Crenellations on the outer edges.
      for (let x = x0; x <= x1; x++) if ((x % 4) < 2 && (e || w || !(n || s))) {
        p.set(ox + x, by - H - 7, light);
        p.set(ox + x, by - H - 8, light);
      }
    }
    if (tower) {
      const tH = level === 1 ? 20 : level === 2 ? 22 : 27;
      const col = level === 1 ? ['#8f6a3e', '#6f5030', '#c49a62'] : [base, dark, light];
      for (let y = by - tH; y <= by; y++) for (let x = 2; x <= 13; x++) {
        let c = x === 2 ? col[2] : x === 13 ? col[1] : col[0];
        if (level > 1 && ((y % 4 === 3) || (x + (Math.floor(y / 4) % 2) * 3) % 6 === 0)) c = mortar;
        if (level === 1 && x % 3 === 0) c = col[1];
        p.set(ox + x, y, c);
      }
      for (let x = 1; x <= 14; x++) if (x % 3 !== 0) {
        p.set(ox + x, by - tH - 1, col[2]);
        p.set(ox + x, by - tH - 2, col[2]);
      }
      p.rect(ox + 7, by - tH + 6, 2, 3, '#2a2226');
      if (level === 3) {
        for (let y = by - tH - 9; y < by - tH - 2; y++) {
          const half = Math.round(((y - (by - tH - 9)) / 7) * 7);
          for (let x = 8 - half; x <= 7 + half; x++) p.set(ox + x, y, x < 8 ? '#62759a' : '#4d6088');
        }
      }
    }
    p.outline(OUT);
    return p;
  });
}

/** Gatehouse over a road crossing the wall; horizontal = wall runs east-west. */
export function gateSprite(level, horizontal, style) {
  return cached(`g:${level}:${+horizontal}:${style}`, () => {
    const p = new Pix(18, 36);
    const ox = 1;
    const by = 34;
    const stone = style === 'adobe' ? ['#d3ad78', '#b48c5c', '#e6c694'] : style === 'ash' ? ['#4a4450', '#35303a', '#5e5866'] : ['#a19b95', '#7c7570', '#bcb5ac'];
    const col = level === 1 ? ['#8f6a3e', '#6f5030', '#c49a62'] : stone;
    const H = level === 1 ? 16 : level === 2 ? 20 : 24;
    if (horizontal) {
      for (const x0 of [0, 12]) {
        for (let y = by - H; y <= by; y++) for (let x = x0; x < x0 + 4; x++) p.set(ox + x, y, x === x0 ? col[2] : col[0]);
      }
      for (let y = by - H; y < by - H + 5; y++) for (let x = 0; x < 16; x++) p.set(ox + x, y, y === by - H ? col[2] : col[1]);
      for (let x = 0; x < 16; x += 3) {
        p.set(ox + x, by - H - 1, col[2]);
        p.set(ox + x + 1, by - H - 1, col[2]);
      }
    } else {
      for (const y0 of [by - 16, by]) {
        for (let y = y0 - 6; y <= y0; y++) for (let x = 4; x < 12; x++) p.set(ox + x, y - (y0 === by ? 0 : 0), x === 4 ? col[2] : col[0]);
      }
    }
    p.outline(OUT);
    return p;
  });
}

/** Rowing boat moored at a pier. */
export function boatSprite(v = 0) {
  return cached(`boat:${v}`, () => {
    const p = new Pix(18, 10);
    p.ellipse(9, 5, 8, 3.2, (dx, dy) => (dy < -0.2 ? '#b48b5a' : '#7a5632'));
    p.ellipse(9, 4.5, 6, 1.8, '#5a3e24');
    p.hline(5, 13, 4, '#8f6a3e');
    if (v % 2) {
      p.vline(9, -1, 4, '#6f5030');
      p.rect(10, 0, 4, 3, '#f0ece0');
    }
    p.outline(OUT);
    return p;
  });
}

/** A boat at sea, facing right: a troop boat under the owner's sail, or a trading cog. */
export function shipSprite(kind, color) {
  return cached(`ship:${kind}:${color}`, () => {
    if (kind === 'trade') {
      const p = new Pix(22, 18);
      p.rect(3, 12, 16, 3, '#7a5632');
      p.hline(2, 19, 11, '#b48b5a');
      p.hline(5, 17, 15, '#5a3e24');
      p.rect(16, 9, 4, 3, '#8f6a3e');
      p.vline(10, 1, 11, '#5a3e24');
      p.rect(5, 2, 10, 7, '#f0ece0');
      for (let y = 3; y < 9; y += 2) p.hline(5, 14, y, shade(color, -0.1));
      p.set(10, 0, color);
      p.outline(OUT);
      return p;
    }
    const p = new Pix(18, 15);
    p.ellipse(9, 11, 7.5, 2.6, (dx, dy) => (dy < -0.2 ? '#b48b5a' : '#7a5632'));
    p.hline(4, 14, 10, '#8f6a3e');
    p.vline(8, 1, 10, '#5a3e24');
    for (let y = 2; y < 9; y++) p.hline(9, 9 + Math.max(1, Math.round((y - 1) * 0.8)), y, y < 5 ? color : shade(color, -0.2));
    p.set(8, 0, '#f0ece0');
    p.outline(OUT);
    return p;
  });
}

// ---------------------------------------------------------------------------
// Units

/** A soldier figure; colour is the kingdom's. kind: inf | arch | cav | siege | militia. */
export function soldierSprite(kind, color, frame = 0) {
  return cached(`u:${kind}:${color}:${frame}`, () => {
    const p = new Pix(14, 16);
    const bob = frame % 2;
    const skin = '#e8b88a';
    if (kind === 'cav') {
      p.ellipse(7, 11, 5.5, 2.6, '#7a5632');
      p.vline(3, 12, 15, '#5a3e24');
      p.vline(10, 12, 15 - bob, '#5a3e24');
      p.rect(11, 7, 2, 4, '#7a5632');
      p.set(12, 6, '#5a3e24');
      p.rect(5, 4 + bob, 4, 5, color);
      p.rect(5, 1 + bob, 4, 3, skin);
      p.hline(5, 8, 1 + bob, '#8f8a86');
      p.vline(10, 0, 9, '#c9c2b8');
    } else if (kind === 'siege') {
      p.rect(2, 9, 10, 3, '#8f6a3e');
      p.ellipse(4, 13, 2, 2, '#4a3a2a');
      p.ellipse(10, 13, 2, 2, '#4a3a2a');
      p.line(4, 9, 11, 2, '#6f5030');
      p.ellipse(11, 2, 1.6, 1.6, '#7c7570');
      p.set(7, 8, color);
      p.set(8, 8, color);
    } else {
      p.rect(5, 6 + bob, 4, 5, kind === 'militia' ? '#8a7a5a' : color);
      p.hline(5, 8, 8 + bob, shade(kind === 'militia' ? '#8a7a5a' : color, -0.3));
      p.rect(5, 3 + bob, 4, 3, skin);
      p.hline(5, 8, 2 + bob, kind === 'militia' ? '#6a4a2e' : '#8f8a86');
      p.hline(5, 8, 3 + bob, kind === 'militia' ? '#6a4a2e' : '#aca69f');
      p.vline(5, 11 + bob, 14, '#4a3a2a');
      p.vline(8, 11 + bob, 14, '#4a3a2a');
      if (kind === 'arch') {
        p.line(10, 3, 11, 7, '#8f6a3e');
        p.line(11, 7, 10, 11, '#8f6a3e');
        p.vline(10, 3, 11, '#e8e0c8');
      } else {
        p.vline(10, 0 + bob, 13, '#8f6a3e');
        p.set(10, 0 + bob, '#c9c2b8');
        p.rect(2, 7 + bob, 3, 4, shade(color, -0.15));
      }
    }
    p.outline(OUT);
    return p;
  });
}

/** Wagons: caravan (trade), settlers, scout rider. */
export function wagonSprite(kind, color, frame = 0) {
  return cached(`wg:${kind}:${color}:${frame}`, () => {
    const p = new Pix(24, 16);
    const bob = frame % 2;
    if (kind === 'scout') {
      p.ellipse(10, 10, 5.5, 2.6, '#9a6a3a');
      p.vline(6, 11, 15, '#6a4a2a');
      p.vline(14, 11, 15 - bob, '#6a4a2a');
      p.rect(15, 6, 2, 4, '#9a6a3a');
      p.rect(8, 3 + bob, 4, 5, color);
      p.rect(8, 0 + bob, 4, 3, '#e8b88a');
      p.hline(7, 12, 0 + bob, '#3a6a3a');
    } else {
      // Horse.
      p.ellipse(19, 9, 3.6, 2.2, '#8a5a32');
      p.rect(21, 5, 2, 4, '#8a5a32');
      p.vline(17, 10, 14, '#5a3a20');
      p.vline(21, 10, 14 - bob, '#5a3a20');
      // Wagon body and cover.
      p.rect(2, 7, 13, 5, '#8f6a3e');
      p.hline(2, 14, 7, '#b48b5a');
      if (kind === 'settlers') {
        p.ellipse(8.5, 6, 6.5, 4.5, (dx, dy) => (dy < -0.3 ? '#f4ecdc' : '#d8ccb0'));
        p.set(8, 5, color);
        p.set(9, 5, color);
      } else {
        p.rect(3, 3, 5, 4, '#c8b898');
        p.rect(9, 4, 5, 3, color);
        p.hline(9, 13, 4, shade(color, 0.3));
      }
      p.ellipse(5, 13, 2.2, 2.2, '#4a3a2a');
      p.ellipse(12, 13, 2.2, 2.2, '#4a3a2a');
      p.set(5, 13, '#8a6a44');
      p.set(12, 13, '#8a6a44');
      p.line(15, 9, 17, 9, '#5a3a20');
    }
    p.outline(OUT);
    return p;
  });
}
