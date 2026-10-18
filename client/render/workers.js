// Villagers at work around towns. Purely visual: the simulation only counts
// people, but every town shows some of them busy at the places its plan
// laid out: woodcutters at the trees by the lumber camp, miners at the
// quarry, farmers in the fields, fishers on the piers and porters walking the
// streets. Positions are worked out once per layout version from the layout
// itself, deterministically, and animated with the clock.

import { workerSprite } from './people.js';
import { TILE } from './ground.js';
import { TREE_FEATURES, F } from '../../engine/world/biomes.js';
import { N as LN, O } from '../../engine/settlement/planner.js';

const PER_STAGE = [3, 6, 9, 13, 18];
const ROCKS = new Set([F.ROCK, F.BOULDER, F.CRAG]);

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Road cells of the layout between two world points (BFS on the street grid), as world points. */
function streetPath(L, ax, ay, bx, by) {
  const nearestRoad = (x, y) => {
    let best = -1;
    let bd = Infinity;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const lx = x - L.ox + dx;
        const ly = y - L.oy + dy;
        if (lx < 0 || ly < 0 || lx >= LN || ly >= LN || !(L.road[ly * LN + lx] || L.occ[ly * LN + lx] === O.PLAZA)) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = ly * LN + lx;
        }
      }
    }
    return best;
  };
  const a = nearestRoad(ax, ay);
  const b = nearestRoad(bx, by);
  if (a < 0 || b < 0 || a === b) return null;
  const from = new Int16Array(LN * LN).fill(-1);
  from[a] = a;
  const q = [a];
  for (let k = 0; k < q.length; k++) {
    const c = q[k];
    if (c === b) break;
    const x = c % LN;
    for (const n of [x > 0 ? c - 1 : -1, x < LN - 1 ? c + 1 : -1, c - LN, c + LN]) {
      if (n < 0 || n >= LN * LN || from[n] >= 0 || !(L.road[n] || L.occ[n] === O.PLAZA)) continue;
      from[n] = c;
      q.push(n);
    }
  }
  if (from[b] < 0) return null;
  const path = [];
  for (let c = b; c !== a; c = from[c]) path.push([L.ox + (c % LN), L.oy + ((c / LN) | 0)]);
  path.push([L.ox + (a % LN), L.oy + ((a / LN) | 0)]);
  return path.reverse();
}

/** Who works where in a town (cached per layout version by the caller). */
export function planWorkers(world, ov, L) {
  const r = rng(L.seed ^ 0x9e37);
  const out = [];
  const want = PER_STAGE[Math.max(0, Math.min(4, L.stage))];
  // About a third of them carry goods along the streets; the rest work.
  const workers = want - Math.max(1, Math.round(want * 0.35));
  const W = world.width;
  const used = new Set();
  const place = (job, x, y, flip = false) => out.push({ job, x, y, flip, variant: (r() * 6) | 0, phase: r() * 4 });
  for (const b of L.buildings) {
    if (out.length >= workers) break;
    if (b.kind === 'lumber') {
      // The nearest standing trees.
      const trees = [];
      for (let dy = -7; dy <= 7; dy++) {
        for (let dx = -7; dx <= 7; dx++) {
          const x = b.door.x + dx;
          const y = b.door.y + dy;
          if (x < 1 || y < 1 || x >= W - 1 || y >= world.height - 1) continue;
          const i = y * W + x;
          if (!TREE_FEATURES.has(world.feature[i]) || ov.cleared[i] || used.has(i)) continue;
          trees.push([dx * dx + dy * dy, x, y, i]);
        }
      }
      trees.sort((p, q) => p[0] - q[0]);
      for (const [, x, y, i] of trees.slice(0, 2)) {
        used.add(i);
        place('chop', x - 0.55, y + 0.25);
      }
    } else if (b.kind === 'quarry' || b.kind === 'mine') {
      let rock = null;
      for (let dy = -6; dy <= 6 && !rock; dy++) {
        for (let dx = -6; dx <= 6; dx++) {
          const i = (b.door.y + dy) * W + b.door.x + dx;
          if (ROCKS.has(world.feature[i]) && !ov.cleared[i]) {
            rock = [b.door.x + dx, b.door.y + dy];
            break;
          }
        }
      }
      const [x, y] = rock || [b.x + b.w / 2, b.y + b.h];
      place('mine', x - 0.6, y + 0.3);
      if (out.length < workers) place('mine', x + 0.6, y + 0.35, true);
    } else if (b.kind === 'farm' && b.field) {
      const f = L.fields.find((q) => q.id === b.field);
      if (!f) continue;
      place('farm', f.x + 0.5 + r() * Math.max(0, f.w - 1), f.y + 0.6 + r() * Math.max(0, f.h - 1), r() < 0.5);
    } else if (b.kind === 'fishery' || b.kind === 'harbor') {
      const d = L.docks.find((q) => q.id === b.id);
      if (d && d.cells.length) {
        const [x, y] = d.cells[d.cells.length - 1];
        place('fish', x + 0.5, y + 0.4, d.dir === 'w');
      }
    }
  }
  // Porters between the market (or the hall) and houses.
  const hub = L.buildings.find((b) => b.kind === 'market') || L.buildings.find((b) => b.kind === 'keep' || b.kind === 'hall' || b.kind === 'lodge');
  const homes = L.buildings.filter((b) => b.kind === 'house' || b.kind === 'farm' || b.kind === 'lumber');
  for (let k = 0; k < homes.length && out.length < want && hub; k++) {
    const h = homes[(k * 5 + 3) % homes.length];
    const path = streetPath(L, hub.door.x, hub.door.y, h.door.x, h.door.y);
    if (!path || path.length < 4) continue;
    out.push({ job: r() < 0.5 ? 'carry' : 'walk', path, variant: (r() * 6) | 0, phase: r() * 100, speed: 0.9 + r() * 0.5 });
  }
  return out;
}

/** Draw a town's workers. `scale` is screen pixels per art pixel. */
export function drawWorkers(ctx, plans, ox, oy, ppt, now) {
  const scale = ppt / TILE;
  const t = now / 1000;
  for (const w of plans) {
    let x = w.x;
    let y = w.y;
    let flip = w.flip;
    let frame = Math.floor(t * 4 + w.phase) % 4;
    if (w.path) {
      // Walk the street to the end and back.
      const n = w.path.length - 1;
      const pos = ((t * w.speed + w.phase) % (2 * n));
      const fwd = pos < n;
      const u = fwd ? pos : 2 * n - pos;
      const k = Math.min(n - 1, Math.floor(u));
      const f = u - k;
      const [ax, ay] = w.path[k];
      const [bx, by] = w.path[k + 1];
      x = ax + (bx - ax) * f + 0.5;
      y = ay + (by - ay) * f + 0.7;
      flip = fwd ? bx < ax : bx > ax;
      frame = Math.floor(t * 6 + w.phase) % 4;
    }
    const spr = workerSprite(w.job, frame, w.variant);
    const sx = ox + x * ppt;
    const sy = oy + y * ppt;
    const dw = spr.w * scale;
    const dh = spr.h * scale;
    if (flip) {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(-1, 1);
      ctx.drawImage(spr.canvas, -spr.ax * scale, -spr.ay * scale, dw, dh);
      ctx.restore();
    } else ctx.drawImage(spr.canvas, sx - spr.ax * scale, sy - spr.ay * scale, dw, dh);
  }
}
