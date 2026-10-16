// Single-player host: runs the authoritative Match in a worker thread and
// speaks the same protocol as the multiplayer server.

import { Match } from '../../engine/sim/match.js';
import { TICK } from '../../engine/sim/defs.js';
import { PlayerView, initMessage } from '../../engine/net/protocol.js';
import { saveMatch, loadMatch, describeSave } from '../../engine/sim/persist.js';

let match = null;
let view = null;
let timer = null;
let speed = 1;
let ticks = 0;

function post(msgs) {
  for (const m of msgs) self.postMessage(m);
}

function schedule() {
  if (timer) clearInterval(timer);
  timer = null;
  if (!match || speed <= 0) return;
  timer = setInterval(() => {
    try {
      match.step();
      ticks++;
      if (ticks % 2 === 0) post(view.messages());
    } catch (e) {
      self.postMessage({ t: 'error', text: `Simulation error: ${e.message}` });
      console.error(e);
      clearInterval(timer);
    }
  }, (TICK * 1000) / speed);
}

self.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.t === 'start') {
    const o = msg.opts || {};
    if (o.load) {
      // A saved realm: the player is always kingdom 0 in single player.
      try {
        match = loadMatch(o.load);
      } catch (err) {
        self.postMessage({ t: 'error', fatal: true, text: `Could not load the save: ${err.message}` });
        return;
      }
    } else {
      const players = [{ name: o.name || 'You' }];
      const ais = o.ais ?? 3;
      const pers = o.personalities || [];
      for (let i = 0; i < ais; i++) players.push({ ai: true, personality: pers[i] || ['builder', 'merchant', 'warlord'][i % 3] });
      match = new Match({ seed: o.seed ?? 1, size: o.size || 'medium', players, placementTime: 0, timeLimit: (o.timeLimit ?? 45) * 60 });
    }
    view = new PlayerView(match, 0);
    self.postMessage(initMessage(match, 0));
    post(view.messages(true));
    speed = 1;
    schedule();
  } else if (msg.t === 'cmd' && match) {
    match.command(0, msg.cmd);
    // Feedback quickly even when paused.
    if (speed <= 0) {
      const q = match.queue;
      match.queue = [];
      for (const { kid, cmd } of q) match.exec(kid, cmd);
      post(view.messages());
    }
  } else if (msg.t === 'save' && match) {
    try {
      const data = saveMatch(match);
      self.postMessage({ t: 'saved', id: msg.id, data, info: describeSave(data) });
    } catch (err) {
      self.postMessage({ t: 'saved', id: msg.id, error: err.message });
    }
  } else if (msg.t === 'speed') {
    speed = Math.max(0, Math.min(8, Number(msg.v) || 0));
    schedule();
    if (match) post(view.messages());
  }
});
