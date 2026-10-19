// Trade routes and the roads they wear into the land. Every few years towns
// trade with their nearest neighbours of the same realm, with friendly
// towns across the border, and harbours with harbours across the water.
// Land routes become tracks, then paved roads, then railways as their
// realms learn the wheel, engineering and railways. Routes carry wealth,
// knowledge, faith, and plague.

import { GridSearch } from '../core/search.js';
import { B } from '../world/biomes.js';
import { has } from './tech.js';
import { seaRange } from './ai.js';

export class Trade {
  constructor(sim) {
    this.sim = sim;
    this.routes = []; // { a, b, sea, path, value }
    this.paths = new Map(); // "a:b" -> path (Int32Array) or null
    this.pairs = new Set(); // "civA:civB" with a route between them
    this.search = new GridSearch(sim.W, sim.H);
    this.ver = 0;
  }

  between(a, b) {
    return this.pairs.has(a < b ? `${a}:${b}` : `${b}:${a}`);
  }

  update() {
    const sim = this.sim;
    const routes = [];
    const seen = new Set();
    const towns = [...sim.liveTowns()];
    const add = (a, b, sea) => {
      const k = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
      if (seen.has(k)) return;
      seen.add(k);
      const path = this.pathFor(a, b, sea, k);
      if (!path) return;
      const value = Math.sqrt(Math.max(1, a.urban) * Math.max(1, b.urban)) / (10 + path.length * 0.5);
      routes.push({ a: a.id, b: b.id, sea, path, value });
    };
    for (const a of towns) {
      const civ = sim.civs[a.civ];
      if (!has(civ, 'agriculture')) continue;
      const range = 14 + civ.era * 4 + (has(civ, 'wheel') ? 6 : 0);
      const near = sim.townsNear(a.x, a.y, range).filter((b) => b !== a).sort((p, q) => dist(a, p) - dist(a, q));
      let own = 0;
      let foreign = 0;
      for (const b of near) {
        if (sim.world.part[a.i] !== sim.world.part[b.i]) continue;
        if (b.civ === a.civ) {
          if (own >= 2) continue;
          own++;
          add(a, b, false);
        } else if (foreign < 1 && !civ.wars.has(b.civ) && civ.era >= 1) {
          foreign++;
          add(a, b, false);
        }
      }
      if (a.port) {
        const sr = seaRange(civ) * 0.8;
        const ports = sim.townsNear(a.x, a.y, sr).filter((b) => b !== a && b.port && !civ.wars.has(b.civ)).sort((p, q) => dist(a, p) - dist(a, q));
        let n = 0;
        for (const b of ports) {
          if (n >= 2) break;
          if (sim.world.part[a.i] === sim.world.part[b.i] && dist(a, b) < 25) continue;
          n++;
          add(a, b, true);
        }
      }
    }
    this.routes = routes;
    this.pairs.clear();
    for (const t of towns) t.routes = 0;
    for (const r of routes) {
      const a = sim.towns[r.a];
      const b = sim.towns[r.b];
      a.routes++;
      b.routes++;
      if (a.civ !== b.civ) this.pairs.add(a.civ < b.civ ? `${a.civ}:${b.civ}` : `${b.civ}:${a.civ}`);
      if (!r.sea) this.pave(r, sim.civs[a.civ], sim.civs[b.civ]);
    }
    this.ver++;
  }

  pathFor(a, b, sea, k) {
    const key = `${k}:${sea ? 's' : 'l'}`;
    if (this.paths.has(key)) return this.paths.get(key);
    const sim = this.sim;
    const w = sim.world;
    const biome = w.biome;
    let path;
    if (sea) {
      // Harbour to harbour over water (start and end on the towns' tiles).
      const step = (from, to) => {
        const t = biome[to];
        if (t === B.SEA || t === B.LAKE) return 1;
        if (t === B.DEEP) return 1.15;
        return to === b.i || to === a.i ? 1 : Infinity;
      };
      path = this.search.astar({ start: a.i, goal: b.i, target: b.i, cost: step, minStep: 1, maxNodes: 60000 });
    } else {
      const step = (from, to) => {
        const c = w.cost[to];
        if (c === Infinity) return Infinity;
        return sim.road[to] ? c * 0.55 : c;
      };
      path = this.search.astar({ start: a.i, goal: b.i, target: b.i, cost: step, minStep: 0.55, maxNodes: 30000 });
    }
    const out = path ? Int32Array.from(path) : null;
    this.paths.set(key, out);
    if (this.paths.size > 6000) this.paths.delete(this.paths.keys().next().value);
    return out;
  }

  /** Wear a land route into a road as good as its realms know how to build. */
  pave(r, ca, cb) {
    const level = (c) => (has(c, 'railways') ? 3 : has(c, 'engineering') ? 2 : has(c, 'wheel') ? 1 : 0);
    const lv = Math.min(level(ca), level(cb));
    if (!lv) return;
    const sim = this.sim;
    const changed = [];
    for (const i of r.path) {
      if (sim.road[i] >= lv) continue;
      const b = sim.world.biome[i];
      if (b === B.SEA || b === B.DEEP || b === B.LAKE) continue;
      sim.road[i] = lv;
      changed.push(i);
    }
    if (changed.length) sim.layout.roads(changed);
  }
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
