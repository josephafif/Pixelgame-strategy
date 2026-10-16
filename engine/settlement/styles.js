// Architectural styles. A settlement takes the style of the land it is
// founded on; the style changes how the planner lays roads (how strongly
// they follow contours, how much they wander) and how the client draws it.

import { B, BIOMES } from '../world/biomes.js';

export const STYLES = {
  farm: { name: 'Farmstead', slopeW: 6, wander: 0.5, turn: 0.35, density: 1, fields: 1.4, marsh: false },
  timber: { name: 'Timber', slopeW: 7, wander: 0.9, turn: 0.2, density: 1.1, fields: 0.8, marsh: false },
  stone: { name: 'Highland stone', slopeW: 14, wander: 0.5, turn: 0.15, density: 1.2, fields: 0.6, marsh: false, steepOk: true },
  harbor: { name: 'Harbour', slopeW: 6, wander: 0.55, turn: 0.3, density: 1.15, fields: 0.8, marsh: false },
  stilt: { name: 'Stilt', slopeW: 5, wander: 0.8, turn: 0.25, density: 0.9, fields: 0.7, marsh: true },
  adobe: { name: 'Adobe', slopeW: 6, wander: 0.3, turn: 0.5, density: 1.35, fields: 0.7, marsh: false },
  nordic: { name: 'Nordic', slopeW: 8, wander: 0.7, turn: 0.25, density: 1.25, fields: 0.6, marsh: false },
  ash: { name: 'Basalt', slopeW: 8, wander: 0.6, turn: 0.3, density: 1.2, fields: 0.6, marsh: false },
  free: { name: 'Free city', slopeW: 6, wander: 0.4, turn: 0.4, density: 1.3, fields: 0.9, marsh: false },
};

/** Pick a style from the biomes around a site (counts keyed by biome key). */
export function styleForSite(world, cx, cy) {
  const { width: W, height: H, biome } = world;
  const counts = new Map();
  let water = 0;
  let land = 0;
  for (let dy = -6; dy <= 6; dy++) {
    for (let dx = -6; dx <= 6; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const b = biome[y * W + x];
      if (b === B.SEA || b === B.DEEP || b === B.LAKE) {
        water++;
        continue;
      }
      land++;
      const st = BIOMES[b].style;
      if (st) counts.set(st, (counts.get(st) || 0) + (Math.abs(dx) + Math.abs(dy) < 4 ? 3 : 1));
    }
  }
  if (water > 24 && water < land * 1.5) return 'harbor';
  let best = 'farm';
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}
