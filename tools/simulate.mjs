// Headless match: AI players race for land; prints a standings line each
// minute, the notable events and the winner.
// Usage: node tools/simulate.mjs [seed] [minutes] [ais] [size]
import { Match } from '../engine/sim/match.js';
import { TICK } from '../engine/sim/defs.js';

const seed = Number(process.argv[2] ?? 3);
const minutes = Number(process.argv[3] ?? 20);
const ais = Number(process.argv[4] ?? 10);
const size = process.argv[5] ?? 'medium';
const t0 = performance.now();
const m = new Match({ seed, size, placementTime: 0.2, timeLimit: minutes * 60, players: Array.from({ length: ais }, (_, i) => ({ ai: true, personality: ['builder', 'merchant', 'warlord'][i % 3] })) });
console.log(`setup ${(performance.now() - t0).toFixed(0)} ms, ${m.W}x${m.H}, land ${m.landTotal}`);
const ticks = Math.round((minutes * 60 + 1) / TICK);
let last = 0;
const t1 = performance.now();
let worst = 0;
const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);
for (let i = 0; i < ticks; i++) {
  const a = performance.now();
  m.step();
  worst = Math.max(worst, performance.now() - a);
  if (m.state.phase === 'over') break;
  if (m.state.t - last >= 60) {
    last = m.state.t;
    const ps = [...m.state.players].sort((x, y) => y.tiles - x.tiles);
    const line = ps.slice(0, 8).map((p) => `${p.name.slice(0, 8)}[${p.personality[0]}] ${((p.tiles / m.landTotal) * 100).toFixed(1)}% pop ${k(p.pop)}/${k(p.maxPop)} g${k(p.gold)}${p.alive ? '' : ' X'}`).join(' | ');
    const st = m.state;
    console.log(`t=${Math.round(st.t / 60)}m alive ${ps.filter((p) => p.alive).length} atk ${st.attacks.length} boats ${st.boats.filter((b) => b.kind === 'transport').length}/${st.boats.length} towns ${st.structures.filter((s) => s.kind === 'town').length} ports ${st.structures.filter((s) => s.kind === 'port').length} outposts ${st.structures.filter((s) => s.kind === 'outpost').length} allies ${st.alliances.length} :: ${line}`);
  }
}
const ms = performance.now() - t1;
console.log(`simulated ${Math.round(m.state.t)}s in ${(ms / 1000).toFixed(1)}s real (${(ms / Math.max(1, m.state.tick)).toFixed(2)} ms/tick avg, worst ${worst.toFixed(0)} ms)`);
const evs = m.state.events.filter((e) => e.kid === -1);
for (const e of evs.slice(-25)) console.log(`  [${Math.round(e.t)}] ${e.text}`);
for (const p of m.state.players) console.log(`  ${p.name}: ${p.alive ? 'alive' : 'fallen'}, best ${((p.stats.maxTiles / m.landTotal) * 100).toFixed(1)}%, attacks ${p.stats.attacks}, boats ${p.stats.boats}, trade ${Math.round(p.stats.trade)} gold, towns ${m.state.structures.filter((s) => s.owner === p.id && s.kind === 'town').map((s) => s.level).join(',')}`);
console.log('winner:', JSON.stringify(m.state.winner), m.state.winner ? m.state.players[m.state.winner.kid].name : '');
