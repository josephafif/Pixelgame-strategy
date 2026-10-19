// Faiths: founded when a people learns mysticism (or later, monotheism),
// carried along trade routes and by conquest, adopted by realms when most of
// their towns believe. Shared faith warms relations; different faiths cool
// them and unsettle realms whose towns are divided.

import { religionName, nameRng } from './names.js';

const COLORS = ['#f2d36b', '#9fd3f2', '#f29f9f', '#b9f29f', '#d39ff2', '#f2c49f', '#9ff2d8', '#f29fd3', '#c8c8f2', '#e6f29f', '#9fb6f2', '#f2b0e0'];

export class Faith {
  constructor(sim) {
    this.sim = sim;
    this.list = [null];
  }

  found(civ, town, major) {
    const sim = this.sim;
    const id = this.list.length;
    const rng = nameRng(sim.seed, id * 101 + 3);
    const r = {
      id,
      name: religionName(civ.culture, rng, civ.names.adj),
      color: COLORS[(id - 1) % COLORS.length],
      founder: civ.id,
      holy: town.id,
      year: sim.year,
      major,
    };
    this.list.push(r);
    town.religion = id;
    civ.religion = id;
    sim.dirtyTowns.add(town.id);
    sim.log('faith', `The ${r.name} arose in ${town.name}.`, { x: town.x, y: town.y, civs: [civ.id], weight: major ? 2 : 1 });
    return r;
  }

  learned(civ, key) {
    const sim = this.sim;
    const cap = sim.towns[civ.capital];
    if (!cap) return;
    if (key === 'mysticism' && !civ.religion) {
      // Adopt a neighbour's gods or find one's own.
      const nb = [...(sim.contacts.get(civ.id) || [])].map((id) => sim.civs[id]).filter((c) => c.religion);
      if (nb.length && sim.rng.chance(0.45)) {
        civ.religion = nb[sim.rng.int(0, nb.length - 1)].religion;
        cap.religion = civ.religion;
      } else this.found(civ, cap, false);
    }
    if (key === 'monotheism') {
      const majors = this.list.filter((r) => r && r.major).length;
      if (majors < 4 && sim.rng.chance(0.55 - majors * 0.1)) this.found(civ, cap, true);
    }
  }

  /** Yearly: faiths spread town to town; realms follow their people. */
  year() {
    const sim = this.sim;
    const pull = new Map();
    const vote = (t, r, w) => {
      if (!r || r === t.religion) return;
      let m = pull.get(t.id);
      if (!m) pull.set(t.id, (m = new Map()));
      m.set(r, (m.get(r) || 0) + w);
    };
    for (const route of sim.trade.routes) {
      const a = sim.towns[route.a];
      const b = sim.towns[route.b];
      if (!a || !b || !a.alive || !b.alive) continue;
      vote(a, b.religion, this.weight(b.religion));
      vote(b, a.religion, this.weight(a.religion));
    }
    for (const t of sim.liveTowns()) {
      const civ = sim.civs[t.civ];
      if (civ.religion) vote(t, civ.religion, 2.5 * this.weight(civ.religion) * (0.5 + civ.traits.piety));
      const m = pull.get(t.id);
      if (!m) continue;
      let best = 0;
      let bw = 0;
      for (const [r, w] of m) {
        if (w > bw) {
          bw = w;
          best = r;
        }
      }
      if (best && sim.rng.next() < 0.012 * bw) {
        t.religion = best;
        sim.dirtyTowns.add(t.id);
      }
    }
    // A realm adopts the faith most of its people hold.
    for (const civ of sim.liveCivs()) {
      const towns = sim.townsOf(civ);
      if (!towns.length) continue;
      const count = new Map();
      let total = 0;
      for (const t of towns) {
        if (!t.religion) continue;
        count.set(t.religion, (count.get(t.religion) || 0) + t.pop);
        total += t.pop;
      }
      let best = 0;
      let bp = 0;
      for (const [r, p] of count) {
        if (p > bp) {
          bp = p;
          best = r;
        }
      }
      if (best && best !== civ.religion && bp > total * 0.6 && sim.rng.chance(0.2)) {
        const before = civ.religion;
        civ.religion = best;
        const cap = sim.towns[civ.capital];
        if (before) sim.log('faith', `${civ.name} embraced the ${this.list[best].name}.`, { x: cap?.x, y: cap?.y, civs: [civ.id] });
        sim.dirtyCivs.add(civ.id);
      }
    }
  }

  weight(r) {
    const f = this.list[r];
    return f ? (f.major ? 1.6 : 1) : 0;
  }
}
