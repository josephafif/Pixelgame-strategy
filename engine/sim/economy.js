// Economy: site survey, labour allocation, production chains, consumption,
// population growth, housing, construction projects and upkeep.

import { B, BIOMES, D, TREE_FEATURES } from '../world/biomes.js';
import { BUILDINGS, HOUSE, STAGES, RULES, RES_KEYS, RESOURCES, UNITS, LABOR, stagePopNeed } from './defs.js';
import { completeBuilding, addMarketStalls } from '../settlement/planner.js';
import * as military from './military.js';

/** Survey a settlement's territory: multipliers for each kind of production. */
export function computeSite(m, s) {
  const { world } = m;
  const W = world.width;
  const H = world.height;
  const R = (s.hub ? 12 : STAGES[s.stage].radius) + 1;
  const explored = s.kingdom >= 0 ? m.explored[s.kingdom] : null;
  let land = 0;
  let trees = 0;
  let rock = 0;
  let water = 0;
  let sea = 0;
  const ferts = [];
  const dep = { iron: 0, fish: 0, stone: 0 };
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = s.x + dx;
      const y = s.y + dy;
      if (x < 0 || y < 0 || x >= W || y >= H || dx * dx + dy * dy > R * R) continue;
      const i = y * W + x;
      const own = m.owner[i];
      const b = world.biome[i];
      // Water next to the territory counts for fishing and harbours.
      if (b === B.SEA || b === B.LAKE || b === B.RIVER || b === B.DEEP) {
        if (Math.abs(dx) + Math.abs(dy) <= R) {
          water++;
          if (b !== B.RIVER) sea++;
        }
      }
      if (own !== s.id && own !== -1) continue;
      if (own === -1 && dx * dx + dy * dy > (R - 2) * (R - 2)) continue;
      const known = !explored || explored[i];
      const d = world.deposit[i];
      if (d && known) {
        const amt = world.depAmt[i] / 255;
        if (d === D.IRON) dep.iron += amt;
        else if (d === D.FISH) dep.fish += amt;
        else if (d === D.STONE) dep.stone += amt;
      }
      if (b <= B.RIVER) continue;
      land++;
      const p = BIOMES[b];
      ferts.push(p.fert);
      if (TREE_FEATURES.has(world.feature[i]) || b === B.FOREST || b === B.TAIGA) trees++;
      if (b === B.HILLS || b === B.MOUNTAIN || b === B.DESERT && p.stone > 0.3) rock++;
    }
  }
  ferts.sort((a, b) => b - a);
  const best = ferts.slice(0, 40);
  const fert = best.length ? best.reduce((a, b) => a + b, 0) / best.length : 0;
  const n = Math.max(1, land);
  s.site = {
    fert: Math.max(0.15, Math.min(1.4, fert)),
    wood: Math.max(0.25, Math.min(1.35, 0.25 + (trees / n) * 1.5)),
    stone: Math.max(0.2, Math.min(1.4, 0.2 + (rock / n) * 1.6 + dep.stone * 0.25)),
    water: water > 0 ? Math.min(1.6, 0.8 + dep.fish * 0.3) : 0,
    coast: sea > 3 ? 1 : 0,
    iron: dep.iron > 0 ? Math.min(1.6, 0.55 + dep.iron * 0.3) : 0,
  };
}

/** Production multiplier from the site for a building kind (0 = not possible). */
export function siteFactor(s, kind) {
  const def = BUILDINGS[kind];
  if (!def || !def.site) return 1;
  switch (def.site) {
    case 'fert': return s.site.fert;
    case 'water': return s.site.water;
    case 'wood': return s.site.wood;
    case 'stone': return s.site.stone;
    case 'iron': return s.site.iron;
    case 'coast': return s.site.coast;
    default: return 1;
  }
}

function soldiersIn(g) {
  let n = 0;
  for (const v of Object.values(g)) n += v;
  return n;
}

/** Distribute a settlement's workforce over job slots by kingdom priority. */
export function assignLabor(m, s, k) {
  const labor = Math.max(s.pop >= 2 ? 1 : 0, Math.floor(s.pop * RULES.laborShare));
  const slots = {};
  for (const c of LABOR) slots[c] = 0;
  const byCat = {};
  for (const [kind, count] of Object.entries(s.buildings)) {
    const def = BUILDINGS[kind];
    if (!def || !def.jobs || !count) continue;
    if (siteFactor(s, kind) <= 0) continue;
    slots[def.cat] += def.jobs * count;
    (byCat[def.cat] ||= []).push(kind);
  }
  const active = s.projects.length + m.state.roadJobs.filter((r) => r.kid === s.kingdom && (r.a === s.id || r.b === s.id)).length;
  slots.build = active * 5;
  const assigned = {};
  for (const c of LABOR) assigned[c] = 0;
  let pool = labor;
  // A starving kingdom's people drop other work to feed themselves.
  const prio = (c) => (c === 'food' && k.flags.starving ? 4 : k.priorities[c] ?? 2);
  for (let level = 4; level >= 1 && pool > 0; level--) {
    const cats = LABOR.filter((c) => prio(c) === level && slots[c] > 0);
    let want = 0;
    for (const c of cats) want += slots[c];
    if (!want) continue;
    if (pool >= want) {
      for (const c of cats) assigned[c] = slots[c];
      pool -= want;
    } else {
      let given = 0;
      for (const c of cats) {
        const n = Math.floor((pool * slots[c]) / want);
        assigned[c] = n;
        given += n;
      }
      let rest = pool - given;
      for (const c of cats) {
        if (rest <= 0) break;
        if (assigned[c] < slots[c]) {
          assigned[c]++;
          rest--;
        }
      }
      pool = 0;
    }
  }
  // Construction always gets a couple of hands if there is work and anyone idle.
  if (active && assigned.build < RULES.minBuilders && pool > 0) {
    const n = Math.min(pool, RULES.minBuilders - assigned.build);
    assigned.build += n;
    pool -= n;
  }
  // Workers per building kind (proportional within a category).
  const perKind = {};
  for (const [cat, kinds] of Object.entries(byCat)) {
    const total = slots[cat];
    let left = assigned[cat];
    kinds.forEach((kind, idx) => {
      const def = BUILDINGS[kind];
      const cap = def.jobs * s.buildings[kind];
      const n = idx === kinds.length - 1 ? Math.min(cap, left) : Math.min(cap, Math.round((assigned[cat] * cap) / total));
      perKind[kind] = n;
      left -= n;
    });
  }
  s.jobs = { labor, assigned, perKind, idle: pool, slots };
}

function prosperityOf(m, s, k) {
  let p = 0.85;
  for (const [kind, n] of Object.entries(s.buildings)) {
    const e = BUILDINGS[kind]?.effect;
    if (e && e.prosperity && n) p += e.prosperity;
  }
  // Larger towns are richer; hunger makes everyone poorer.
  p += s.stage * 0.03;
  if (k.flags.starving) p -= 0.2;
  if (k.flags.unpaid) p -= 0.1;
  p -= Math.min(0.3, k.warWeariness * 0.0005);
  if (s.unrest > 0) p -= 0.25;
  return Math.max(0.3, Math.min(1.6, p));
}

/** Logistics: unconnected settlements lose part of what they ship to the kingdom. */
function logistics(m, s) {
  if (s.connected) return 1;
  const cap = m.settlement(m.state.kingdoms[s.kingdom].capital);
  if (!cap) return 0.7;
  const d = Math.hypot(cap.x - s.x, cap.y - s.y);
  return d < 20 ? 0.85 : d < 40 ? 0.72 : 0.6;
}

export function tick(m, dt, second) {
  const st = m.state;
  for (const k of st.kingdoms) {
    if (!k.alive || !k.placed) continue;
    const mine = m.settlementsOf(k.id);
    if (!mine.length) continue;
    const before = { ...k.stock, coin: k.coin };
    // Connectivity to the capital via the road graph.
    if (second) updateConnectivity(m, k);
    let pop = 0;
    let soldiers = 0;
    let workers = 0;
    let idle = 0;
    const need = { food: 0 };
    for (const s of mine) {
      if (second || !s.jobs.assigned) assignLabor(m, s, k);
      pop += s.pop;
      soldiers += soldiersIn(s.garrison);
      workers += s.jobs.labor - s.jobs.idle;
      idle += s.jobs.idle;
      const unrestF = s.unrest > 0 ? 1 - 0.7 * Math.min(1, s.unrest / RULES.unrestCapture) : 1;
      const logi = logistics(m, s);
      s.out = {};
      for (const [kind, n] of Object.entries(s.jobs.perKind || {})) {
        if (!n) continue;
        const def = BUILDINGS[kind];
        const f = siteFactor(s, kind) * unrestF;
        if (f <= 0) continue;
        let scale = 1;
        if (def.inp) {
          for (const [r, v] of Object.entries(def.inp)) {
            const want = v * n * dt;
            if (want > 0) scale = Math.min(scale, (k.stock[r] || 0) / want);
          }
          scale = Math.max(0, Math.min(1, scale));
          for (const [r, v] of Object.entries(def.inp)) k.stock[r] -= v * n * dt * scale;
        }
        for (const [r, v] of Object.entries(def.out || {})) {
          const amt = v * n * f * scale * dt * (r === 'food' ? 1 : logi);
          k.stock[r] = (k.stock[r] || 0) + amt;
          s.out[r] = (s.out[r] || 0) + amt / dt;
        }
      }
      // Idle hands tend kitchen gardens and gather deadwood: far less than real work.
      if (s.jobs.idle > 0) {
        const f = s.jobs.idle * RULES.forage * s.site.fert * unrestF * dt;
        k.stock.food += f;
        s.out.food = (s.out.food || 0) + f / dt;
        const w = s.jobs.idle * RULES.gatherWood * s.site.wood * unrestF * logi * dt;
        k.stock.wood += w;
        s.out.wood = (s.out.wood || 0) + w / dt;
      }
      // Consumption.
      need.food += s.pop * RULES.foodPerPop;
      for (const [u, n] of Object.entries(s.garrison)) need.food += n * UNITS[u].food;
      s.prosperity = prosperityOf(m, s, k);
      // Taxes.
      k.coin += s.pop * RULES.taxPerPop * s.prosperity * unrestF * dt;
      if (s.unrest > 0) s.unrest = Math.max(0, s.unrest - dt * 1.5);
    }
    // Armies eat from the kingdom while in supply (military.js handles carried supply).
    let coinUp = 0;
    for (const s of mine) for (const [u, n] of Object.entries(s.garrison)) coinUp += n * UNITS[u].coin;
    for (const a of st.armies) {
      if (a.kid !== k.id) continue;
      for (const [u, n] of Object.entries(a.units)) {
        coinUp += n * UNITS[u].coin;
        if (a.inSupply) need.food += n * UNITS[u].food;
        soldiers += n;
      }
    }
    k.flags = {};
    for (const [r, v] of Object.entries(need)) {
      const want = v * dt;
      if ((k.stock[r] || 0) >= want) k.stock[r] -= want;
      else {
        k.stock[r] = 0;
        if (r === 'food') k.flags.starving = true;
      }
    }
    k.coin -= coinUp * dt;
    if (k.coin < 0) {
      k.coin = 0;
      k.flags.unpaid = true;
    }
    // Spoilage and storage.
    const cap = m.storageCap(k.id);
    k.stock.food *= 1 - RESOURCES.food.perish * dt;
    for (const r of RES_KEYS) if (k.stock[r] > cap) k.stock[r] = cap;
    // Growth, housing, projects, training.
    for (const s of mine) {
      growth(m, s, k, dt);
      autoHousing(m, s, k);
      projects(m, s, k, dt);
      training(m, s, k, dt);
    }
    // Smoothed rates for the UI (per second).
    for (const r of [...RES_KEYS, 'coin']) {
      const now = r === 'coin' ? k.coin : k.stock[r];
      const d = (now - (before[r] || 0)) / dt;
      k.rates[r] = (k.rates[r] ?? d) * 0.97 + d * 0.03;
    }
    k.stats.pop = Math.round(pop);
    k.stats.soldiers = Math.round(soldiers);
    k.stats.workers = workers;
    k.stats.idle = idle;
    k.need = need;
    if (k.flags.unpaid) military.desert(m, k, dt);
    // Wonder hold timer.
    const capS = m.settlement(k.capital);
    if (capS && capS.buildings.wonder) k.wonderHeld += dt;
    else k.wonderHeld = 0;
    k.warWeariness = Object.values(k.relations).some((r) => r === 'war') ? k.warWeariness + dt : Math.max(0, k.warWeariness - dt * 2);
  }
}

function foodSecurity(m, k) {
  const pop = Math.max(1, k.stats.pop || 1);
  const buffer = Math.min(1, (k.stock.food || 0) / (pop * 1.5));
  const trend = (k.rates.food ?? 0) >= 0 ? 1 : 0.3;
  return buffer * trend;
}

function growth(m, s, k, dt) {
  let dp = 0;
  if (k.flags.starving) dp = -s.pop * RULES.starve;
  else if (s.pop < s.housing) {
    const room = Math.min(1, (s.housing - s.pop) / Math.max(4, s.pop * 0.08));
    const g = RULES.growth * s.prosperity * (0.15 + 0.85 * foodSecurity(m, k));
    dp = Math.max(0.03, s.pop * g) * room;
  } else if (s.pop > s.housing + 0.5) {
    dp = -(s.pop - s.housing) * 0.03;
  }
  if (s.siege && s.siege.blockade) dp = Math.min(dp, 0);
  s.pop = Math.max(1, s.pop + dp * dt);
}

function houseCost(s) {
  return HOUSE.cost[Math.min(HOUSE.cost.length - 1, s.stage)];
}

function autoHousing(m, s, k) {
  // A full layout is retried once it has changed (new roads, a neighbour's buildings gone).
  if (s.full && m.layouts.get(s.id).v !== s.fullV) s.full = false;
  if (s.full || s.unrest > 0) return;
  if (k.flags.starving || foodSecurity(m, k) < 0.25) return; // no one builds while hungry
  // Nor while the stores are shrinking towards empty (less than three minutes left).
  if ((k.rates.food ?? 0) < 0 && k.stock.food < (k.need?.food || 0) * 180) return;
  const building = s.projects.filter((p) => p.type === 'house').length;
  const maxPar = 1 + Math.floor(s.stage / 2);
  if (building >= maxPar) return;
  if (s.houses + building >= STAGES[s.stage].maxHouses) {
    s.crowded = true; // must grow a stage before more houses go up
    return;
  }
  s.crowded = false;
  const pending = building * HOUSE.capacity[1];
  if (s.pop + 2 < (s.housing + pending) * 0.82) return;
  const cost = houseCost(s);
  if (!m.canAfford(k.id, cost)) return;
  const b = m.layoutAdd(s, 'house', 'site');
  if (!b) {
    s.full = true;
    s.fullV = m.layouts.get(s.id).v;
    if (!s.fullWarned) m.event(k.id, 'warn', `${s.name} has no room for more houses: grow it a stage to open new ground.`, s.x, s.y);
    s.fullWarned = true;
    return;
  }
  m.pay(k.id, cost);
  s.projects.push({ id: m.nextId(), type: 'house', kind: 'house', work: HOUSE.work, progress: 0, bid: b.id, cost });
}

function projects(m, s, k, dt) {
  if (!s.projects.length) return;
  const builders = s.jobs.assigned ? s.jobs.assigned.build : 0;
  if (!builders) return;
  const rate = (builders * RULES.builderRate) / s.projects.length;
  for (const p of s.projects.slice()) {
    p.progress += rate * dt;
    if (p.progress >= p.work) finishProject(m, s, k, p);
  }
}

export function finishProject(m, s, k, p) {
  s.projects = s.projects.filter((q) => q !== p);
  const L = m.layouts.get(s.id);
  switch (p.type) {
    case 'house':
      completeBuilding(L, p.bid);
      m.layoutChanged(s);
      break;
    case 'building':
      completeBuilding(L, p.bid);
      s.buildings[p.kind] = (s.buildings[p.kind] || 0) + 1;
      if (p.kind === 'market') addMarketStalls(L);
      m.layoutChanged(s);
      m.event(k.id, 'built', `${BUILDINGS[p.kind].name} completed in ${s.name}.`, s.x, s.y);
      break;
    case 'stage':
      s.stage = p.to;
      s.full = false;
      m.layoutStage(s);
      m.territoryDirty = true;
      m.event(k.id, 'stage', `${s.name} grows into a ${STAGES[s.stage].name.toLowerCase()}.`, s.x, s.y);
      break;
    case 'walls':
      s.walls.level = p.to;
      s.walls.hp = p.hp;
      m.layoutWalls(s, p.to);
      m.event(k.id, 'built', `${s.name} raises its walls.`, s.x, s.y);
      break;
    default:
      break;
  }
}

function training(m, s, k, dt) {
  for (const t of s.training.slice()) {
    t.t -= dt;
    if (t.t <= 0) {
      s.garrison[t.unit] = (s.garrison[t.unit] || 0) + t.n;
      s.training = s.training.filter((q) => q !== t);
    }
  }
  for (const d of s.demob.slice()) {
    d.t -= dt;
    if (d.t <= 0) {
      s.pop += d.n;
      s.demob = s.demob.filter((q) => q !== d);
    }
  }
}

/** Settlements linked to the capital by completed roads (or harbour to harbour). */
export function updateConnectivity(m, k) {
  const mine = m.settlementsOf(k.id);
  const cap = m.settlement(k.capital);
  for (const s of mine) s.connected = false;
  if (!cap) return;
  const W = m.world.width;
  // Flood over road tiles from the capital; settlements whose centre area touches it connect.
  const seen = new Uint8Array(W * m.world.height);
  const q = [];
  const pushArea = (s) => {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const i = m.idx(s.x + dx, s.y + dy);
        if (m.roadMask[i] && !seen[i]) {
          seen[i] = 1;
          q.push(i);
        }
      }
    }
  };
  pushArea(cap);
  cap.connected = true;
  while (q.length) {
    const c = q.pop();
    for (const n of [c - 1, c + 1, c - W, c + W]) {
      if (n < 0 || n >= seen.length || seen[n] || !m.roadMask[n]) continue;
      seen[n] = 1;
      q.push(n);
    }
  }
  for (const s of mine) {
    if (s === cap) continue;
    let ok = false;
    for (let dy = -3; dy <= 3 && !ok; dy++) for (let dx = -3; dx <= 3; dx++) if (seen[m.idx(s.x + dx, s.y + dy)]) {
      ok = true;
      break;
    }
    s.connected = ok;
  }
}

/** Order a building project in a settlement (shared by players and AI). */
export function orderBuilding(m, kid, s, kind) {
  const def = BUILDINGS[kind];
  if (!def) return { error: 'Unknown building.' };
  if (s.kingdom !== kid) return { error: 'Not your settlement.' };
  if (s.unrest > 0) return { error: `${s.name} is in unrest after conquest.` };
  if (s.stage < def.stage) return { error: `${def.name} needs a ${STAGES[def.stage].name.toLowerCase()}.` };
  if (def.capitalOnly && !s.capital) return { error: `${def.name} can only be built in the capital.` };
  if (def.notCapital && s.capital) return { error: 'The capital already governs itself.' };
  const have = (s.buildings[kind] || 0) + s.projects.filter((p) => p.kind === kind).length;
  if (def.once && have > 0) return { error: `${s.name} already has a ${def.name.toLowerCase()}.` };
  let nonHouse = 0;
  for (const [kk, n] of Object.entries(s.buildings)) if (BUILDINGS[kk]) nonHouse += n;
  nonHouse += s.projects.filter((p) => p.type === 'building').length;
  if (nonHouse >= STAGES[s.stage].maxBuild) return { error: `${s.name} must grow before it can hold more buildings.` };
  if (def.site && siteFactor(s, kind) <= 0) {
    const why = { iron: 'an iron vein', coal: 'a coal seam', crystal: 'a crystal geode', water: 'water nearby', coast: 'a coast' }[def.site] || 'the right land';
    return { error: `${def.name} needs ${why} in ${s.name}'s territory.` };
  }
  if (s.projects.length >= 3 + s.stage) return { error: `${s.name} is already busy with ${s.projects.length} projects.` };
  if (!m.canAfford(kid, def.cost)) return { error: `Not enough resources for ${def.name}.` };
  const b = m.layoutAdd(s, def.plan, 'site');
  if (!b) return { error: `No room in ${s.name} for a ${def.name.toLowerCase()}.` };
  m.pay(kid, def.cost);
  s.projects.push({ id: m.nextId(), type: 'building', kind, work: def.work, progress: 0, bid: b.id, cost: def.cost });
  return { ok: true };
}

export function stageUpError(m, s) {
  const next = STAGES[s.stage + 1];
  if (!next) return 'Already a city.';
  if (s.projects.some((p) => p.type === 'stage')) return 'Already growing.';
  const up = next.up;
  const need = stagePopNeed(s);
  if (s.pop < need) return `Needs ${need} people (has ${Math.floor(s.pop)}).`;
  for (const need of up.needs || []) if (!s.buildings[need]) return `Needs a ${BUILDINGS[need].name.toLowerCase()}.`;
  if (up.connected && !s.connected) return 'Needs a road to the capital.';
  if (!m.canAfford(s.kingdom, up.cost)) return 'Not enough resources.';
  return null;
}
