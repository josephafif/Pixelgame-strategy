// Headless match: AI kingdoms play for a while; prints a chronicle and stats.
// Usage: node tools/simulate.mjs [seed] [minutes] [ais] [size]
import { Match } from '../engine/sim/match.js';
import { TICK } from '../engine/sim/defs.js';

const seed = Number(process.argv[2] ?? 3);
const minutes = Number(process.argv[3] ?? 10);
const ais = Number(process.argv[4] ?? 4);
const size = process.argv[5] ?? 'medium';
const t0 = performance.now();
const m = new Match({ seed, size, placementTime: 0.25, players: Array.from({ length: ais }, (_, i) => ({ ai: true, name: undefined, personality: ['builder', 'merchant', 'warlord'][i % 3] })) });
console.log(`setup ${(performance.now() - t0).toFixed(0)} ms, hubs ${m.state.hubs.length}, sites ${m.startSites.length}`);
const ticks = Math.round((minutes * 60) / TICK);
let last = 0;
const t1 = performance.now();
let worst = 0;
for (let i = 0; i < ticks; i++) {
  const a = performance.now();
  m.step();
  worst = Math.max(worst, performance.now() - a);
  if (m.state.phase === 'over') break;
  if (m.state.t - last >= 60 || i === ticks - 1) {
    last = m.state.t;
    const line = m.state.kingdoms.map((k) => `${k.name.slice(0, 10)}[${k.personality[0]}] pop ${k.stats.pop} sol ${k.stats.soldiers} towns ${m.settlementsOf(k.id).length} coin ${Math.round(k.coin)} food ${Math.round(k.stock.food)} wood ${Math.round(k.stock.wood)}${k.alive ? '' : ' FALLEN'}`).join(' | ');
    console.log(`t=${Math.round(m.state.t)}s ${line}`);
  }
}
const ms = performance.now() - t1;
console.log(`simulated ${Math.round(m.state.t)}s in ${(ms / 1000).toFixed(1)}s real (${(ms / ticks).toFixed(2)} ms/tick avg, worst ${worst.toFixed(0)} ms)`);
const evs = m.state.events.filter((e) => e.kid === -1 || e.kind === 'found' || e.kind === 'stage' || e.kind === 'capture');
for (const e of evs.slice(-40)) console.log(`  [${Math.round(e.t)}] ${e.kid >= 0 ? m.state.kingdoms[e.kid].name + ': ' : ''}${e.text}`);
console.log('settlements:', m.state.settlements.filter((s) => !s.hub).map((s) => `${s.name}(${s.kingdom}) st${s.stage} pop${Math.round(s.pop)}/${s.housing} b:${Object.entries(s.buildings).map(([k, v]) => k + v).join(',')}`).join('\n  '));
console.log('market:', JSON.stringify(m.state.market.price));
for (const k of m.state.kingdoms) console.log(`  ${k.name}: trades ${k.stats.trades || 0} (sold ${Math.round(k.stats.sold || 0)}, bought ${Math.round(k.stats.bought || 0)}), deals ${k.stats.deals || 0}, roads ${m.state.roadJobs.filter((r) => r.kid === k.id).length} building, orders ${k.orders.map((o) => o.side + ' ' + o.res).join(', ')}, stock ${JSON.stringify(Object.fromEntries(Object.entries(k.stock).map(([a, b]) => [a, Math.round(b)])))}`);
console.log('tally:', JSON.stringify(m.state.tally || {}));
console.log('winner:', JSON.stringify(m.state.winner));
