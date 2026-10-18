// How land changes hands without a fight. Land comes from settlements:
// every town, port and outpost slowly takes the unclaimed land within its
// reach (further as a town grows), nearest first; soldiers take no land by
// walking on it. Pockets enclosed by one realm are annexed (small empty ones,
// and small rival ones without buildings or soldiers).

import { RULES, landRadius } from './defs.js';
import { disk } from './units.js';

/** Each place takes a little of the unclaimed land within its reach, nearest first. */
export function landClaims(m) {
  const t = m.state.t;
  for (const s of m.state.structures) {
    if (s.owner < 0 || t < (s.landNext ?? 0)) continue;
    let left = s.kind === 'town' ? s.level : 1;
    let took = 0;
    for (const [dx, dy] of disk(landRadius(s))) {
      const x = s.x + dx;
      const y = s.y + dy;
      if (x < 0 || y < 0 || x >= m.W || y >= m.H) continue;
      const i = y * m.W + x;
      if (!m.land[i] || m.owner[i] !== -1) continue;
      if (took >= left) break;
      m.setOwner(i, s.owner);
      took++;
    }
    // Nothing (more) to take: look again in a while (land can fall back to the wilds).
    if (took < left) s.landNext = t + 15;
    if (took) {
      // New land to build on.
      s.full = false;
      const L = m.layouts.get(s.id);
      if (L) L.failed = {};
    }
  }
}

/**
 * Label every connected area of land with one owner (or none). An area
 * whose only land neighbour is one realm is annexed by it: unclaimed areas
 * up to RULES.annexNeutral tiles, rival areas up to RULES.annexRival tiles
 * with no building and no soldiers of their own inside.
 */
export function annex(m) {
  const { W, H, owner, land } = m;
  const n = W * H;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  const squadAt = new Set();
  for (const sq of m.state.squads) squadAt.add(Math.round(sq.y) * W + Math.round(sq.x));
  for (let start = 0; start < n; start++) {
    if (seen[start] || !land[start]) continue;
    const o = owner[start];
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    let other = -2; // the single neighbouring owner, -3 when there are several
    let blocked = false;
    while (head < tail) {
      const i = queue[head++];
      if (o >= 0 && (m.structAt.has(i) || squadAt.has(i))) blocked = true;
      const x = i % W;
      const y = (i / W) | 0;
      for (let k = 0; k < 4; k++) {
        let j;
        if (k === 0) j = x > 0 ? i - 1 : -1;
        else if (k === 1) j = x < W - 1 ? i + 1 : -1;
        else if (k === 2) j = y > 0 ? i - W : -1;
        else j = y < H - 1 ? i + W : -1;
        if (j < 0) {
          other = -3; // the map's edge counts as open
          continue;
        }
        if (!land[j]) continue;
        const oj = owner[j];
        if (oj === o) {
          if (!seen[j]) {
            seen[j] = 1;
            queue[tail++] = j;
          }
        } else if (other === -2) other = oj;
        else if (other !== oj) other = -3;
      }
    }
    if (other < 0 || blocked) continue;
    const limit = o < 0 ? RULES.annexNeutral : RULES.annexRival;
    if (tail > limit || (o >= 0 && m.allied(o, other))) continue;
    for (let k = 0; k < tail; k++) m.setOwner(queue[k], other);
    if (o >= 0) m.event(o, 'lost', `${m.state.players[other].name} surrounded and took ${tail} tiles of your land.`);
  }
}
