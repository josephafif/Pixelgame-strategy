// App icons for the installable web app (PWA), drawn as pixel art on a
// 32×32 grid and scaled up with whole pixels: a keep with a red banner on a
// green hill, in a parchment-ringed seal. Writes client/icons/.
// Usage: node tools/make-icons.mjs
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writePng } from './png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'client', 'icons');
mkdirSync(out, { recursive: true });

const N = 32;
const BG = '#24170e';
const INK = '#2b1d26';

function rgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** The art: colours per cell ('' = background). `seal`: draw the round seal behind the keep. */
function art(seal = true) {
  const g = Array.from({ length: N * N }, () => '');
  const set = (x, y, c) => {
    if (x >= 0 && y >= 0 && x < N && y < N) g[y * N + x] = c;
  };
  const get = (x, y) => (x >= 0 && y >= 0 && x < N && y < N ? g[y * N + x] : '');
  const rect = (x0, y0, w, h, c) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, c);
  };
  const cx = 15.5;
  const cy = 15.5;
  const inDisc = (x, y, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  if (seal) {
    // Sky, lighter toward the horizon, inside a parchment ring.
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (!inDisc(x, y, 15.2)) continue;
        if (!inDisc(x, y, 13.6)) set(x, y, '#e6d3a3');
        else set(x, y, y < 9 ? '#4f86a1' : y < 15 ? '#6b9fb4' : '#8dbac4');
      }
    }
  }
  // The hill.
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (seal && !inDisc(x, y, 13.6)) continue;
      const h = ((x - 15.5) / 17) ** 2 + ((y - 31) / 9.5) ** 2;
      if (h > 1) continue;
      set(x, y, h > 0.82 ? '#9cc463' : y > 27 ? '#4f763a' : '#74a04c');
    }
  }
  // The keep: stone, lit from the left, with merlons, a door and arrow slits.
  const stone = '#a8a29a';
  rect(11, 12, 10, 13, stone);
  for (let y = 12; y < 25; y++) {
    set(11, y, '#cdc6bb');
    set(19, y, '#7f7a74');
    set(20, y, '#6c6762');
  }
  for (const x of [11, 14, 17, 20]) rect(x === 20 ? 19 : x, 10, 2, 2, x === 11 ? '#cdc6bb' : x === 20 ? '#7f7a74' : stone);
  rect(13, 16, 1, 2, INK);
  rect(18, 16, 1, 2, INK);
  rect(14, 20, 4, 5, '#5a3b22');
  rect(15, 19, 2, 1, '#5a3b22');
  set(16, 22, '#c99b4a');
  // Mortar lines.
  for (const y of [14, 18, 22]) for (let x = 12; x < 19; x += 3) set(x + (y % 4 === 2 ? 1 : 0), y, '#938d86');
  // Flagpole and a red swallow-tailed banner.
  rect(15, 3, 1, 7, '#4e3420');
  set(15, 2, '#e8c46a');
  rect(16, 3, 7, 4, '#d0453a');
  rect(16, 6, 7, 1, '#9a2c26');
  rect(16, 3, 7, 1, '#e8735f');
  set(22, 4, '');
  set(22, 5, '');
  // Ink outline round the keep and banner.
  const solid = new Set(['#a8a29a', '#cdc6bb', '#7f7a74', '#6c6762', '#938d86', '#5a3b22', '#c99b4a', '#4e3420', '#e8c46a', '#d0453a', '#9a2c26', '#e8735f', INK]);
  const edge = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (solid.has(get(x, y))) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => solid.has(get(x + dx, y + dy)))) edge.push([x, y]);
    }
  }
  for (const [x, y] of edge) set(x, y, INK);
  // Ink ring round the seal.
  if (seal) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) if (!get(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => get(x + dx, y + dy) === '#e6d3a3')) set(x, y, INK);
    }
  }
  return g;
}

/** Render the art at `scale` pixels per cell in a `size`² image, centred on the background colour. */
function render(g, size, scale) {
  const px = new Uint8Array(size * size * 4);
  const [br, bg, bb] = rgb(BG);
  for (let i = 0; i < size * size; i++) px.set([br, bg, bb, 255], i * 4);
  const off = Math.floor((size - N * scale) / 2);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const c = g[y * N + x];
      if (!c) continue;
      const [r, gg, b] = rgb(c);
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) px.set([r, gg, b, 255], ((off + y * scale + sy) * size + off + x * scale + sx) * 4);
    }
  }
  return px;
}

const seal = art(true);
// Maskable icons are cropped to a circle (or other shape) by the system: the
// keep alone, smaller, well inside the safe zone, on a full-bleed background.
const bare = art(false);
const icons = [
  ['icon-192.png', 192, 6, seal],
  ['icon-512.png', 512, 16, seal],
  ['maskable-512.png', 512, 11, bare],
  ['apple-touch-icon.png', 180, 5, bare],
  ['favicon-32.png', 32, 1, seal],
];
for (const [name, size, scale, g] of icons) writePng(join(out, name), size, size, render(g, size, scale));
console.log(`icons written to ${out}`);
