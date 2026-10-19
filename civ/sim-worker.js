// Runs the simulator off the main thread. Time passes at the chosen speed
// (years per second; 0 pauses, Infinity runs as fast as the machine can) and
// the changes go to the page about ten times a second.

import { CivSim } from '../engine/civ/sim.js';
import { initPayload, delta, Tracker, history } from '../engine/civ/protocol.js';
import { apply } from '../engine/civ/commands.js';
import { saveWorld, loadWorld } from '../engine/civ/persist.js';

let sim = null;
let tr = null;
let speed = 1;
let due = 0;
let last = 0;
let lastPost = 0;
let timer = 0;
let stepMs = 1; // recent cost of a month, to keep the page responsive

function start(s) {
  sim = s;
  tr = new Tracker();
  const init = initPayload(sim);
  self.postMessage(init);
  post(true);
  last = performance.now();
  due = 0;
  if (!timer) loop();
}

function post(force = false) {
  const now = performance.now();
  const gap = speed > 20 ? 200 : 100;
  if (!force && now - lastPost < gap) return;
  lastPost = now;
  const { msg, transfer } = delta(sim, tr);
  msg.speed = speed;
  msg.stepMs = stepMs;
  self.postMessage(msg, transfer);
}

function loop() {
  timer = setTimeout(loop, 4);
  if (!sim) return;
  const now = performance.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (speed > 0) {
    due += speed === Infinity ? 1e9 : dt * speed * 12;
    const t0 = performance.now();
    let n = 0;
    while (due >= 1 && performance.now() - t0 < 14) {
      const a = performance.now();
      sim.step();
      stepMs = stepMs * 0.95 + (performance.now() - a) * 0.05;
      due--;
      n++;
    }
    // Never build up a backlog: a slow machine simply runs slower.
    if (due > 24) due = 24;
    if (speed === Infinity) due = 0;
    if (n) post();
  }
}

self.addEventListener('message', (e) => {
  const m = e.data;
  try {
    if (m.t === 'new') start(new CivSim(m.opts));
    else if (m.t === 'speed') {
      speed = m.v === 'max' ? Infinity : Number(m.v) || 0;
      post(true);
    } else if (m.t === 'step') {
      // One month at a time while paused.
      for (let k = 0; k < (m.n || 1); k++) sim.step();
      post(true);
    } else if (m.t === 'cmd') {
      const r = apply(sim, m.c);
      self.postMessage({ t: 'cmd', id: m.id, ok: true, r });
      post(true);
    } else if (m.t === 'history') {
      self.postMessage({ t: 'history', id: m.id, history: history(sim) });
    } else if (m.t === 'save') {
      self.postMessage({ t: 'saved', id: m.id, text: saveWorld(sim), year: sim.year });
    } else if (m.t === 'load') {
      start(loadWorld(m.text));
    }
  } catch (err) {
    self.postMessage({ t: m.t === 'cmd' ? 'cmd' : 'error', id: m.id, ok: false, error: err && err.message ? err.message : String(err) });
  }
});
