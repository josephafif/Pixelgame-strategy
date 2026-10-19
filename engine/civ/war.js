// Wars, armies, battles and sieges. A realm at war raises soldiers from its
// towns and marches them on the enemy's nearest towns; armies that meet
// fight until one side breaks; an army camped at a town besieges it until
// the garrison gives in. Soldiers who come home rejoin their towns.

import { GridSearch } from '../core/search.js';
import { B } from '../world/biomes.js';
import { has } from './tech.js';
import { rel } from './ai.js';

const MIGHT = [1, 1.5, 2, 2.5, 3, 4.2, 6.5, 10];

export class War {
  constructor(sim) {
    this.sim = sim;
    this.armies = [];
    this.nextId = 1;
    this.wars = new Map();
    this.search = new GridSearch(sim.W, sim.H);
    this.battles = []; // recent battle sites for the client (x, y, year, month)
  }

  key(a, b) {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  /** Fighting strength of one soldier. */
  might(civ) {
    let p = MIGHT[civ.era];
    if (has(civ, 'bronze')) p *= 1.08;
    if (has(civ, 'iron')) p *= 1.08;
    if (has(civ, 'riding')) p *= 1.06;
    if (has(civ, 'feudalism')) p *= 1.06;
    if (has(civ, 'gunpowder')) p *= 1.1;
    if (has(civ, 'rifles')) p *= 1.1;
    return p;
  }

  soldiersOf(id) {
    let n = 0;
    for (const a of this.armies) if (a.civ === id) n += a.size;
    return n;
  }

  armiesOf(id) {
    return this.armies.filter((a) => a.civ === id);
  }

  // -------------------------------------------------------------------------
  // Diplomacy

  declare(a, b, why = '') {
    const sim = this.sim;
    if (a === b || a.wars.has(b.id) || !a.alive || !b.alive) return;
    a.wars.add(b.id);
    b.wars.add(a.id);
    a.allies.delete(b.id);
    b.allies.delete(a.id);
    const w = { a: a.id, b: b.id, start: sim.year, score: 0, dead: { [a.id]: 0, [b.id]: 0 }, taken: { [a.id]: [], [b.id]: [] } };
    this.wars.set(this.key(a.id, b.id), w);
    rel(a, b.id).opinion -= 30;
    rel(b, a.id).opinion -= 30;
    const cap = sim.towns[b.capital];
    sim.log('war', `${a.name} declared war on ${b.name}${why ? ` ${why}` : ''}.`, { x: cap?.x, y: cap?.y, civs: [a.id, b.id], weight: 2 });
    sim.dirtyCivs.add(a.id);
    sim.dirtyCivs.add(b.id);
    // Allies of the attacked come to their aid.
    const near = sim.contacts.get(a.id);
    for (const id of [...b.allies]) {
      const c = sim.civs[id];
      if (c && c.alive && !c.wars.has(a.id) && c.id !== a.id && near && near.has(c.id) && c.wars.size < 3) this.declare(c, a, `to defend ${b.names.land}`);
    }
  }

  makePeace(a, b) {
    const sim = this.sim;
    const k = this.key(a.id, b.id);
    const w = this.wars.get(k);
    if (!w) return;
    this.wars.delete(k);
    a.wars.delete(b.id);
    b.wars.delete(a.id);
    const until = sim.year + 12 + sim.rng.int(0, 15);
    a.truce.set(b.id, until);
    b.truce.set(a.id, until);
    for (const army of this.armies) {
      if ((army.civ === a.id || army.civ === b.id) && !sim.civs[army.civ].wars.size) this.sendHome(army);
    }
    const ta = w.taken[a.id].map((id) => sim.towns[id]).filter((t) => t && t.civ === a.id);
    const tb = w.taken[b.id].map((id) => sim.towns[id]).filter((t) => t && t.civ === b.id);
    const terms = [];
    if (ta.length) terms.push(`${a.names.land} kept ${list(ta.map((t) => t.name))}`);
    if (tb.length) terms.push(`${b.names.land} kept ${list(tb.map((t) => t.name))}`);
    sim.log('peace', `${a.name} and ${b.name} made peace${terms.length ? ` (${terms.join('; ')})` : ''}.`, { civs: [a.id, b.id], weight: 1 });
    sim.dirtyCivs.add(a.id);
    sim.dirtyCivs.add(b.id);
  }

  considerPeace(civ, other, apart = false) {
    const sim = this.sim;
    const w = this.wars.get(this.key(civ.id, other.id));
    if (!w) return;
    const years = sim.year - w.start;
    if (apart && years >= 2 && sim.rng.chance(0.5)) {
      this.makePeace(civ, other);
      return;
    }
    const myDead = w.dead[civ.id] / Math.max(1, civ.stats.pop);
    const won = w.taken[civ.id].length;
    const lost = w.taken[other.id].length;
    let p = Math.max(0, (years - 3) / 30);
    p += myDead * 6;
    if (won > 0 && years > 2) p += 0.15;
    if (lost > won) p += 0.1;
    p += civ.warWeary / 200;
    if (civ.player && !civ.auto.diplomacy) return;
    if (sim.rng.next() < Math.min(0.6, p)) this.makePeace(civ, other);
  }

  ally(a, b) {
    const sim = this.sim;
    if (a.allies.has(b.id) || a.wars.has(b.id)) return;
    a.allies.add(b.id);
    b.allies.add(a.id);
    sim.log('ally', `${a.name} and ${b.name} became allies.`, { civs: [a.id, b.id] });
  }

  unally(a, b) {
    if (!b || !a.allies.has(b.id)) return;
    a.allies.delete(b.id);
    b.allies.delete(a.id);
  }

  /** A realm leaves the stage: its wars end and its armies scatter. */
  endAll(civ) {
    for (const id of [...civ.wars]) {
      const o = this.sim.civs[id];
      civ.wars.delete(id);
      if (o) o.wars.delete(civ.id);
      this.wars.delete(this.key(civ.id, id));
    }
    for (const id of [...civ.allies]) this.unally(civ, this.sim.civs[id]);
    this.armies = this.armies.filter((a) => a.civ !== civ.id);
  }

  // -------------------------------------------------------------------------
  // Raising and steering armies (yearly)

  plan(civ) {
    const sim = this.sim;
    const mine = this.armiesOf(civ.id);
    if (!civ.wars.size) {
      for (const a of mine) if (a.mode !== 'home' && !a.order) this.sendHome(a);
      return;
    }
    const want = civ.stats.pop * (0.01 + 0.03 * civ.policy.military) * (0.8 + civ.traits.aggression * 0.4);
    const have = this.soldiersOf(civ.id);
    if (have < want * 0.6 && mine.length < 8 && (!civ.player || civ.auto.military)) {
      const muster = this.musterTown(civ);
      if (muster) this.raise(civ, muster, Math.min(want - have, civ.stats.pop * 0.04));
    }
    for (const a of this.armiesOf(civ.id)) {
      if (a.order) continue;
      if (a.mode === 'idle' || a.mode === 'home' || !this.validTarget(a)) this.retarget(a);
    }
    void sim;
  }

  /** The own town closest to an enemy. */
  musterTown(civ) {
    const sim = this.sim;
    const own = sim.townsOf(civ);
    let best = null;
    let bd = Infinity;
    for (const id of civ.wars) {
      for (const e of sim.townsOf(sim.civs[id])) {
        for (const t of own) {
          const d = Math.hypot(t.x - e.x, t.y - e.y);
          if (d < bd) {
            bd = d;
            best = t;
          }
        }
      }
    }
    return best;
  }

  /** Raise `n` soldiers from a realm's towns, mustered at town `at`. */
  raise(civ, at, n) {
    const sim = this.sim;
    const towns = sim.townsOf(civ);
    const total = towns.reduce((s, t) => s + t.pop, 0);
    n = Math.floor(Math.min(n, total * 0.08));
    if (n < 60) return null;
    for (const t of towns) t.pop -= n * (t.pop / total);
    const a = {
      id: this.nextId++,
      civ: civ.id,
      size: n,
      start: n,
      home: at.id,
      x: at.x,
      y: at.y,
      tile: at.i,
      path: null,
      pi: 0,
      acc: 0,
      mode: 'idle',
      target: 0,
      morale: 1,
      siege: 0,
      order: null,
      fighting: 0,
      era: civ.era,
    };
    this.armies.push(a);
    return a;
  }

  validTarget(a) {
    const t = this.sim.towns[a.target];
    return t && t.alive && this.sim.civs[a.civ].wars.has(t.civ);
  }

  retarget(a) {
    const sim = this.sim;
    const civ = sim.civs[a.civ];
    let best = null;
    let bs = Infinity;
    a.cant ||= {};
    for (const id of civ.wars) {
      for (const t of sim.townsOf(sim.civs[id])) {
        if ((a.cant[t.id] || 0) > sim.year) continue;
        const d = Math.hypot(t.x - a.x, t.y - a.y);
        const s = d + Math.sqrt(t.pop) * 0.05 + t.walls * 4 - (t.capital ? 3 : 0);
        if (s < bs) {
          bs = s;
          best = t;
        }
      }
    }
    if (!best) {
      this.sendHome(a);
      return;
    }
    a.target = best.id;
    a.mode = 'march';
    a.siege = 0;
    this.route(a, best.i);
    if (!a.path) {
      a.cant[best.id] = sim.year + 10;
      a.mode = 'idle';
      a.target = 0;
    }
  }

  sendHome(a) {
    const home = this.sim.towns[a.home];
    const civ = this.sim.civs[a.civ];
    let t = home && home.alive && home.civ === a.civ ? home : null;
    if (!t) t = this.sim.townsOf(civ)[0];
    if (!t) {
      a.size = 0;
      return;
    }
    a.home = t.id;
    a.mode = 'home';
    a.target = 0;
    a.order = null;
    this.route(a, t.i);
  }

  /** Order an army to a tile (the player's command). */
  order(a, i) {
    a.order = { i };
    a.mode = 'march';
    const o = this.sim.owner[i];
    a.target = o && this.sim.towns[o].i === i ? o : 0;
    this.route(a, i);
  }

  route(a, goal) {
    const sim = this.sim;
    const civ = sim.civs[a.civ];
    const w = sim.world;
    const biome = w.biome;
    const cost = w.cost;
    const road = sim.road;
    const shallow = has(civ, 'sailing');
    const deep = has(civ, 'navigation');
    const rail = has(civ, 'railways');
    const step = (from, to) => {
      const b = biome[to];
      const fb = biome[from];
      const water = b === B.SEA || b === B.DEEP || b === B.LAKE;
      if (water) {
        if (b === B.DEEP ? !deep : !shallow) return Infinity;
        const fw = fb === B.SEA || fb === B.DEEP || fb === B.LAKE;
        return fw ? 0.7 : 5;
      }
      let c = cost[to];
      const r = road[to];
      if (r) c *= r === 3 && rail ? 0.3 : r >= 2 ? 0.5 : 0.7;
      const fw = fb === B.SEA || fb === B.DEEP || fb === B.LAKE;
      return fw ? c + 3 : c;
    };
    const path = this.search.astar({ start: a.tile, goal, target: goal, cost: step, minStep: 0.45, maxNodes: 12000 });
    a.path = path;
    a.pi = 0;
    a.acc = 0;
    if (!path) {
      a.mode = a.mode === 'home' ? 'home' : 'idle';
      a.target = a.mode === 'home' ? 0 : a.target;
    }
  }

  // -------------------------------------------------------------------------
  // Every month

  month() {
    const sim = this.sim;
    const W = sim.W;
    for (const a of this.armies) {
      if (a.size <= 0) continue;
      const civ = sim.civs[a.civ];
      if (!civ || !civ.alive) {
        a.size = 0;
        continue;
      }
      a.era = civ.era;
      if (a.fighting > 0) {
        a.fighting--;
        if (a.mode !== 'home') continue;
      }
      a.morale = Math.min(1, a.morale + 0.03);
      if (a.mode === 'siege') {
        this.besiege(a);
        continue;
      }
      if (a.path && a.pi < a.path.length - 1) this.march(a, civ);
      const t = sim.towns[a.target];
      if (a.mode === 'march' && t && t.alive && sim.civs[a.civ].wars.has(t.civ) && Math.hypot(t.x - a.x, t.y - a.y) <= 1.6) {
        a.mode = 'siege';
        a.siege = 0;
      } else if (a.path && a.pi >= a.path.length - 1) {
        if (a.mode === 'home') this.disband(a);
        else if (a.order) a.order = null;
        else if (a.mode === 'march') a.mode = 'idle';
      }
      if (a.mode === 'idle' && !a.order && (sim.tick + a.id) % 6 === 0) {
        if (civ.wars.size) this.retarget(a);
        else this.sendHome(a);
      }
    }
    this.fights();
    this.armies = this.armies.filter((a) => a.size > 0);
    if (this.battles.length > 60) this.battles.splice(0, this.battles.length - 60);
    void W;
  }

  march(a, civ) {
    const sim = this.sim;
    const W = sim.W;
    let speed = 0.75;
    if (has(civ, 'riding')) speed *= 1.25;
    if (has(civ, 'combustion')) speed *= 1.6;
    if (a.mode === 'home') speed *= 1.2;
    let budget = speed;
    const biome = sim.world.biome;
    while (budget > 0 && a.pi < a.path.length - 1) {
      const next = a.path[a.pi + 1];
      const b = biome[next];
      const water = b === B.SEA || b === B.DEEP || b === B.LAKE;
      let c = water ? 0.6 : sim.world.cost[next];
      const r = sim.road[next];
      if (!water && r) c *= r === 3 && has(civ, 'railways') ? 0.25 : r >= 2 ? 0.5 : 0.7;
      if (a.acc + budget >= c) {
        budget -= c - a.acc;
        a.acc = 0;
        a.pi++;
      } else {
        a.acc += budget;
        budget = 0;
      }
    }
    const cur = a.path[a.pi];
    a.tile = cur;
    let x = cur % W;
    let y = (cur / W) | 0;
    if (a.pi < a.path.length - 1) {
      const nx = a.path[a.pi + 1] % W;
      const ny = (a.path[a.pi + 1] / W) | 0;
      const b = biome[a.path[a.pi + 1]];
      const water = b === B.SEA || b === B.DEEP || b === B.LAKE;
      const c = water ? 0.6 : sim.world.cost[a.path[a.pi + 1]];
      const f = Math.min(1, a.acc / c);
      x += (nx - x) * f;
      y += (ny - y) * f;
    }
    a.x = x;
    a.y = y;
  }

  disband(a) {
    const t = this.sim.towns[a.home];
    if (t && t.alive) t.pop += a.size;
    a.size = 0;
  }

  /** Armies of realms at war that meet, fight. */
  fights() {
    const sim = this.sim;
    const list = this.armies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.size <= 0) continue;
      const ca = sim.civs[a.civ];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.size <= 0 || a.civ === b.civ || !ca.wars.has(b.civ)) continue;
        if ((a.mode === 'home' && a.fighting > 0) || (b.mode === 'home' && b.fighting > 0)) continue;
        if (Math.abs(a.x - b.x) > 1.6 || Math.abs(a.y - b.y) > 1.6) continue;
        this.battle(a, b);
        if (a.size <= 0) break;
      }
    }
  }

  battle(a, b) {
    const sim = this.sim;
    const ca = sim.civs[a.civ];
    const cb = sim.civs[b.civ];
    const terr = (army) => {
      const i = Math.round(army.y) * sim.W + Math.round(army.x);
      const bi = sim.world.biome[i];
      let m = bi === B.HILLS || bi === B.FOREST || bi === B.TAIGA ? 1.15 : bi === B.MOUNTAIN ? 1.35 : 1;
      if (sim.civAt(i) === army.civ) m *= 1.15;
      return m;
    };
    const pa = a.size * this.might(ca) * a.morale * terr(a) * (0.9 + sim.rng.next() * 0.2);
    const pb = b.size * this.might(cb) * b.morale * terr(b) * (0.9 + sim.rng.next() * 0.2);
    const clash = Math.min(a.size, b.size) * 0.22;
    const la = Math.min(a.size, clash * (pb / (pa + pb)) * 2);
    const lb = Math.min(b.size, clash * (pa / (pa + pb)) * 2);
    const big = a.start + b.start > 3000;
    a.size -= la;
    b.size -= lb;
    a.morale -= (la / Math.max(1, a.size + la)) * 1.6;
    b.morale -= (lb / Math.max(1, b.size + lb)) * 1.6;
    a.fighting = 1;
    b.fighting = 1;
    this.casualties(ca, cb, la);
    this.casualties(cb, ca, lb);
    this.battles.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, year: sim.year, month: sim.month });
    const rout = (loser, winner) => {
      if (loser.morale < 0.35 || loser.size < loser.start * 0.15) {
        const w = this.wars.get(this.key(loser.civ, winner.civ));
        if (big && w && sim.year - (w.logged ?? -1e9) >= 3) {
          w.logged = sim.year;
          const near = sim.townsNear(Math.round(loser.x), Math.round(loser.y), 14).sort((p, q) => Math.hypot(p.x - loser.x, p.y - loser.y) - Math.hypot(q.x - loser.x, q.y - loser.y))[0];
          const wc = sim.civs[winner.civ];
          const lc = sim.civs[loser.civ];
          sim.log('battle', `Battle${near ? ` of ${near.name}` : ''}: ${wc.names.adj} troops routed the ${lc.names.adj} army.`, { x: Math.round(loser.x), y: Math.round(loser.y), civs: [wc.id, lc.id] });
        }
        loser.order = null;
        this.sendHome(loser);
        loser.fighting = 4; // regrouping: out of the fight for a while
        if (loser.size < 60) loser.size = 0;
      }
    };
    rout(a, b);
    rout(b, a);
  }

  casualties(civ, enemy, n) {
    const w = this.wars.get(this.key(civ.id, enemy.id));
    if (w) w.dead[civ.id] += n;
    civ.losses += n;
    civ.warWeary = Math.min(80, civ.warWeary + (n / Math.max(1, civ.stats.pop)) * 300);
  }

  besiege(a) {
    const sim = this.sim;
    const t = sim.towns[a.target];
    const civ = sim.civs[a.civ];
    if (!t || !t.alive || !civ.wars.has(t.civ)) {
      a.mode = 'idle';
      return;
    }
    const def = sim.civs[t.civ];
    let walls = 1 + t.walls * 0.8 * (has(civ, 'gunpowder') ? 0.35 : 1);
    if (has(def, 'feudalism')) walls *= 1.2;
    const garrison = (t.pop * 0.02 + 60) * this.might(def) * walls * (t.capital ? 1.5 : 1);
    const force = a.size * this.might(civ) * a.morale;
    a.siege += Math.min(0.34, 0.1 * (force / garrison));
    a.size *= 0.992;
    t.pop *= 0.996;
    if (a.siege >= 1) this.capture(a, t);
  }

  capture(a, t) {
    const sim = this.sim;
    const civ = sim.civs[a.civ];
    const old = sim.civs[t.civ];
    const w = this.wars.get(this.key(civ.id, old.id));
    if (w) w.taken[civ.id].push(t.id);
    const sack = sim.rng.chance(0.3 + civ.traits.aggression * 0.2);
    const wasCapital = t.capital;
    sim.transfer(t, civ, { sack });
    if (wasCapital && old.alive) old.stability = Math.max(0, old.stability - 25);
    sim.log('capture', `${civ.names.adj} armies ${sack ? 'sacked' : 'took'} ${t.name}${wasCapital ? `, capital of ${old.name}` : ` from ${old.name}`}.`, { x: t.x, y: t.y, civs: [civ.id, old.id], weight: wasCapital ? 3 : 1 });
    a.mode = 'idle';
    a.target = 0;
    a.siege = 0;
    // Some soldiers stay as the new garrison.
    const stay = a.size * 0.2;
    t.pop += stay;
    a.size -= stay;
  }
}

function list(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
