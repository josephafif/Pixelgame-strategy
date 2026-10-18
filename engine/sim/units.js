// Soldiers. A squad is a group of soldiers of one type. Squads are raised
// with gold and people at the player's town or outpost nearest to where they
// are sent, march there over land (and sail across water), and hold where
// they stand: they fight any squad or garrison of a player who is not their
// ally within reach, and go for enemies that come near by themselves. They
// take no land by walking on it; a place they capture brings its land with
// it. Damage is applied all at once at the end of a step, so the order
// squads are processed in does not matter.

import { B } from '../world/biomes.js';
import { RULES, UNITS, COVER, garrisonMax, landRadius, commandOf, STRUCTURES } from './defs.js';

// Seconds to cross a tile, by biome, at speed 1 (water is sailed instead).
const MOVE = new Map([
  [B.BEACH, 1.1], [B.GRASS, 1], [B.MEADOW, 1], [B.FOREST, 1.5], [B.TAIGA, 1.6], [B.MARSH, 2.2], [B.DESERT, 1.25],
  [B.HILLS, 1.8], [B.MOUNTAIN, 3], [B.PEAK, Infinity], [B.SNOW, 1.6], [B.ASH, 1.4], [B.RIVER, 2.5],
]);
const COVER_BY_BIOME = new Map([[B.FOREST, COVER.forest], [B.TAIGA, COVER.taiga], [B.HILLS, COVER.hills], [B.MOUNTAIN, COVER.mountain], [B.MARSH, COVER.marsh], [B.RIVER, COVER.river]]);
const CELL = 8; // spatial grid for finding nearby squads

/** Disk offsets [dx, dy, d] sorted by distance, per radius. */
const disks = new Map();
export function disk(r) {
  let d = disks.get(r);
  if (d) return d;
  d = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r) d.push([dx, dy, Math.hypot(dx, dy)]);
  d.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  disks.set(r, d);
  return d;
}

// Per tile: seconds to cross it at speed 1 (0 for water), worked out once per world.
const moveCosts = new WeakMap();
function moveCost(m) {
  let mc = moveCosts.get(m.world);
  if (!mc) {
    mc = new Float64Array(m.W * m.H);
    for (let i = 0; i < mc.length; i++) mc[i] = m.land[i] ? MOVE.get(m.world.biome[i]) ?? 1 : 0;
    moveCosts.set(m.world, mc);
  }
  return mc;
}

/** Seconds for a squad of `type` to enter tile `to` from `from`. */
export function stepCost(m, type, from, to) {
  const mc = moveCost(m);
  const toLand = m.land[to];
  let c = toLand ? mc[to] / UNITS[type].speed : 1 / RULES.sailSpeed;
  if (c === Infinity) return Infinity;
  if (toLand !== m.land[from]) c += RULES.embark / UNITS[type].speed;
  return c;
}

/**
 * Per tile: which stretch of walkable land it belongs to (-1 for water and
 * impassable peaks), worked out once per world. Soldiers walk round water
 * within one stretch and only take to boats to reach another.
 */
const landParts = new WeakMap();
export function landPart(m) {
  let part = landParts.get(m.world);
  if (part) return part;
  const { W, H } = m;
  const mc = moveCost(m);
  part = new Int32Array(W * H).fill(-1);
  const stack = [];
  let n = 0;
  for (let i = 0; i < W * H; i++) {
    if (part[i] >= 0 || !m.land[i] || mc[i] === Infinity) continue;
    part[i] = n;
    stack.push(i);
    while (stack.length) {
      const c = stack.pop();
      const x = c % W;
      for (const j of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
        if (j < 0 || j >= W * H || part[j] >= 0 || !m.land[j] || mc[j] === Infinity) continue;
        part[j] = n;
        stack.push(j);
      }
    }
    n++;
  }
  landParts.set(m.world, part);
  return part;
}

/**
 * The walkable land tile soldiers starting at `start` should head for when
 * sent to (x, y): the nearest one, preferring the land they stand on when
 * that is about as near. -1 when there is no land close by (open sea).
 */
function landGoal(m, start, x, y) {
  const part = landPart(m);
  const home = start >= 0 ? part[start] : -1;
  let best = -1;
  let bestD = 0;
  for (const [dx, dy, d] of disk(8)) {
    if (best >= 0 && d > bestD + 3) break;
    const nx = Math.round(x) + dx;
    const ny = Math.round(y) + dy;
    if (nx < 0 || ny < 0 || nx >= m.W || ny >= m.H) continue;
    const i = ny * m.W + nx;
    if (part[i] < 0) continue;
    if (best < 0) {
      best = i;
      bestD = d;
      if (home < 0 || part[i] === home) break;
    } else if (part[i] === home) {
      best = i;
      break;
    }
  }
  return best;
}

/** Is there walkable land within reach of (x, y)? */
export function nearLand(m, x, y) {
  const part = landPart(m);
  for (const [dx, dy] of disk(8)) {
    const nx = Math.round(x) + dx;
    const ny = Math.round(y) + dy;
    if (nx >= 0 && ny >= 0 && nx < m.W && ny < m.H && part[ny * m.W + nx] >= 0) return true;
  }
  return false;
}

/**
 * A path (tile indices) for a squad of `type` from tile `start` to near
 * (x, y), or null. Within one stretch of land the path stays on land (round
 * lakes and bays); to reach other land it sails, boarding where it must.
 */
export function findPath(m, type, start, x, y, maxNodes = 120000) {
  const goal = landGoal(m, start, x, y);
  if (goal < 0) return null;
  if (goal === start) return [start];
  const part = landPart(m);
  const speed = UNITS[type].speed;
  const mc = moveCost(m);
  const land = m.land;
  const inv = 1 / speed;
  if (part[start] >= 0 && part[start] === part[goal]) {
    // An inflated heuristic (weighted A*) searches far fewer tiles; the paths
    // are a little longer than the shortest, which marching columns do anyway.
    const path = m.search.astar({
      start,
      goal,
      target: goal,
      diag: true,
      minStep: inv * 2,
      maxNodes,
      cost: (from, to, diag) => {
        if (!land[to]) return Infinity;
        const c = mc[to] * inv;
        return diag ? c * 1.414 : c;
      },
    });
    if (path) return path;
  }
  // stepCost, inlined: this runs for every neighbour of every tile searched.
  const sail = 1 / RULES.sailSpeed;
  const embark = RULES.embark * inv;
  return m.search.astar({
    start,
    goal,
    target: goal,
    diag: true,
    minStep: Math.min(inv, sail) * 2,
    maxNodes,
    cost: (from, to, diag) => {
      const toLand = land[to];
      let c = toLand ? mc[to] * inv : sail;
      if (c === Infinity) return Infinity;
      if (toLand !== land[from]) c += embark;
      return diag ? c * 1.414 : c;
    },
  });
}

/** How many soldiers player `pid` can command: what its towns, ports and outposts allow. */
export function command(m, pid) {
  let n = RULES.baseCommand;
  for (const s of m.state.structures) if (s.owner === pid) n += commandOf(s);
  return n;
}

/** Is a structure under siege (rival soldiers close by, recently)? Its gates stay shut. */
export function besieged(m, s) {
  return m.state.t - (s.siege ?? -99) < 8;
}

/**
 * The player's town, port or outpost nearest (x, y) that can send soldiers
 * out, preferring one on the same land as (x, y) so they can walk there.
 */
export function sourceFor(m, pid, x, y) {
  const part = landPart(m);
  const goal = landGoal(m, -1, x, y);
  const there = goal >= 0 ? part[goal] : -1;
  let best = null;
  for (const s of m.state.structures) {
    if (s.owner !== pid || besieged(m, s)) continue;
    const d = Math.hypot(s.x - x, s.y - y) + (part[m.idx(s.x, s.y)] === there ? 0 : 1e4);
    if (!best || d < best.d) best = { s, d };
  }
  return best ? best.s : null;
}

function newSquad(m, owner, type, n, x, y) {
  return { id: m.nextId(), owner, type, n, x, y, post: [x, y], path: null, pi: 0, pf: 0, state: 'idle', dest: null, cp: 0, born: m.state.t };
}

/** Raise n soldiers of `type` at the structure nearest (x, y) and send them there. */
export function deploy(m, pid, type, n, x, y) {
  const st = m.state;
  const p = st.players[pid];
  const u = UNITS[type];
  if (!u) return { error: 'Unknown kind of soldier.' };
  n = Math.floor(n);
  if (!(n >= 1)) return { error: 'Send at least one soldier.' };
  if (n > RULES.maxSquad) n = RULES.maxSquad;
  if (x < 0 || y < 0 || x >= m.W || y >= m.H) return { error: 'Outside the map.' };
  const room = command(m, pid) - m.army(pid);
  if (room < u.people) return { error: `Your realm commands no more soldiers (${Math.round(m.army(pid))} of ${command(m, pid)}). Grow your towns or build outposts for more.` };
  if (st.squads.filter((q) => q.owner === pid).length >= RULES.maxSquads) return { error: `You lead ${RULES.maxSquads} squads already: send soldiers together, or let squads standing together merge.` };
  const afford = Math.min(Math.floor(p.gold / u.cost), Math.floor((p.pop - 10) / u.people), Math.floor(room / u.people));
  if (afford < 1) return { error: p.gold < u.cost ? `${u.name} cost ${u.cost} gold each.` : 'Not enough people to raise soldiers.' };
  n = Math.min(n, afford);
  if (!nearLand(m, x, y)) return { error: 'Soldiers need land to stand on: send them to a shore.' };
  const src = sourceFor(m, pid, x, y);
  if (!src) return { error: m.state.structures.some((s) => s.owner === pid) ? 'Every town and outpost of yours is under siege.' : 'You need a town or an outpost to raise soldiers.' };
  const path = findPath(m, type, m.idx(src.x, src.y), x, y);
  if (!path) return { error: `${u.name} cannot get there from ${src.name}.` };
  p.gold -= u.cost * n;
  p.pop -= u.people * n;
  p.stats.raised += n;
  const sq = newSquad(m, pid, type, n, src.x, src.y);
  sq.from = src.id;
  setPath(sq, path, m);
  st.squads.push(sq);
  return { ok: true, id: sq.id, n, from: src.id };
}

function setPath(sq, path, m) {
  sq.path = path;
  sq.pi = 0;
  sq.pf = 0;
  const end = path[path.length - 1];
  sq.dest = [end % m.W, (end / m.W) | 0];
  sq.post = sq.dest.slice();
  sq.state = path.length > 1 ? 'moving' : 'idle';
}

/**
 * A path for a squad at tile `here` to (x, y) that follows `lead`, a path
 * another squad already found to about the same place: a short walk onto
 * it, the long march along it, and a short walk off it to the squad's own
 * spot. Null when the lead passes too far away.
 */
function followPath(m, type, here, lead, x, y) {
  const W = m.W;
  const dist = (i, px, py) => Math.hypot((i % W) - px, ((i / W) | 0) - py);
  const hx = here % W;
  const hy = (here / W) | 0;
  let j = 0;
  for (let k = 1; k < lead.length; k++) if (dist(lead[k], hx, hy) < dist(lead[j], hx, hy)) j = k;
  if (dist(lead[j], hx, hy) > JOIN) return null;
  let e = lead.length - 1;
  for (let k = lead.length - 2; k > Math.max(j, lead.length - 16); k--) if (dist(lead[k], x, y) < dist(lead[e], x, y)) e = k;
  if (e - j < 8) return null;
  const head = findPath(m, type, here, lead[j] % W, (lead[j] / W) | 0, 4000);
  const tail = findPath(m, type, lead[e], x, y, 4000);
  if (!head || !tail || head[head.length - 1] !== lead[j] || tail[0] !== lead[e]) return null;
  return head.concat(lead.slice(j + 1, e), tail);
}
const JOIN = 20; // tiles a squad walks to join another's road

/** Send own squads to (x, y), spread out around it. */
export function move(m, pid, ids, x, y) {
  const st = m.state;
  const list = st.squads.filter((s) => s.owner === pid && ids.includes(s.id));
  if (!list.length) return { error: 'No soldiers selected.' };
  if (!nearLand(m, x, y)) return { error: 'Soldiers need land to stand on: send them to a shore.' };
  // Spread squads over a small spiral around the point so they do not stack.
  const spots = disk(6).filter((o, k) => k === 0 || (Math.abs(o[0]) + Math.abs(o[1])) % 2 === 0);
  // Squads standing together share the long march: only the first of them
  // searches the whole way (a long search costs far more than a short one).
  // The farthest go first: their road passes most of the others.
  const leads = [];
  let sent = 0;
  let failed = null;
  const spot = new Map(list.sort((a, b) => a.id - b.id).map((sq, k) => [sq, spots[Math.min(spots.length - 1, k * 2)]]));
  const far = (sq) => Math.hypot(sq.x - x, sq.y - y);
  list.sort((a, b) => far(b) - far(a) || a.id - b.id).forEach((sq) => {
    const [dx, dy] = spot.get(sq);
    const here = m.idx(Math.round(sq.x), Math.round(sq.y));
    let path = null;
    for (const lead of leads) if (!path) path = followPath(m, sq.type, here, lead, x + dx, y + dy);
    if (!path) {
      path = findPath(m, sq.type, here, x + dx, y + dy);
      if (path && path.length > 3 * JOIN) leads.push(path);
    }
    if (!path) {
      failed = sq;
      return;
    }
    setPath(sq, path, m);
    sent++;
  });
  if (!sent) return { error: `${UNITS[failed.type].name} cannot get there.` };
  return { ok: true, sent };
}

export function stop(m, pid, ids) {
  for (const sq of m.state.squads) {
    if (sq.owner !== pid || !ids.includes(sq.id)) continue;
    sq.path = null;
    sq.state = 'idle';
    sq.dest = null;
    sq.post = [Math.round(sq.x), Math.round(sq.y)];
  }
  return { ok: true };
}

/** Follow the path for dt seconds; true when at the end. */
function march(m, sq, dt) {
  const W = m.W;
  let budget = dt;
  const path = sq.path;
  while (budget > 0 && sq.pi < path.length - 1) {
    const a = path[sq.pi];
    const b = path[sq.pi + 1];
    let c = stepCost(m, sq.type, a, b);
    if (c === Infinity) {
      sq.path = null;
      return true;
    }
    if (a % W !== b % W && ((a / W) | 0) !== ((b / W) | 0)) c *= 1.414;
    const need = c * (1 - sq.pf);
    if (budget >= need) {
      budget -= need;
      sq.pi++;
      sq.pf = 0;
    } else {
      sq.pf += budget / c;
      budget = 0;
    }
  }
  const a = path[sq.pi];
  const b = path[Math.min(path.length - 1, sq.pi + 1)];
  sq.x = (a % W) + ((b % W) - (a % W)) * sq.pf;
  sq.y = ((a / W) | 0) + (((b / W) | 0) - ((a / W) | 0)) * sq.pf;
  return sq.pi >= path.length - 1;
}

/** Walk straight toward (tx, ty) for dt seconds (short moves near the post). */
function stepToward(m, sq, tx, ty, dt) {
  const dx = tx - sq.x;
  const dy = ty - sq.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.05) return;
  const here = m.idx(Math.round(sq.x), Math.round(sq.y));
  const nx = sq.x + (dx / d) * Math.min(d, UNITS[sq.type].speed * dt);
  const ny = sq.y + (dy / d) * Math.min(d, UNITS[sq.type].speed * dt);
  const there = m.idx(Math.round(nx), Math.round(ny));
  if (there !== here && (!m.land[there] || stepCost(m, sq.type, here, there) === Infinity)) return;
  sq.x = nx;
  sq.y = ny;
}

function grid(m) {
  const g = new Map();
  for (const sq of m.state.squads) {
    const k = ((sq.y / CELL) | 0) * 4096 + ((sq.x / CELL) | 0);
    let list = g.get(k);
    if (!list) g.set(k, (list = []));
    list.push(sq);
  }
  return g;
}

function hostile(m, a, b) {
  return a !== b && a >= 0 && b >= 0 && !m.allied(a, b);
}

/** Nearest hostile squad within r of (x, y). */
function nearestEnemy(m, g, owner, x, y, r) {
  let best = null;
  let bd = r;
  const c0 = Math.floor((x - r) / CELL);
  const c1 = Math.floor((x + r) / CELL);
  const r0 = Math.floor((y - r) / CELL);
  const r1 = Math.floor((y + r) / CELL);
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      const list = g.get(cy * 4096 + cx);
      if (!list) continue;
      for (const o of list) {
        if (o.n <= 0 || !hostile(m, owner, o.owner)) continue;
        const d = Math.hypot(o.x - x, o.y - y);
        if (d > r) continue;
        if (!best || d < bd || (d === bd && o.id < best.id)) {
          bd = d;
          best = o;
        }
      }
    }
  }
  return best;
}

/** Damage a squad on its tile takes ×. */
function cover(m, sq) {
  const i = m.idx(Math.round(sq.x), Math.round(sq.y));
  let c = m.land[i] ? COVER_BY_BIOME.get(m.world.biome[i]) ?? 1 : COVER.water;
  const p = m.state.players[sq.owner];
  if (p.traitorUntil > m.state.t) c /= RULES.traitorDefense;
  return c;
}

function worksCover(m, s) {
  let c = s.kind === 'outpost' ? 0.6 : s.kind === 'town' && s.level >= 3 ? 0.6 : 1;
  const p = m.state.players[s.owner];
  if (p && p.traitorUntil > m.state.t) c /= RULES.traitorDefense;
  return c;
}

/** One simulation step for every squad and garrison. */
export function tick(m, dt) {
  const st = m.state;
  const squads = st.squads;
  const g = grid(m);
  // Structures by grid cell, for quick "which buildings are in reach".
  const gw = new Map();
  for (const s of st.structures) {
    const k = ((s.y / CELL) | 0) * 4096 + ((s.x / CELL) | 0);
    let list = gw.get(k);
    if (!list) gw.set(k, (list = []));
    list.push(s);
  }
  const hurt = new Map(); // squad id -> soldiers lost
  const hit = new Map(); // structure id -> garrison lost
  const harm = (o, n) => hurt.set(o.id, (hurt.get(o.id) || 0) + n);
  const works = st.structures;
  for (const sq of squads) {
    const u = UNITS[sq.type];
    // Who is in reach: soldiers first, then buildings.
    const foe = nearestEnemy(m, g, sq.owner, sq.x, sq.y, u.range);
    let wk = null;
    if (!foe) {
      let bd = u.range + 0.6;
      const near = [];
      for (let cy = Math.floor((sq.y - bd) / CELL); cy <= Math.floor((sq.y + bd) / CELL); cy++) {
        for (let cx = Math.floor((sq.x - bd) / CELL); cx <= Math.floor((sq.x + bd) / CELL); cx++) {
          const list = gw.get(cy * 4096 + cx);
          if (list) near.push(...list);
        }
      }
      for (const s of near) {
        if (!hostile(m, sq.owner, s.owner)) continue;
        const d = Math.hypot(s.x - sq.x, s.y - sq.y);
        // Passing columns do not stop to besiege every town on the way.
        const meant = sq.state !== 'moving' || (sq.dest && Math.hypot(sq.dest[0] - s.x, sq.dest[1] - s.y) < 8);
        if (d <= bd && meant && (s.garrison > 0 || d <= 1.7)) {
          bd = d;
          wk = s;
        }
      }
    }
    if (foe) {
      const mult = u.vs[foe.type] || 1;
      harm(foe, (sq.n * u.atk * mult * dt * cover(m, foe)) / UNITS[foe.type].hp);
      sq.fighting = true;
      continue;
    }
    if (wk) {
      sq.fighting = true;
      if (wk.garrison > 0) hit.set(wk.id, (hit.get(wk.id) || 0) + (sq.n * u.atk * (u.vs.works || 1) * dt * worksCover(m, wk)) / 10);
      else if (sq.type !== 'trebuchet' && Math.hypot(wk.x - sq.x, wk.y - sq.y) <= 1.7) capture(m, wk, sq.owner);
      continue;
    }
    sq.fighting = false;
    if (sq.state === 'moving' && sq.path) {
      if (march(m, sq, dt)) {
        sq.state = 'idle';
        sq.path = null;
        sq.post = [Math.round(sq.x), Math.round(sq.y)];
      }
      continue;
    }
    // Holding a post: go for enemies that come near (archers and engines
    // only until they are within reach), but not too far from the post.
    const near = nearestEnemy(m, g, sq.owner, sq.x, sq.y, Math.max(RULES.aggro, u.range + 2));
    if (near && Math.hypot(near.x - sq.post[0], near.y - sq.post[1]) <= RULES.leash + u.range) {
      stepToward(m, sq, near.x, near.y, dt);
      continue;
    }
    if (Math.hypot(sq.x - sq.post[0], sq.y - sq.post[1]) > 0.3) stepToward(m, sq, sq.post[0], sq.post[1], dt);
  }
  // Rival soldiers near a structure put it under siege: no soldiers leave it, the garrison does not grow.
  for (const s of works) if (s.owner >= 0 && nearestEnemy(m, g, s.owner, s.x, s.y, 8)) s.siege = st.t;
  // Garrisons shoot back.
  for (const s of works) {
    if (s.owner < 0 || !(s.garrison > 0)) continue;
    const range = s.kind === 'outpost' ? STRUCTURES.outpost.range : s.kind === 'town' && s.level >= 3 ? 5 : 3;
    const foe = nearestEnemy(m, g, s.owner, s.x, s.y, range);
    if (!foe) continue;
    const atk = s.kind === 'outpost' ? 0.45 : 0.3;
    harm(foe, (s.garrison * atk * dt * cover(m, foe)) / UNITS[foe.type].hp);
    s.alarm = st.t;
  }
  for (const s of works) {
    const lost = hit.get(s.id);
    if (lost) {
      s.garrison = Math.max(0, s.garrison - lost);
      s.alarm = st.t;
    } else if (!besieged(m, s) && st.t - (s.alarm ?? -99) > 6 && s.garrison < garrisonMax(s)) {
      s.garrison = Math.min(garrisonMax(s), s.garrison + RULES.garrisonRegen * dt);
    }
  }
  if (hurt.size) {
    for (const sq of squads) {
      const lost = hurt.get(sq.id);
      if (!lost) continue;
      sq.n -= lost;
      st.players[sq.owner].stats.lostSoldiers += Math.min(lost, Math.max(0, sq.n + lost));
    }
    st.squads = squads.filter((sq) => sq.n >= 0.5);
  }
}

/**
 * A structure whose garrison is gone falls to the squad at its gate, with
 * its land: the old owner's tiles within its reach that are nearer to it than
 * to any other of the old owner's places.
 */
export function capture(m, s, to) {
  const from = s.owner;
  const r = landRadius(s) + 2;
  const others = m.state.structures.filter((q) => q !== s && q.owner === from && Math.hypot(q.x - s.x, q.y - s.y) < 2 * r + 2);
  s.owner = to;
  s.capital = false;
  s.garrison = garrisonMax(s) * 0.2;
  s.alarm = m.state.t;
  m.state.structV++;
  for (const [dx, dy, d] of disk(r)) {
    const x = s.x + dx;
    const y = s.y + dy;
    if (x < 0 || y < 0 || x >= m.W || y >= m.H) continue;
    const i = m.idx(x, y);
    if (!m.land[i] || (m.owner[i] !== from && m.owner[i] >= 0)) continue;
    if (from >= 0 && others.some((q) => Math.hypot(q.x - x, q.y - y) < d)) continue;
    m.setOwner(i, to);
  }
  // And whatever its own buildings and fields stand on.
  const L = m.layouts.get(s.id);
  for (const b of L ? [...L.buildings, ...L.fields] : []) {
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        const i = m.idx(x, y);
        if (m.land[i] && (m.owner[i] === from || m.owner[i] < 0)) m.setOwner(i, to);
      }
    }
  }
  const what = STRUCTURES[s.kind].name.toLowerCase();
  const p = m.state.players[to];
  if (from >= 0) m.event(from, 'lost', `${p.name} took your ${what} ${s.name}.`, s.x, s.y);
  m.event(to, 'captured', `You took the ${what} ${s.name}.`, s.x, s.y);
  if (from >= 0) m.event(-1, 'fallen-town', `${p.name} takes ${s.name} from ${m.state.players[from].name}.`, s.x, s.y);
}

/** Idle squads of one owner and type standing together become one squad. */
export function merge(m) {
  const st = m.state;
  const g = grid(m);
  const gone = new Set();
  for (const sq of st.squads) {
    if (gone.has(sq.id) || sq.state !== 'idle' || sq.fighting || sq.n >= RULES.maxSquad) continue;
    const list = g.get(((sq.y / CELL) | 0) * 4096 + ((sq.x / CELL) | 0)) || [];
    for (const o of list) {
      if (o === sq || gone.has(o.id) || o.id < sq.id || o.owner !== sq.owner || o.type !== sq.type || o.state !== 'idle' || o.fighting) continue;
      if (Math.hypot(o.x - sq.x, o.y - sq.y) > 2.5 || sq.n + o.n > RULES.maxSquad) continue;
      sq.n += o.n;
      gone.add(o.id);
    }
  }
  if (gone.size) st.squads = st.squads.filter((q) => !gone.has(q.id));
}

/** Gold upkeep of the army; an empty treasury makes soldiers desert. */
export function upkeep(m, dt) {
  const st = m.state;
  const cost = new Float64Array(st.players.length);
  for (const sq of st.squads) cost[sq.owner] += sq.n * UNITS[sq.type].cost * RULES.upkeep * dt;
  for (const p of st.players) {
    p.upkeep = cost[p.id] / dt;
    p.gold -= cost[p.id];
    if (p.gold < 0) {
      p.gold = 0;
      for (const sq of st.squads) if (sq.owner === p.id) sq.n -= sq.n * RULES.desertion * dt;
    }
  }
  if (st.squads.some((sq) => sq.n < 0.5)) st.squads = st.squads.filter((sq) => sq.n >= 0.5);
}

/** Fighting strength of a squad (for AI estimates). */
export function power(sq) {
  const u = UNITS[sq.type];
  return sq.n * Math.sqrt(u.hp * u.atk * 10);
}
