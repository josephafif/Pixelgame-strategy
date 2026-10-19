// Run the civilization simulator headless and print its chronicle.
// Usage: node tools/civ-sim.mjs [seed] [years] [size] [peoples]
import { CivSim, yearText } from '../engine/civ/sim.js';
import { ERAS } from '../engine/civ/tech.js';

const [seed = '3', years = '2000', size = 'medium', peoples = '14'] = process.argv.slice(2);
let t0 = performance.now();
const sim = new CivSim({ seed: Number(seed), size, peoples: Number(peoples) });
console.log(`world ${sim.W}x${sim.H} ready in ${(performance.now() - t0).toFixed(0)} ms; ${sim.civs.length - 1} peoples, ${sim.siteList.length} sites`);
t0 = performance.now();
let shown = 0;
const end = sim.year + Number(years);
let worst = 0;
let last = performance.now();
while (sim.year < end) {
  const a = performance.now();
  sim.step();
  worst = Math.max(worst, performance.now() - a);
  for (; shown < sim.events.length; shown++) {
    const e = sim.events[shown];
    if (e.weight >= 1) console.log(`${yearText(e.year).padStart(9)}  ${e.text}`);
  }
  if (sim.month === 0 && sim.year % 250 === 0 && performance.now() - last > 0) {
    last = performance.now();
    const civs = [...sim.liveCivs()].sort((p, q) => q.stats.pop - p.stats.pop);
    const pop = civs.reduce((s, c) => s + c.stats.pop, 0);
    console.log(`--- ${yearText(sim.year)}: ${civs.length} realms, ${[...sim.liveTowns()].length} towns, ${Math.round(pop).toLocaleString()} people, ${sim.layout.blds.filter(Boolean).length} buildings, ${sim.war.armies.length} armies, ${(performance.now() - t0).toFixed(0)} ms`);
    for (const c of civs.slice(0, 5)) console.log(`      ${c.name.padEnd(34)} ${ERAS[c.era].name.padEnd(15)} pop ${Math.round(c.stats.pop).toLocaleString().padStart(10)}  towns ${String(c.stats.towns).padStart(3)}  stab ${c.stability.toFixed(0)}`);
  }
}
const ms = performance.now() - t0;
console.log(`${years} years in ${ms.toFixed(0)} ms (${(ms / Number(years)).toFixed(2)} ms/year, worst month ${worst.toFixed(1)} ms)`);
