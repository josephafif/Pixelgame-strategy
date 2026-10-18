// The in-game interface, kept small so the map stays in view: a stats chip
// and a few buttons at the top; at the bottom the army bar (the realm you
// march on, how many soldiers each drop sends, a card per kind of soldier,
// and the three buildings) and, when soldiers are selected, a selection bar.
//
// Raising soldiers works like dropping troops: choose a target realm, pick a
// card, then tap where they should go. They are raised at your town or
// outpost nearest that spot and march there; holding the finger down keeps
// dropping. Soldiers hold where they stand until you select them (tap them,
// or drag a box around them) and tap somewhere else. A long press or a right
// click opens a small menu for that spot. Every action is a command; the
// simulation validates it.

import { STRUCTURES, MAX_TOWN_LEVEL, TOWN_LEVELS, RULES, UNITS, UNIT_KEYS } from '../../engine/sim/defs.js';
import { canFoundAt } from '../../engine/world/sites.js';
import { landPart } from '../../engine/sim/units.js';
import { unitIcon } from '../render/people.js';
import { icon } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fmt = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.floor(v)}`);
const pct = (v) => (v >= 0.1 ? `${Math.round(v * 100)}%` : `${(v * 100).toFixed(1)}%`);
const BUILD_ICON = { town: 'house', port: 'anchor', outpost: 'tower' };
const BULK = [5, 10, 25, 50, 100, 200];
const TOAST_KINDS = new Set(['error', 'captured', 'lost', 'alliance', 'betrayal', 'fall', 'fallen-town', 'victory', 'declined', 'expired', 'built', 'grew', 'warning']);
const PUBLIC_TOAST = new Set(['betrayal', 'fall', 'victory', 'alliance', 'fallen-town']);
const COMPACT_QUERY = '(max-width: 720px), (max-height: 500px)';
const HOLD_MS = 380; // a press this long without moving starts a drag-select (or repeated drops)
const DROP_EVERY = 300;

function clock(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function setText(el, v) {
  if (el && el.textContent !== v) el.textContent = v;
}

const iconUrls = new Map();
function unitIconUrl(type) {
  if (!iconUrls.has(type)) {
    const ic = unitIcon(type);
    const cv = document.createElement('canvas');
    cv.width = ic.w;
    cv.height = ic.h;
    cv.getContext('2d').drawImage(ic.canvas, 0, 0);
    iconUrls.set(type, cv.toDataURL());
  }
  return iconUrls.get(type);
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
    this.armed = null; // a soldier type while dropping troops
    this.target = -1; // the realm marched on (-1: the wilds)
    this.bulk = store.get('bulk', 10);
    this.sel = renderer.selected;
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
      army: $('st-army'),
      gold: $('st-gold'),
      time: $('time'),
      speed: $('btn-speed'),
      board: $('board'),
      boardBtn: $('btn-board'),
      notices: $('notices'),
      bar: $('bar'),
      selbar: $('selbar'),
      cards: $('cards'),
      bulk: $('btn-bulk'),
      tgt: $('btn-target'),
      tgtName: $('tgt-name'),
      tgtDot: $('tgt-dot'),
      targets: $('targets'),
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
    for (const [id, name] of [['i-land', 'flag'], ['i-pop', 'pop'], ['i-army', 'soldier'], ['i-gold', 'coin']]) document.getElementById(id).src = icon(name);
    el.build.innerHTML = Object.entries(STRUCTURES)
      .map(([k, d]) => `<button class="bb" data-build="${k}" title="${esc(d.name)}: ${esc(d.about)}"><img src="${icon(BUILD_ICON[k])}" alt=""><span class="bc" data-cost="${k}"></span></button>`)
      .join('');
    el.cards.innerHTML = UNIT_KEYS.map((k, n) => {
      const u = UNITS[k];
      return `<button class="card" data-unit="${k}" title="${esc(u.name)} (${n + 1}): ${esc(u.about)} ${u.cost} gold each."><img src="${unitIconUrl(k)}" alt=""><span class="cn">${esc(u.short)}</span><span class="cc">${u.cost}</span></button>`;
    }).join('');
    this.renderBulk();
    this.renderTarget();
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
    clearInterval(this.dropTimer);
    for (const k of ['hud', 'placement', 'mini', 'popup', 'hint', 'tip', 'targets']) this.el[k].hidden = true;
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
    if (at) this.r.flyTo(at[0], at[1], Math.max(this.r.cam.ppt, 6));
  }

  // Snapshots ----------------------------------------------------------------

  onSnap(snap) {
    const el = this.el;
    const me = this.cw.me;
    setText(el.time, snap.phase === 'placement' ? 'Start' : clock(snap.time));
    if (me && me.spawned) {
      el.stats.hidden = false;
      setText(el.land, pct(this.cw.share(this.cw.you)));
      setText(el.pop, fmt(me.pop));
      el.pop.parentElement.style.setProperty('--fill', `${Math.min(100, (me.pop / Math.max(1, me.maxPop)) * 100).toFixed(0)}%`);
      setText(el.army, me.command ? `${fmt(me.army)}/${fmt(me.command)}` : fmt(me.army));
      setText(el.gold, `${fmt(me.gold)}${me.goldRate !== undefined ? ` +${fmt(Math.max(0, me.goldRate - (me.upkeep || 0)))}` : ''}`);
      for (const b of el.build.querySelectorAll('[data-cost]')) {
        const c = me.costs?.[b.dataset.cost] ?? 0;
        setText(b, fmt(c));
        b.parentElement.classList.toggle('poor', (me.gold ?? 0) < c);
      }
      for (const c of el.cards.querySelectorAll('[data-unit]')) c.classList.toggle('poor', (me.gold ?? 0) < UNITS[c.dataset.unit].cost);
    } else el.stats.hidden = this.cw.you < 0 || snap.phase === 'placement';
    el.bar.hidden = !(me && me.alive && snap.phase === 'running');
    // Forget selected squads that are gone.
    for (const id of [...this.sel]) if (!this.cw.squad(id)) this.sel.delete(id);
    this.renderSelection();
    this.renderPlacement();
    this.renderNotices(snap);
    if (this.boardOpen && (!this.boardAt || performance.now() - this.boardAt > 900)) this.renderBoard();
    if (!this.el.targets.hidden && (!this.targetsAt || performance.now() - this.targetsAt > 900)) this.renderTargets();
    if (this.target >= 0 && !this.cw.player(this.target)?.alive) this.setTarget(-1);
    if (this.popupAt) this.refreshPopup();
    if (snap.phase === 'over' && snap.winner && !this.ended) {
      this.ended = true;
      this.showEnd(snap);
    } else if (me && me.spawned && !me.alive && !this.fallenShown && snap.phase === 'running') {
      this.fallenShown = true;
      const best = me.stats?.maxTiles ?? 0;
      this.onQuit('end', `<h2>Your realm has fallen</h2><p>At its height ${esc(me.name)} held ${pct(best / Math.max(1, this.cw.init.landTotal))} of the land. The war goes on without you.</p>${this.standingsHtml(snap)}`);
    }
  }

  onEvents(evs) {
    for (const e of evs) {
      if (!TOAST_KINDS.has(e.kind)) continue;
      // Other realms' news only when it is big.
      const mine = !PUBLIC_TOAST.has(e.kind) || e.text.includes(this.cw.me?.name || '\u0000');
      if (!mine && (e.kind === 'alliance' || e.kind === 'fallen-town')) continue;
      this.toast(e.text, e.kind, e.x, e.y);
    }
  }

  toast(text, kind = 'info', x = null, y = null) {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    if (x != null) {
      // A toast about a place takes you there.
      t.classList.add('go');
      t.addEventListener('click', () => this.r.flyTo(x, y, Math.max(this.r.cam.ppt, 6)));
    }
    this.el.toasts.appendChild(t);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstChild.remove();
    setTimeout(() => t.classList.add('out'), kind === 'error' ? 2600 : 3800);
    setTimeout(() => t.remove(), kind === 'error' ? 3000 : 4200);
  }

  /** Alliance requests and enemy soldiers on your land, as small chips under the top bar. */
  renderNotices(snap) {
    const you = this.cw.you;
    const rows = [];
    for (const r of snap.requests) {
      if (r.to !== you) continue;
      const p = this.cw.player(r.from);
      rows.push(`<div class="notice ally"><span class="dot" style="background:${p.color}"></span><span class="nt">${esc(p.name)} ${r.renew ? 'renews' : 'offers'} an alliance</span><button data-answer="${r.id}" data-yes="1" class="yes" title="Accept">✓</button><button data-answer="${r.id}" class="no" title="Decline">✕</button></div>`);
    }
    // Hostile soldiers inside your borders.
    let n = 0;
    let big = null;
    for (const q of snap.squads) {
      if (q.owner === you || this.cw.allied(you, q.owner) || this.cw.ownerAt(q.x, q.y) !== you) continue;
      n += q.n;
      if (!big || q.n > big.n) big = q;
    }
    if (big) rows.push(`<div class="notice war"><span class="dot" style="background:${this.cw.colorOf(big.owner)}"></span><span class="nt">${fmt(n)} enemy soldiers on your land</span><button class="show" data-show="${big.x},${big.y}" title="Show">◎</button></div>`);
    const me = this.cw.me;
    if (me?.traitor) rows.push(`<div class="notice war"><span class="nt">Traitor: your soldiers and walls are weaker for ${Math.ceil(me.traitor)} s</span></div>`);
    const html = rows.join('');
    if (html !== this.noticesHtml) {
      this.noticesHtml = html;
      this.el.notices.innerHTML = html;
    }
  }

  standingsHtml(snap) {
    const rows = [...snap.players]
      .filter((p) => p.spawned)
      .sort((a, b) => b.tiles - a.tiles)
      .slice(0, 12)
      .map((p, k) => `<tr class="${p.id === this.cw.you ? 'me' : ''}"><td>${k + 1}</td><td><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</td><td>${pct(p.tiles / Math.max(1, this.cw.init.landTotal))}</td><td>${fmt(p.army)}</td></tr>`)
      .join('');
    return `<table class="t"><tr><th>#</th><th>Realm</th><th>Land</th><th>Soldiers</th></tr>${rows}</table>`;
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

  // Army bar ------------------------------------------------------------------

  renderBulk() {
    setText(this.el.bulk, `×${this.bulk}`);
  }

  setTarget(pid) {
    this.target = pid;
    this.r.highlight = pid >= 0 ? pid : null;
    this.renderTarget();
  }

  renderTarget() {
    const p = this.target >= 0 ? this.cw.player(this.target) : null;
    setText(this.el.tgtName, p ? p.name : 'Wilds');
    this.el.tgtDot.style.background = p ? p.color : '#9a9a8a';
  }

  /** Realms to march on, nearest first, plus the wilds. */
  renderTargets() {
    const snap = this.cw.snap;
    if (!snap) return;
    this.targetsAt = performance.now();
    const you = this.cw.you;
    const here = snap.labels[you] || [this.r.cam.x, this.r.cam.y];
    const list = snap.players
      .filter((p) => p.id !== you && p.alive && p.spawned)
      .map((p) => ({ p, d: snap.labels[p.id] ? Math.hypot(snap.labels[p.id][0] - here[0], snap.labels[p.id][1] - here[1]) : 1e9 }))
      .sort((a, b) => a.d - b.d);
    const rows = [`<button class="lb${this.target < 0 ? ' me' : ''}" data-target="-1"><span class="dot" style="background:#9a9a8a"></span><span class="nm">Wilds <span class="muted">unclaimed land</span></span><span class="pc"></span></button>`];
    for (const { p } of list) {
      const ally = this.cw.allied(you, p.id) ? ' <span class="tag good">ally</span>' : '';
      rows.push(`<button class="lb${this.target === p.id ? ' me' : ''}" data-target="${p.id}"><span class="dot" style="background:${p.color}"></span><span class="nm">${esc(p.name)}${ally}</span><span class="pc">⚔ ${fmt(p.army)}</span></button>`);
    }
    const html = rows.join('');
    if (html !== this.targetsHtml) {
      this.targetsHtml = html;
      this.el.targets.innerHTML = html;
    }
  }

  arm(unit) {
    this.armed = unit === this.armed ? null : unit;
    if (this.armed) this.setMode(null, true);
    for (const c of this.el.cards.querySelectorAll('[data-unit]')) c.classList.toggle('on', c.dataset.unit === this.armed);
    this.r.canvas.classList.toggle('targeting', !!(this.armed || this.mode));
    if (!this.armed) {
      this.r.deploy = null;
      if (!this.mode) this.el.hint.hidden = true;
      return;
    }
    const u = UNITS[this.armed];
    const tgt = this.target >= 0 ? this.cw.player(this.target)?.name : 'the wilds';
    this.el.hint.innerHTML = `<span>Tap where ${this.bulk} ${esc(u.name)} should go${tgt ? ` (target: ${esc(tgt)})` : ''} · hold to keep sending</span><button class="btn small" data-hint="cancel">Done</button>`;
    this.el.hint.hidden = false;
  }

  /** Raise a batch of the armed soldiers toward (x, y). */
  drop(x, y) {
    const unit = this.armed;
    if (!unit) return;
    const me = this.cw.me;
    const u = UNITS[unit];
    const n = Math.min(this.bulk, Math.floor((me?.gold ?? 0) / u.cost));
    if (n < 1) {
      this.toast(`${u.name} cost ${u.cost} gold each.`, 'error');
      return;
    }
    this.send({ type: 'deploy', unit, n, x, y });
    this.r.ping(x, y, '#9cff8a');
    // Show where they come from for a moment.
    const from = this.sourceNear(x, y);
    this.r.deploy = { x, y, ok: true, from };
    clearTimeout(this.deployClear);
    this.deployClear = setTimeout(() => {
      if (!this.hoverDeploy) this.r.deploy = null;
    }, 900);
  }

  /** The player's place soldiers sent to (x, y) come from (as the server picks it, unless besieged). */
  sourceNear(x, y) {
    const cw = this.cw;
    const part = landPart(cw);
    const there = part[Math.max(0, Math.min(cw.H - 1, Math.round(y))) * cw.W + Math.max(0, Math.min(cw.W - 1, Math.round(x)))];
    let best = null;
    for (const s of cw.snap?.structures || []) {
      if (s.owner !== cw.you) continue;
      const d = Math.hypot(s.x - x, s.y - y) + (there >= 0 && part[s.y * cw.W + s.x] !== there ? 1e4 : 0);
      if (!best || d < best.d) best = { s, d };
    }
    return best ? { x: best.s.x, y: best.s.y } : null;
  }

  renderSelection() {
    const el = this.el.selbar;
    if (!this.sel.size) {
      if (!el.hidden) el.hidden = true;
      this.selHtml = null;
      return;
    }
    const by = {};
    let total = 0;
    for (const id of this.sel) {
      const q = this.cw.squad(id);
      if (!q) continue;
      by[q.type] = (by[q.type] || 0) + q.n;
      total += q.n;
    }
    const parts = UNIT_KEYS.filter((k) => by[k]).map((k) => `<span class="sk"><img src="${unitIconUrl(k)}" alt="">${fmt(by[k])}</span>`).join('');
    const html = `<span class="sn">${this.sel.size} squad${this.sel.size === 1 ? '' : 's'} · ${fmt(total)}</span>${parts}<span class="sh">tap the map to send them</span><span class="sb"><button data-sel="all" title="Select all your soldiers (A)">All</button><button data-sel="stop" title="Stop here (X)">Stop</button><button data-sel="clear" title="Deselect (Esc)">✕</button></span>`;
    if (html !== this.selHtml) {
      this.selHtml = html;
      el.innerHTML = html;
    }
    el.hidden = false;
  }

  selectAll() {
    this.sel.clear();
    for (const q of this.cw.snap?.squads || []) if (q.owner === this.cw.you) this.sel.add(q.id);
    this.renderSelection();
  }

  clearSelection() {
    this.sel.clear();
    this.renderSelection();
  }

  /** Own squads inside a screen rectangle. */
  boxSelect(b, add) {
    const a = this.r.screenToTile(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1));
    const z = this.r.screenToTile(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
    if (!add) this.sel.clear();
    for (const q of this.cw.snap?.squads || []) {
      if (q.owner !== this.cw.you) continue;
      if (q.x + 0.5 >= a.x - 0.5 && q.x + 0.5 <= z.x + 0.5 && q.y + 0.5 >= a.y - 0.5 && q.y + 0.5 <= z.y + 0.5) this.sel.add(q.id);
    }
    this.renderSelection();
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

  setMode(mode, quiet = false) {
    this.mode = mode === this.mode ? null : mode;
    if (this.mode && this.armed) this.arm(null);
    for (const b of this.el.build.querySelectorAll('[data-build]')) b.classList.toggle('on', b.dataset.build === this.mode);
    this.r.preview = null;
    this.r.canvas.classList.toggle('targeting', !!(this.mode || this.armed));
    if (this.mode) {
      const d = STRUCTURES[this.mode];
      this.el.hint.innerHTML = `<span>${this.mode === 'port' ? 'Tap your coast' : 'Tap your land'} to place a ${esc(d.name.toLowerCase())}</span><button class="btn small" data-hint="cancel">Cancel</button>`;
      this.el.hint.hidden = false;
    } else if (!quiet && !this.armed) this.el.hint.hidden = true;
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
    if (this.armed) {
      this.drop(x, y);
      return;
    }
    // Your own soldiers: select (toggle) them.
    const own = this.cw.squadAt(t.x - 0.5, t.y - 0.5, Math.max(1.2, 14 / this.r.cam.ppt));
    if (own) {
      if (this.sel.has(own.id) && (this.sel.size > 1 || t.shift)) this.sel.delete(own.id);
      else {
        if (!t.shift && !t.touch) this.sel.clear();
        this.sel.add(own.id);
      }
      this.renderSelection();
      return;
    }
    // With soldiers selected, a tap sends them there.
    if (this.sel.size) {
      this.send({ type: 'move', ids: [...this.sel], x, y });
      this.r.ping(x, y, '#fff3c4');
      return;
    }
    // Otherwise a tap on a realm makes it the target, and says who it is.
    const o = this.cw.ownerAt(x, y);
    if (o >= 0 && o !== this.cw.you) {
      this.setTarget(o);
      this.openPopup(t, x, y);
    } else if (o === this.cw.you) {
      const s = this.cw.structureAt(t.x, t.y, 3);
      if (s && s.owner === this.cw.you) this.openPopup(t, x, y);
    }
  }

  /** Long press or right click: a small menu for that spot. */
  openPopup(t, x, y) {
    this.el.tip.hidden = true;
    this.popupAt = { sx: t.sx, sy: t.sy, x, y };
    this.refreshPopup(true);
  }

  closePopup() {
    this.popupAt = null;
    this.el.popup.hidden = true;
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
      parts.push(`<div class="pr"><span>${pct(p.tiles / Math.max(1, cw.init.landTotal))} land</span><span>⚔ ${fmt(p.army)}</span>${al ? `<span class="good">ally ${Math.ceil(Math.max(0, al.until - cw.snap.time))} s</span>` : ''}${p.traitor ? '<span class="bad">traitor</span>' : ''}</div>`);
      if (o !== you && running && p.alive) {
        const btns = [];
        if (!al && this.target !== o) btns.push('<button class="btn small" data-pop="target">🎯 March on them</button>');
        if (theirs) btns.push(`<button class="btn small go" data-answer="${theirs.id}" data-yes="1">Accept alliance</button>`);
        else if (!al) btns.push(`<button class="btn small go" data-pop="ally" ${req ? 'disabled' : ''}>${req ? 'Asked…' : 'Ask alliance'}</button>`);
        else {
          if (al.until - cw.snap.time < 60) btns.push(`<button class="btn small go" data-pop="ally" ${req ? 'disabled' : ''}>Renew</button>`);
          btns.push('<button class="btn small primary" data-pop="break">Break alliance</button>');
        }
        parts.push(`<div class="pbtns">${btns.join('')}</div>`);
      }
    } else if (cw.isLand(x, y)) {
      parts.push('<div class="ph"><b>Unclaimed land</b></div><div class="pr"><span>A town or outpost near it takes it in time.</span></div>');
    } else parts.push('<div class="ph"><b>Open water</b></div><div class="pr"><span>Soldiers sail across it on their own.</span></div>');
    // Your own buildings and land.
    const s = cw.structureAt(x + 0.5, y + 0.5, 3);
    if (s) {
      const lvl = s.kind === 'town' ? ` · ${TOWN_LEVELS[s.level].name}` : '';
      parts.push(`<div class="ps"><b>${esc(s.name)}</b> <span class="muted">${esc(STRUCTURES[s.kind].name)}${lvl} · garrison ${s.garrison}/${s.gmax}</span></div>`);
      if (s.owner === you && s.kind === 'town' && s.level < MAX_TOWN_LEVEL && running) parts.push(`<div class="pbtns"><button class="btn small go" data-pop="grow" data-sid="${s.id}" ${me.gold < s.upgrade ? 'disabled' : ''}>Grow to ${TOWN_LEVELS[s.level + 1].name.toLowerCase()} · ${fmt(s.upgrade)} gold</button></div>`);
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
    if (act === 'target') this.setTarget(o);
    else if (act === 'ally') this.send({ type: 'ally', to: o });
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
    if (this.popupAt) {
      this.el.tip.hidden = true;
      return;
    }
    const t = this.r.screenToTile(e.clientX, e.clientY);
    const x = Math.floor(t.x);
    const y = Math.floor(t.y);
    if (this.mode) {
      this.r.preview = { x, y, ok: this.cw.ownerAt(x, y) === this.cw.you, radius: this.mode === 'town' ? TOWN_LEVELS[1].land : STRUCTURES[this.mode]?.land || 0 };
      this.el.tip.hidden = true;
      return;
    }
    if (this.armed) {
      this.hoverDeploy = true;
      this.r.deploy = { x, y, ok: true, from: this.sourceNear(x, y) };
      this.el.tip.hidden = true;
      return;
    }
    const o = this.cw.ownerAt(x, y);
    const p = this.cw.player(o);
    const s = this.cw.structureAt(t.x, t.y, 2);
    const q = this.cw.squadAt(t.x - 0.5, t.y - 0.5, Math.max(1.2, 14 / this.r.cam.ppt), null);
    let html = '';
    if (q) html = `<span class="dot" style="background:${this.cw.colorOf(q.owner)}"></span><b>${fmt(q.n)} ${esc(UNITS[q.type].name)}</b> · ${esc(this.cw.player(q.owner)?.name)}${q.state === 'fight' ? ' · fighting' : ''}<br>`;
    if (s) html += `<b>${esc(s.name)}</b> · ${esc(STRUCTURES[s.kind].name)}${s.kind === 'town' ? ` (${TOWN_LEVELS[s.level].name})` : ''} · garrison ${s.garrison}/${s.gmax}<br>`;
    if (p) html += `<span class="dot" style="background:${p.color}"></span><b>${esc(p.name)}</b> · ⚔ ${fmt(p.army)}${this.cw.allied(this.cw.you, o) ? ' · ally' : ''}`;
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
    this.on(el.tgt, 'click', () => {
      el.targets.hidden = !el.targets.hidden;
      if (!el.targets.hidden) this.renderTargets();
    });
    this.on(el.targets, 'click', (e) => {
      const b = e.target.closest('[data-target]');
      if (!b) return;
      const pid = Number(b.dataset.target);
      this.setTarget(pid);
      el.targets.hidden = true;
      // Show the target if it is off screen.
      const spot = pid >= 0 ? this.cw.snap?.labels[pid] : null;
      if (spot) {
        const s = this.r.tileToScreen(spot[0], spot[1]);
        if (s.x < 0 || s.y < 0 || s.x > this.r.vw || s.y > this.r.vh) this.r.flyTo(spot[0], spot[1]);
      }
    });
    this.on(el.bulk, 'click', () => {
      this.bulk = BULK[(BULK.indexOf(this.bulk) + 1) % BULK.length] || 10;
      store.set('bulk', this.bulk);
      this.renderBulk();
      if (this.armed) {
        // Re-arm to update the hint.
        const u = this.armed;
        this.armed = null;
        this.arm(u);
      }
    });
    this.on(el.cards, 'click', (e) => {
      const b = e.target.closest('[data-unit]');
      if (b) this.arm(b.dataset.unit);
    });
    this.on(el.build, 'click', (e) => {
      const b = e.target.closest('[data-build]');
      if (b) this.setMode(b.dataset.build);
    });
    this.on(el.hint, 'click', (e) => {
      if (!e.target.closest('[data-hint="cancel"]')) return;
      if (this.armed) this.arm(null);
      this.setMode(null);
    });
    this.on(el.selbar, 'click', (e) => {
      const b = e.target.closest('[data-sel]');
      if (!b) return;
      if (b.dataset.sel === 'all') this.selectAll();
      else if (b.dataset.sel === 'stop') this.send({ type: 'stop', ids: [...this.sel] });
      else this.clearSelection();
    });
    const answer = (e) => {
      const b = e.target.closest('[data-answer]');
      if (!b) return false;
      this.send({ type: 'answer', id: Number(b.dataset.answer), accept: !!b.dataset.yes });
      b.closest('.notice')?.remove();
      this.noticesHtml = null;
      return true;
    };
    this.on(el.notices, 'click', (e) => {
      if (answer(e)) return;
      const b = e.target.closest('[data-show]');
      if (b) {
        const [x, y] = b.dataset.show.split(',').map(Number);
        this.r.flyTo(x, y, Math.max(this.r.cam.ppt, 6));
      }
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

  /**
   * Pointers. Touch: one finger pans and taps, two fingers pinch; holding a
   * finger still starts a selection box (or, with a soldier card armed, keeps
   * dropping soldiers where the finger is). Mouse: left drag draws a
   * selection box, right or middle drag pans, a click acts, a right click
   * sends selected soldiers or opens the menu.
   */
  bindInput() {
    const canvas = this.r.canvas;
    let drag = null;
    const pts = new Map();
    let pinch = null;
    let lastTap = null;
    const twoFinger = () => {
      const [a, b] = [...pts.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    const clearHold = () => {
      if (drag?.holdTimer) clearTimeout(drag.holdTimer);
      if (drag) drag.holdTimer = null;
    };
    const stopDropping = () => {
      clearInterval(this.dropTimer);
      this.dropTimer = null;
    };
    const tileAt = (sx, sy) => {
      const t = this.r.screenToTile(sx, sy);
      t.sx = sx;
      t.sy = sy;
      return t;
    };
    this.on(canvas, 'pointerdown', (e) => {
      this.r.inputAt = performance.now();
      canvas.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.vel = null;
      this.r.fly = null;
      this.el.targets.hidden = true;
      if (pts.size === 1) {
        const touch = e.pointerType !== 'mouse';
        // The mouse pans with the right or middle button; the left one selects.
        const pan = touch || e.button === 1 || e.button === 2;
        drag = { x: e.clientX, y: e.clientY, cx: this.r.cam.x, cy: this.r.cam.y, moved: false, button: e.button, touch, pan, hold: false, track: [[performance.now(), e.clientX, e.clientY]], shift: e.shiftKey };
        const running = this.cw.snap?.phase === 'running';
        if (running && (touch || (this.armed && e.button === 0))) {
          drag.holdTimer = setTimeout(() => {
            if (!drag || drag.moved) return;
            drag.hold = true;
            if (this.armed) {
              // Keep dropping where the finger is.
              const go = () => {
                if (!drag) return stopDropping();
                const t = this.r.screenToTile(drag.lx ?? drag.x, drag.ly ?? drag.y);
                this.drop(Math.floor(t.x), Math.floor(t.y));
              };
              go();
              this.dropTimer = setInterval(go, DROP_EVERY);
            } else {
              drag.box = true;
              this.r.box = { x0: drag.x, y0: drag.y, x1: drag.x, y1: drag.y };
              if (navigator.vibrate) navigator.vibrate(12);
            }
          }, HOLD_MS);
        }
      } else if (pts.size === 2) {
        clearHold();
        stopDropping();
        if (drag) {
          drag.moved = true; // a second finger means no tap
          drag.box = false;
        }
        this.r.box = null;
        pinch = twoFinger();
        this.r.anim = null;
      }
    });
    this.on(canvas, 'pointermove', (e) => {
      if (pts.has(e.pointerId)) {
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.r.inputAt = performance.now();
      }
      if (pinch && pts.size >= 2) {
        const now = twoFinger();
        this.r.cam.x -= (now.x - pinch.x) / this.r.cam.ppt;
        this.r.cam.y -= (now.y - pinch.y) / this.r.cam.ppt;
        this.r.setPpt(this.r.cam.ppt * (now.d / Math.max(1, pinch.d)), now.x, now.y);
        pinch = now;
        return;
      }
      if (drag) {
        drag.lx = e.clientX;
        drag.ly = e.clientY;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) > (drag.touch ? 10 : 5)) {
          drag.moved = true;
          if (!drag.hold) clearHold();
          this.closePopup();
          // A left drag with the mouse draws a selection box at once.
          if (!drag.pan && !this.armed && !drag.hold) {
            drag.box = true;
            this.r.box = { x0: drag.x, y0: drag.y, x1: drag.x, y1: drag.y };
          }
        }
        if (drag.box) {
          this.r.box.x1 = e.clientX;
          this.r.box.y1 = e.clientY;
        } else if (drag.moved && !drag.hold && drag.pan) {
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
          drag = { x: p.x, y: p.y, cx: this.r.cam.x, cy: this.r.cam.y, moved: true, button: 0, touch: true, pan: true, hold: false, track: [] };
        }
        return;
      }
      if (pts.size > 0) return;
      canvas.classList.remove('dragging');
      const d = drag;
      clearHold();
      stopDropping();
      drag = null;
      if (!d) return;
      if (d.box) {
        const b = this.r.box;
        this.r.box = null;
        if (!cancelled && b && Math.abs(b.x1 - b.x0) + Math.abs(b.y1 - b.y0) > 8) {
          this.boxSelect(b, d.shift);
          return;
        }
        if (d.touch && !cancelled) {
          // Held but not dragged: the menu for that spot.
          const t = tileAt(d.x, d.y);
          this.openPopup(t, Math.floor(t.x), Math.floor(t.y));
          return;
        }
      }
      if (d.moved && d.pan && !cancelled && d.track.length >= 2) {
        // Let the map glide on after a flick.
        const [t0, x0, y0] = d.track[0];
        const [t1, x1, y1] = d.track[d.track.length - 1];
        const dt = Math.max(1, t1 - t0);
        if (performance.now() - t1 < 60 && dt < 160) this.vel = { x: (x1 - x0) / dt, y: (y1 - y0) / dt };
      }
      if (cancelled || d.moved || d.hold) return;
      const t = tileAt(e.clientX, e.clientY);
      t.shift = d.shift;
      t.touch = d.touch;
      if (d.button === 2) {
        // Right click: send the selected soldiers, or open the menu.
        if (this.sel.size) {
          this.send({ type: 'move', ids: [...this.sel], x: Math.floor(t.x), y: Math.floor(t.y) });
          this.r.ping(Math.floor(t.x), Math.floor(t.y), '#fff3c4');
        } else this.openPopup(t, Math.floor(t.x), Math.floor(t.y));
        return;
      }
      // Double tap zooms in (when no order is pending).
      const free = !this.mode && !this.armed && !this.sel.size && this.cw.snap?.phase !== 'placement';
      if (d.touch && free && lastTap && performance.now() - lastTap.at < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        lastTap = null;
        clearTimeout(this.tapTimer);
        this.r.zoomStep(1, e.clientX, e.clientY);
        return;
      }
      if (d.touch && free) {
        // Wait a moment: a second tap means zoom.
        lastTap = { at: performance.now(), x: e.clientX, y: e.clientY };
        clearTimeout(this.tapTimer);
        this.tapTimer = setTimeout(() => this.tapTile(t), 230);
        return;
      }
      lastTap = null;
      this.tapTile(t);
    };
    this.on(canvas, 'pointerup', (e) => release(e, false));
    this.on(canvas, 'pointercancel', (e) => release(e, true));
    this.on(canvas, 'pointerleave', () => {
      this.el.tip.hidden = true;
      if (this.hoverDeploy) {
        this.hoverDeploy = false;
        this.r.deploy = null;
      }
    });
    this.on(canvas, 'contextmenu', (e) => e.preventDefault());
    this.on(canvas, 'wheel', (e) => {
      e.preventDefault();
      this.vel = null;
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(dy) * 0.5 && Math.abs(dy) < 40) {
        // Two-finger scrolling on a trackpad pans.
        this.r.cam.x += e.deltaX / this.r.cam.ppt;
        this.r.cam.y += dy / this.r.cam.ppt;
        this.r.clampCam();
        return;
      }
      if (e.ctrlKey || Math.abs(dy) < 40) {
        // Trackpad pinch and fine scrolling: follow the fingers, then settle.
        this.r.anim = null;
        this.r.setPpt(this.r.cam.ppt * Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.004)), e.clientX, e.clientY);
        clearTimeout(this.wheelTimer);
        this.wheelTimer = setTimeout(() => this.r.settle(e.clientX, e.clientY), 180);
      } else this.r.zoomBy(dy < 0 ? 1.5 : 1 / 1.5, e.clientX, e.clientY);
    }, { passive: false });
    this.on(window, 'keydown', (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === 'escape') {
        if (this.armed) this.arm(null);
        else if (this.mode) this.setMode(null);
        else if (this.popupAt) this.closePopup();
        else if (!this.el.targets.hidden) this.el.targets.hidden = true;
        else if (this.sel.size) this.clearSelection();
        else this.onQuit('menu');
      } else if (k === ' ' && this.single) {
        e.preventDefault();
        this.setSpeed(this.speed === 0 ? 1 : 0);
      } else if (k >= '1' && k <= '5') this.arm(UNIT_KEYS[Number(k) - 1]);
      else if (k === '0') this.arm(null);
      else if (k === '.' || k === ',') this.setSpeed(k === '.' ? { 0: 1, 1: 2, 2: 4, 4: 4 }[this.speed] : { 4: 2, 2: 1, 1: 1, 0: 0 }[this.speed]);
      else if (k === '+' || k === '=') this.r.zoomStep(1);
      else if (k === '-') this.r.zoomStep(-1);
      else if (k === 'h') this.home();
      else if (k === 'b') this.setMode('town');
      else if (k === 'p') this.setMode('port');
      else if (k === 'o') this.setMode('outpost');
      else if (k === 't') this.el.tgt.click();
      else if (k === 'f') this.selectAll();
      else if (k === 'x' && this.sel.size) this.send({ type: 'stop', ids: [...this.sel] });
      else if (k === 'q' || k === 'e') {
        const i = Math.max(0, Math.min(BULK.length - 1, BULK.indexOf(this.bulk) + (k === 'e' ? 1 : -1)));
        this.bulk = BULK[i];
        store.set('bulk', this.bulk);
        this.renderBulk();
        if (this.armed) {
          const u = this.armed;
          this.armed = null;
          this.arm(u);
        }
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
