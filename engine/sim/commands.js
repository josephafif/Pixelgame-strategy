// The command interface: every action a human or AI player can take goes
// through applyCommand, which validates it against the rules. Network
// messages, the single-player worker and the AI all use the same commands.

import * as units from './units.js';
import * as diplomacy from './diplomacy.js';
import * as structures from './structures.js';

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const ids = (v) => (Array.isArray(v) ? v.slice(0, 400).map((x) => num(x, -1)) : []);

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
    case 'deploy':
      return units.deploy(m, pid, String(cmd.unit), num(cmd.n, 1), num(cmd.x, -1), num(cmd.y, -1));
    case 'move':
      return units.move(m, pid, ids(cmd.ids), num(cmd.x, -1), num(cmd.y, -1));
    case 'stop':
      return units.stop(m, pid, ids(cmd.ids));
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
