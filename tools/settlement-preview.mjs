// Headless settlement preview: grows a settlement at a world site and writes
// a PNG with roads, buildings, fields and piers drawn as flat colours.
// Usage: node tools/settlement-preview.mjs seed siteIndex houses stage out.png
import { generateWorld, WORLD_SIZES } from '../engine/world/worldgen.js';
import { pickStartSites, pickTradeHubs } from '../engine/world/sites.js';
import { N, O } from '../engine/settlement/planner.js';
import { growDemo } from '../engine/settlement/demo.js';
import { BIOMES } from '../engine/world/biomes.js';
import { writePng } from './png.mjs';

if (import.meta.url === `file://${process.argv[1]}`) {
  const seed = Number(process.argv[2] ?? 1);
  const siteIdx = Number(process.argv[3] ?? 0);
  const houses = Number(process.argv[4] ?? 40);
  const stage = Number(process.argv[5] ?? 3);
  const out = process.argv[6] ?? 'settlement.png';
  const world = generateWorld({ seed, ...WORLD_SIZES.medium });
  const hubs = pickTradeHubs(world, 3);
  const sites = pickStartSites(world, 10, hubs);
  const site = sites[siteIdx];
  const t0 = performance.now();
  const { L, failures, check } = growDemo(world, site, { houses, stage, walls: stage >= 3 ? 2 : 0, validate: true });
  console.log(`${site.title} style=${L.style} buildings=${L.buildings.length} fields=${L.fields.length} in ${(performance.now() - t0).toFixed(0)}ms failures=${failures.join(',')}`);
  console.log('valid', check.ok, check.errors.slice(0, 10));
  const S = 8;
  const W = N * S;
  const px = new Uint8Array(W * W * 4);
  const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const kindCol = { house: '#c0603a', keep: '#ffd700', farm: '#d8b030', market: '#ff60ff', default: '#e04040' };
  for (let ly = 0; ly < N; ly++) for (let lx = 0; lx < N; lx++) {
    const l = ly * N + lx;
    const wx = L.ox + lx, wy = L.oy + ly;
    let c = hex(BIOMES[world.biome[wy * world.width + wx]].color);
    if (world.feature[wy * world.width + wx] && L.occ[l] === O.FREE) c = c.map((v) => v * 0.7);
    const o = L.occ[l];
    if (o === O.PLAZA) c = [200, 190, 160];
    if (o === O.ROAD) c = L.road[l] === 1 ? [120, 100, 80] : L.road[l] === 2 ? [160, 140, 110] : [190, 170, 130];
    if (o === O.FIELD) c = [230, 210, 90];
    if (o === O.GARDEN) c = [100, 170, 60];
    if (o === O.DECOR) c = [90, 60, 40];
    if (o === O.DOCK) c = [140, 90, 50];
    if (o === O.APRON) c = [255, 255, 255];
    if (o === O.WALL) c = [60, 60, 60];
    if (o === O.BUILDING) {
      const b = L.buildings.find((q) => q.x <= wx && wx < q.x + q.w && q.y <= wy && wy < q.y + q.h);
      c = hex(kindCol[b?.kind] || kindCol.default);
      if (b && b.level > 1) c = c.map((v) => Math.min(255, v + 40 * (b.level - 1)));
      if (b && b.door.x === wx && b.door.y === wy) c = [30, 30, 30];
    }
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const edge = sx === 0 || sy === 0;
      const oo = ((ly * S + sy) * W + lx * S + sx) * 4;
      const k = edge && o === O.BUILDING ? 0.85 : 1;
      px[oo] = c[0] * k; px[oo + 1] = c[1] * k; px[oo + 2] = c[2] * k; px[oo + 3] = 255;
    }
  }
  writePng(out, W, W, px);
}
