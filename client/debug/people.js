// Sheet of every unit type and worker job, all frames, in two player
// colours, plus a live animated strip. ?scale=4&colors=d23c3c,3a68d8
import { UNIT_TYPES, unitSprite, workerSprite, unitIcon } from '../render/people.js';
import { GROUND } from '../render/palette.js';
import { B } from '../../engine/world/biomes.js';

const q = new URLSearchParams(location.search);
const scale = Number(q.get('scale') || 4);
const colors = (q.get('colors') || 'd23c3c,3a68d8').split(',').map((c) => `#${c}`);
const JOBS = ['chop', 'mine', 'farm', 'carry', 'walk', 'fish'];
const CW = 32;
const CH = 30;
const LABEL = 64;

function cell(ctx, s, x, y, flip = false) {
  // Anchor the sprite's feet at the cell's ground line.
  const ax = x + CW / 2;
  const ay = y + CH - 4;
  if (flip) {
    ctx.save();
    ctx.translate(ax, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(s.canvas, -s.ax, ay - s.ay);
    ctx.restore();
  } else ctx.drawImage(s.canvas, ax - s.ax, ay - s.ay);
}

const rows = [];
for (const t of UNIT_TYPES) for (const c of colors) rows.push({ label: `${t} ${c}`, cells: [0, 1, 2, 3, 4, 5].map((f) => unitSprite(t, c, f)) });
for (const j of JOBS) rows.push({ label: `${j} v0/v3`, cells: [0, 1, 2, 3].map((f) => workerSprite(j, f, 0)).concat([0, 1, 2, 3].map((f) => workerSprite(j, f, 3))) });
rows.push({ label: 'variants', cells: [0, 1, 2, 3, 4, 5].map((v) => workerSprite('walk', 0, v)).concat([0, 1].map((v) => workerSprite('carry', 1, v))) });

const cv = document.getElementById('c');
cv.width = (LABEL + 8 * CW) * scale;
cv.height = (rows.length * CH + 20) * scale;
const ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;
ctx.scale(scale, scale);
rows.forEach((r, i) => {
  const y = i * CH;
  ctx.fillStyle = i % 2 ? GROUND[B.GRASS].base : GROUND[B.MEADOW].base;
  ctx.fillRect(0, y, LABEL + 8 * CW, CH);
  ctx.fillStyle = '#2b1d26';
  ctx.font = '6px monospace';
  ctx.fillText(r.label, 2, y + 10);
  r.cells.forEach((s, k) => cell(ctx, s, LABEL + k * CW, y));
});
// Icons on parchment-free dark ground, as on buttons.
const iy = rows.length * CH + 4;
UNIT_TYPES.forEach((t, k) => {
  const s = unitIcon(t);
  ctx.fillStyle = '#4a3a30';
  ctx.fillRect(LABEL + k * 16 - 1, iy - 1, 14, 14);
  ctx.drawImage(s.canvas, LABEL + k * 16, iy);
});
ctx.fillStyle = '#f3e6cc';
ctx.fillText('icons', 2, iy + 8);

// Live strip: everything animating, half of it mirrored (facing left).
const live = document.getElementById('live');
const LW = 13;
live.width = LW * CW * scale;
live.height = CH * scale;
const lctx = live.getContext('2d');
lctx.imageSmoothingEnabled = false;
let t0 = performance.now();
function tick(now) {
  const f = Math.floor((now - t0) / 160);
  lctx.setTransform(scale, 0, 0, scale, 0, 0);
  lctx.fillStyle = GROUND[B.GRASS].base;
  lctx.fillRect(0, 0, LW * CW, CH);
  UNIT_TYPES.forEach((t, k) => cell(lctx, unitSprite(t, colors[k % colors.length], f % 4), k * CW, 0, k % 2 === 1));
  UNIT_TYPES.slice(0, 2).forEach((t, k) => cell(lctx, unitSprite(t, colors[0], 4 + (f >> 1) % 2), (5 + k) * CW, 0));
  JOBS.forEach((j, k) => cell(lctx, workerSprite(j, f % 4, k), (7 + k) * CW, 0));
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
t0 = performance.now();
document.getElementById('info').textContent = `${UNIT_TYPES.length} unit types × 6 frames × ${colors.length} colours, ${JOBS.length} jobs × 4 frames`;
window.__done = true;
