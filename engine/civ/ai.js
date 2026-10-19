// What a realm decides each year when nobody steers it (or where its
// leader left a matter to its advisers): where to settle next, whom to
// befriend, whom to fight and when to make peace.

import { has } from './tech.js';

export function decide(sim, civ, towns) {
  if (!civ.player || civ.auto.expansion) colonize(sim, civ, towns);
  diplomacy(sim, civ);
  if (!civ.player || civ.auto.military) sim.war.plan(civ);
}

/** How far by sea a realm's ships carry settlers. */
export function seaRange(civ) {
  if (has(civ, 'oceans')) return 220;
  if (has(civ, 'navigation')) return 60;
  if (has(civ, 'sailing')) return 22;
  return 0;
}

/** The best free place to settle from town `from`, or null. */
export function bestSite(sim, civ, from, { minDist = 6 } = {}) {
  const { W } = sim;
  const w = sim.world;
  const landR = 9 + civ.era * 2.5 + civ.traits.expansion * 5;
  const sea = from.port ? seaRange(civ) : 0;
  const maxR = Math.max(landR, sea);
  let best = -1;
  let bestS = -Infinity;
  for (const i of sim.siteList) {
    const x = i % W;
    const y = (i / W) | 0;
    const d = Math.hypot(x - from.x, y - from.y);
    if (d > maxR || d < minDist) continue;
    const o = sim.owner[i];
    if (o && sim.towns[o].civ !== civ.id) continue;
    const samePart = w.part[i] === w.part[from.i];
    if (samePart ? d > landR : !(sea && w.coast[i] === 1 && d <= sea)) continue;
    let s = w.site[i] - d * 0.45 + (o ? 3 : 0);
    if (!samePart) s -= 6;
    if (s <= bestS) continue;
    if (!sim.canSettle(i, minDist)) continue;
    bestS = s;
    best = i;
  }
  return best;
}

function colonize(sim, civ, towns) {
  if (sim.year < civ.nextColony) return;
  const drive = civ.traits.expansion * (0.5 + civ.policy.expansion);
  // Settle from the most crowded town.
  let from = null;
  let press = 0;
  for (const t of towns) {
    const p = t.pop / t.K;
    if (p > press && t.pop > 500) {
      press = p;
      from = t;
    }
  }
  const wait = Math.round((60 - 45 * drive) / (1 + civ.era * 0.15));
  civ.nextColony = sim.year + Math.max(4, wait) + sim.rng.int(0, 8);
  if (!from || press < 0.55) return;
  const i = bestSite(sim, civ, from);
  if (i < 0) return;
  const t = sim.found(civ, i % sim.W, (i / sim.W) | 0, from);
  if (sim.rng.chance(0.25) || civ.stats.towns <= 2) {
    const sea = sim.world.part[i] !== sim.world.part[from.i];
    sim.log('found', `${civ.name} founded ${t.name}${sea ? ' across the sea' : ''}.`, { x: t.x, y: t.y, civs: [civ.id] });
  }
}

/** Opinions drift; wars are declared and ended; alliances made. */
function diplomacy(sim, civ) {
  const nb = sim.contacts.get(civ.id);
  if (!nb) return;
  for (const id of nb) {
    const other = sim.civs[id];
    if (!other || !other.alive) continue;
    const r = rel(civ, id);
    let d = -1.2; // friction along a shared border
    if (civ.religion && civ.religion === other.religion) d += 2;
    else if (civ.religion && other.religion) d -= 0.8;
    if (sim.trade.between(civ.id, id)) d += 1.5;
    if (civ.allies.has(id)) d += 2;
    if (civ.wars.has(id)) d -= 4;
    r.opinion = Math.max(-100, Math.min(100, r.opinion * 0.97 + d));
  }
  if (civ.player && !civ.auto.diplomacy) return;
  // Wars with realms out of reach peter out; others are weighed each year.
  for (const id of [...civ.wars]) {
    const other = sim.civs[id];
    if (other && other.alive) sim.war.considerPeace(civ, other, !nb.has(id));
  }
  for (const id of nb) {
    const other = sim.civs[id];
    if (!other || !other.alive || civ.wars.has(id)) continue;
    if (wantsWar(sim, civ, other)) sim.war.declare(civ, other);
    else if (!civ.allies.has(id) && wantsAlliance(sim, civ, other)) sim.war.ally(civ, other);
  }
  // Alliances lapse when opinions sour.
  for (const id of [...civ.allies]) {
    if (rel(civ, id).opinion < 10) sim.war.unally(civ, sim.civs[id]);
  }
}

export function rel(civ, id) {
  let r = civ.relations.get(id);
  if (!r) civ.relations.set(id, (r = { opinion: 0 }));
  return r;
}

function power(sim, civ) {
  return civ.stats.pop * sim.war.might(civ) * (0.6 + civ.policy.military);
}

function wantsWar(sim, civ, other) {
  if ((civ.truce.get(other.id) || -1e9) > sim.year) return false;
  if (civ.allies.has(other.id)) return false;
  if (civ.wars.size >= 2) return false;
  if (civ.stats.towns < 1 || other.stats.towns < 1) return false;
  const ratio = power(sim, civ) / Math.max(1, power(sim, other));
  let crowded = 0;
  for (const t of sim.townsOf(civ)) if (t.pop > t.K * 0.85) crowded++;
  const hunger = crowded / Math.max(1, civ.stats.towns);
  // Early peoples raid; organised war grows with the state.
  let desire = civ.traits.aggression * 55 * sim.settings.aggression * Math.min(1, 0.7 + civ.era * 0.1);
  desire += hunger * 25;
  desire += ratio > 2 ? 25 : ratio > 1.3 ? 12 : ratio > 0.9 ? 0 : -40;
  desire -= rel(civ, other.id).opinion * 0.45;
  if (civ.religion && other.religion && civ.religion !== other.religion) desire += 6 * civ.traits.piety;
  if (other.wars.size) desire += 8; // a neighbour busy elsewhere
  desire -= civ.wars.size * 25;
  desire -= civ.warWeary;
  desire += sim.rng.next() * 18;
  return desire > 58;
}

function wantsAlliance(sim, civ, other) {
  const r = rel(civ, other.id);
  if (r.opinion < 45) return false;
  // A shared enemy, or a much stronger common neighbour.
  for (const w of civ.wars) if (other.wars.has(w)) return true;
  return r.opinion > 70 && sim.rng.chance(0.15);
}
