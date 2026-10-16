// The in-game interface, kept small so the map stays in view: a stats chip
// and a few buttons at the top, two sliders and three build buttons at the
// bottom, short notices for alliance requests and attacks. Tapping land
// attacks it (by boat when it lies across the water); a long press or a
// right click opens a small menu for that spot. Every action is sent as a
// command; the simulation validates it.

import { STRUCTURES, MAX_TOWN_LEVEL, TOWN_LEVELS, RULES } from '../../engine/sim/defs.js';
import { canFoundAt } from '../../engine/world/sites.js';
import { icon } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fmt = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.floor(v)}`);
const pct = (v) => (v >= 0.1 ? `${Math.round(v * 100)}%` : `${(v * 100).toFixed(1)}%`);
const BUILD_ICON = { town: 'house', port: 'anchor', outpost: 'tower' };
const TOAST_KINDS = new Set(['error', 'captured', 'lost', 'alliance', 'betrayal', 'fall', 'victory', 'declined', 'expired', 'landing', 'repelled', 'built', 'grew']);
const PUBLIC_TOAST = new Set(['betrayal', 'fall', 'victory', 'alliance']);
const COMPACT_QUERY = '(max-width: 720px), (max-height: 500px)';

function clock(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function setText(el, v) {
  if (el && el.textContent !== v) el.textContent = v;
}

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

export class GameUI {
  constructor({ cw, renderer, transport, single, onQuit }) {
    this.cw = cw;
    this.r = renderer;
    this.tx = transport;
    this.single = single;
    this.onQuit = onQuit;
    this.speed = 1;
    this.mode = null; // 'town' | 'port' | 'outpost' while placing a building
    this.ratio = store.get('ratio', RULES.attackRatio);
    this.keys = new Set();
    this.listeners = [];
    this.vel = null;
    this.spawnPick = null;
    this.boardOpen = false;
    this.ended = false;
    this.fallenShown = false;
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'),
      stats: $('stats'),
      land: $('st-land'),
      pop: $('st-pop'),
      troops: $('st-troops'),
      gold: $('st-gold'),
      time: $('time'),
      speed: $('btn-speed'),
      board: $('board'),
      boardBtn: $('btn-board'),
      notices: $('notices'),
      attacks: $('attacks'),
      bar: $('bar'),
      ratio: $('r-ratio'),
      ratioV: $('v-ratio'),
      share: $('r-share'),
      shareV: $('v-share'),
      build: $('build'),
      hint: $('hint'),
      popup: $('popup'),
      placement: $('placement'),
      toasts: $('toasts'),
      tip: $('tooltip'),
      mini: $('minimap-wrap'),
    };
  }

  start() {
    const el = this.el;
    el.hud.hidden = false;
    this.mq = window.matchMedia(COMPACT_QUERY);
    const relayout = () => {
      this.compact = this.mq.matches;
      el.mini.hidden = this.compact;
      this.r.resize();
    };
    relayout();
    this.mq.addEventListener('change', relayout);
    this.listeners.push([this.mq, ['change', relayout]]);
    el.speed.hidden = !this.single;
    for (const [id, name] of [['i-land', 'flag'], ['i-pop', 'pop'], ['i-troops', 'soldier'], ['i-gold', 'coin']]) document.getElementById(id).src = icon(name);
    el.ratio.value = Math.round(this.ratio * 100);
    el.build.innerHTML = Object.entries(STRUCTURES)
      .map(([k, d]) => `<button class="bb" data-build="${k}" title="${esc(d.name)}: ${esc(d.about)}"><img src="${icon(BUILD_ICON[k])}" alt=""><span class="bn">${esc(d.name)}</span><span class="bc" data-cost="${k}"></span></button>`)
      .join('');
    this.cw.on((kind, data) => {
      if (kind === 'snap') this.onSnap(data);
      else if (kind === 'events') this.onEvents(data);
    });
    this.bindInput();
    this.bindHud();
    // Start over your own land, or over the whole map while choosing.
    const me = this.cw.me;
    if (me && me.spawned) this.home();
    else this.r.centerOn(this.cw.W / 2, this.cw.H / 2, Math.sqrt((this.r.vw * this.r.vh) / (this.cw.W * this.cw.H)) * 0.9);
    this.renderPlacement();
  }

  destroy() {
    for (const [target, [ev, fn], opts] of this.listeners) target.removeEventListener(ev, fn, opts);
    this.listeners = [];
    this.el.hud.hidden = true;
    this.el.placement.hidden = true;
    this.el.mini.hidden = true;
    this.el.popup.hidden = true;
    this.el.hint.hidden = true;
    this.el.tip.hidden = true;
  }

  on(target, ev, fn, opts) {
    target.addEventListener(ev, fn, opts);
    this.listeners.push([target, [ev, fn], opts]);
  }

  send(cmd) {
    this.tx.command(cmd);
  }

  home() {
    const cap = this.cw.snap?.structures.find((s) => s.owner === this.cw.you && s.capital) || this.cw.snap?.structures.find((s) => s.owner === this.cw.you);
    const spot = this.cw.snap?.labels[this.cw.you];
    const at = cap ? [cap.x, cap.y] : spot ? [spot[0], spot[1]] : null;
    if (at) this.r.flyTo(at[0], at[1], Math.max(this.r.cam.ppt, 4));
  }

  // Snapshots ----------------------------------------------------------------

  onSnap(snap) {
    const el = this.el;
    const me = this.cw.me;
    setText(el.time, snap.phase === 'placement' ? 'Start' : clock(snap.time));
    if (me && me.spawned) {
      el.stats.hidden = false;
      setText(el.land, pct(this.cw.share(this.cw.you)));
      setText(el.pop, `${fmt(me.pop)}`);
      el.pop.parentElement.style.setProperty('--fill', `${Math.min(100, (me.pop / Math.max(1, me.maxPop)) * 100).toFixed(0)}%`);
      setText(el.troops, fmt(me.troops));
      setText(el.gold, fmt(me.gold));
      if (me.troopShare !== undefined && document.activeElement !== el.share && !this.shareDrag) {
        const v = String(Math.round(me.troopShare * 100));
        if (el.share.value !== v) el.share.value = v;
      }
      this.updateSliders();
      for (const b of el.build.querySelectorAll('[data-cost]')) {
        const c = me.costs?.[b.dataset.cost] ?? 0;
        setText(b, fmt(c));
        b.parentElement.classList.toggle('poor', (me.gold ?? 0) < c);
      }
    } else el.stats.hidden = this.cw.you < 0 || snap.phase === 'placement';
    el.bar.hidden = !(me && me.alive && snap.phase === 'running');
    this.renderPlacement();
    this.renderNotices(snap);
    this.renderAttacks(snap);
    if (this.boardOpen && (!this.boardAt || performance.now() - this.boardAt > 900)) this.renderBoard();
    if (this.popupAt) this.refreshPopup();
    if (snap.phase === 'over' && snap.winner && !this.ended) {
      this.ended = true;
      this.showEnd(snap);
    } else if (me && me.spawned && !me.alive && !this.fallenShown && snap.phase === 'running') {
      this.fallenShown = true;
      this.onQuit('end', `<h2>Your realm has fallen</h2><p>${esc(me.name)} held ${pct(me.tiles / Math.max(1, this.cw.init.landTotal))} of the land at the end. The race goes on without you.</p>${this.standingsHtml(snap)}`);
    }
  }

  updateSliders() {
    const el = this.el;
    const me = this.cw.me;
    const share = Number(el.share.value) / 100;
    setText(el.shareV, `${Math.round(share * 100)}%`);
    const send = me ? me.troops * this.ratio : 0;
    setText(el.ratioV, `${Math.round(this.ratio * 100)}% · ${fmt(send)}`);
  }

  onEvents(evs) {
    for (const e of evs) {
      if (!TOAST_KINDS.has(e.kind)) continue;
      // Other realms' news only when it is big.
      const mine = !PUBLIC_TOAST.has(e.kind) || e.text.includes(this.cw.me?.name || '\u0000');
      if (!mine && e.kind === 'alliance') continue;
      this.toast(e.text, e.kind);
    }
  }

  toast(text, kind = 'info') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.el.toasts.appendChild(t);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstChild.remove();
    setTimeout(() => t.classList.add('out'), kind === 'error' ? 2600 : 3400);
    setTimeout(() => t.remove(), kind === 'error' ? 3000 : 3800);
  }

  /** Alliance requests and incoming attacks, as small chips under the top bar. */
  renderNotices(snap) {
    const you = this.cw.you;
    const rows = [];
    for (const r of snap.requests) {
      if (r.to !== you) continue;
      const p = this.cw.player(r.from);
      rows.push(`<div class="notice ally"><span class="dot" style="background:${p.color}"></span><span class="nt">${esc(p.name)} ${r.renew ? 'renews' : 'offers'} an alliance</span><button data-answer="${r.id}" data-yes="1" class="yes" title="Accept">✓</button><button data-answer="${r.id}" class="no" title="Decline">✕</button></div>`);
    }
    const incoming = snap.attacks.filter((a) => a.to === you).sort((a, b) => b.troops - a.troops).slice(0, 2);
    for (const a of incoming) {
      const p = this.cw.player(a.from);
      rows.push(`<div class="notice war"><span class="dot" style="background:${p.color}"></span><span class="nt">${esc(p.name)} attacks · ${fmt(a.troops)}</span></div>`);
    }
    const me = this.cw.me;
    if (me?.traitor) rows.push(`<div class="notice war"><span class="nt">Traitor: your land is easier to take for ${Math.ceil(me.traitor)} s</span></div>`);
    const html = rows.join('');
    if (html !== this.noticesHtml) {
      this.noticesHtml = html;
      this.el.notices.innerHTML = html;
    }
  }

  /** Your attacks under way, each with a button to call it off. */
  renderAttacks(snap) {
    const you = this.cw.you;
    const mine = snap.attacks.filter((a) => a.from === you).sort((a, b) => b.troops - a.troops).slice(0, 3);
    const boats = snap.boats.filter((b) => b.owner === you && b.kind === 'transport');
    const rows = mine.map((a) => {
      const p = this.cw.player(a.to);
      return `<div class="atk"><span class="dot" style="background:${p ? p.color : '#9a9a8a'}"></span>${a.landing ? '⚓ ' : ''}${esc(p ? p.name : 'Wilds')} <b>${fmt(a.troops)}</b><button data-retreat="${a.id}" title="Call off (troops come home)">✕</button></div>`;
    });
    if (boats.length) rows.push(`<div class="atk">⛵ ${boats.length} at sea · <b>${fmt(boats.reduce((t, b) => t + (b.troops || 0), 0))}</b></div>`);
    const html = rows.join('');
    if (html !== this.attacksHtml) {
      this.attacksHtml = html;
      this.el.attacks.innerHTML = html;
    }
  }

  standingsHtml(snap) {
    const rows = [...snap.players]
      .filter((p) => p.spawned)
      .sort((a, b) => b.tiles - a.tiles)
      .slice(0, 12)
      .map((p, k) => `<tr class="${p.id === this.cw.you ? 'me' : ''}"><td>${k + 1}</td><td><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</td><td>${pct(p.tiles / Math.max(1, this.cw.init.landTotal))}</td><td>${fmt(p.troops)}</td></tr>`)
      .join('');
    return `<table class="t"><tr><th>#</th><th>Realm</th><th>Land</th><th>Troops</th></tr>${rows}</table>`;
  }

  renderBoard() {
    const snap = this.cw.snap;
    if (!snap) return;
    this.boardAt = performance.now();
    const you = this.cw.you;
    const list = [...snap.players].filter((p) => p.spawned).sort((a, b) => b.tiles - a.tiles);
    const top = list.slice(0, this.compact ? 6 : 10);
    const meIdx = list.findIndex((p) => p.id === you);
    if (meIdx >= top.length) top.push(list[meIdx]);
    const html = top
      .map((p) => {
        const rank = list.indexOf(p) + 1;
        const ally = this.cw.allied(you, p.id) ? ' <span class="tag good">ally</span>' : '';
        return `<button class="lb${p.id === you ? ' me' : ''}${p.alive ? '' : ' dead'}" data-player="${p.id}"><span class="rk">${rank}</span><span class="dot" style="background:${p.color}"></span><span class="nm">${esc(p.name)}${ally}</span><span class="pc">${pct(p.tiles / Math.max(1, this.cw.init.landTotal))}</span></button>`;
      })
      .join('');
    const goal = `<div class="goal">First to ${Math.round(this.cw.init.winShare * 100)}% of the land wins</div>`;
    if (html + goal !== this.boardHtml) {
      this.boardHtml = html + goal;
      this.el.board.innerHTML = this.boardHtml;
    }
  }

  // Placement ------------------------------------------------------------------

  renderPlacement() {
    const snap = this.cw.snap;
    const el = this.el.placement;
    const me = this.cw.me;
    const choosing = snap && snap.phase === 'placement' && me && !me.spawned;
    if (!choosing) {
      if (!el.hidden) {
        el.hidden = true;
        this.r.preview = null;
        this.r.sites = null;
        if (snap?.phase === 'running' && me?.spawned && !this.homed) {
          this.homed = true;
          this.home();
        }
      }
      return;
    }
    this.r.sites = this.cw.init.startSites;
    const left = this.cw.init.opts.placementTime > 0 ? ` · ${Math.max(0, Math.ceil(snap.placementLeft))} s` : '';
    const pick = this.spawnPick;
    const html = pick
      ? `<span class="pt">${pick.err ? esc(pick.err) : 'Start here?'}${left}</span><span class="pb">${pick.err ? '' : '<button class="btn go" data-spawn="go">Start</button>'}<button class="btn" data-spawn="cancel">✕</button></span>`
      : `<span class="pt">Tap open land to choose where your realm begins${left}</span>`;
    if (html !== this.placeHtml) {
      this.placeHtml = html;
      el.innerHTML = html;
    }
    el.hidden = false;
  }

  spawnError(x, y) {
    if (!canFoundAt(this.cw.world, x, y)) return 'Pick open land to start on.';
    if (this.cw.ownerAt(x, y) >= 0) return 'Someone already holds that land.';
    for (const p of this.cw.snap.players) {
      if (!p.spawned) continue;
      const spot = this.cw.snap.labels[p.id];
      if (spot && Math.hypot(spot[0] - x, spot[1] - y) < RULES.spawnSpacing) return 'Too close to another realm.';
    }
    return null;
  }

  // Map actions ------------------------------------------------------------------

  setMode(mode) {
    this.mode = mode === this.mode ? null : mode;
    for (const b of this.el.build.querySelectorAll('[data-build]')) b.classList.toggle('on', b.dataset.build === this.mode);
    this.r.preview = null;
    this.r.canvas.classList.toggle('targeting', !!this.mode);
    if (this.mode) {
      const d = STRUCTURES[this.mode];
      this.el.hint.innerHTML = `<span>${this.mode === 'port' ? 'Tap your coast' : 'Tap your land'} to place a ${esc(d.name.toLowerCase())}</span><button class="btn small" data-hint="cancel">Cancel</button>`;
      this.el.hint.hidden = false;
    } else this.el.hint.hidden = true;
  }

  /** A tap or click on the map. */
  tapTile(t) {
    const snap = this.cw.snap;
    if (!snap) return;
    const x = Math.floor(t.x);
    const y = Math.floor(t.y);
    this.closePopup();
    const me = this.cw.me;
    if (snap.phase === 'placement') {
      if (!me || me.spawned) return;
      this.spawnPick = { x, y, err: this.spawnError(x, y) };
      this.r.preview = { x, y, ok: !this.spawnPick.err, radius: RULES.spawnRadius };
      this.renderPlacement();
      return;
    }
    if (snap.phase !== 'running' || !me || !me.alive) return;
    if (this.mode) {
      this.send({ type: 'build', kind: this.mode, x, y });
      this.r.ping(x, y, '#9cff8a');
      this.setMode(null);
      return;
    }
    const o = this.cw.ownerAt(x, y);
    if (o === this.cw.you) {
      const s = this.cw.structureAt(t.x, t.y, 3);
      if (s && s.owner === this.cw.you) this.openPopup(t, x, y);
      return;
    }
    if (o >= 0 && this.cw.allied(this.cw.you, o)) {
      this.openPopup(t, x, y);
      return;
    }
    // Land attacks go over the border; anything across the water goes by boat (the server decides).
    this.send({ type: this.cw.isLand(x, y) ? 'attack' : 'boat', x, y, ratio: this.ratio });
    this.r.ping(x, y, o >= 0 ? '#ff9a7a' : '#fff3c4');
  }

  /** Long press or right click: a small menu for that spot. */
  openPopup(t, x, y) {
    this.popupAt = { sx: t.sx, sy: t.sy, x, y };
    this.refreshPopup(true);
  }

  closePopup() {
    this.popupAt = null;
    this.el.popup.hidden = true;
    this.r.highlight = null;
  }

  refreshPopup(first = false) {
    const at = this.popupAt;
    const cw = this.cw;
    if (!at || !cw.snap) return;
    const { x, y } = at;
    const you = cw.you;
    const o = cw.ownerAt(x, y);
    const p = cw.player(o);
    const me = cw.me;
    const running = cw.snap.phase === 'running' && me?.alive;
    const parts = [];
    if (p) {
      const al = cw.alliance(you, o);
      const req = cw.snap.requests.find((r) => r.from === you && r.to === o);
      const theirs = cw.snap.requests.find((r) => r.from === o && r.to === you);
      parts.push(`<div class="ph"><span class="dot" style="background:${p.color}"></span><b>${esc(p.name)}</b>${p.ai ? ` <span class="muted">${esc(p.personality || 'AI')}</span>` : ''}</div>`);
      parts.push(`<div class="pr"><span>${pct(p.tiles / Math.max(1, cw.init.landTotal))} land</span><span>${fmt(p.troops)} troops</span>${al ? `<span class="good">ally ${Math.ceil(Math.max(0, al.until - cw.snap.time))} s</span>` : ''}${p.traitor ? '<span class="bad">traitor</span>' : ''}</div>`);
      if (o !== you && running && p.alive) {
        const btns = [];
        if (!al) btns.push(`<button class="btn small" data-pop="attack">Attack ${fmt(me.troops * this.ratio)}</button>`);
        if (!al) btns.push('<button class="btn small" data-pop="boat">⛵ Boat</button>');
        if (theirs) btns.push(`<button class="btn small go" data-answer="${theirs.id}" data-yes="1">Accept alliance</button>`);
        else if (!al) btns.push(`<button class="btn small go" data-pop="ally" ${req ? 'disabled' : ''}>${req ? 'Asked…' : 'Ask alliance'}</button>`);
        else {
          if (al.until - cw.snap.time < 60) btns.push(`<button class="btn small go" data-pop="ally" ${req ? 'disabled' : ''}>Renew</button>`);
          btns.push('<button class="btn small primary" data-pop="break">Break alliance</button>');
        }
        parts.push(`<div class="pbtns">${btns.join('')}</div>`);
      }
    } else if (cw.isLand(x, y)) {
      parts.push('<div class="ph"><b>Unclaimed land</b></div>');
      if (running) parts.push(`<div class="pbtns"><button class="btn small" data-pop="attack">Claim ${fmt(me.troops * this.ratio)}</button><button class="btn small" data-pop="boat">⛵ Boat</button></div>`);
    } else {
      parts.push('<div class="ph"><b>Open water</b></div>');
      if (running) parts.push('<div class="pbtns"><button class="btn small" data-pop="boat">⛵ Land troops nearby</button></div>');
    }
    // Your own buildings and land.
    const s = cw.structureAt(x + 0.5, y + 0.5, 3);
    if (s && s.owner === you) {
      const lvl = s.kind === 'town' ? ` · ${TOWN_LEVELS[s.level].name}` : '';
      parts.push(`<div class="ps"><b>${esc(s.name)}</b> <span class="muted">${esc(STRUCTURES[s.kind].name)}${lvl}</span></div>`);
      if (s.kind === 'town' && s.level < MAX_TOWN_LEVEL && running) parts.push(`<div class="pbtns"><button class="btn small go" data-pop="grow" data-sid="${s.id}" ${me.gold < s.upgrade ? 'disabled' : ''}>Grow to ${TOWN_LEVELS[s.level + 1].name.toLowerCase()} · ${fmt(s.upgrade)} gold</button></div>`);
    } else if (o === you && running) {
      const btns = Object.keys(STRUCTURES).map((k) => `<button class="btn small" data-pop="build" data-kind="${k}" ${me.gold < me.costs[k] ? 'disabled' : ''}><img src="${icon(BUILD_ICON[k])}" alt=""> ${esc(STRUCTURES[k].name)} ${fmt(me.costs[k])}</button>`);
      parts.push(`<div class="pbtns">${btns.join('')}</div>`);
    }
    const html = parts.join('');
    const el = this.el.popup;
    if (html !== this.popupHtml) {
      this.popupHtml = html;
      el.innerHTML = html;
    }
    this.r.highlight = o >= 0 && o !== you ? o : null;
    if (first) {
      el.hidden = false;
      // Next to the finger, inside the screen.
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = Math.max(8, Math.min(window.innerWidth - w - 8, at.sx - w / 2));
      const top = at.sy - h - 18 > 60 ? at.sy - h - 18 : Math.min(window.innerHeight - h - 8, at.sy + 18);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    }
  }

  popupAction(b) {
    const at = this.popupAt;
    if (!at) return;
    const { x, y } = at;
    const o = this.cw.ownerAt(x, y);
    const act = b.dataset.pop;
    if (act === 'attack') {
      this.send({ type: 'attack', x, y, ratio: this.ratio });
      this.r.ping(x, y, '#ff9a7a');
    } else if (act === 'boat') {
      this.send({ type: 'boat', x, y, ratio: this.ratio });
      this.r.ping(x, y, '#fff3c4');
    } else if (act === 'ally') this.send({ type: 'ally', to: o });
    else if (act === 'break') this.send({ type: 'breakAlliance', to: o });
    else if (act === 'grow') this.send({ type: 'upgrade', sid: Number(b.dataset.sid) });
    else if (act === 'build') {
      this.send({ type: 'build', kind: b.dataset.kind, x, y });
      this.r.ping(x, y, '#9cff8a');
    }
    this.closePopup();
  }

  // Desktop hover ----------------------------------------------------------------

  hover(e) {
    const t = this.r.screenToTile(e.clientX, e.clientY);
    const x = Math.floor(t.x);
    const y = Math.floor(t.y);
    if (this.mode) {
      this.r.preview = { x, y, ok: this.cw.ownerAt(x, y) === this.cw.you, radius: this.mode === 'outpost' ? RULES.outpostRadius : 0 };
      this.el.tip.hidden = true;
      return;
    }
    const o = this.cw.ownerAt(x, y);
    const p = this.cw.player(o);
    const s = this.cw.structureAt(t.x, t.y, 2);
    let html = '';
    if (s) html = `<b>${esc(s.name)}</b> · ${esc(STRUCTURES[s.kind].name)}${s.kind === 'town' ? ` (${TOWN_LEVELS[s.level].name})` : ''}<br>`;
    if (p) html += `<span class="dot" style="background:${p.color}"></span><b>${esc(p.name)}</b> · ${fmt(p.troops)} troops${this.cw.allied(this.cw.you, o) ? ' · ally' : ''}`;
    else if (this.cw.isLand(x, y)) html += 'Unclaimed land';
    if (!html) {
      this.el.tip.hidden = true;
      return;
    }
    const tip = this.el.tip;
    if (tip.innerHTML !== html) tip.innerHTML = html;
    tip.hidden = false;
    tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 8, e.clientX + 16)}px`;
    tip.style.top = `${Math.min(window.innerHeight - tip.offsetHeight - 8, e.clientY + 16)}px`;
  }

  // Input ------------------------------------------------------------------

  setSpeed(v) {
    if (!this.single) return;
    this.speed = v;
    this.tx.setSpeed(v);
    setText(this.el.speed, v === 0 ? '▶' : `${v}×`);
    this.el.speed.classList.toggle('on', v === 0);
  }

  bindHud() {
    const el = this.el;
    this.on(el.ratio, 'input', () => {
      this.ratio = Number(el.ratio.value) / 100;
      store.set('ratio', this.ratio);
      this.updateSliders();
    });
    this.on(el.share, 'input', () => {
      this.shareDrag = true;
      this.updateSliders();
    });
    this.on(el.share, 'change', () => {
      this.shareDrag = false;
      this.send({ type: 'troops', share: Number(el.share.value) / 100 });
    });
    this.on(el.speed, 'click', () => this.setSpeed({ 1: 2, 2: 4, 4: 0, 0: 1 }[this.speed] ?? 1));
    this.on(document.getElementById('btn-menu'), 'click', () => this.onQuit('menu'));
    this.on(document.getElementById('btn-home'), 'click', () => this.home());
    this.on(el.boardBtn, 'click', () => {
      this.boardOpen = !this.boardOpen;
      el.board.hidden = !this.boardOpen;
      el.boardBtn.classList.toggle('on', this.boardOpen);
      if (this.boardOpen) this.renderBoard();
    });
    this.on(el.board, 'click', (e) => {
      const b = e.target.closest('[data-player]');
      if (!b) return;
      const spot = this.cw.snap?.labels[Number(b.dataset.player)];
      if (spot) this.r.flyTo(spot[0], spot[1]);
    });
    this.on(el.build, 'click', (e) => {
      const b = e.target.closest('[data-build]');
      if (b) this.setMode(b.dataset.build);
    });
    this.on(el.hint, 'click', (e) => {
      if (e.target.closest('[data-hint="cancel"]')) this.setMode(null);
    });
    const answer = (e) => {
      const b = e.target.closest('[data-answer]');
      if (!b) return false;
      this.send({ type: 'answer', id: Number(b.dataset.answer), accept: !!b.dataset.yes });
      b.closest('.notice')?.remove();
      this.noticesHtml = null;
      return true;
    };
    this.on(el.notices, 'click', answer);
    this.on(el.attacks, 'click', (e) => {
      const b = e.target.closest('[data-retreat]');
      if (b) this.send({ type: 'retreat', id: Number(b.dataset.retreat) });
    });
    this.on(el.popup, 'click', (e) => {
      if (answer(e)) return this.closePopup();
      const b = e.target.closest('[data-pop]');
      if (b && !b.disabled) this.popupAction(b);
    });
    this.on(el.placement, 'click', (e) => {
      const b = e.target.closest('[data-spawn]');
      if (!b) return;
      if (b.dataset.spawn === 'go' && this.spawnPick) this.send({ type: 'place', x: this.spawnPick.x, y: this.spawnPick.y });
      this.spawnPick = null;
      this.r.preview = null;
      this.renderPlacement();
    });
    this.on(document.getElementById('minimap'), 'click', (e) => {
      const rect = e.target.getBoundingClientRect();
      this.r.flyTo(((e.clientX - rect.left) / rect.width) * this.cw.W, ((e.clientY - rect.top) / rect.height) * this.cw.H);
    });
  }

  bindInput() {
    const canvas = this.r.canvas;
    let drag = null;
    // Pointers: one finger (or the mouse) pans and taps; two fingers pinch
    // to zoom and pan together; a touch held still is a long-press.
    const pts = new Map();
    let pinch = null;
    let lastTap = null;
    const twoFinger = () => {
      const [a, b] = [...pts.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    const clearLong = () => {
      if (drag?.longTimer) clearTimeout(drag.longTimer);
      if (drag) drag.longTimer = null;
    };
    this.on(canvas, 'pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.vel = null;
      this.r.fly = null;
      if (pts.size === 1) {
        drag = { x: e.clientX, y: e.clientY, cx: this.r.cam.x, cy: this.r.cam.y, moved: false, button: e.button, touch: e.pointerType === 'touch', long: false, track: [[performance.now(), e.clientX, e.clientY]] };
        if (drag.touch) {
          drag.longTimer = setTimeout(() => {
            if (!drag || drag.moved) return;
            drag.long = true;
            const t = this.r.screenToTile(drag.x, drag.y);
            this.openPopup({ ...t, sx: drag.x, sy: drag.y }, Math.floor(t.x), Math.floor(t.y));
          }, 480);
        }
      } else if (pts.size === 2) {
        clearLong();
        if (drag) drag.moved = true; // a second finger means no tap
        pinch = twoFinger();
        this.r.anim = null;
      }
    });
    this.on(canvas, 'pointermove', (e) => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size >= 2) {
        const now = twoFinger();
        this.r.cam.x -= (now.x - pinch.x) / this.r.cam.ppt;
        this.r.cam.y -= (now.y - pinch.y) / this.r.cam.ppt;
        this.r.setPpt(this.r.cam.ppt * (now.d / Math.max(1, pinch.d)), now.x, now.y);
        pinch = now;
        return;
      }
      if (drag && (drag.button === 0 || drag.button === 1)) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > (drag.touch ? 10 : 5)) {
          if (!drag.moved) this.closePopup();
          drag.moved = true;
          clearLong();
        }
        if (drag.moved) {
          canvas.classList.add('dragging');
          this.r.cam.x = drag.cx - dx / this.r.cam.ppt;
          this.r.cam.y = drag.cy - dy / this.r.cam.ppt;
          this.r.clampCam();
          drag.track.push([performance.now(), e.clientX, e.clientY]);
          if (drag.track.length > 6) drag.track.shift();
        }
      }
      if (e.pointerType === 'mouse' && !drag) this.hover(e);
    });
    const release = (e, cancelled) => {
      pts.delete(e.pointerId);
      if (pinch && pts.size < 2) {
        this.r.settle(pinch.x, pinch.y);
        pinch = null;
        // The remaining finger starts a fresh pan.
        if (pts.size === 1) {
          const [p] = [...pts.values()];
          drag = { x: p.x, y: p.y, cx: this.r.cam.x, cy: this.r.cam.y, moved: true, button: 0, touch: true, long: false, track: [] };
        }
        return;
      }
      if (pts.size > 0) return;
      canvas.classList.remove('dragging');
      const d = drag;
      clearLong();
      drag = null;
      if (!d) return;
      if (d.moved && !cancelled && d.track.length >= 2) {
        // Let the map glide on after a flick.
        const [t0, x0, y0] = d.track[0];
        const [t1, x1, y1] = d.track[d.track.length - 1];
        const dt = Math.max(1, t1 - t0);
        if (performance.now() - t1 < 60 && dt < 160) this.vel = { x: (x1 - x0) / dt, y: (y1 - y0) / dt };
      }
      if (cancelled || d.moved || d.long) return;
      const t = this.r.screenToTile(e.clientX, e.clientY);
      t.sx = e.clientX;
      t.sy = e.clientY;
      if (d.button === 2) {
        this.openPopup(t, Math.floor(t.x), Math.floor(t.y));
        return;
      }
      // Double tap zooms in where the finger is.
      if (d.touch && lastTap && performance.now() - lastTap.at < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30 && !this.mode && this.cw.snap?.phase !== 'placement') {
        lastTap = null;
        clearTimeout(this.tapTimer);
        this.r.zoomStep(1, e.clientX, e.clientY);
        return;
      }
      if (d.touch && this.cw.snap?.phase === 'running' && !this.mode) {
        // Wait a moment: a second tap means zoom, not attack.
        lastTap = { at: performance.now(), x: e.clientX, y: e.clientY };
        clearTimeout(this.tapTimer);
        this.tapTimer = setTimeout(() => this.tapTile(t), 230);
        return;
      }
      lastTap = d.touch ? { at: performance.now(), x: e.clientX, y: e.clientY } : null;
      this.tapTile(t);
    };
    this.on(canvas, 'pointerup', (e) => release(e, false));
    this.on(canvas, 'pointercancel', (e) => release(e, true));
    this.on(canvas, 'pointerleave', () => {
      this.el.tip.hidden = true;
    });
    this.on(canvas, 'contextmenu', (e) => e.preventDefault());
    this.on(canvas, 'wheel', (e) => {
      e.preventDefault();
      this.vel = null;
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      if (e.ctrlKey || Math.abs(dy) < 40) {
        // Trackpad pinch and fine scrolling: follow the fingers, then settle.
        this.r.anim = null;
        this.r.setPpt(this.r.cam.ppt * Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.004)), e.clientX, e.clientY);
        clearTimeout(this.wheelTimer);
        this.wheelTimer = setTimeout(() => this.r.settle(e.clientX, e.clientY), 180);
      } else this.r.zoomBy(dy < 0 ? 1.5 : 1 / 1.5, e.clientX, e.clientY);
    }, { passive: false });
    this.on(window, 'keydown', (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName) && document.activeElement.type !== 'range') return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === 'escape') {
        if (this.mode) this.setMode(null);
        else if (this.popupAt) this.closePopup();
        else this.onQuit('menu');
      } else if (k === ' ' && this.single) {
        e.preventDefault();
        this.setSpeed(this.speed === 0 ? 1 : 0);
      } else if (k === '1' || k === '2' || k === '3') this.setSpeed([1, 2, 4][Number(k) - 1]);
      else if (k === '+' || k === '=') this.r.zoomStep(1);
      else if (k === '-') this.r.zoomStep(-1);
      else if (k === 'h') this.home();
      else if (k === 'b') this.setMode('town');
      else if (k === 'p') this.setMode('port');
      else if (k === 'o') this.setMode('outpost');
      else if (k === 'q' || k === 'e') {
        this.ratio = Math.max(0.05, Math.min(1, Math.round((this.ratio + (k === 'e' ? 0.05 : -0.05)) * 20) / 20));
        this.el.ratio.value = Math.round(this.ratio * 100);
        store.set('ratio', this.ratio);
        this.updateSliders();
      }
    });
    this.on(window, 'keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    this.on(window, 'resize', () => this.r.resize());
  }

  /** Called every animation frame. */
  update(dt) {
    const k = this.keys;
    const speed = (600 / this.r.cam.ppt) * dt;
    if (k.has('w') || k.has('arrowup')) this.r.cam.y -= speed;
    if (k.has('s') || k.has('arrowdown')) this.r.cam.y += speed;
    if (k.has('a') || k.has('arrowleft')) this.r.cam.x -= speed;
    if (k.has('d') || k.has('arrowright')) this.r.cam.x += speed;
    if (this.vel) {
      const ms = dt * 1000;
      this.r.cam.x -= (this.vel.x * ms) / this.r.cam.ppt;
      this.r.cam.y -= (this.vel.y * ms) / this.r.cam.ppt;
      const f = Math.pow(0.9, ms / 16);
      this.vel.x *= f;
      this.vel.y *= f;
      if (Math.hypot(this.vel.x, this.vel.y) < 0.02) this.vel = null;
    }
    this.r.clampCam();
  }

  showEnd(snap) {
    const cw = this.cw;
    const w = snap.winner;
    const p = cw.player(w.kid);
    const how = { conquest: 'as the last realm standing', domination: `by holding ${Math.round(cw.init.winShare * 100)}% of the land`, time: 'with the most land when time ran out' }[w.how];
    const won = w.kid === cw.you;
    this.onQuit('end', `<h2>${won ? 'Victory!' : `${esc(p?.name)} wins`}</h2><p>${esc(p?.name)} wins ${how}.</p>${this.standingsHtml(snap)}`);
  }
}
