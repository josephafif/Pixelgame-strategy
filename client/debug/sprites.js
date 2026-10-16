// Sprite sheet of every building kind in every style (?scale=3&kinds=keep,house).
import { buildingSprite } from '../render/buildings.js';
import { KINDS } from '../../engine/settlement/kinds.js';
import { STYLES } from '../../engine/settlement/styles.js';

const q = new URLSearchParams(location.search);
const scale = Number(q.get('scale') || 2);
const kinds = (q.get('kinds') || Object.keys(KINDS).join(',')).split(',');
const styles = (q.get('styles') || Object.keys(STYLES).join(',')).split(',');
const levels = (q.get('levels') || '1').split(',').map(Number);
const cells = [];
for (const st of styles) for (const k of kinds) for (const lv of levels) {
  const def = KINDS[k];
  cells.push(buildingSprite({ kind: k, w: def.w, h: def.h, level: lv, variant: cells.length % 4, face: 's', door: { x: Math.floor(def.w / 2), y: def.h - 1 }, x: 0, y: 0, state: q.get('site') ? 'site' : 'built' }, st, '#d23c3c'));
}
const colW = 104;
const rowH = 120;
const perRow = kinds.length * levels.length;
const cv = document.getElementById('c');
cv.width = perRow * colW * scale;
cv.height = styles.length * rowH * scale;
const ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;
cells.forEach((s, i) => {
  const cx = (i % perRow) * colW;
  const cy = Math.floor(i / perRow) * rowH;
  ctx.drawImage(s.canvas, (cx + 4) * scale, (cy + rowH - s.h - 4) * scale, s.w * scale, s.h * scale);
});
document.getElementById('info').textContent = styles.join(' / ');
window.__done = true;
