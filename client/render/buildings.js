// Building sprites in 3/4 top-down view. Each building is painted from parts
// (walls in a style's material, gable or flat roofs, windows, doors, towers,
// awnings) for its footprint, style, level and variant, then cached.
//
// Sprite frame: footprint is w×h tiles (16 px). The sprite is wider by one
// outline pixel per side and taller by `extra` pixels above the footprint.

import { Pix, srng } from './pix.js';
import { ARCH } from './palette.js';
import { shade, mix } from './color.js';

const cache = new Map();
const OUT = '#231a16';

const STONE = {
  default: { base: '#9a99a2', dark: '#77767f', light: '#b5b4bc', mortar: '#66656e' },
  adobe: { base: '#d3ad78', dark: '#b48c5c', light: '#e6c694', mortar: '#a07c50' },
  ash: { base: '#4a4450', dark: '#35303a', light: '#5e5866', mortar: '#2a262f' },
  nordic: { base: '#8d8c92', dark: '#6c6b72', light: '#a8a7ad', mortar: '#5a5960' },
};
const stoneOf = (style) => STONE[style] || STONE.default;

// ---------------------------------------------------------------------------
// Parts

function wallMaterial(style) {
  return { farm: 'plaster', timber: 'logs', stone: 'stone', harbor: 'whitewash', stilt: 'planks', adobe: 'adobe', nordic: 'logs', ash: 'basalt', free: 'plaster' }[style] || 'plaster';
}

function paintWall(p, x0, x1, y0, y1, pal, material, rnd, style) {
  const st = stoneOf(style);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let c = pal.wall;
      const ry = y - y0;
      const rx = x - x0;
      switch (material) {
        case 'logs':
          c = ry % 3 === 2 ? pal.wallDark : rnd() < 0.08 ? shade(pal.wall, 0.08) : pal.wall;
          if ((rx === 0 || x === x1) && ry % 3 !== 2) c = pal.frame;
          break;
        case 'stone':
        case 'basalt': {
          const s = material === 'basalt' ? STONE.ash : st;
          const joint = ry % 4 === 3 || (rx + (Math.floor(ry / 4) % 2) * 3) % 6 === 0;
          c = joint ? s.mortar : rnd() < 0.15 ? s.light : rnd() < 0.1 ? s.dark : s.base;
          break;
        }
        case 'planks':
          c = rx % 4 === 3 ? pal.wallDark : pal.wall;
          break;
        case 'adobe':
          c = rnd() < 0.06 ? pal.wallDark : pal.wall;
          break;
        case 'whitewash':
          c = rnd() < 0.05 ? pal.wallDark : pal.wall;
          if (y > y1 - 2) c = st.base;
          break;
        default: // plaster with timber framing
          c = pal.wall;
          if (rx === 0 || x === x1 || ry === 0 || (rx % 8 === 0 && rx > 0 && x < x1 - 1)) c = pal.frame;
          break;
      }
      p.set(x, y, c);
    }
  }
  // Shaded base course.
  for (let x = x0; x <= x1; x++) p.set(x, y1, shade(material === 'logs' || material === 'planks' ? pal.wallDark : pal.base, -0.1));
}

function paintGableRoof(p, x0, x1, y0, y1, pal, { snow = false, ridge = 0.38, thatch = false, rnd }) {
  const ridgeY = y0 + Math.max(2, Math.round((y1 - y0) * ridge));
  const back = thatch ? pal.thatchDark : pal.roofDark;
  const front = thatch ? pal.thatch : pal.roof;
  const light = thatch ? shade(pal.thatch, 0.15) : pal.roofLight;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let c;
      if (y < ridgeY) {
        c = back;
        if ((y - y0) % 2 === 1 && rnd() < 0.25) c = shade(back, -0.08);
      } else if (y === ridgeY) {
        c = shade(front, -0.25);
      } else {
        const ry = y - ridgeY;
        c = front;
        if (thatch) {
          if (ry % 2 === 0 && rnd() < 0.35) c = shade(front, -0.12);
          if (rnd() < 0.06) c = light;
        } else {
          if (ry % 3 === 0) c = shade(front, -0.18);
          else if ((x + (Math.floor(ry / 3) % 2) * 2) % 4 === 0) c = shade(front, -0.1);
          else if (ry % 3 === 1 && rnd() < 0.2) c = light;
        }
      }
      if (x === x0 || x === x1) c = shade(c, -0.2); // verges
      if (y === y1) c = shade(front, -0.35); // eave shadow
      if (snow && y <= ridgeY + 1 + ((x * 7) % 3 === 0 ? 1 : 0)) c = y <= ridgeY ? pal.snow || '#f3f7fb' : pal.snowDark || '#d7e2ec';
      p.set(x, y, c);
    }
  }
  return ridgeY;
}

function paintFlatRoof(p, x0, x1, y0, y1, pal, variant = 0) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let c = pal.roof;
      if (x === x0 || x === x1 || y === y0) c = pal.roofLight; // parapet
      else if (x === x0 + 1 || y === y0 + 1) c = shade(pal.roof, -0.12); // parapet shadow
      else if (y >= y1 - 1) c = pal.roofDark;
      else if ((x * 7 + y * 3) % 23 === 0) c = shade(pal.roof, 0.08);
      p.set(x, y, c);
    }
  }
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 8 || h < 6) return;
  if (variant % 3 === 0) {
    // Little dome over the stair.
    const cx = x0 + 4;
    const cy = y0 + 4;
    p.ellipse(cx, cy, 3, 2.5, (dx, dy) => (dx + dy < -0.3 ? '#efdcae' : '#c9a876'));
  } else if (variant % 3 === 1) {
    // Roof hatch with a ladder.
    p.rect(x1 - 5, y0 + 3, 3, 3, '#5a3e24');
    p.vline(x1 - 5, y0 + 2, y0 + 6, '#8f6a3e');
    p.vline(x1 - 3, y0 + 2, y0 + 6, '#8f6a3e');
  } else {
    // Water jars and a drying cloth.
    p.ellipse(x0 + 4, y0 + 4, 1.6, 1.6, '#a0603a');
    p.ellipse(x0 + 7, y0 + 4, 1.6, 1.6, '#b8703f');
    p.hline(x0 + 3, x1 - 3, y1 - 3, '#d24a3a');
  }
}

function paintWindow(p, x, y, pal, { lit = false, tall = false } = {}) {
  const h = tall ? 4 : 3;
  for (let j = 0; j < h; j++) for (let i = 0; i < 3; i++) p.set(x + i, y + j, lit ? (j === 0 ? '#ffe7a0' : '#f2b84a') : pal.window);
  p.set(x, y, lit ? '#fff2c8' : shade(pal.window, 0.35));
  for (let i = -1; i <= 3; i++) p.set(x + i, y + h, pal.trim || '#e8dcc4');
}

function paintDoor(p, x, y1, pal, { w = 4, h = 7, arch = false } = {}) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let c = pal.door;
      if (i === w - 1 || j === 0) c = shade(pal.door, -0.25);
      if (arch && j === 0 && (i === 0 || i === w - 1)) continue;
      p.set(x + i, y1 - h + 1 + j, c);
    }
  }
  p.set(x + w - 2, y1 - (h >> 1), '#e8c060'); // handle
}

function paintChimney(p, x, y, pal, smoke = false) {
  p.rect(x, y, 3, 5, '#7a6e66');
  p.hline(x, x + 2, y, '#5a504a');
  p.set(x + 2, y + 2, '#5a504a');
  if (smoke) {
    p.set(x + 1, y - 2, '#d8d4d0', 0.8);
    p.set(x + 2, y - 3, '#e8e4e0', 0.6);
    p.set(x + 1, y - 4, '#f0ece8', 0.45);
  }
}

function paintBanner(p, x, y, color) {
  p.vline(x, y, y + 10, '#4a3a2a');
  p.rect(x + 1, y, 5, 4, color);
  p.hline(x + 1, x + 5, y + 4, shade(color, -0.3));
  p.set(x + 6, y + 1, color);
  p.set(x + 6, y + 2, shade(color, -0.2));
  p.set(x + 2, y + 1, shade(color, 0.35));
}

function paintCrenels(p, x0, x1, y, col, dark) {
  for (let x = x0; x <= x1; x++) {
    const merlon = ((x - x0) % 4) < 2;
    p.set(x, y + 2, col);
    if (merlon) {
      p.set(x, y, col);
      p.set(x, y + 1, col);
    }
    p.set(x, y + 3, dark);
  }
}

// ---------------------------------------------------------------------------
// Composite painters

/** Generic house body: walls + roof + openings. Returns geometry for extras. */
function paintHouse(p, ox, oy, FW, FH, extra, style, pal, opts) {
  const { level = 1, face = 's', doorX = null, rnd, lit = false, thatch = false, chimney = true, storyH = 7 } = opts;
  const wallH = 4 + storyH * level;
  const bottom = oy + FH + extra - 1;
  const wallTop = bottom - wallH + 1;
  const x0 = ox + 1;
  const x1 = ox + FW - 2;
  const material = wallMaterial(style);
  const raised = style === 'stilt' ? 4 : 0;
  const wb = bottom - raised;
  const wt = wallTop - raised;
  if (raised) {
    for (let x = x0 + 1; x <= x1; x += 5) p.vline(x, wb + 1, bottom, '#4f3a22');
    p.hline(x0, x1, wb + 1, '#5b4326');
  }
  paintWall(p, x0, x1, wt, wb, pal, material, rnd, style);
  // Roof covers the rest of the footprint plus the extra height.
  const roofTop = oy;
  const roofBot = wt + 1;
  if (style === 'adobe') paintFlatRoof(p, x0, x1, roofTop + 3, roofBot, pal, opts.variant || 0);
  else paintGableRoof(p, ox, ox + FW - 1, roofTop, roofBot, pal, { snow: style === 'nordic', thatch, rnd });
  // Windows per storey, door on the visible face.
  const doorPos = face === 's' && doorX !== null ? doorX : null;
  for (let s = 0; s < level; s++) {
    const wy = wb - 4 - s * storyH - (s === 0 ? 1 : 0) - 2;
    for (let x = x0 + 3; x <= x1 - 5; x += 7) {
      if (doorPos !== null && s === 0 && Math.abs(x + 1 - doorPos) < 5) continue;
      paintWindow(p, x, wy, pal, { lit: lit || (style === 'nordic' || style === 'ash') });
    }
  }
  if (doorPos !== null) paintDoor(p, Math.max(x0 + 1, Math.min(x1 - 4, doorPos - 2)), wb - 1, pal, { arch: style === 'adobe' || style === 'stone' });
  if (chimney && style !== 'adobe') paintChimney(p, x1 - 6 - (opts.variant % 2) * 8, roofTop + 2, pal, opts.variant % 3 === 0);
  return { x0, x1, wt, wb, roofTop, roofBot, bottom };
}

function stoneBlock(p, x0, y0, x1, y1, st, rnd) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const ry = y - y0;
      const joint = ry % 4 === 3 || (x + (Math.floor(ry / 4) % 2) * 3) % 6 === 0;
      let c = joint ? st.mortar : rnd() < 0.12 ? st.light : rnd() < 0.08 ? st.dark : st.base;
      if (x === x0) c = st.light;
      if (x === x1) c = st.dark;
      p.set(x, y, c);
    }
  }
}

function castleTower(p, cx, half, yTop, yBot, st, roof, rnd) {
  // A round tower: shaded shaft, crenellated or conical top.
  for (let y = yTop + 4; y <= yBot; y++) {
    for (let x = cx - half; x <= cx + half; x++) {
      const rel = (x - cx) / half;
      let c = rel < -0.5 ? st.light : rel > 0.55 ? st.dark : (y + (x >> 1)) % 5 === 0 ? st.mortar : st.base;
      if (rnd() < 0.05) c = st.dark;
      p.set(x, y, c);
    }
  }
  p.rect(cx, yTop + 9, 1, 3, '#26222a');
  if (roof) {
    for (let y = yTop - 6; y < yTop + 5; y++) {
      const t = (y - (yTop - 6)) / 10;
      const w = Math.round((half + 1) * t);
      for (let x = cx - w; x <= cx + w; x++) p.set(x, y, x < cx ? shade(roof, 0.18) : x > cx + w / 2 ? shade(roof, -0.15) : roof);
    }
    p.set(cx, yTop - 7, '#e8c060');
  } else {
    for (let x = cx - half - 1; x <= cx + half + 1; x++) {
      p.set(x, yTop + 3, st.light);
      p.set(x, yTop + 4, st.dark);
      if ((x - cx + half + 1) % 3 !== 2) {
        p.set(x, yTop + 1, st.light);
        p.set(x, yTop + 2, st.base);
      }
    }
  }
}

/** The capital's seat: lord's hall (1), walled keep (2), castle (3). */
function keep(p, ox, oy, FW, FH, extra, style, pal, o) {
  const st = stoneOf(style);
  const bottom = oy + FH + extra - 1;
  const top = oy + extra; // footprint top edge
  const lvl = o.level;
  const rnd = o.rnd;
  const roofCol = style === 'adobe' ? '#c9a24a' : style === 'ash' ? '#7b2f2b' : style === 'nordic' ? '#4a3524' : style === 'harbor' ? '#3d7ba3' : '#3f5f9e';
  const cx = ox + (FW >> 1);
  if (lvl >= 2) {
    // Courtyard enclosed by curtain walls seen from above.
    for (let y = top; y <= bottom - 10; y++) {
      for (let x = ox + 2; x <= ox + FW - 3; x++) {
        const c = (x + (y >> 1) * 3) % 5 === 0 || y % 4 === 0 ? '#8e897f' : '#b4ae9f';
        p.set(x, y, c);
      }
    }
    // Back wall walkway.
    for (let y = top - 3; y <= top + 2; y++) for (let x = ox + 1; x <= ox + FW - 2; x++) p.set(x, y, y === top - 3 ? st.light : y > top ? st.dark : st.base);
    for (let x = ox + 1; x <= ox + FW - 2; x += 3) {
      p.set(x, top - 4, st.light);
      p.set(x, top - 5, st.light);
    }
    // Side walls.
    for (let y = top - 3; y <= bottom - 10; y++) {
      for (const x0 of [ox + 1, ox + FW - 6]) {
        for (let x = x0; x < x0 + 5; x++) p.set(x, y, x === x0 ? st.light : x === x0 + 4 ? st.dark : st.base);
      }
    }
  }
  // The donjon: a tall square tower.
  const dw = Math.max(14, Math.round(FW * (lvl >= 3 ? 0.42 : 0.34)));
  const dcx = lvl === 1 ? ox + FW - Math.round(dw / 2) - 3 : cx + (lvl === 2 ? Math.round(FW * 0.12) : 0);
  const dBot = lvl >= 2 ? bottom - 9 : bottom;
  const dTop = oy + (lvl >= 3 ? 8 : 12);
  const dx0 = dcx - (dw >> 1);
  const dx1 = dcx + (dw >> 1);
  // Great hall (left) with a pitched roof, built against the donjon.
  if (lvl <= 2) {
    const hx0 = ox + (lvl >= 2 ? 7 : 2);
    const hx1 = lvl === 1 ? dx0 + 1 : ox + Math.round(FW * 0.5);
    const hb = lvl >= 2 ? bottom - 11 : bottom;
    const ht = hb - 11;
    paintWall(p, hx0 + 1, hx1 - 1, ht, hb, pal, wallMaterial(style), rnd, style);
    paintGableRoof(p, hx0, hx1, hb - FH + 10, ht + 1, { ...pal, roof: roofCol, roofDark: shade(roofCol, -0.25), roofLight: shade(roofCol, 0.18) }, { rnd, snow: style === 'nordic' });
    for (let x = hx0 + 4; x < hx1 - 4; x += 6) paintWindow(p, x, hb - 7, pal, { lit: true });
  }
  // Top surface then front face.
  for (let y = dTop - 4; y < dTop; y++) for (let x = dx0; x <= dx1; x++) p.set(x, y, (x + y) % 6 === 0 ? st.dark : shade(st.base, -0.15));
  stoneBlock(p, dx0, dTop, dx1, dBot, st, rnd);
  for (let x = dx0 - 1; x <= dx1 + 1; x++) {
    p.set(x, dTop - 1, st.light);
    p.set(x, dTop, st.dark);
    if ((x - dx0 + 1) % 4 < 2) {
      p.set(x, dTop - 5, st.light);
      p.set(x, dTop - 6, st.light);
    }
  }
  if (lvl >= 3) {
    // Pyramid roof on the great tower.
    for (let y = dTop - 18; y < dTop - 4; y++) {
      const t = (y - (dTop - 18)) / 13;
      const w = Math.round((dw / 2 + 1) * t);
      for (let x = dcx - w; x <= dcx + w; x++) p.set(x, y, x < dcx ? shade(roofCol, 0.15) : shade(roofCol, -0.08));
    }
    paintBanner(p, dcx, dTop - 29, o.color);
  } else {
    paintBanner(p, dcx + 2, dTop - 16, o.color);
  }
  // Windows and slits on the donjon.
  for (let y = dTop + 5; y < dBot - 8; y += 9) {
    p.rect(dcx - 4, y, 2, 4, '#26222a');
    p.rect(dcx + 3, y, 2, 4, '#26222a');
  }
  p.rect(dcx - 1, dTop + 4, 3, 3, '#ffd88a');
  if (lvl === 1) {
    // Hall door and steps.
    paintDoor(p, dcx - 2, bottom - 1, pal, { w: 5, h: 8, arch: true });
    return;
  }
  // Front curtain wall with a gatehouse.
  stoneBlock(p, ox + 1, bottom - 10, ox + FW - 2, bottom, st, rnd);
  for (let x = ox + 1; x <= ox + FW - 2; x++) {
    p.set(x, bottom - 11, st.light);
    if ((x - ox) % 4 < 2) {
      p.set(x, bottom - 12, st.light);
      p.set(x, bottom - 13, st.base);
    }
  }
  const gw = 8;
  for (let y = bottom - 8; y <= bottom; y++) {
    for (let x = cx - gw / 2; x < cx + gw / 2; x++) {
      const arch = y === bottom - 8 && (x === cx - gw / 2 || x === cx + gw / 2 - 1);
      if (arch) continue;
      p.set(x, y, (x - cx) % 2 === 0 || y % 3 === 0 ? '#3a2a1e' : '#1e1814');
    }
  }
  castleTower(p, cx - gw / 2 - 3, 3, bottom - 17, bottom, st, null, rnd);
  castleTower(p, cx + gw / 2 + 2, 3, bottom - 17, bottom, st, null, rnd);
  // Corner towers.
  const roof = lvl >= 3 ? roofCol : null;
  if (lvl >= 3) {
    castleTower(p, ox + 5, 4, top - 10, top + 8, st, roof, rnd);
    castleTower(p, ox + FW - 6, 4, top - 10, top + 8, st, roof, rnd);
  }
  castleTower(p, ox + 5, 4, bottom - 22, bottom, st, roof, rnd);
  castleTower(p, ox + FW - 6, 4, bottom - 22, bottom, st, roof, rnd);
}

function temple(p, ox, oy, FW, FH, extra, style, pal, o) {
  const st = stoneOf(style);
  const bottom = oy + FH + extra - 1;
  if (style === 'adobe') {
    // Domed temple with a slender minaret.
    const g = paintHouse(p, ox, oy + 8, FW, FH - 8, extra, style, pal, { ...o, level: 2, chimney: false });
    const cx = ox + (FW >> 1);
    const r = Math.min(9, FW / 2 - 3);
    p.ellipse(cx, g.roofTop + 12, r, r * 0.9, (dx, dy) => (dx + dy < -0.4 ? shade(pal.dome, 0.15) : dx + dy > 0.6 ? pal.domeDark : pal.dome));
    p.set(cx, g.roofTop + 12 - r - 1, '#c9a24a');
    p.set(cx, g.roofTop + 12 - r - 2, '#c9a24a');
    p.rect(ox + FW - 6, oy, 4, bottom - oy - 2, st.base);
    p.vline(ox + FW - 6, oy, bottom - 2, st.light);
    p.rect(ox + FW - 7, oy + 2, 6, 2, st.dark);
    return;
  }
  const g = paintHouse(p, ox, oy + 10, FW, FH - 10, extra, style, { ...pal, roof: style === 'stone' || style === 'free' ? pal.roofDark : pal.roof }, { ...o, level: 2, chimney: false, storyH: 8 });
  // Bell tower at the front centre.
  const cx = ox + (FW >> 1);
  const tTop = oy;
  for (let y = tTop + 8; y <= g.wb; y++) {
    for (let x = cx - 4; x <= cx + 4; x++) {
      const joint = (y % 4 === 3) || ((x + (Math.floor(y / 4) % 2) * 3) % 6 === 0);
      p.set(x, y, x === cx - 4 ? st.light : x === cx + 4 ? st.dark : joint ? st.mortar : st.base);
    }
  }
  // Spire.
  const spire = style === 'nordic' ? '#3a2a1e' : style === 'harbor' ? pal.roof : '#4b5670';
  for (let y = tTop; y < tTop + 9; y++) {
    const half = Math.round(((y - tTop) / 8) * 5);
    for (let x = cx - half; x <= cx + half; x++) p.set(x, y, x < cx ? shade(spire, 0.18) : spire);
  }
  p.set(cx, tTop - 1, '#e8c060');
  // Belfry opening and rose window.
  p.rect(cx - 1, tTop + 11, 3, 3, '#2a2a30');
  p.set(cx, tTop + 13, '#e8c060');
  paintDoor(p, cx - 2, g.wb - 1, pal, { w: 5, h: 8, arch: true });
  p.ellipse(cx + 0.5, g.wb - 13, 1.6, 1.6, '#b04a6a');
}

function market(p, ox, oy, FW, FH, extra, style, pal, o) {
  // Open hall: roof on posts with striped awnings over the stalls.
  const bottom = oy + FH + extra - 1;
  const roofBot = bottom - 12;
  paintGableRoof(p, ox, ox + FW - 1, oy, roofBot, pal, { snow: style === 'nordic', rnd: o.rnd });
  for (let x = ox + 2; x <= ox + FW - 3; x++) {
    for (let y = roofBot + 1; y <= bottom; y++) p.set(x, y, '#3a2a1e');
  }
  for (let x = ox + 2; x <= ox + FW - 3; x += 7) p.vline(x, roofBot + 1, bottom, pal.frame);
  p.vline(ox + FW - 3, roofBot + 1, bottom, pal.frame);
  const stripes = [['#d24a3a', '#f4ecdc'], ['#3a68c8', '#f4ecdc'], ['#e2b02a', '#f4ecdc']];
  let k = 0;
  for (let x = ox + 3; x <= ox + FW - 9; x += 7) {
    const [a, b] = stripes[(k++ + o.variant) % stripes.length];
    for (let i = 0; i < 6; i++) {
      p.set(x + i, roofBot + 1, i % 2 ? a : b);
      p.set(x + i, roofBot + 2, i % 2 ? a : b);
      p.set(x + i, roofBot + 3, shade(i % 2 ? a : b, -0.2));
    }
    // Goods on the counter.
    const goods = ['#e05a3a', '#7cbf5a', '#e8c060', '#a05a32'];
    for (let i = 0; i < 5; i++) p.set(x + i, bottom - 4, goods[(i + k) % goods.length]);
    p.hline(x, x + 5, bottom - 3, '#8a6a44');
  }
}

function openShed(p, ox, oy, FW, FH, extra, style, pal, o, contents) {
  const bottom = oy + FH + extra - 1;
  const roofBot = bottom - 11;
  paintGableRoof(p, ox, ox + FW - 1, oy + 4, roofBot, pal, { snow: style === 'nordic', thatch: style === 'farm' || style === 'stilt', rnd: o.rnd });
  for (let x = ox + 2; x <= ox + FW - 3; x++) for (let y = roofBot + 1; y <= bottom; y++) p.set(x, y, '#3b2e24');
  p.vline(ox + 2, roofBot + 1, bottom, pal.frame);
  p.vline(ox + FW - 3, roofBot + 1, bottom, pal.frame);
  contents(roofBot + 2, bottom);
}

function mine(p, ox, oy, FW, FH, extra, style, pal, o, crystal = false) {
  const bottom = oy + FH + extra - 1;
  const cx = ox + FW / 2;
  const rock = style === 'ash' ? STONE.ash : STONE.default;
  p.ellipse(cx, bottom - 9, FW / 2 - 1, 11, (dx, dy) => (dx + dy < -0.5 ? rock.light : dx + dy > 0.5 ? rock.dark : rock.base));
  for (let y = bottom - 9; y <= bottom; y++) for (let x = Math.round(cx) - 4; x <= Math.round(cx) + 3; x++) p.set(x, y, '#1e1a18');
  p.vline(Math.round(cx) - 5, bottom - 10, bottom, '#7a5632');
  p.vline(Math.round(cx) + 4, bottom - 10, bottom, '#7a5632');
  p.hline(Math.round(cx) - 5, Math.round(cx) + 4, bottom - 10, '#8f6a3e');
  p.hline(Math.round(cx) - 3, Math.round(cx) + 2, bottom, '#8a8a90');
  if (crystal) {
    for (const [dx, h] of [[-8, 6], [-5, 8], [5, 7], [8, 5]]) {
      const x = Math.round(cx + dx);
      for (let j = 0; j < h; j++) {
        p.set(x, bottom - 12 - j, j > h - 3 ? '#f0c8ff' : '#b45aff');
        p.set(x + 1, bottom - 12 - j + 1, '#8a3ad8');
      }
    }
  }
}

function kiln(p, ox, oy, FW, FH, extra, style, pal, o) {
  const bottom = oy + FH + extra - 1;
  const cx = ox + FW / 2;
  p.ellipse(cx, bottom - 6, FW / 2 - 2, 10, (dx, dy) => (dx + dy < -0.5 ? '#b0644a' : dx + dy > 0.4 ? '#7a3e2c' : '#9a5038'));
  for (let y = bottom - 5; y <= bottom; y++) for (let x = Math.round(cx) - 3; x <= Math.round(cx) + 2; x++) p.set(x, y, y > bottom - 3 ? '#ff8a3a' : '#c24a1a');
  for (let k = 0; k < 4; k++) p.set(Math.round(cx) + (k % 2), bottom - 17 - k * 2, '#d8d4d0', 0.7 - k * 0.12);
}

function watchtower(p, ox, oy, FW, FH, extra, style, pal, o) {
  const bottom = oy + FH + extra - 1;
  const st = stoneOf(style);
  const wood = style === 'stone' || style === 'adobe' || style === 'ash' ? null : '#7a5632';
  const cx = ox + (FW >> 1);
  for (let y = oy + 10; y <= bottom; y++) {
    for (let x = cx - 4; x <= cx + 3; x++) {
      if (wood) p.set(x, y, (x === cx - 4 || x === cx + 3) ? '#5a3e24' : ((y - x) % 6 === 0 ? '#5a3e24' : null));
      else p.set(x, y, x === cx - 4 ? st.light : x === cx + 3 ? st.dark : (y % 4 === 3 ? st.mortar : st.base));
    }
  }
  p.rect(cx - 6, oy + 6, 12, 5, wood ? '#8f6a3e' : st.base);
  p.hline(cx - 6, cx + 5, oy + 10, wood ? '#5a3e24' : st.dark);
  if (wood) {
    for (let y = oy; y < oy + 6; y++) {
      const half = Math.round(((y - oy) / 5) * 7);
      for (let x = cx - half; x < cx + half; x++) p.set(x, y, x < cx ? shade(pal.roof, 0.1) : pal.roof);
    }
  } else {
    paintCrenels(p, cx - 6, cx + 5, oy + 3, st.light, st.dark);
  }
  paintBanner(p, cx + 4, oy - 4, o.color);
}

function constructionSite(p, ox, oy, FW, FH, extra, style, pal, o) {
  const bottom = oy + FH + extra - 1;
  // Foundation, scaffold poles and a partial frame.
  for (let x = ox + 1; x <= ox + FW - 2; x++) {
    p.set(x, bottom, '#8a8580');
    p.set(x, bottom - 1, '#a7a29a');
  }
  const top = bottom - Math.min(FH + extra - 6, 22);
  for (let x = ox + 2; x <= ox + FW - 3; x += 6) p.vline(x, top, bottom - 2, '#8f6a3e');
  p.vline(ox + FW - 3, top, bottom - 2, '#8f6a3e');
  for (let y = top + 3; y < bottom - 2; y += 6) p.hline(ox + 2, ox + FW - 3, y, '#b48b5a');
  for (let x = ox + 3; x < ox + FW - 3; x += 2) if (o.rnd() < 0.5) p.set(x, bottom - 3, pal.wall);
  // Crane-ish diagonal brace.
  p.line(ox + 2, bottom - 2, ox + FW - 3, top, '#6f5030');
}

// ---------------------------------------------------------------------------

/** Vertical overhang above the footprint for a kind/level. */
function extraFor(kind, level, h) {
  switch (kind) {
    case 'keep': return level >= 3 ? 30 : level >= 2 ? 22 : 18;
    case 'temple': return 18;
    case 'tower': return 22;
    case 'wonder': return 20;
    case 'granary': return 10;
    case 'hall': return 14;
    case 'mine':
    case 'crystalmine':
    case 'kiln': return 4;
    default: return 2 + level * 6 + (h >= 3 ? 0 : 0);
  }
}

/**
 * Build (or fetch) the sprite for a building record.
 * b: { kind, w, h, level, variant, face, state, door }, style key, banner colour.
 * Returns { canvas, ox, oy } where (ox, oy) is the offset of the footprint's
 * top-left pixel inside the sprite.
 */
export function buildingSprite(b, style, color) {
  const level = b.kind === 'house' || b.kind === 'keep' || b.kind === 'hall' ? b.level || 1 : 1;
  const site = b.state === 'site';
  const doorX = b.face === 's' && b.door ? (b.door.x - b.x) * 16 + 8 : null;
  const key = `${b.kind}|${b.w}x${b.h}|${style}|${level}|${b.variant}|${b.face}|${doorX}|${site ? 1 : 0}|${color}`;
  let s = cache.get(key);
  if (s) return s;
  const FW = b.w * 16;
  const FH = b.h * 16;
  const extra = site ? 4 : extraFor(b.kind, level, b.h);
  const p = new Pix(FW + 2, FH + extra + 2);
  const ox = 1;
  const oy = 1;
  const basePal = ARCH[style] || ARCH.farm;
  let pal = basePal;
  if (style === 'free' && basePal.alt) pal = { ...basePal, roof: basePal.alt[b.variant % 4], roofDark: shade(basePal.alt[b.variant % 4], -0.25), roofLight: shade(basePal.alt[b.variant % 4], 0.18) };
  else if (b.variant === 3 && b.kind === 'house') pal = { ...basePal, roof: mix(basePal.roof, basePal.thatch, 0.5), roofDark: mix(basePal.roofDark, basePal.thatchDark, 0.5) };
  const rnd = srng(b.variant * 977 + b.w * 31 + b.h * 7 + level * 101 + style.length);
  const o = { level, face: b.face, doorX: doorX !== null ? ox + doorX : null, rnd, variant: b.variant, color };
  if (site) constructionSite(p, ox, oy, FW, FH, extra, style, pal, o);
  else {
    switch (b.kind) {
      case 'keep':
        keep(p, ox, oy, FW, FH, extra, style, pal, o);
        break;
      case 'temple':
        temple(p, ox, oy, FW, FH, extra, style, pal, o);
        break;
      case 'market':
        market(p, ox, oy, FW, FH, extra, style, pal, o);
        break;
      case 'lumber':
        openShed(p, ox, oy, FW, FH, extra, style, pal, o, (y0, y1) => {
          for (let y = y1 - 1; y >= y0 + 1; y -= 3) for (let x = ox + 4; x < ox + FW - 4; x += 4) p.ellipse(x + 1.5, y, 1.8, 1.4, (dx) => (dx < 0 ? '#c49a62' : '#8f6a3e'));
        });
        break;
      case 'quarry':
        openShed(p, ox, oy, FW, FH, extra, style, pal, o, (y0, y1) => {
          const st = stoneOf(style);
          for (let x = ox + 4; x < ox + FW - 6; x += 5) {
            p.rect(x, y1 - 4, 4, 4, st.base);
            p.hline(x, x + 3, y1 - 4, st.light);
            p.vline(x + 3, y1 - 4, y1 - 1, st.dark);
          }
        });
        break;
      case 'stables':
        openShed(p, ox, oy, FW, FH, extra, style, pal, o, (y0, y1) => {
          for (let x = ox + 4; x < ox + FW - 6; x += 8) {
            p.rect(x, y1 - 6, 6, 6, '#8a5a32');
            p.hline(x, x + 5, y1 - 3, '#5a3a20');
            p.set(x + 2, y1 - 8, '#6a4a2e');
            p.set(x + 3, y1 - 8, '#6a4a2e');
          }
        });
        break;
      case 'siegeworks':
        openShed(p, ox, oy, FW, FH, extra, style, pal, o, (y0, y1) => {
          p.line(ox + 8, y1 - 1, ox + FW - 10, y0 + 1, '#8f6a3e');
          p.hline(ox + 6, ox + FW - 8, y1 - 1, '#6f5030');
          p.ellipse(ox + 9, y1 - 1, 2, 2, '#4a3a2a');
          p.ellipse(ox + FW - 11, y1 - 1, 2, 2, '#4a3a2a');
        });
        break;
      case 'mine':
        mine(p, ox, oy, FW, FH, extra, style, pal, o);
        break;
      case 'crystalmine':
        mine(p, ox, oy, FW, FH, extra, style, pal, o, true);
        break;
      case 'kiln':
        kiln(p, ox, oy, FW, FH, extra, style, pal, o);
        break;
      case 'tower':
        watchtower(p, ox, oy, FW, FH, extra, style, pal, o);
        break;
      case 'granary': {
        const g = paintHouse(p, ox, oy, FW - 10, FH, extra, style, pal, { ...o, chimney: false, doorX: o.doorX !== null ? Math.min(o.doorX, ox + FW - 16) : null });
        // Round silo with a conical roof at the east end.
        const cx = ox + FW - 6;
        for (let y = oy + 8; y <= g.bottom; y++) for (let x = cx - 4; x <= cx + 4; x++) p.set(x, y, x === cx - 4 ? shade(pal.wall, 0.1) : x === cx + 4 ? pal.wallDark : (y % 5 === 0 ? pal.wallDark : pal.wall));
        for (let y = oy; y < oy + 9; y++) {
          const half = Math.round(((y - oy) / 8) * 5);
          for (let x = cx - half; x <= cx + half; x++) p.set(x, y, x < cx ? pal.roofLight : pal.roof);
        }
        break;
      }
      case 'smithy': {
        const g = paintHouse(p, ox, oy, FW, FH, extra, style === 'adobe' || style === 'ash' ? style : 'stone', ARCH[style === 'adobe' || style === 'ash' ? style : 'stone'], { ...o, chimney: false });
        p.rect(g.x1 - 5, oy, 4, 9, '#5a504a');
        p.set(g.x1 - 4, oy - 0, '#ff8a3a');
        p.set(g.x1 - 3, oy + 1, '#ffb44c');
        p.rect(g.x0 + 2, g.wb - 5, 4, 4, '#ff8a3a');
        p.set(g.x0 + 3, g.wb - 4, '#ffe08a');
        break;
      }
      case 'tavern': {
        paintHouse(p, ox, oy, FW, FH, extra, style, pal, { ...o, level: 2, lit: true });
        // Hanging sign.
        const sx = ox + FW - 9;
        const sy = oy + FH + extra - 14;
        p.hline(sx, sx + 6, sy, '#4a3a2a');
        p.rect(sx + 2, sy + 1, 5, 4, '#c49a62');
        p.set(sx + 4, sy + 2, '#8a3a2a');
        p.set(sx + 3, sy + 3, '#8a3a2a');
        break;
      }
      case 'hall': {
        const g = paintHouse(p, ox, oy + 6, FW, FH - 6, extra, style, pal, { ...o, level: 2, chimney: false });
        const cx = ox + (FW >> 1);
        // Cupola with bell.
        p.rect(cx - 3, oy + 2, 7, 7, pal.wall);
        p.rect(cx - 1, oy + 4, 3, 3, '#2a2a30');
        p.set(cx, oy + 6, '#e8c060');
        for (let y = oy - 2; y < oy + 2; y++) {
          const half = Math.round(((y - oy + 2) / 3) * 4);
          for (let x = cx - half; x <= cx + half; x++) p.set(x, y, x < cx ? pal.roofLight : pal.roofDark);
        }
        paintBanner(p, g.x1 - 6, oy + 1, color);
        break;
      }
      case 'lodge': {
        const g = paintHouse(p, ox, oy, FW, FH, extra, 'timber', ARCH.timber, { ...o, chimney: true, thatch: true });
        paintBanner(p, g.x0 + 1, oy, color);
        break;
      }
      case 'barracks': {
        const g = paintHouse(p, ox, oy, FW, FH, extra, style === 'adobe' || style === 'ash' ? style : 'stone', ARCH[style === 'adobe' || style === 'ash' ? style : 'stone'], { ...o, chimney: false });
        // Shields along the wall.
        for (let x = g.x0 + 4; x < g.x1 - 4; x += 8) {
          p.rect(x, g.wb - 9, 4, 4, color);
          p.set(x + 1, g.wb - 8, shade(color, 0.4));
          p.hline(x + 1, x + 2, g.wb - 5, shade(color, -0.3));
        }
        paintBanner(p, g.x1 - 4, oy - 2 + 2, color);
        break;
      }
      case 'harbor':
      case 'fishery': {
        const g = paintHouse(p, ox, oy, FW, FH, extra, style === 'adobe' ? 'adobe' : style === 'stilt' ? 'stilt' : 'harbor', ARCH[style === 'adobe' ? 'adobe' : style === 'stilt' ? 'stilt' : 'harbor'], { ...o, chimney: b.kind === 'fishery' });
        if (b.kind === 'harbor') {
          // Loading crane.
          p.vline(g.x1 - 2, oy + 2, g.wb, '#6f5030');
          p.hline(g.x1 - 10, g.x1 - 2, oy + 2, '#6f5030');
          p.vline(g.x1 - 10, oy + 3, oy + 8, '#3a3a40');
          p.rect(g.x1 - 11, oy + 9, 3, 2, '#8a6a44');
        } else {
          for (let x = g.x0 + 2; x < g.x1 - 2; x += 2) p.set(x, g.wb - 2 - (x % 4 === 0 ? 1 : 0), '#c8c0a8');
        }
        break;
      }
      case 'wonder': {
        const g = paintHouse(p, ox, oy + 12, FW, FH - 12, extra, style === 'free' ? 'farm' : style, pal, { ...o, level: 2, chimney: false, lit: true });
        const cx = ox + FW / 2;
        p.ellipse(cx, g.roofTop + 10, FW / 4, 11, (dx, dy) => (dx + dy < -0.5 ? '#ffe28a' : dx + dy > 0.5 ? '#b8862a' : '#e8b840'));
        p.vline(Math.round(cx), g.roofTop - 4, g.roofTop - 1, '#e8b840');
        paintBanner(p, ox + 3, oy + 2, color);
        paintBanner(p, ox + FW - 9, oy + 2, color);
        break;
      }
      case 'farm': {
        // Barn: plank walls in a strong colour with white trim.
        const barnPal = style === 'farm' || style === 'free' ? { ...pal, wall: '#a8452f', wallDark: '#86351f', frame: '#f2ead8', trim: '#f2ead8' } : pal;
        paintHouse(p, ox, oy, FW, FH, extra, style === 'adobe' ? 'adobe' : 'stilt' === style ? 'stilt' : 'farm', barnPal, { ...o, thatch: style !== 'stone' && style !== 'harbor', chimney: false });
        break;
      }
      case 'herbalist': {
        const g = paintHouse(p, ox, oy, FW, FH, extra, style, { ...pal, roof: '#5f8a3e', roofDark: '#476a2e', roofLight: '#78a452' }, { ...o, thatch: false });
        for (let x = g.x0 + 2; x < g.x1 - 1; x += 3) {
          p.set(x, g.wt + 1, '#4f8a3a');
          p.set(x, g.wt + 2, '#6aa848');
        }
        break;
      }
      case 'workshop': {
        const g = paintHouse(p, ox, oy, FW, FH, extra, style, pal, { ...o, chimney: true });
        // Big double doors.
        const dx = g.x0 + 3;
        for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) p.set(dx + i, g.wb - 7 + j, i === 3 || i === 4 ? shade(pal.door, -0.3) : pal.door);
        break;
      }
      default: {
        // Houses and anything else: a plain gabled building.
        paintHouse(p, ox, oy, FW, FH, extra, style, pal, { ...o, thatch: level === 1 && (style === 'farm' || style === 'stilt') && b.variant % 2 === 0 });
      }
    }
  }
  p.outline(OUT);
  s = { canvas: p.toCanvas(), ox: ox, oy: oy + extra, w: p.w, h: p.h };
  cache.set(key, s);
  return s;
}

export function clearBuildingCache() {
  cache.clear();
}
