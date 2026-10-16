// Renders an overview PNG of a generated world (1 px per tile, scaled).
// Usage: node tools/world-preview.mjs [seed] [size] [out.png]
import { generateWorld, WORLD_SIZES } from '../engine/world/worldgen.js';
import { BIOMES, D } from '../engine/world/biomes.js';
import { writePng } from './png.mjs';

const seed = Number(process.argv[2] ?? 1);
const size = process.argv[3] ?? 'medium';
const out = process.argv[4] ?? `world-${seed}-${size}.png`;
const t0 = performance.now();
const world = generateWorld({ seed, ...WORLD_SIZES[size] });
const t1 = performance.now();
console.log(`generated ${world.width}x${world.height} in ${(t1 - t0).toFixed(0)} ms`);
const S = 2;
const W = world.width * S;
const H = world.height * S;
const px = new Uint8Array(W * H * 4);
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const cols = BIOMES.map((b) => hex(b.color));
const depCol = { [D.IRON]: [200, 60, 40], [D.COAL]: [20, 20, 20], [D.CRYSTAL]: [220, 80, 255], [D.HERBS]: [120, 255, 120], [D.FISH]: [255, 255, 255], [D.STONE]: [250, 240, 200] };
for (let y = 0; y < world.height; y++) {
  for (let x = 0; x < world.width; x++) {
    const i = y * world.width + x;
    let [r, g, b] = cols[world.biome[i]];
    const shade = world.height01[i] >= 0 ? (world.height01[i] - (world.height01[i - world.width] ?? world.height01[i])) * -260 : 0;
    r = Math.max(0, Math.min(255, r + shade)); g = Math.max(0, Math.min(255, g + shade)); b = Math.max(0, Math.min(255, b + shade));
    if (world.feature[i] && [1, 2, 3, 4, 12].includes(world.feature[i])) { r *= 0.8; g *= 0.85; b *= 0.8; }
    if (world.deposit[i]) [r, g, b] = depCol[world.deposit[i]];
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const o = ((y * S + sy) * W + x * S + sx) * 4;
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
    }
  }
}
writePng(out, W, H, px);
const counts = {};
for (let i = 0; i < world.biome.length; i++) counts[BIOMES[world.biome[i]].key] = (counts[BIOMES[world.biome[i]].key] || 0) + 1;
console.log(JSON.stringify(counts));
