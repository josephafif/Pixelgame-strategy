// The command interface: every action a human or AI player can take goes
// through applyCommand, which validates it against the rules. Network
// messages, the single-player worker and the AI all use the same commands.

import { RULES } from './defs.js';
import * as attacks from './attack.js';
import * as naval from './naval.js';
import * as diplomacy from './diplomacy.js';
import * as structures from './structures.js';

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Is tile `i` (held by `o`) reachable over land from `pid`'s border? Walks
 * the target's land outward from the tile until it meets the player.
 */
export function landReach(m, pid, i, limit = 60000) {
  const o = m.owner[i];
  if (m.touches(i, pid)) return true;
  const seen = new Set([i]);
  const queue = [i];
  const { W } = m;
  for (let k = 0; k < queue.length && k < limit; k++) {
    const j = queue[k];
    const x = j % W;
    for (const n of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j - W, j + W]) {
      if (n < 0 || n >= m.owner.length || seen.has(n) || !m.land[n]) continue;
      if (m.owner[n] === pid) return true;
      if (m.owner[n] !== o) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return false;
}

export function applyCommand(m, pid, cmd) {
  if (!cmd || typeof cmd.type !== 'string') return { error: 'Malformed command.' };
  const st = m.state;
  const p = st.players[pid];
  if (!p) return { error: 'Unknown player.' };
  if (st.phase === 'over') return { error: 'The match is over.' };
  if (cmd.type === 'place') {
    if (st.phase !== 'placement') return { error: 'The start is over.' };
    if (p.spawned) return { error: 'You have already started.' };
    const x = Math.round(num(cmd.x));
    const y = Math.round(num(cmd.y));
    const err = m.spawnError(x, y);
    if (err) return { error: err };
    m.spawn(pid, x, y);
    return { ok: true };
  }
  if (st.phase !== 'running') return { error: 'Wait for the match to start.' };
  if (!p.alive) return { error: 'Your realm has fallen.' };
  switch (cmd.type) {
    case 'attack':
    case 'boat': {
      const x = Math.round(num(cmd.x, -1));
      const y = Math.round(num(cmd.y, -1));
      if (x < 0 || y < 0 || x >= m.W || y >= m.H) return { error: 'Outside the map.' };
      const ratio = clamp(num(cmd.ratio, RULES.attackRatio), 0.01, 1);
      const troops = m.troops(p) * ratio;
      if (troops < RULES.minAttack) return { error: 'Not enough troops to attack.' };
      const i = m.idx(x, y);
      const o = m.owner[i];
      if (cmd.type === 'attack') {
        if (!m.land[i]) return { error: 'That is water. Tap a shore to send a boat.' };
        if (o === pid) return { error: 'That is your own land.' };
        if (o >= 0 && m.allied(pid, o)) return { error: `${st.players[o].name} is your ally.` };
        if (landReach(m, pid, i)) {
          p.troops -= troops;
          attacks.launch(m, pid, o, troops, { fx: x, fy: y });
          return { ok: true, how: 'land' };
        }
      }
      // Across the water.
      const r = naval.sendBoat(m, pid, x, y, troops);
      if (r.error && cmd.type === 'attack') return { error: o === -1 ? `You do not border that land, and ${r.error[0].toLowerCase()}${r.error.slice(1)}` : r.error };
      if (r.ok) r.how = 'boat';
      return r;
    }
    case 'retreat': {
      const a = st.attacks.find((q) => q.id === num(cmd.id) && q.from === pid);
      if (!a) return { error: 'No such attack.' };
      attacks.finish(m, a, RULES.retreatKeep);
      return { ok: true };
    }
    case 'troops':
      p.troopShare = clamp(num(cmd.share, RULES.troopShare), 0.05, 0.95);
      return { ok: true };
    case 'build':
      return structures.build(m, pid, String(cmd.kind), Math.round(num(cmd.x, -1)), Math.round(num(cmd.y, -1)));
    case 'upgrade':
      return structures.upgrade(m, pid, num(cmd.sid));
    case 'ally':
      return diplomacy.request(m, pid, num(cmd.to, -1));
    case 'answer':
      return diplomacy.answer(m, pid, num(cmd.id), !!cmd.accept);
    case 'breakAlliance':
      return diplomacy.breakOff(m, pid, num(cmd.to, -1));
    default:
      return { error: `Unknown command ${cmd.type}.` };
  }
}
