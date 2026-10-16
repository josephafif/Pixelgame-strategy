// The command interface: every action a human or AI kingdom can take goes
// through applyCommand, which validates it against the rules. Network
// messages, the single-player worker and the AI all use the same commands.

import { LABOR, STAGES, WALLS } from './defs.js';
import { orderBuilding, stageUpError } from './economy.js';
import { orderFound, orderScout, orderRoad } from './expansion.js';
import { orderError, propose, respond } from './trade.js';
import * as mil from './military.js';
import { removeBuilding } from '../settlement/planner.js';

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export function applyCommand(m, kid, cmd) {
  if (!cmd || typeof cmd.type !== 'string') return { error: 'Malformed command.' };
  const st = m.state;
  const k = st.kingdoms[kid];
  if (!k) return { error: 'Unknown kingdom.' };
  if (st.phase === 'over') return { error: 'The match is over.' };
  if (cmd.type === 'place') {
    if (st.phase !== 'placement') return { error: 'Placement is over.' };
    if (k.placed) return { error: 'You already have a capital.' };
    const x = Math.round(num(cmd.x));
    const y = Math.round(num(cmd.y));
    const err = m.placementError(x, y);
    if (err) return { error: err };
    m.foundCapital(kid, x, y);
    return { ok: true };
  }
  if (st.phase !== 'running') return { error: 'Wait for the match to start.' };
  if (!k.alive) return { error: 'Your kingdom has fallen.' };
  const s = cmd.sid !== undefined ? m.settlement(num(cmd.sid)) : null;
  switch (cmd.type) {
    case 'build':
      if (!s) return { error: 'No such settlement.' };
      return orderBuilding(m, kid, s, String(cmd.kind));
    case 'cancel': {
      if (!s || s.kingdom !== kid) return { error: 'Not your settlement.' };
      const p = s.projects.find((q) => q.id === num(cmd.pid));
      if (!p) return { error: 'No such project.' };
      s.projects = s.projects.filter((q) => q !== p);
      // Half the materials are recovered from an abandoned site.
      if (p.cost) m.refund(kid, p.cost, 0.5);
      if (p.bid) {
        removeBuilding(m.world, m.layouts.get(s.id), p.bid);
        m.layoutChanged(s);
      }
      return { ok: true };
    }
    case 'upgrade': {
      if (!s || s.kingdom !== kid) return { error: 'Not your settlement.' };
      const err = stageUpError(m, s);
      if (err) return { error: err };
      const up = STAGES[s.stage + 1].up;
      m.pay(kid, up.cost);
      s.projects.push({ id: m.nextId(), type: 'stage', to: s.stage + 1, work: up.work, progress: 0, cost: up.cost });
      return { ok: true };
    }
    case 'walls': {
      if (!s || s.kingdom !== kid) return { error: 'Not your settlement.' };
      const to = s.walls.level + 1;
      const w = WALLS[to];
      if (!w) return { error: 'Walls are already at their strongest.' };
      if (s.stage < 1) return { error: 'Outposts cannot raise walls.' };
      if (w.stage && s.stage < w.stage) return { error: `${w.name} need a ${STAGES[w.stage].name.toLowerCase()}.` };
      if (s.projects.some((p) => p.type === 'walls')) return { error: 'Walls are already being built.' };
      if (!m.canAfford(kid, w.cost)) return { error: `${w.name} cost ${Object.entries(w.cost).map(([r, v]) => `${v} ${r}`).join(', ')}.` };
      m.pay(kid, w.cost);
      s.projects.push({ id: m.nextId(), type: 'walls', to, hp: w.hp, work: w.work, progress: 0, cost: w.cost });
      return { ok: true };
    }
    case 'recruit':
      return mil.recruit(m, kid, s, String(cmd.unit), Math.floor(num(cmd.n, 1)));
    case 'levy':
      return mil.levy(m, kid, s);
    case 'demobilize':
      return mil.demobilize(m, kid, s, String(cmd.unit), Math.floor(num(cmd.n, 1)));
    case 'formArmy':
      return mil.formArmy(m, kid, s, cmd.units || null);
    case 'move':
      return mil.moveArmy(m, kid, num(cmd.aid), num(cmd.x), num(cmd.y));
    case 'garrison':
      return mil.garrisonArmy(m, kid, num(cmd.aid));
    case 'found':
      return orderFound(m, kid, num(cmd.sid), Math.round(num(cmd.x)), Math.round(num(cmd.y)));
    case 'scout':
      return orderScout(m, kid, num(cmd.sid), Math.round(num(cmd.x)), Math.round(num(cmd.y)));
    case 'road':
      return orderRoad(m, kid, num(cmd.a), num(cmd.b));
    case 'priority': {
      if (!LABOR.includes(cmd.cat)) return { error: 'Unknown labour category.' };
      k.priorities[cmd.cat] = Math.max(0, Math.min(3, Math.round(num(cmd.level, 2))));
      return { ok: true };
    }
    case 'order': {
      const o = { res: cmd.res, side: cmd.side, amount: Math.round(num(cmd.amount)), limit: num(cmd.limit), keep: Math.round(num(cmd.keep)) };
      const err = orderError(m, kid, o);
      if (err) return { error: err };
      k.orders.push({ id: m.nextId(), ...o });
      return { ok: true };
    }
    case 'cancelOrder':
      k.orders = k.orders.filter((o) => o.id !== num(cmd.oid));
      return { ok: true };
    case 'propose':
      return propose(m, kid, {
        to: num(cmd.to),
        give: { res: cmd.give?.res, n: Math.round(num(cmd.give?.n)) },
        get: { res: cmd.get?.res, n: Math.round(num(cmd.get?.n)) },
        every: num(cmd.every, 30),
        times: Math.round(num(cmd.times, 10)),
      });
    case 'respond':
      return respond(m, kid, num(cmd.id), !!cmd.accept);
    case 'declareWar':
      return mil.declareWar(m, kid, num(cmd.to));
    case 'offerPeace':
      return mil.offerPeace(m, kid, num(cmd.to));
    case 'answerPeace':
      return mil.answerPeace(m, kid, num(cmd.id), !!cmd.accept);
    default:
      return { error: `Unknown command ${cmd.type}.` };
  }
}
