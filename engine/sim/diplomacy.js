// Alliances. A player asks, the other accepts or declines. Allies cannot
// attack each other, and their trade ships earn more. An alliance lasts five
// minutes and can be renewed in its last minute. Breaking one makes you a
// traitor: for a minute your land is easier to take.

import { RULES } from './defs.js';
import * as attacks from './attack.js';

export function alliance(m, a, b) {
  return m.state.alliances.find((q) => (q.a === a && q.b === b) || (q.a === b && q.b === a)) || null;
}

export function allied(m, a, b) {
  if (a < 0 || b < 0 || a === b) return false;
  return !!alliance(m, a, b);
}

export function request(m, from, to) {
  const st = m.state;
  const p = st.players[from];
  const q = st.players[to];
  if (!q || to === from) return { error: 'No such realm.' };
  if (!q.alive || !q.spawned) return { error: `${q.name} is not in the game.` };
  const al = alliance(m, from, to);
  if (al && al.until - st.t > RULES.renewWindow) return { error: `You are already allied with ${q.name}.` };
  // Asking someone who already asked you seals it.
  const theirs = st.requests.find((r) => r.from === to && r.to === from);
  if (theirs) return answer(m, from, theirs.id, true);
  if (st.requests.some((r) => r.from === from && r.to === to)) return { error: `You already asked ${q.name}.` };
  const r = { id: m.nextId(), from, to, until: st.t + RULES.requestTime, renew: !!al };
  st.requests.push(r);
  m.event(to, 'request', `${p.name} ${al ? 'wants to renew your alliance' : 'asks for an alliance'}.`);
  return { ok: true, id: r.id };
}

export function answer(m, pid, rid, accept) {
  const st = m.state;
  const r = st.requests.find((q) => q.id === rid && q.to === pid);
  if (!r) return { error: 'That request has expired.' };
  st.requests = st.requests.filter((q) => q !== r);
  const p = st.players[r.from];
  const q = st.players[r.to];
  if (!accept) {
    m.event(r.from, 'declined', `${q.name} declines your alliance.`);
    return { ok: true };
  }
  if (!p.alive || !q.alive) return { error: 'That realm has fallen.' };
  const al = alliance(m, r.from, r.to);
  if (al) al.until = st.t + RULES.allianceTime;
  else {
    st.alliances.push({ a: r.from, b: r.to, since: st.t, until: st.t + RULES.allianceTime });
    attacks.callOff(m, r.from, r.to);
  }
  m.event(-1, 'alliance', `${p.name} and ${q.name} ${al ? 'renew their' : 'form an'} alliance.`);
  return { ok: true };
}

export function breakOff(m, pid, other) {
  const st = m.state;
  const al = alliance(m, pid, other);
  if (!al) return { error: 'You are not allied.' };
  st.alliances = st.alliances.filter((q) => q !== al);
  const p = st.players[pid];
  p.traitorUntil = st.t + RULES.traitorTime;
  m.event(-1, 'betrayal', `${p.name} breaks the alliance with ${st.players[other].name}!`);
  return { ok: true };
}

/** Once a second: expire requests and alliances. */
export function tick(m) {
  const st = m.state;
  if (st.requests.length) st.requests = st.requests.filter((r) => r.until > st.t);
  for (const al of [...st.alliances]) {
    if (al.until > st.t) continue;
    st.alliances = st.alliances.filter((q) => q !== al);
    m.event(al.a, 'expired', `Your alliance with ${st.players[al.b].name} has ended.`);
    m.event(al.b, 'expired', `Your alliance with ${st.players[al.a].name} has ended.`);
  }
}
