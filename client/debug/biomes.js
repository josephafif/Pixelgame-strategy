// Biome showcase: finds the most typical window of each landscape in a
// generated world and paints it with renderChunk, so terrain art can be
// judged side by side.
// ?seed=7&size=small&scale=2&cols=2&w=26&h=17&only=forest,coast&render=render
import { generateWorld, WORLD_SIZES } from '../../engine/world/worldgen.js';
import { B } from '../../engine/world/biomes.js';

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed') || 7);
const size = q.get('size') || 'small';
const scale = Number(q.get('scale') || 2);
const cols = Number(q.get('cols') || 2);
const WW = Number(q.get('w') || 26);
const WH = Number(q.get('h') || 17);
const only = q.get('only') ? q.get('only').split(',') : null;
// Which render module folder to use (lets a before/after copy be compared).
const dir = q.get('render') || 'render';
const { renderChunk, CHUNK, TILE } = await import(`../${dir}/ground.js`);

const world = generateWorld({ seed, ...WORLD_SIZES[size] });
const { width: W, height: H, biome } = world;
const N = W * H;
const ov = { road: new Uint8Array(N), ground: new Uint8Array(N), crop: new Uint8Array(N), cleared: new Uint8Array(N) };

const water = (b) => b <= B.RIVER;
const SCENES = [
  { key: 'forest', score: (b) => (b === B.FOREST ? 1 : 0) },
  { key: 'forest-edge', score: (b) => (b === B.FOREST ? 1 : b === B.GRASS || b === B.MEADOW ? 0.9 : -1), mix: [(b) => b === B.FOREST, (b) => b === B.GRASS] },
  { key: 'taiga', score: (b) => (b === B.TAIGA ? 1 : 0) },
  { key: 'grass', score: (b) => (b === B.GRASS ? 1 : b === B.MEADOW ? 0.8 : 0) },
  { key: 'hills', score: (b) => (b === B.HILLS ? 1 : 0) },
  { key: 'mountain', score: (b) => (b === B.MOUNTAIN ? 1 : b === B.PEAK ? 0.6 : 0) },
  { key: 'coast', score: (b) => (b === B.BEACH ? 2 : b === B.SEA ? 1 : 0.3), mix: [(b) => b === B.SEA || b === B.DEEP, (b) => !water(b)] },
  { key: 'river', score: (b) => (b === B.RIVER ? 3 : water(b) ? -1 : 0.2) },
  { key: 'lake', score: (b) => (b === B.LAKE ? 1 : 0.5), mix: [(b) => b === B.LAKE, (b) => !water(b)] },
  { key: 'desert', score: (b) => (b === B.DESERT ? 1 : 0) },
  { key: 'snow', score: (b) => (b === B.SNOW ? 1 : b === B.PEAK ? 0.3 : 0) },
  { key: 'marsh', score: (b) => (b === B.MARSH ? 1 : 0) },
  { key: 'ash', score: (b) => (b === B.ASH ? 1 : 0) },
].filter((s) => !only || only.includes(s.key));

function bestWindow(sc) {
  let best = null;
  for (let y = 0; y + WH <= H; y += 3) {
    for (let x = 0; x + WW <= W; x += 3) {
      let s = 0;
      let ma = 0;
      let mb = 0;
      for (let j = 0; j < WH; j += 2) {
        for (let i = 0; i < WW; i += 2) {
          const b = biome[(y + j) * W + x + i];
          s += sc.score(b);
          if (sc.mix && sc.mix[0](b)) ma++;
          if (sc.mix && sc.mix[1](b)) mb++;
        }
      }
      if (sc.mix) {
        const tot = (WW >> 1) * (WH >> 1);
        s *= Math.min(ma, mb) / tot * 4;
      }
      if (!best || s > best.s) best = { s, x, y };
    }
  }
  return best;
}

const chunkCache = new Map();
let paintMs = 0;
function chunk(kx, ky) {
  const key = `${kx},${ky}`;
  let c = chunkCache.get(key);
  if (!c) {
    const t0 = performance.now();
    c = renderChunk(world, kx, ky, ov);
    paintMs += performance.now() - t0;
    chunkCache.set(key, c);
  }
  return c;
}

const grid = document.getElementById('grid');
grid.style.gridTemplateColumns = `repeat(${cols}, ${WW * TILE * scale}px)`;
for (const sc of SCENES) {
  const win = bestWindow(sc);
  if (!win) continue;
  const fig = document.createElement('figure');
  const cap = document.createElement('figcaption');
  cap.textContent = `${sc.key} @${win.x},${win.y}`;
  const cv = document.createElement('canvas');
  cv.width = WW * TILE * scale;
  cv.height = WH * TILE * scale;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (let ky = Math.floor(win.y / CHUNK); ky <= Math.floor((win.y + WH) / CHUNK); ky++) {
    for (let kx = Math.floor(win.x / CHUNK); kx <= Math.floor((win.x + WW) / CHUNK); kx++) {
      if (kx * CHUNK >= W || ky * CHUNK >= H) continue;
      ctx.drawImage(chunk(kx, ky), (kx * CHUNK - win.x) * TILE * scale, (ky * CHUNK - win.y) * TILE * scale, CHUNK * TILE * scale, CHUNK * TILE * scale);
    }
  }
  fig.append(cap, cv);
  grid.append(fig);
}
document.getElementById('info').textContent = `seed ${seed} ${size} [${dir}] — ${chunkCache.size} chunks painted in ${paintMs.toFixed(0)} ms`;
window.__done = true;
