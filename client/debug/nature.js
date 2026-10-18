// Sprite sheet of nature variants on their own ground colour, with shadows.
// ?scale=3&n=16&only=oak,pine
import { natureSprite } from '../render/nature.js';
import { GROUND } from '../render/palette.js';
import { F, B } from '../../engine/world/biomes.js';

const q = new URLSearchParams(location.search);
const scale = Number(q.get('scale') || 3);
const n = Number(q.get('n') || 16);
const only = q.get('only') ? q.get('only').split(',') : null;
const ROWS = [
  ['oak', F.OAK, B.FOREST],
  ['oak/grass', F.OAK, B.GRASS],
  ['birch', F.BIRCH, B.FOREST],
  ['pine', F.PINE, B.TAIGA],
  ['snowpine', F.SNOWPINE, B.SNOW],
  ['palm', F.PALM, B.BEACH],
  ['dead', F.DEADTREE, B.ASH],
  ['willow', F.WILLOW, B.MARSH],
  ['bush', F.BUSH, B.GRASS],
  ['cactus', F.CACTUS, B.DESERT],
  ['reeds', F.REEDS, B.MARSH],
  ['rock', F.ROCK, B.GRASS],
  ['rock/desert', F.ROCK, B.DESERT],
  ['boulder', F.BOULDER, B.HILLS],
  ['crag', F.CRAG, B.MOUNTAIN],
  ['crag/snow', F.CRAG, B.SNOW],
  ['ashrock', F.ASHROCK, B.ASH],
].filter((r) => !only || only.includes(r[0]));
const CW = 40;
const CH = 50;
const cv = document.getElementById('c');
cv.width = (n * CW + 80) * scale;
cv.height = ROWS.length * CH * scale;
const ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;
ctx.scale(scale, scale);
ROWS.forEach(([name, f, b], row) => {
  const y0 = row * CH;
  ctx.fillStyle = GROUND[b].base;
  ctx.fillRect(0, y0, n * CW + 80, CH - 2);
  ctx.fillStyle = '#f3e6cc';
  ctx.font = '7px monospace';
  ctx.fillText(name, 2, y0 + 9);
  for (let k = 0; k < n; k++) {
    // Walk variants and mirrors, with a spread of colourings.
    const h = (k % 16) + ((k >> 4) & 1) * 16 + (((k * 5) & 7) << 5) + ((k * 37) % 128 << 8);
    const s = natureSprite(f, h >>> 0, b);
    if (!s) continue;
    const ax = 80 + k * CW + CW / 2;
    const ay = y0 + CH - 8;
    ctx.globalAlpha = 0.36;
    ctx.drawImage(s.cast.canvas, ax + s.cast.x, ay + s.cast.y);
    ctx.globalAlpha = 1;
    ctx.drawImage(s.canvas, ax - s.ax, ay - s.ay);
  }
});
document.getElementById('info').textContent = `${ROWS.length} species × ${n} variants`;
window.__done = true;
