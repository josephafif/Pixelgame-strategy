// Strategic analysis of locations: what a settlement founded here could
// draw on, plus selection of suggested start sites and neutral trade cities.

import { B, BIOMES, D, F, TREE_FEATURES, isWater } from './biomes.js';
import { Rng } from '../core/rng.js';

/** Survey the land around (x, y). Only uses surface terrain plus, when given, known deposits. */
export function analyzeSite(world, x, y, { r = 9, knownDeposit = null } = {}) {
  const { width: W, height: H, biome, feature, deposit, depAmt } = world;
  const out = {
    land: 0, buildable: 0, fert: 0, wood: 0, stone: 0, sea: 0, lake: 0, river: 0,
    iron: 0, fuel: 0, crystal: 0, herbs: 0, fish: 0, marble: 0, rough: 0, cold: 0, marsh: 0,
    biomes: {},
  };
  const R2 = r * r;
  const rOuter = r + 6;
  let ring = 0;
  for (let dy = -rOuter; dy <= rOuter; dy++) {
    for (let dx = -rOuter; dx <= rOuter; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const d2 = dx * dx + dy * dy;
      const i = ny * W + nx;
      const b = biome[i];
      const props = BIOMES[b];
      if (d2 > R2) {
        if (d2 <= rOuter * rOuter) {
          ring++;
          if (props.move >= 3.5 || b === B.RIVER || isWater(b)) out.rough++;
        }
        continue;
      }
      out.biomes[props.key] = (out.biomes[props.key] || 0) + 1;
      if (b === B.SEA || b === B.DEEP) out.sea++;
      else if (b === B.LAKE) out.lake++;
      else if (b === B.RIVER) out.river++;
      else {
        out.land++;
        if (props.build === 1 && b !== B.MOUNTAIN) out.buildable++;
        if (b === B.MARSH) out.marsh++;
        out.fert += props.fert;
        out.stone += props.stone;
        out.wood += props.wood * 0.5 + (TREE_FEATURES.has(feature[i]) && feature[i] !== F.DEADTREE ? 0.6 : 0);
        if (props.cold) out.cold++;
      }
      const dep = deposit[i];
      if (dep && (!knownDeposit || knownDeposit(i))) {
        const amt = depAmt[i] / 255;
        if (dep === D.IRON) out.iron += amt;
        else if (dep === D.COAL) out.fuel += amt;
        else if (dep === D.CRYSTAL) out.crystal += amt;
        else if (dep === D.HERBS) out.herbs += amt;
        else if (dep === D.FISH) out.fish += amt;
        else if (dep === D.STONE) out.marble += amt;
      }
    }
  }
  out.defense = ring ? out.rough / ring : 0;
  return out;
}

/** Turn a survey into normalised strengths used for labels and AI scoring. */
export function siteStrengths(a) {
  const area = Math.max(1, a.land);
  return {
    farming: a.fert / area + (a.fish > 0 ? 0.15 : 0),
    timber: Math.min(1.4, a.wood / area * 1.6),
    highland: Math.min(1.5, a.stone / area * 1.2 + a.iron * 0.25 + a.defense * 0.8),
    maritime: (a.sea > 6 ? 0.6 : 0) + Math.min(0.5, a.fish * 0.2) + (a.lake > 6 ? 0.2 : 0),
    trade: (a.river > 2 ? 0.55 : 0) + (a.sea > 6 ? 0.35 : 0) + (a.biomes.meadow ? 0.2 : 0),
    rare: Math.min(1.5, a.crystal * 0.6 + a.herbs * 0.25 + a.fuel * 0.3),
  };
}

const ARCHETYPES = {
  farming: { title: 'Breadbasket', blurb: 'Fertile soil feeds a large population.' },
  timber: { title: 'Timberland', blurb: 'Deep woods for cheap construction and fuel.' },
  highland: { title: 'Highland Hold', blurb: 'Stone, iron and natural defences.' },
  maritime: { title: 'Harbour Coast', blurb: 'Fishing grounds and sea trade.' },
  trade: { title: 'River Crossroads', blurb: 'Rivers carry goods and caravans fast.' },
  rare: { title: 'Wild Frontier', blurb: 'Rare herbs, coal or crystal nearby.' },
};

export function describeSite(a) {
  const s = siteStrengths(a);
  const ranked = Object.entries(s).sort((p, q) => q[1] - p[1]);
  const pros = [];
  const cons = [];
  if (a.fert / Math.max(1, a.land) > 0.9) pros.push('fertile');
  if (a.wood / Math.max(1, a.land) > 0.45) pros.push('timber');
  if (a.stone / Math.max(1, a.land) > 0.4) pros.push('stone');
  if (a.iron > 0) pros.push('iron');
  if (a.fuel > 0) pros.push('coal');
  if (a.crystal > 0) pros.push('crystal');
  if (a.herbs > 0) pros.push('herbs');
  if (a.sea > 6) pros.push('coast');
  if (a.river > 2) pros.push('river');
  if (a.defense > 0.3) pros.push('defensible');
  if (a.fert / Math.max(1, a.land) < 0.5) cons.push('poor soil');
  if (a.wood / Math.max(1, a.land) < 0.12) cons.push('little wood');
  if (a.cold > a.land * 0.4) cons.push('cold: needs fuel');
  if (a.buildable < a.land * 0.5) cons.push('cramped');
  if (a.defense < 0.08) cons.push('open ground');
  const arche = ranked[0][0];
  return { archetype: arche, ...ARCHETYPES[arche], pros, cons, strengths: s };
}

/** Is (x,y) a legal place to found any settlement (terrain only)? */
export function canFoundAt(world, x, y) {
  if (x < 3 || y < 3 || x >= world.width - 3 || y >= world.height - 3) return false;
  const b = world.biome[y * world.width + x];
  const p = BIOMES[b];
  return p.build >= 1 && b !== B.MOUNTAIN && b !== B.PEAK;
}

/** Neutral trade cities ("Free Cities"): coasts and river mouths, spread out. */
export function pickTradeHubs(world, count) {
  const { width: W, height: H } = world;
  const rng = new Rng(world.seed ^ 0x7ade);
  const cands = [];
  for (let y = 6; y < H - 6; y += 3) {
    for (let x = 6; x < W - 6; x += 3) {
      if (!canFoundAt(world, x, y)) continue;
      const a = analyzeSite(world, x, y, { r: 7 });
      if (a.buildable < 60) continue;
      const coastal = a.sea > 8;
      const riv = a.river > 2;
      if (!coastal && !riv) continue;
      const score = (coastal ? 1 : 0) + (riv ? 1.2 : 0) + a.buildable / 150 + rng.next() * 0.3;
      cands.push({ x, y, score, coastal });
    }
  }
  cands.sort((p, q) => q.score - p.score);
  const minD = Math.min(W, H) * (count > 3 ? 0.36 : 0.42);
  const hubs = [];
  for (const c of cands) {
    if (hubs.length >= count) break;
    if (hubs.some((h) => Math.hypot(h.x - c.x, h.y - c.y) < minD)) continue;
    hubs.push(c);
  }
  return hubs.map((h, k) => ({ id: k, x: h.x, y: h.y, coastal: h.coastal }));
}

/** Suggested starting locations with distinct strategic profiles. */
export function pickStartSites(world, count, avoid = []) {
  const { width: W, height: H } = world;
  const rng = new Rng(world.seed ^ 0x57a7);
  const cands = [];
  const step = 5;
  for (let y = 8; y < H - 8; y += step) {
    for (let x = 8; x < W - 8; x += step) {
      const jx = x + rng.int(-2, 2);
      const jy = y + rng.int(-2, 2);
      if (!canFoundAt(world, jx, jy)) continue;
      if (avoid.some((p) => Math.hypot(p.x - jx, p.y - jy) < 18)) continue;
      const a = analyzeSite(world, jx, jy);
      if (a.buildable < 90) continue; // room for a capital
      if (a.fert < 55) continue; // must be able to feed itself
      if (a.wood < 12) continue; // must be able to build
      const s = siteStrengths(a);
      const top = Math.max(...Object.values(s));
      const score = top + a.buildable / 400 + rng.next() * 0.15;
      cands.push({ x: jx, y: jy, a, s, score });
    }
  }
  cands.sort((p, q) => q.score - p.score);
  const minD = Math.max(22, Math.min(W, H) * 0.2);
  const chosen = [];
  const used = new Set();
  // First pass: one per archetype, then fill by score.
  for (const pass of [0, 1]) {
    for (const c of cands) {
      if (chosen.length >= count) break;
      if (chosen.includes(c)) continue;
      if (chosen.some((h) => Math.hypot(h.x - c.x, h.y - c.y) < minD)) continue;
      const d = describeSite(c.a);
      if (pass === 0 && used.has(d.archetype)) continue;
      used.add(d.archetype);
      chosen.push(c);
    }
  }
  return chosen.map((c, k) => ({ id: k, x: c.x, y: c.y, ...describeSite(c.a), survey: c.a }));
}
