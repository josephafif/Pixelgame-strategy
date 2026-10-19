// Every building kind by era for one climate (?climate=arid&scale=3&kinds=house,temple&eras=0,4&vn=3&size=1).
import { buildingSprite, SIZES, ERA_NAMES } from '../render/buildings.js';

const q = new URLSearchParams(location.search);
const scale = Number(q.get('scale') || 3);
const climate = q.get('climate') || 'temperate';
const kinds = (q.get('kinds') || 'hut,house,rowhouse,farm,granary,workshop,temple,palace,market,harbor,lighthouse,windmill,factory,apartment,office,monument,well,tower').split(',');
const eras = (q.get('eras') || '0,1,2,3,4,5,6,7').split(',').map(Number);
const vn = Number(q.get('vn') || 1);
const sizeIx = Number(q.get('size') || 0);
const state = q.get('state') || 'ok';
const snow = q.get('snow') === '1';
const color = '#d23c3c';
const rows = [];
for (const era of eras) {
  const row = [];
  for (const kind of kinds) {
    const sizes = SIZES[kind];
    const [w, d] = sizes[Math.min(sizeIx, sizes.length - 1)];
    for (let v = 0; v < vn; v++) row.push({ s: buildingSprite({ kind, w, d, era, climate, v, color, state, snow }), w, d, kind });
  }
  rows.push(row);
}
const pad = 6;
const rowH = rows.map((r) => Math.max(...r.map((c) => c.s ? c.s.h : 0)) + pad * 2 + 10);
const rowW = rows.map((r) => r.reduce((a, c) => a + (c.s ? Math.max(c.s.w, c.w * 8 + 8) : 0) + pad, pad));
const cv = document.getElementById('c');
cv.width = Math.max(...rowW) * scale;
cv.height = rowH.reduce((a, b) => a + b, 0) * scale;
const g = cv.getContext('2d');
g.imageSmoothingEnabled = false;
g.scale(scale, scale);
let y = 0;
rows.forEach((row, ri) => {
  let x = pad;
  const base = y + rowH[ri] - pad;
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, y, cv.width, 1);
  for (const c of row) {
    if (!c.s) continue;
    const s = c.s;
    // Footprint origin: the lot's north-west corner.
    const ox = x + Math.max(0, (Math.max(s.w, c.w * 8 + 8) - c.w * 8) / 2);
    const oy = base - c.d * 8;
    g.fillStyle = 'rgba(160,130,90,0.35)';
    g.fillRect(ox, oy, c.w * 8, c.d * 8);
    if (s.shadow) {
      g.globalAlpha = 0.34;
      g.drawImage(s.shadow.canvas, ox - s.shadow.ox, oy - s.shadow.oy);
      g.globalAlpha = 1;
    }
    g.drawImage(s.canvas, ox - s.ox, oy - s.oy);
    x += Math.max(s.w, c.w * 8 + 8) + pad;
  }
  g.fillStyle = '#fff';
  g.font = '6px monospace';
  g.fillText(ERA_NAMES[eras[ri]], 2, y + 7);
  y += rowH[ri];
});
document.getElementById('info').textContent = `${climate} ${state}`;
window.__done = true;
