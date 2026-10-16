// Realmwright client entry: title menu, single-player setup, multiplayer
// lobby, loading, and the frame loop.

import { WorkerTransport, SocketTransport } from './net/transport.js';
import { ClientWorld } from './game/client-world.js';
import { Renderer } from './render/renderer.js';
import { GameUI } from './ui/game-ui.js';

const $ = (id) => document.getElementById(id);
const modalBack = $('modal-back');
const modal = $('modal');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(`realmwright:${k}`);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`realmwright:${k}`, JSON.stringify(v));
    } catch {
      // storage unavailable: fine
    }
  },
};

let session = null; // { transport, cw, renderer, ui, raf }

// Saved single-player realm: the full save under one key, a short summary
// under another so the menu can describe it without parsing the save.
const SAVE_KEY = 'realmwright:save:single';
const SAVE_INFO_KEY = 'realmwright:save:single:info';
const AUTOSAVE_EVERY = 3 * 60 * 1000;

function savedInfo() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_INFO_KEY) || 'null');
  } catch {
    return null;
  }
}

function readSave() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  } catch {
    return null;
  }
}

/** Store a save in the browser; returns false when storage is full or blocked. */
function writeSave(data, info) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    localStorage.setItem(SAVE_INFO_KEY, JSON.stringify({ ...info, at: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

function describeInfo(i) {
  if (!i) return '';
  return `${esc(i.name)} · ${i.minutes} min · ${i.alive === false ? 'fallen' : `${i.share ?? 0}% of the land`} · ${esc(i.size)} map`;
}

async function saveSession(quiet = false) {
  if (!session?.single || !session.cw) return false;
  try {
    const { data, info } = await session.transport.save();
    const ok = writeSave(data, info);
    if (!quiet) session.ui?.toast(ok ? 'Realm saved in this browser.' : 'The browser refused to store the save; download it instead.', ok ? 'info' : 'error');
    return ok;
  } catch (e) {
    if (!quiet) session.ui?.toast(`Saving failed: ${e.message}`, 'error');
    return false;
  }
}

async function downloadSave() {
  if (!session?.single) return;
  const { data, info } = await session.transport.save();
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `realmwright-${String(info.name).replace(/[^\w-]+/g, '_')}-${info.minutes}min.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

function loadFromFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data?.format !== 'realmwright-save') throw new Error('not a Realmwright save');
      startLoaded(data);
    } catch (e) {
      titleMenu(`That file could not be loaded: ${e.message}.`);
    }
  });
  input.click();
}

function startLoaded(data) {
  endSession();
  loading('Restoring the realm…');
  runGame(new WorkerTransport({ load: data }), true);
}

function showModal(html) {
  modal.innerHTML = html;
  modalBack.hidden = false;
}

function hideModal() {
  modalBack.hidden = true;
}

function titleMenu(err = '') {
  const info = savedInfo();
  const live = session?.single && session.cw;
  showModal(`<h1>Realmwright</h1>
    <div class="tagline">A race for land. Push your borders, raise towns that grow on their own,<br>ally, betray and sail. First to 80% of the map wins.</div>
    ${err ? `<p class="bad" style="text-align:center">${esc(err)}</p>` : ''}
    <div class="menu">
      ${session ? '<button class="btn go" data-go="resume">Return to the realm</button>' : ''}
      ${live ? '<button class="btn" data-go="save">Save the realm</button><button class="btn" data-go="download">Download save file</button>' : ''}
      ${info && !live ? `<button class="btn go" data-go="continue">Continue saved realm<br><span class="small">${describeInfo(info)}</span></button>` : ''}
      <button class="btn primary" data-go="single">New realm (vs. AI)</button>
      <button class="btn" data-go="multi">Multiplayer</button>
      <button class="btn" data-go="load-file">Load save file…</button>
      <button class="btn" data-go="help">How to play</button>
    </div>
    <p class="small muted" style="text-align:center;margin-top:18px">A real-time strategy game · pixel art in the spirit of Pixelgame</p>`);
}

const DEFAULT_AIS = { small: 6, medium: 10, large: 16 };

function singleSetup() {
  const o = store.get('single2', { name: 'House Ardent', size: 'medium', ais: 10, timeLimit: 20 });
  const aiOptions = (n) => [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24].map((k) => `<option ${k === n ? 'selected' : ''}>${k}</option>`).join('');
  showModal(`<h2>A new realm</h2>
    <label>Your realm <input id="f-name" value="${esc(o.name)}" maxlength="20"></label>
    <label>World seed <input id="f-seed" type="number" value="${Math.floor(Math.random() * 99999) + 1}"></label>
    <label>Map size <select id="f-size">${['small', 'medium', 'large'].map((s) => `<option ${s === o.size ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    <label>AI rivals <select id="f-ais">${aiOptions(o.ais)}</select></label>
    <label>Time limit (min) <input id="f-time" type="number" value="${o.timeLimit}" min="5" max="60"></label>
    <p class="small muted">Rivals are builders, merchants and warlords and follow the same rules as you. A match takes 10 to 20 minutes; when time runs out, the realm with the most land wins.</p>
    <div class="footer"><button class="btn" data-go="title">Back</button><button class="btn primary" data-go="start-single">Begin</button></div>`);
  // A bigger map suggests more rivals, until the player picks a number.
  const size = document.getElementById('f-size');
  const ais = document.getElementById('f-ais');
  size.addEventListener('change', () => {
    if (!ais.dataset.touched) ais.innerHTML = aiOptions(DEFAULT_AIS[size.value]);
  });
  ais.addEventListener('change', () => {
    ais.dataset.touched = '1';
  });
}

function helpScreen() {
  showModal(`<h2>How to play</h2><div class="help small">
    <p><b>Pick where to start.</b> Tap open land. You begin with a patch of land and a hamlet.</p>
    <p><b>Your people grow with your land.</b> The more land and the bigger your towns, the more people you can have. The <b>Troops</b> slider sets how many of them are under arms; the rest work and earn gold.</p>
    <p><b>Tap land to attack it.</b> Unclaimed land is cheap; a rival's land costs more, and more again in hills, forests and mountains or near an outpost. The <b>Attack</b> slider sets the share of your troops each attack sends. Your border pushes outward until the troops are spent; what is left comes home. ✕ calls an attack off.</p>
    <p><b>Across the water,</b> a tap on a far shore sends a boat (up to three at a time). The troops land and attack from the beach.</p>
    <p><b>Build</b> with gold: <b>towns</b> (more people and gold; they grow by themselves into pixel-art cities, and you can raise them to village, town and city), <b>ports</b> (trade ships sail to other players' ports and both sides earn gold) and <b>outposts</b> (land around them is much harder to take).</p>
    <p><b>Alliances.</b> Long-press (or right-click) a realm to ask for an alliance. Allies cannot attack each other and trade for more. An alliance lasts five minutes and can be renewed; whoever breaks one is a traitor for a minute and easier to attack.</p>
    <p><b>Win</b> by holding 80% of all land, by being the last realm standing, or by holding the most land when time runs out.</p>
    <p><b>Controls:</b> drag to pan, wheel or pinch to zoom, click or tap to attack, right-click or long-press for more. Keys: H home, B/P/O build town/port/outpost, Q/E attack share, +/- zoom, Space pause, 1/2/3 speed, Esc menu.</p>
    </div><div class="footer"><span></span><button class="btn" data-go="title">Back</button></div>`);
}

// A static copy of the client (e.g. on Netlify) has no game server of its own.
const STATIC_HOSTING = document.querySelector('meta[name="realmwright-hosting"]')?.content === 'static';

function multiSetup(err = '') {
  const o = store.get('multi', { name: 'House Ardent', server: '' });
  const def = STATIC_HOSTING ? '' : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  showModal(`<h2>Multiplayer</h2>
    ${err ? `<p class="bad">${esc(err)}</p>` : ''}
    ${STATIC_HOSTING ? '<p class="small">This copy of the game is hosted without a game server, so single player works here but multiplayer needs a server: run <code>npm start</code> somewhere reachable and enter its address (<code>wss://…/ws</code> from an https page).</p>' : ''}
    <label>Your realm <input id="f-name" value="${esc(o.name)}" maxlength="20"></label>
    <label>Server <input id="f-server" value="${esc(o.server || def)}" placeholder="wss://your-server/ws"></label>
    <label>Room code <input id="f-code" placeholder="e.g. K7Q2M" maxlength="5" style="text-transform:uppercase"></label>
    <p class="small muted">Run your own server with <code>npm start</code> and share its address. The server runs the authoritative simulation.</p>
    <div class="footer"><button class="btn" data-go="title">Back</button><span><button class="btn" data-go="join">Join room</button> <button class="btn primary" data-go="create">Create room</button></span></div>`);
}

function lobbyScreen(room, me, isHost) {
  const players = room.players.map((p) => `<tr><td>${esc(p.name)}${p.host ? ' <span class="tag">host</span>' : ''}</td><td>${p.online ? '<span class="good">online</span>' : '<span class="muted">away</span>'}</td></tr>`).join('');
  const o = room.opts;
  showModal(`<h2>Room ${esc(room.code)}</h2>
    <p class="small muted">Share the code <b>${esc(room.code)}</b> with your friends.</p>
    <table class="t"><tr><th>Player</th><th></th></tr>${players}</table>
    <h3 class="small">Settings</h3>
    <label>World seed <input id="o-seed" type="number" value="${o.seed}" ${isHost ? '' : 'disabled'}></label>
    <label>Map size <select id="o-size" ${isHost ? '' : 'disabled'}>${['small', 'medium', 'large'].map((s) => `<option ${s === o.size ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    <label>AI rivals <input id="o-ais" type="number" min="0" max="24" value="${o.ais}" ${isHost ? '' : 'disabled'}></label>
    <label>Time to choose a start (s) <input id="o-place" type="number" min="10" max="120" value="${o.placementTime}" ${isHost ? '' : 'disabled'}></label>
    <label>Time limit (min) <input id="o-time" type="number" min="5" max="60" value="${o.timeLimit}" ${isHost ? '' : 'disabled'}></label>
    <div class="footer"><button class="btn" data-go="leave">Leave</button>${isHost ? '<span><button class="btn" data-go="save-opts">Save settings</button> <button class="btn primary" data-go="start-room">Start match</button></span>' : '<span class="muted">Waiting for the host…</span>'}</div>`);
}

function loading(text) {
  showModal(`<div class="loading"><h2>${esc(text)}</h2><div class="bar warm"><i style="width:60%"></i></div></div>`);
}

// ---------------------------------------------------------------------------

function endSession() {
  if (!session) return;
  cancelAnimationFrame(session.raf);
  clearInterval(session.autosave);
  session.ui?.destroy();
  session.renderer?.destroy();
  session.transport.close();
  for (const id of ['hud', 'popup', 'minimap-wrap', 'hint', 'placement', 'tooltip']) $(id).hidden = true;
  $('toasts').innerHTML = '';
  session = null;
}

/** Attach a transport to a fresh client world once its init arrives. */
function runGame(transport, single) {
  const pending = [];
  let cw = null;
  let started = false;
  const s = { transport, single, cw: null, renderer: null, ui: null, raf: 0 };
  transport.onMessage((msg) => {
    if (msg.t === 'init') {
      loading('Surveying the realm…');
      // Let the loading screen paint before generating the world.
      setTimeout(() => {
        cw = new ClientWorld(msg);
        s.cw = cw;
        for (const m of pending) cw.apply(m);
        pending.length = 0;
        start();
      }, 30);
      return;
    }
    if (msg.t === 'error' && !started) {
      if (single) titleMenu(msg.text);
      else multiSetup(msg.text);
      return;
    }
    if (msg.t === 'disconnected') {
      if (session === s) s.ui?.toast('Disconnected from the server.', 'error');
      return;
    }
    if (msg.t === 'error') {
      s.ui?.toast(msg.text, 'error');
      return;
    }
    if (!cw) pending.push(msg);
    else cw.apply(msg);
  });
  const start = () => {
    started = true;
    hideModal();
    const canvas = $('view');
    s.renderer = new Renderer(canvas, cw);
    s.ui = new GameUI({
      cw,
      renderer: s.renderer,
      transport,
      single,
      onQuit: (why, html) => {
        if (why === 'end') {
          showModal(`${html}<div class="footer"><button class="btn" data-go="resume">Keep watching</button><button class="btn primary" data-go="quit">Main menu</button></div>`);
        } else {
          if (single) transport.setSpeed(0);
          titleMenu();
        }
      },
    });
    s.ui.start();
    if (cw.snap) s.ui.onSnap(cw.snap);
    let last = performance.now();
    let miniAt = 0;
    // Single-player realms save themselves now and then.
    if (single) {
      s.autosave = setInterval(() => {
        if (session === s && cw.snap?.phase === 'running') saveSession(true);
      }, AUTOSAVE_EVERY);
    }
    const loop = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      s.ui.update(dt);
      s.renderer.frame(now);
      if (now - miniAt > 400 && !$('minimap-wrap').hidden) {
        miniAt = now;
        s.renderer.drawMinimap($('minimap'));
      }
      s.raf = requestAnimationFrame(loop);
    };
    s.raf = requestAnimationFrame(loop);
    window.__realm = s; // debugging and automated visual checks
  };
  session = s;
  return s;
}

function startSingle() {
  const o = {
    name: $('f-name').value || 'House Ardent',
    seed: Number($('f-seed').value) || 1,
    size: $('f-size').value,
    ais: Number($('f-ais').value),
    timeLimit: Number($('f-time').value) || 20,
  };
  store.set('single2', { name: o.name, size: o.size, ais: o.ais, timeLimit: o.timeLimit });
  endSession();
  loading('Raising the realm…');
  runGame(new WorkerTransport(o), true);
}

let mp = null; // multiplayer lobby state

function connectMulti(action) {
  const name = $('f-name').value || 'House Ardent';
  const server = $('f-server').value;
  const code = ($('f-code').value || '').toUpperCase().trim();
  store.set('multi', { name, server });
  if (!server) return multiSetup('Enter the address of a game server.');
  if (action === 'join' && !code) return multiSetup('Enter a room code.');
  endSession();
  loading('Connecting…');
  let t;
  try {
    t = new SocketTransport(server);
  } catch (e) {
    return multiSetup(e.message);
  }
  mp = { transport: t, name, code: null, isHost: false, myId: null };
  t.ready.catch((e) => multiSetup(e.message));
  t.onMessage((msg) => {
    if (msg.t === 'welcome') mp.myId = msg.id;
    if (msg.t === 'joined') {
      mp.code = msg.code;
      store.set(`token:${msg.code}`, msg.token);
    }
    if (msg.t === 'lobby') {
      mp.isHost = msg.room.players.some((p) => p.host && p.name === name);
      lobbyScreen(msg.room, name, mp.isHost);
    }
  });
  t.send({ t: 'hello', name });
  const token = code ? store.get(`token:${code}`, null) : null;
  if (action === 'create') t.send({ t: 'create', name, opts: {} });
  else t.send({ t: 'join', code, name, token });
  runGame(t, false);
}

modal.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (!b) return;
  const go = b.dataset.go;
  if (go === 'title') titleMenu();
  else if (go === 'single') singleSetup();
  else if (go === 'multi') multiSetup();
  else if (go === 'help') helpScreen();
  else if (go === 'start-single') startSingle();
  else if (go === 'save') saveSession().then(() => titleMenu());
  else if (go === 'download') downloadSave();
  else if (go === 'load-file') loadFromFile();
  else if (go === 'continue') {
    const data = readSave();
    if (data) startLoaded(data);
    else titleMenu('The saved realm could not be read.');
  }
  else if (go === 'create' || go === 'join') connectMulti(go);
  else if (go === 'resume') {
    hideModal();
    if (session?.single) session.transport.setSpeed(session.ui?.speed || 1);
  } else if (go === 'quit') {
    endSession();
    titleMenu();
  } else if (go === 'leave') {
    mp?.transport.send({ t: 'leave' });
    endSession();
    multiSetup();
  } else if (go === 'save-opts' || go === 'start-room') {
    const opts = { seed: Number($('o-seed').value), size: $('o-size').value, ais: Number($('o-ais').value), placementTime: Number($('o-place').value), timeLimit: Number($('o-time').value) };
    mp.transport.send({ t: 'opts', opts });
    if (go === 'start-room') setTimeout(() => mp.transport.send({ t: 'start' }), 100);
  }
});

// Automated checks can start a game directly: ?autostart=1&seed=..&size=..&ais=..
const q = new URLSearchParams(location.search);
if (q.get('autostart')) {
  loading('Raising the realm…');
  runGame(new WorkerTransport({ name: 'Tester', seed: Number(q.get('seed') || 7), size: q.get('size') || 'small', ais: Number(q.get('ais') || 4), timeLimit: 20 }), true);
} else {
  titleMenu();
}
