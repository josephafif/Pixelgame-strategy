// Reproducible terrain inspection: ?seed=1&size=medium&x=200&y=150&w=60&h=36&scale=2
import { generateWorld, WORLD_SIZES } from '../../engine/world/worldgen.js';
import { renderChunk, CHUNK, TILE } from '../render/ground.js';

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed') || 1);
const size = q.get('size') || 'medium';
const world = generateWorld({ seed, ...WORLD_SIZES[size] });
const cx = Number(q.get('x') || world.width / 2);
const cy = Number(q.get('y') || world.height / 2);
const w = Number(q.get('w') || 60);
const h = Number(q.get('h') || 36);
const scale = Number(q.get('scale') || 2);
const N = world.width * world.height;
const ov = { road: new Uint8Array(N), ground: new Uint8Array(N), crop: new Uint8Array(N), cleared: new Uint8Array(N) };
const x0 = Math.round(cx - w / 2);
const y0 = Math.round(cy - h / 2);
const canvas = document.getElementById('c');
canvas.width = w * TILE * scale;
canvas.height = h * TILE * scale;
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
const t0 = performance.now();
let chunks = 0;
for (let ky = Math.floor(y0 / CHUNK); ky <= Math.floor((y0 + h) / CHUNK); ky++) {
  for (let kx = Math.floor(x0 / CHUNK); kx <= Math.floor((x0 + w) / CHUNK); kx++) {
    const c = renderChunk(world, kx, ky, ov);
    chunks++;
    ctx.drawImage(c, (kx * CHUNK - x0) * TILE * scale, (ky * CHUNK - y0) * TILE * scale, CHUNK * TILE * scale, CHUNK * TILE * scale);
  }
}
document.getElementById('info').textContent = `seed ${seed} @${cx},${cy} — ${chunks} chunks in ${(performance.now() - t0).toFixed(0)} ms`;
window.__done = true;
