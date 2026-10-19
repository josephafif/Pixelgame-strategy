// What happens to peoples that nobody decides: plagues, droughts, quakes,
// eruptions, great fires and golden ages; restless provinces that break
// away; realms that fall apart; new tribes on empty land.

import { ERAS, has } from './tech.js';
import { peopleName, nameRng, cultureFor, realmName as realmNameOf } from './names.js';

export class Fate {
  constructor(sim) {
    this.sim = sim;
    this.droughts = []; // { x, y, r, until }
  }

  year() {
    const sim = this.sim;
    const d = sim.settings.disasters;
    const rng = sim.rng;
    const towns = [...sim.liveTowns()];
    if (!towns.length) return;
    // Plague: starts in a big, busy town and travels the trade routes.
    if (rng.next() < 0.018 * d) {
      const big = towns.filter((t) => t.urban > 1500 && t.routes > 0);
      if (big.length) this.plague(big[rng.int(0, big.length - 1)]);
    }
    // Drought: a region's harvests fail for some years.
    if (rng.next() < 0.03 * d) {
      const t = towns[rng.int(0, towns.length - 1)];
      this.drought(t.x, t.y, rng.int(10, 24), rng.int(3, 8));
    }
    this.endDroughts();
    // Earthquake.
    if (rng.next() < 0.012 * d) {
      const t = towns[rng.int(0, towns.length - 1)];
      this.quake(t.x, t.y);
    }
    // Volcanic eruption near one of the world's volcanoes.
    if (rng.next() < 0.004 * d && sim.world.volcanoes.length) {
      const v = sim.world.volcanoes[rng.int(0, sim.world.volcanoes.length - 1)];
      this.eruption(Math.round(v.x), Math.round(v.y));
    }
    // A great fire in a crowded town of timber.
    if (rng.next() < 0.02 * d) {
      const t = towns[rng.int(0, towns.length - 1)];
      const civ = sim.civs[t.civ];
      if (t.urban > 3000 && civ.era >= 3 && civ.era <= 5) this.fire(t);
    }
    // A golden age for a settled, prosperous realm.
    if (rng.next() < 0.03) {
      const civs = [...sim.liveCivs()].filter((c) => c.stability > 65 && !c.wars.size && c.stats.towns >= 3);
      if (civs.length) this.goldenAge(civs[rng.int(0, civs.length - 1)]);
    }
    // Plague spreads along trade routes.
    for (const r of sim.trade.routes) {
      const a = sim.towns[r.a];
      const b = sim.towns[r.b];
      if (!a || !b || !a.alive || !b.alive) continue;
      if (a.plague > 3 && !b.plague && rng.chance(0.35)) b.plague = rng.int(2, 4);
      else if (b.plague > 3 && !a.plague && rng.chance(0.35)) a.plague = rng.int(2, 4);
    }
    if (sim.settings.newPeoples) this.newcomers();
  }

  plague(t) {
    const sim = this.sim;
    t.plague = sim.rng.int(4, 7);
    const civ = sim.civs[t.civ];
    sim.log('plague', `Plague broke out in ${t.name}${has(civ, 'medicine') ? '' : ' and spread along the roads'}.`, { x: t.x, y: t.y, civs: [civ.id], weight: 2 });
  }

  drought(x, y, r, years) {
    const sim = this.sim;
    const { W, H } = sim;
    this.droughts.push({ x, y, r, until: sim.year + years });
    for (let yy = Math.max(0, y - r); yy <= Math.min(H - 1, y + r); yy++) {
      for (let xx = Math.max(0, x - r); xx <= Math.min(W - 1, x + r); xx++) {
        if (Math.hypot(xx - x, yy - y) <= r) sim.yieldMod[yy * W + xx] = 0.55;
      }
    }
    sim.territoryDirty = true;
    const near = sim.townsNear(x, y, r)[0];
    if (near) sim.log('drought', `Years of drought withered the fields round ${near.name}.`, { x, y, civs: [near.civ] });
  }

  endDroughts() {
    const sim = this.sim;
    const { W, H } = sim;
    const left = [];
    for (const d of this.droughts) {
      if (sim.year < d.until) {
        left.push(d);
        continue;
      }
      for (let yy = Math.max(0, d.y - d.r); yy <= Math.min(H - 1, d.y + d.r); yy++) {
        for (let xx = Math.max(0, d.x - d.r); xx <= Math.min(W - 1, d.x + d.r); xx++) sim.yieldMod[yy * W + xx] = 1;
      }
      sim.territoryDirty = true;
    }
    this.droughts = left;
  }

  quake(x, y) {
    const sim = this.sim;
    const hit = sim.townsNear(x, y, 7);
    if (!hit.length) return;
    for (const t of hit) {
      const k = 1 - Math.hypot(t.x - x, t.y - y) / 8;
      sim.layout.damage(t, 0.25 * k);
      t.pop *= 1 - 0.04 * k;
    }
    sim.log('quake', `An earthquake shook ${hit[0].name}.`, { x, y, civs: [hit[0].civ], weight: 1 });
  }

  eruption(x, y) {
    const sim = this.sim;
    const hit = sim.townsNear(x, y, 9);
    for (const t of hit) {
      const k = 1 - Math.hypot(t.x - x, t.y - y) / 10;
      sim.layout.damage(t, 0.6 * k);
      t.pop *= 1 - 0.35 * k;
    }
    const name = hit[0] ? ` near ${hit[0].name}` : '';
    sim.log('volcano', `A volcano erupted${name}, burying fields under ash.`, { x, y, civs: hit.map((t) => t.civ), weight: hit.length ? 2 : 1 });
    this.drought(x, y, 8, 12);
  }

  fire(t) {
    const sim = this.sim;
    sim.layout.damage(t, 0.3, true);
    t.pop *= 0.97;
    sim.log('fire', `A great fire swept through ${t.name}.`, { x: t.x, y: t.y, civs: [t.civ] });
  }

  goldenAge(civ) {
    const sim = this.sim;
    civ.goldenAge = 25;
    civ.stability = Math.min(100, civ.stability + 10);
    const cap = sim.towns[civ.capital];
    sim.log('golden', `A golden age of art and learning began in ${civ.name}.`, { x: cap?.x, y: cap?.y, civs: [civ.id], weight: 1 });
  }

  /** New tribes on good, empty land (in the early ages). */
  newcomers() {
    const sim = this.sim;
    if (sim.year % 20 !== 0) return;
    let maxEra = 0;
    let n = 0;
    for (const c of sim.liveCivs()) {
      maxEra = Math.max(maxEra, c.era);
      n++;
    }
    if (maxEra >= 3 || n >= sim.opts.peoples * 2.2) return;
    let free = 0;
    for (const i of sim.siteList) {
      if (!sim.owner[i] && sim.canSettle(i, 12)) {
        free++;
        if (free > 6 && sim.rng.chance(0.12)) {
          const x = i % sim.W;
          const y = (i / sim.W) | 0;
          // Newcomers learn from the world around them.
          const techs = ['agriculture'];
          for (const t of ['pottery', 'husbandry', 'mysticism']) if (sim.rng.chance(0.4 + maxEra * 0.15)) techs.push(t);
          const civ = sim.newCiv(x, y, { pop: sim.rng.int(400, 1000), techs });
          sim.layout.found(sim.towns[civ.capital]);
          sim.log('people', `The ${civ.names.people} settled at ${sim.towns[civ.capital].name}.`, { x, y, civs: [civ.id] });
          return;
        }
      }
    }
  }

  /** Restless realms: provinces break away; large realms may fall apart. */
  unrest(civ, towns) {
    const sim = this.sim;
    if (towns.length < 6) return;
    if (civ.player && civ.stability > 15) return;
    const s = civ.stability;
    if (s < 12 && towns.length >= 8 && sim.rng.chance(0.25)) {
      this.collapse(civ, towns);
      return;
    }
    if (s < 30 && sim.rng.next() < (30 - s) / 160) this.secede(civ, towns);
  }

  /** The towns farthest from the capital (and least like it) declare independence. */
  secede(civ, towns, seed = null) {
    const sim = this.sim;
    const cap = sim.towns[civ.capital];
    if (!cap) return null;
    const score = (t) => Math.hypot(t.x - cap.x, t.y - cap.y) + (t.culture !== civ.culture ? 25 : 0) + (t.religion !== civ.religion ? 12 : 0) + t.unrest * 10;
    const cands = towns.filter((t) => t !== cap);
    if (!cands.length) return null;
    const first = seed || cands.reduce((a, b) => (score(b) > score(a) ? b : a));
    const r = 10 + civ.era * 3;
    const group = cands.filter((t) => Math.hypot(t.x - first.x, t.y - first.y) <= r && Math.hypot(t.x - cap.x, t.y - cap.y) > Math.hypot(first.x - cap.x, first.y - cap.y) * 0.5);
    const take = group.slice(0, Math.max(1, Math.floor(towns.length * 0.4)));
    if (!take.includes(first)) take.unshift(first);
    const rebel = this.spawnFrom(civ, take, first);
    sim.log('revolt', `${take.length > 1 ? `${take.length} towns led by ${first.name}` : first.name} broke away from ${civ.name}, founding ${rebel.name}.`, { x: first.x, y: first.y, civs: [civ.id, rebel.id], weight: 2 });
    civ.stability = Math.min(100, civ.stability + 15);
    if (sim.rng.chance(0.55)) sim.war.declare(civ, rebel, 'to crush the rebels');
    return rebel;
  }

  /** A failing realm splits into several successor states. */
  collapse(civ, towns) {
    const sim = this.sim;
    const n = Math.min(4, Math.max(2, Math.floor(towns.length / 6)));
    const cap = sim.towns[civ.capital];
    // Seeds: towns spread far apart, the capital keeps the old name.
    const seeds = [cap];
    while (seeds.length < n + 1) {
      let best = null;
      let bd = -1;
      for (const t of towns) {
        const d = Math.min(...seeds.map((s) => Math.hypot(s.x - t.x, s.y - t.y)));
        if (d > bd) {
          bd = d;
          best = t;
        }
      }
      if (!best || bd < 6) break;
      seeds.push(best);
    }
    const groups = seeds.map(() => []);
    for (const t of towns) {
      let k = 0;
      let bd = Infinity;
      seeds.forEach((s, j) => {
        const d = Math.hypot(s.x - t.x, s.y - t.y);
        if (d < bd) {
          bd = d;
          k = j;
        }
      });
      groups[k].push(t);
    }
    const heirs = [];
    for (let j = 1; j < seeds.length; j++) if (groups[j].length) heirs.push(this.spawnFrom(civ, groups[j], seeds[j]));
    civ.stability = 45;
    if (heirs.length) sim.log('collapse', `${civ.name} fell apart into ${heirs.length + 1} realms: ${[civ, ...heirs].map((c) => c.names.land).join(', ')}.`, { x: cap.x, y: cap.y, civs: [civ.id, ...heirs.map((h) => h.id)], weight: 3 });
  }

  /** A new realm made of some of another's towns. */
  spawnFrom(parent, towns, seat) {
    const sim = this.sim;
    const culture = seat.culture !== parent.culture ? seat.culture : cultureFor(sim.world.climate[seat.i], sim.rng) === parent.culture ? parent.culture : seat.culture;
    const nr = nameRng(sim.seed, sim.civs.length * 977 + 13);
    const names = peopleName(culture, nr);
    // Breakaways often take their seat's name.
    if (sim.rng.chance(0.5)) {
      names.land = seat.name;
      names.adj = seat.name.replace(/[aeiouy]+$/i, '') + (seat.name.endsWith('a') ? 'n' : 'ian');
    }
    const id = sim.civs.length;
    const civ = {
      ...JSON.parse(JSON.stringify({ traits: parent.traits, policy: parent.policy, auto: { research: true, expansion: true, diplomacy: true, military: true } })),
      id,
      alive: true,
      culture,
      names,
      color: sim.freeColor(),
      gov: parent.era >= 3 && sim.rng.chance(0.4) ? 4 : Math.min(2, Math.max(1, parent.gov)),
      name: '',
      capital: seat.id,
      techs: new Set(parent.techs),
      era: parent.era,
      research: null,
      progress: 0,
      stability: 62,
      wealth: 30,
      income: 0,
      religion: seat.religion || parent.religion,
      player: false,
      relations: new Map([[parent.id, { opinion: -40 }]]),
      wars: new Set(),
      allies: new Set(),
      truce: new Map(),
      founded: sim.year,
      parent: parent.id,
      nextColony: sim.year + 20,
      goldenAge: 0,
      losses: 0,
      warWeary: 0,
      stats: { pop: 0, land: 0, towns: 0, urban: 0, army: 0 },
      hist: { pop: [], land: [], era: [] },
      histStart: sim.history.years.length,
      fell: null,
    };
    civ.traits.aggression = Math.min(1, civ.traits.aggression + sim.rng.next() * 0.3 - 0.1);
    sim.civs.push(civ);
    civ.name = realmNameOf(civ);
    for (const t of towns) sim.transfer(t, civ);
    seat.capital = true;
    civ.capital = seat.id;
    let pop = 0;
    for (const t of towns) pop += t.pop;
    civ.stats = { pop, land: 0, towns: towns.length, urban: 0, army: 0 };
    sim.dirtyCivs.add(id);
    void ERAS;
    return civ;
  }
}

