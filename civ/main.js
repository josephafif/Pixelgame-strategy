// Annals: boot, the simulation worker, the frame loop and map input.

import { Mirror } from './state.js';
import { View } from './render/view.js';
import { UI } from './ui/ui.js';
import { saveLocal, loadLocal, hasLocal } from './ui/store.js';

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);

const app = {
  worker: null,
  mirror: null,
  view: null,
  ui: null,
  pending: new Map(),
  seq: 1,
  raf: 0,
};
window.annals = app;

// ---------------------------------------------------------------------------
// Worker

function startWorker() {
  if (app.worker) app.worker.terminate();
  const w = new Worker(new URL('./sim-worker.js', import.meta.url), { type: 'module' });
  w.addEventListener('message', (e) => onMessage(e.data));
  w.addEventListener('error', (e) => {
    console.error('simulation failed', e.message || e);
    toast('The simulation stopped with an error.', true);
  });
  app.worker = w;
  return w;
}

function send(msg, transfer) {
  app.worker.postMessage(msg, transfer || []);
}

/** Send a command; resolves with its result or rejects with the reason. */
export function command(c) {
  const id = app.seq++;
  return new Promise((resolve, reject) => {
    app.pending.set(id, { resolve, reject });
    send({ t: 'cmd', id, c });
  });
}

function request(t, extra = {}) {
  const id = app.seq++;
  return new Promise((resolve, reject) => {
    app.pending.set(id, { resolve, reject });
    send({ t, id, ...extra });
  });
}

function onMessage(m) {
  if (m.t === 'init') {
    setupWorld(m);
    return;
  }
  if (m.t === 'delta') {
    if (!app.mirror) return;
    app.mirror.apply(m);
    return;
  }
  if (m.t === 'cmd' || m.t === 'history' || m.t === 'saved' || m.t === 'error') {
    const p = app.pending.get(m.id);
    if (p) {
      app.pending.delete(m.id);
      if (m.ok === false) p.reject(new Error(m.error));
      else p.resolve(m);
    } else if (m.t === 'error') toast(m.error, true);
  }
}

function setupWorld(init) {
  if (app.view) app.view.destroy();
  if (app.ui) app.ui.destroy();
  app.mirror = new Mirror(init);
  app.view = new View($('map'), app.mirror);
  app.ui = new UI(app);
  $('screen').hidden = true;
  $('loading').hidden = true;
  $('ui').hidden = false;
  if (!app.raf) app.raf = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Frame loop

let last = 0;
function loop(now) {
  app.raf = requestAnimationFrame(loop);
  if (!app.view) return;
  // Phones draw at 30 frames a second when nothing moves.
  const idle = now - app.view.lastInput > 1500 && !app.view.anim;
  const touch = window.matchMedia?.('(pointer: coarse)').matches;
  const target = touch && idle ? 1000 / 30 : 1000 / 60;
  if (now - last < target - 2) return;
  last = now;
  app.view.frame(now);
  app.ui.frame(now);
}

// ---------------------------------------------------------------------------
// Map input: drag to pan, wheel or pinch to zoom, tap to act.

function setupInput() {
  const cv = $('map');
  const ptrs = new Map();
  let drag = null;
  let pinch = null;
  let moved = 0;
  let downAt = 0;
  const pos = (e) => {
    const r = cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  cv.addEventListener('pointerdown', (e) => {
    if (!app.view) return;
    cv.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    ptrs.set(e.pointerId, { x, y });
    app.view.lastInput = performance.now();
    if (ptrs.size === 1) {
      drag = { x, y, sx: x, sy: y };
      moved = 0;
      downAt = performance.now();
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      drag = null;
    }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!app.view) return;
    const [x, y] = pos(e);
    const p = ptrs.get(e.pointerId);
    if (!p) {
      app.ui?.hover(x, y);
      return;
    }
    p.x = x;
    p.y = y;
    app.view.lastInput = performance.now();
    if (pinch && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      app.view.zoomAt(d / Math.max(1, pinch.d), cx, cy);
      app.view.pan(cx - pinch.cx, cy - pinch.cy);
      pinch = { d, cx, cy };
      moved = 99;
    } else if (drag) {
      const dx = x - drag.x;
      const dy = y - drag.y;
      moved = Math.max(moved, Math.hypot(x - drag.sx, y - drag.sy));
      if (moved > 6) {
        cv.classList.add('drag');
        app.view.pan(dx, dy);
      }
      drag.x = x;
      drag.y = y;
    }
  });
  const up = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const [x, y] = pos(e);
    ptrs.delete(e.pointerId);
    cv.classList.remove('drag');
    if (ptrs.size < 2) pinch = null;
    if (drag && moved <= 6 && ptrs.size === 0 && e.type === 'pointerup') {
      app.ui?.tap(x, y, { long: performance.now() - downAt > 550, button: e.button });
    }
    if (ptrs.size === 0) drag = null;
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('wheel', (e) => {
    if (!app.view) return;
    e.preventDefault();
    const [x, y] = pos(e);
    app.view.lastInput = performance.now();
    app.view.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), x, y);
  }, { passive: false });
  cv.addEventListener('dblclick', (e) => {
    if (!app.view) return;
    const [x, y] = pos(e);
    app.view.zoomAt(2, x, y);
  });
  window.addEventListener('resize', () => app.view?.resize());
  window.addEventListener('keydown', (e) => {
    if (!app.view || e.target.closest?.('input, select, textarea')) return;
    app.view.lastInput = performance.now();
    const k = e.key;
    if (k === ' ') {
      e.preventDefault();
      app.ui.togglePause();
    } else if (k === '+' || k === '=') app.view.zoomAt(1.25);
    else if (k === '-') app.view.zoomAt(0.8);
    else if (k === 'ArrowLeft' || k === 'a') app.view.pan(60, 0);
    else if (k === 'ArrowRight' || k === 'd') app.view.pan(-60, 0);
    else if (k === 'ArrowUp' || k === 'w') app.view.pan(0, 60);
    else if (k === 'ArrowDown' || k === 's') app.view.pan(0, -60);
    else if (k >= '1' && k <= '5') app.ui.setSpeed(['0', '1', '5', '25', 'max'][Number(k) - 1]);
    else if (k === 'Escape') app.ui.escape();
    else if (k === 'r') app.ui.toggleDrawer('realms');
    else if (k === 'c') app.ui.toggleDrawer('chronicle');
  });
}

// ---------------------------------------------------------------------------
// Title screen

function setupScreen() {
  const seed = $('f-seed');
  seed.value = q.get('seed') || String(1 + Math.floor(Math.random() * 99999));
  $('f-dice').addEventListener('click', () => {
    seed.value = String(1 + Math.floor(Math.random() * 99999));
  });
  const peoples = $('f-peoples');
  peoples.addEventListener('input', () => {
    $('f-peoples-v').textContent = peoples.value;
  });
  if (q.get('size')) $('f-size').value = q.get('size');
  if (q.get('peoples')) {
    peoples.value = q.get('peoples');
    $('f-peoples-v').textContent = peoples.value;
  }
  $('btn-begin').addEventListener('click', () => begin());
  hasLocal().then((has) => {
    $('btn-continue').hidden = !has;
  });
  $('btn-continue').addEventListener('click', async () => {
    const text = await loadLocal();
    if (text) loadText(text);
  });
  $('btn-loadfile').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', async () => {
    const f = $('file').files[0];
    if (!f) return;
    loadText(await f.text());
    $('file').value = '';
  });
  // Installing as an app.
  let prompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    prompt = e;
    $('btn-install').hidden = false;
  });
  $('btn-install').addEventListener('click', async () => {
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice;
    prompt = null;
    $('btn-install').hidden = true;
  });
}

function begin(opts = null) {
  const o = opts || {
    seed: Number($('f-seed').value) || 1,
    size: $('f-size').value,
    peoples: Number($('f-peoples').value),
    landFraction: Number($('f-land').value),
  };
  $('loading').hidden = false;
  const w = startWorker();
  w.postMessage({ t: 'new', opts: o });
  w.postMessage({ t: 'speed', v: q.get('speed') || 1 });
}

function loadText(text) {
  $('loading').hidden = false;
  const w = startWorker();
  w.postMessage({ t: 'load', text });
  w.postMessage({ t: 'speed', v: 0 });
}

export async function saveNow(download = false) {
  const r = await request('save');
  await saveLocal(r.text);
  if (download) {
    const blob = new Blob([r.text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `annals-${r.year < 0 ? `${-r.year}bce` : `${r.year}ce`}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  return r;
}

export function toast(text, err = false) {
  const el = document.createElement('div');
  el.className = `toast${err ? ' err' : ''}`;
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3700);
}

Object.assign(app, { command, request, send, saveNow, toast, begin, loadText });

setupInput();
setupScreen();
if (q.get('auto')) begin();

// The installable app's offline copy.
const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && secure && (!navigator.webdriver || q.get('sw'))) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
