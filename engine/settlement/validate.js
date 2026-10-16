// Step 7 of the settlement pipeline: verify a layout and repair what can be
// repaired. Invariants:
//  - buildings never overlap each other, roads, fields or piers
//  - buildings stand on terrain their kind allows
//  - every building's entrance faces a road (or the plaza) connected to the plaza
//  - the road network is a single connected component containing the plaza
//  - no road ends without a reason (a gate, a door, a pier or the plaza)
//  - buildings keep their required spacing

import { N, T, O, analyzeLocal } from './terrain.js';
import { KINDS } from './kinds.js';
import { STYLES } from './styles.js';

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

function inner(x, y) {
  return x >= 1 && y >= 1 && x < N - 1 && y < N - 1;
}

function isNet(L, l) {
  return L.road[l] > 0 || L.occ[l] === O.PLAZA;
}

/** Cells that justify a road ending next to them. */
function terminals(L) {
  const set = new Set();
  for (const a of L.arteries) set.add(a.gate);
  if (L.harbor) set.add(L.harbor.land);
  for (const b of L.buildings) set.add(b.front);
  for (const d of L.docks) {
    for (const [wx, wy] of d.cells) {
      const x = wx - L.ox;
      const y = wy - L.oy;
      for (let k = 0; k < 4; k++) if (inner(x + DX[k], y + DY[k])) set.add((y + DY[k]) * N + x + DX[k]);
    }
  }
  if (L.walls) for (const [wx, wy] of L.walls.gates) set.add((wy - L.oy) * N + (wx - L.ox));
  return set;
}

function netDegree(L, l) {
  const x = l % N;
  const y = (l / N) | 0;
  let d = 0;
  for (let k = 0; k < 4; k++) {
    const nx = x + DX[k];
    const ny = y + DY[k];
    if (inner(nx, ny) && isNet(L, ny * N + nx)) d++;
  }
  return d;
}

/** Prune unjustified dead ends and orphaned road fragments. Returns cells removed. */
export function repairLayout(world, L) {
  let removed = 0;
  const term = terminals(L);
  // 1. Disconnected fragments that serve nothing.
  const reach = reachable(L);
  for (let l = 0; l < N * N; l++) {
    if (L.road[l] && !reach[l] && !term.has(l)) {
      L.road[l] = 0;
      if (L.occ[l] === O.ROAD) L.occ[l] = O.FREE;
      removed++;
    }
  }
  // 2. Dead-end stubs, peeled back until they reach a junction or a terminal.
  let changed = true;
  while (changed) {
    changed = false;
    for (let l = 0; l < N * N; l++) {
      if (!L.road[l] || L.occ[l] === O.PLAZA) continue;
      if (term.has(l)) continue;
      if (netDegree(L, l) <= 1) {
        L.road[l] = 0;
        L.occ[l] = O.FREE;
        removed++;
        changed = true;
      }
    }
  }
  if (removed) L.v++;
  return removed;
}

/** Cells of the network reachable from the plaza. */
function reachable(L) {
  const seen = new Uint8Array(N * N);
  const q = [];
  const p = L.plaza;
  for (let y = p.y0; y < p.y0 + p.h; y++) {
    for (let x = p.x0; x < p.x0 + p.w; x++) {
      seen[y * N + x] = 1;
      q.push(y * N + x);
    }
  }
  while (q.length) {
    const c = q.pop();
    const x = c % N;
    const y = (c / N) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + DX[k];
      const ny = y + DY[k];
      if (!inner(nx, ny)) continue;
      const nl = ny * N + nx;
      if (!seen[nl] && isNet(L, nl)) {
        seen[nl] = 1;
        q.push(nl);
      }
    }
  }
  return seen;
}

/**
 * Full check of a layout. Returns { ok, errors: [{ type, detail }] }.
 */
export function validateLayout(world, L) {
  const errors = [];
  const err = (type, detail) => errors.push({ type, detail });
  const an = analyzeLocal(world, L.ox, L.oy, L.seed);
  const style = STYLES[L.style] || STYLES.farm;
  const paint = new Int32Array(N * N);

  // Overlaps and terrain.
  for (const b of L.buildings) {
    const k = KINDS[b.kind];
    const x0 = b.x - L.ox;
    const y0 = b.y - L.oy;
    if (!inner(x0, y0) || !inner(x0 + b.w - 1, y0 + b.h - 1)) {
      err('bounds', b.id);
      continue;
    }
    for (let y = y0; y < y0 + b.h; y++) {
      for (let x = x0; x < x0 + b.w; x++) {
        const l = y * N + x;
        if (paint[l]) err('overlap', `${b.id}/${paint[l]}`);
        paint[l] = b.id;
        if (L.road[l]) err('building-on-road', b.id);
        const t = an.tbase[l];
        const ok = t === T.LAND
          || (t === T.MARSH && (style.marsh || b.kind === 'fishery' || b.kind === 'herbalist'))
          || (t === T.STEEP && (k.steep || style.steepOk));
        if (!ok) err('terrain', `${b.id}:${b.kind}@${t}`);
      }
    }
  }
  for (const f of L.fields) {
    for (let y = f.y - L.oy; y < f.y - L.oy + f.h; y++) {
      for (let x = f.x - L.ox; x < f.x - L.ox + f.w; x++) {
        const l = y * N + x;
        if (paint[l]) err('field-overlap', f.id);
        paint[l] = -1;
        if (L.road[l]) err('field-on-road', f.id);
        const t = an.tbase[l];
        if (!(t === T.LAND || (t === T.MARSH && style.marsh))) err('field-terrain', f.id);
      }
    }
  }
  for (const d of L.docks) {
    for (const [wx, wy] of d.cells) {
      const l = (wy - L.oy) * N + (wx - L.ox);
      if (paint[l]) err('dock-overlap', d.id);
      paint[l] = -2;
      const t = an.tbase[l];
      if (t !== T.SHORE && t !== T.WATER) err('dock-terrain', d.id);
    }
  }

  // Connectivity.
  const reach = reachable(L);
  for (let l = 0; l < N * N; l++) if (L.road[l] && !reach[l]) err('disconnected-road', l);
  for (const b of L.buildings) {
    const f = b.front;
    if (!isNet(L, f)) err('door-not-on-road', b.id);
    else if (!reach[f]) err('unreachable', b.id);
    // The door cell must be part of the footprint and next to the frontage.
    const dl = (b.door.y - L.oy) * N + (b.door.x - L.ox);
    if (paint[dl] !== b.id) err('door-outside', b.id);
    const fx = f % N;
    const fy = (f / N) | 0;
    if (Math.abs(fx - (b.door.x - L.ox)) + Math.abs(fy - (b.door.y - L.oy)) !== 1) err('door-not-adjacent', b.id);
  }

  // Dead ends.
  const term = terminals(L);
  for (let l = 0; l < N * N; l++) {
    if (!L.road[l] || L.occ[l] === O.PLAZA) continue;
    if (netDegree(L, l) <= 1 && !term.has(l)) err('dead-end', l);
  }

  // Spacing.
  for (const b of L.buildings) {
    const x0 = b.x - L.ox;
    const y0 = b.y - L.oy;
    for (let y = y0 - 1; y <= y0 + b.h; y++) {
      for (let x = x0 - 1; x <= x0 + b.w; x++) {
        if (x >= x0 && x < x0 + b.w && y >= y0 && y < y0 + b.h) continue;
        if (!inner(x, y)) continue;
        const o = paint[y * N + x];
        if (o > 0 && o !== b.id) {
          const other = L.buildings.find((q) => q.id === o);
          const terraced = b.kind === 'house' && other.kind === 'house' && other.y === b.y && other.h === b.h && (x === x0 - 1 || x === x0 + b.w);
          if (!terraced) err('spacing', `${b.id}/${o}`);
        }
      }
    }
  }

  // Occupancy grid must agree with the records.
  for (let l = 0; l < N * N; l++) {
    const o = L.occ[l];
    if (paint[l] > 0 && o !== O.BUILDING) err('occ-mismatch', l);
    if (o === O.BUILDING && paint[l] <= 0) err('occ-ghost', l);
    if (o === O.ROAD && !L.road[l]) err('occ-road-mismatch', l);
  }
  return { ok: errors.length === 0, errors };
}
