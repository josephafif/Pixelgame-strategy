// Everything a person can do to the world: lead a realm (its policies,
// studies, diplomacy, settlers and armies) or act as fate itself (new
// peoples, plagues, droughts, quakes, eruptions, fires, golden ages,
// rebellions, gifts of land and knowledge, the pace of history).

import { TECH, available } from './tech.js';
import { theName } from './sim.js';
import { bestSite } from './ai.js';

function civ(sim, id) {
  const c = sim.civs[id | 0];
  if (!c || !c.alive) throw new Error('No such realm.');
  return c;
}

function town(sim, id) {
  const t = sim.towns[id | 0];
  if (!t || !t.alive) throw new Error('No such town.');
  return t;
}

function tileAt(sim, x, y) {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= sim.W || y >= sim.H) throw new Error('Outside the world.');
  return y * sim.W + x;
}

export const COMMANDS = {
  // --- Leading a realm -------------------------------------------------------
  lead(sim, { civ: id }) {
    for (const c of sim.civs) if (c && c.player) c.player = false;
    const c = civ(sim, id);
    c.player = true;
    sim.dirtyCivs.add(c.id);
    return { ok: true };
  },
  release(sim) {
    for (const c of sim.civs) {
      if (c && c.player) {
        c.player = false;
        c.auto = { research: true, expansion: true, diplomacy: true, military: true };
        sim.dirtyCivs.add(c.id);
      }
    }
    return { ok: true };
  },
  policy(sim, { civ: id, policy }) {
    const c = civ(sim, id);
    for (const k of Object.keys(c.policy)) if (policy[k] !== undefined) c.policy[k] = Math.max(0, Math.min(1, Number(policy[k]) || 0));
    sim.dirtyCivs.add(c.id);
    return { ok: true };
  },
  auto(sim, { civ: id, auto }) {
    const c = civ(sim, id);
    for (const k of Object.keys(c.auto)) if (auto[k] !== undefined) c.auto[k] = !!auto[k];
    sim.dirtyCivs.add(c.id);
    return { ok: true };
  },
  research(sim, { civ: id, tech }) {
    const c = civ(sim, id);
    if (!TECH[tech] || !available(c.techs).some((t) => t.key === tech)) throw new Error('That cannot be studied yet.');
    c.wish = tech;
    c.research = tech;
    c.auto.research = false;
    sim.dirtyCivs.add(c.id);
    return { ok: true };
  },
  war(sim, { civ: id, target }) {
    const a = civ(sim, id);
    const b = civ(sim, target);
    if (a === b) throw new Error('A realm cannot fight itself.');
    if (a.wars.has(b.id)) throw new Error('Already at war.');
    sim.war.declare(a, b);
    return { ok: true };
  },
  peace(sim, { civ: id, target }) {
    const a = civ(sim, id);
    const b = civ(sim, target);
    if (!a.wars.has(b.id)) throw new Error('Not at war.');
    sim.war.makePeace(a, b);
    return { ok: true };
  },
  ally(sim, { civ: id, target }) {
    const a = civ(sim, id);
    const b = civ(sim, target);
    if (a.wars.has(b.id)) throw new Error('Make peace first.');
    sim.war.ally(a, b);
    return { ok: true };
  },
  unally(sim, { civ: id, target }) {
    sim.war.unally(civ(sim, id), civ(sim, target));
    return { ok: true };
  },
  /** Send settlers to found a town at (x, y). */
  found(sim, { civ: id, x, y }) {
    const c = civ(sim, id);
    const i = tileAt(sim, x, y);
    if (!sim.canSettle(i, 4)) throw new Error('Too close to another town, or not on land.');
    const o = sim.owner[i];
    if (o && sim.towns[o].civ !== c.id) throw new Error('That land belongs to another realm.');
    // Settlers come from the nearest own town on the same land (or a harbour).
    let from = null;
    let bd = Infinity;
    for (const t of sim.townsOf(c)) {
      const same = sim.world.part[t.i] === sim.world.part[i];
      if (!same && !t.port) continue;
      const d = Math.hypot(t.x - x, t.y - y);
      if (d < bd && t.pop > 400) {
        bd = d;
        from = t;
      }
    }
    if (!from) throw new Error('No town can send settlers there.');
    const t = sim.found(c, x | 0, y | 0, from);
    sim.log('found', `${c.name} founded ${t.name}.`, { x: t.x, y: t.y, civs: [c.id] });
    return { ok: true, town: t.id };
  },
  /** Suggest the best place to settle next (for the founding tool). */
  suggest(sim, { civ: id }) {
    const c = civ(sim, id);
    let best = -1;
    for (const t of sim.townsOf(c)) {
      const i = bestSite(sim, c, t);
      if (i >= 0 && (best < 0 || sim.world.site[i] > sim.world.site[best])) best = i;
    }
    return { ok: true, x: best >= 0 ? best % sim.W : -1, y: best >= 0 ? (best / sim.W) | 0 : -1 };
  },
  raise(sim, { civ: id, town: tid, size }) {
    const c = civ(sim, id);
    const t = town(sim, tid);
    if (t.civ !== c.id) throw new Error('Not your town.');
    const a = sim.war.raise(c, t, Math.max(100, Number(size) || c.stats.pop * 0.02));
    if (!a) throw new Error('Too few people to raise an army.');
    return { ok: true, army: a.id };
  },
  move(sim, { army, x, y }) {
    const a = sim.war.armies.find((q) => q.id === army);
    if (!a) throw new Error('No such army.');
    const i = tileAt(sim, x, y);
    sim.war.order(a, i);
    if (!a.path) throw new Error('The army cannot get there.');
    return { ok: true };
  },
  disband(sim, { army }) {
    const a = sim.war.armies.find((q) => q.id === army);
    if (!a) throw new Error('No such army.');
    sim.war.sendHome(a);
    a.order = { i: a.path ? a.path[a.path.length - 1] : a.tile };
    return { ok: true };
  },
  rename(sim, { civ: id, town: tid, name }) {
    const n = String(name || '').trim().slice(0, 40);
    if (!n) throw new Error('A name, please.');
    if (tid) {
      const t = town(sim, tid);
      t.name = n;
      sim.dirtyTowns.add(t.id);
    } else {
      const c = civ(sim, id);
      c.names = { ...c.names, land: n, adj: n.replace(/[aeiouy]+$/i, '') + 'ian', people: n.replace(/[aeiouy]+$/i, '') + 'ians' };
      c.name = '';
      sim.dirtyCivs.add(c.id);
      sim.govern(c, sim.townsOf(c));
    }
    return { ok: true };
  },
  recolor(sim, { civ: id, color }) {
    const c = civ(sim, id);
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Not a colour.');
    c.color = color;
    sim.dirtyCivs.add(c.id);
    for (const t of sim.townsOf(c)) sim.layout.retag(t);
    return { ok: true };
  },

  // --- Fate ------------------------------------------------------------------
  spawn(sim, { x, y }) {
    const i = tileAt(sim, x, y);
    if (!sim.canSettle(i, 4)) throw new Error('Not here: too close to a town, or not on land.');
    if (sim.owner[i]) throw new Error('That land is already ruled.');
    let era = 0;
    for (const c of sim.liveCivs()) era = Math.max(era, c.era);
    const techs = ['agriculture', 'pottery', 'husbandry'];
    const c = sim.newCiv(x | 0, y | 0, { pop: 1200, techs });
    sim.layout.found(sim.towns[c.capital]);
    sim.territoryDirty = true;
    sim.log('people', `The ${c.names.people} settled at ${sim.towns[c.capital].name}.`, { x, y, civs: [c.id], weight: 1 });
    void era;
    return { ok: true, civ: c.id };
  },
  plague(sim, { town: tid }) {
    sim.fate.plague(town(sim, tid));
    return { ok: true };
  },
  drought(sim, { x, y, r = 14, years = 6 }) {
    tileAt(sim, x, y);
    sim.fate.drought(x | 0, y | 0, Math.min(40, r | 0), Math.min(30, years | 0));
    return { ok: true };
  },
  quake(sim, { x, y }) {
    tileAt(sim, x, y);
    sim.fate.quake(x | 0, y | 0);
    return { ok: true };
  },
  eruption(sim, { x, y }) {
    tileAt(sim, x, y);
    sim.fate.eruption(x | 0, y | 0);
    return { ok: true };
  },
  fire(sim, { town: tid }) {
    sim.fate.fire(town(sim, tid));
    return { ok: true };
  },
  golden(sim, { civ: id }) {
    sim.fate.goldenAge(civ(sim, id));
    return { ok: true };
  },
  bounty(sim, { town: tid }) {
    const t = town(sim, tid);
    t.pop = Math.min(t.K * 1.1, t.pop * 1.25);
    sim.log('bounty', `Rich harvests filled the granaries of ${t.name}.`, { x: t.x, y: t.y, civs: [t.civ] });
    sim.dirtyTowns.add(t.id);
    return { ok: true };
  },
  rebel(sim, { town: tid }) {
    const t = town(sim, tid);
    const c = sim.civs[t.civ];
    const towns = sim.townsOf(c);
    if (towns.length < 2 || t.capital) throw new Error('A capital, or a realm of one town, cannot rebel.');
    sim.fate.secede(c, towns, t);
    return { ok: true };
  },
  give(sim, { town: tid, civ: id }) {
    const t = town(sim, tid);
    const c = civ(sim, id);
    if (t.civ === c.id) throw new Error('It is already theirs.');
    const old = sim.civs[t.civ];
    sim.transfer(t, c);
    sim.log('gift', `${t.name} passed from ${theName(old)} to ${theName(c)}.`, { x: t.x, y: t.y, civs: [old.id, c.id] });
    return { ok: true };
  },
  teach(sim, { civ: id, tech }) {
    const c = civ(sim, id);
    if (!TECH[tech]) throw new Error('No such knowledge.');
    if (!available(c.techs).some((t) => t.key === tech)) throw new Error('They must learn what comes before it first.');
    sim.learn(c, tech);
    sim.dirtyCivs.add(c.id);
    return { ok: true };
  },
  grow(sim, { town: tid }) {
    const t = town(sim, tid);
    t.pop *= 1.5;
    sim.dirtyTowns.add(t.id);
    return { ok: true };
  },
  settings(sim, { settings }) {
    for (const k of Object.keys(sim.settings)) {
      if (settings[k] === undefined) continue;
      sim.settings[k] = typeof sim.settings[k] === 'boolean' ? !!settings[k] : Math.max(0, Math.min(4, Number(settings[k]) || 0));
    }
    return { ok: true };
  },
};

export function apply(sim, c) {
  const f = COMMANDS[c && c.type];
  if (!f) throw new Error(`Unknown command ${c && c.type}`);
  return f(sim, c);
}
