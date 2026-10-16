// In-game interface: resource bar, selection panel (settlement / army),
// realm tabs (labour, trade, diplomacy, chronicle), placement, action modes
// and input. Every action is sent as a command; the simulation validates it.

import { BUILDINGS, STAGES, WALLS, UNITS, RESOURCES, RES_KEYS, LABOR, RULES, stagePopNeed } from '../../engine/sim/defs.js';
import { analyzeSite, describeSite, canFoundAt } from '../../engine/world/sites.js';
import { BIOMES } from '../../engine/world/biomes.js';
import { STYLES } from '../../engine/settlement/styles.js';
import { iconImg, icon } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.floor(v)}`);
const RES_ICON = { food: 'food', wood: 'wood', stone: 'stone', iron: 'iron', fuel: 'fuel', herbs: 'herbs', crystal: 'crystal', goods: 'goods', arms: 'arms', coin: 'coin' };
const LABOR_NAMES = { food: 'Food', wood: 'Timber', stone: 'Stone', iron: 'Iron', fuel: 'Fuel', herbs: 'Herbs', crystal: 'Crystal', industry: 'Industry', build: 'Building' };
const LEVELS = ['Off', 'Low', 'Normal', 'High'];
const UNIT_ORDER = ['inf', 'arch', 'cav', 'siege'];
const TAB_NAMES = { realm: 'Realm', trade: 'Trade', diplomacy: 'Diplomacy', chronicle: 'Chronicle' };
const DOCK = [['town', 'house', 'Town'], ['realm', 'crown', 'Realm'], ['trade', 'scales', 'Trade'], ['diplomacy', 'banner', 'Diplomacy'], ['chronicle', 'scroll', 'Chronicle']];
// Phones keep the most watched stocks at the front of the scrolling strip.
const COMPACT_ORDER = ['coin', 'food', 'wood', 'stone', 'pop', 'soldiers', 'iron', 'fuel', 'herbs', 'goods', 'arms', 'crystal'];
const SECTION_DEFAULTS = { grow: true, construction: true, build: true, work: false, military: false, walls: false };
const COMPACT_QUERY = '(max-width: 720px), (max-height: 500px)';

function loadSections() {
  try {
    return { ...SECTION_DEFAULTS, ...JSON.parse(localStorage.getItem('realmwright:sections') || '{}') };
  } catch {
    return { ...SECTION_DEFAULTS };
  }
}

const TOAST_KINDS = new Set(['war', 'peace', 'capture', 'fall', 'victory', 'found', 'stage', 'built', 'error', 'warn', 'military', 'proposal', 'info']);

function costHtml(cost, have = null) {
  return Object.entries(cost)
    .map(([r, v]) => {
      const short = have && (r === 'coin' ? have.coin : have.stock[r] || 0) < v;
      return `<span class="${short ? 'bad' : ''}">${iconImg(RES_ICON[r] || 'goods', r)}${v}</span>`;
    })
    .join(' ');
}

function canPay(me, cost, mult = 1) {
  if (!me || !me.stock) return false;
  return Object.entries(cost).every(([r, v]) => (r === 'coin' ? me.coin : me.stock[r] || 0) >= v * mult);
}

function clock(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export class GameUI {
  constructor({ cw, renderer, transport, single, onQuit }) {
    this.cw = cw;
    this.r = renderer;
    this.tx = transport;
    this.single = single;
    this.onQuit = onQuit;
    this.tab = 'realm';
    this.speed = 1;
    this.mode = null;
    this.lastPanel = 0;
    this.placingSite = null;
    this.el = {
      top: document.getElementById('topbar'),
      res: document.getElementById('resources'),
      time: document.getElementById('time'),
      speed: document.getElementById('speed'),
      left: document.getElementById('left'),
      right: document.getElementById('right'),
      tabBody: document.getElementById('tab-body'),
      tabs: document.getElementById('tabs'),
      mini: document.getElementById('minimap'),
      miniWrap: document.getElementById('minimap-wrap'),
      hint: document.getElementById('hint'),
      placement: document.getElementById('placement'),
      toasts: document.getElementById('toasts'),
      tip: document.getElementById('tooltip'),
      crest: document.getElementById('realm-crest'),
      realm: document.getElementById('realm-name'),
      dock: document.getElementById('dock'),
      rightTitle: document.getElementById('right-title'),
    };
    this.keys = new Set();
    this.unsub = [];
    // Phone layout: one sheet at a time ('select' or 'tab'), optionally full height.
    this.mqCompact = window.matchMedia(COMPACT_QUERY);
    this.mqTouch = window.matchMedia('(pointer: coarse)');
    this.compact = this.mqCompact.matches;
    this.touch = this.mqTouch.matches;
    this.sheet = null;
    this.full = false;
    this.hasLeft = false;
    this.secOpen = loadSections();
    this.formVals = {}; // values typed into panel forms survive the twice-a-second redraws
    this.recruitN = { inf: 5, arch: 5, cav: 5, siege: 1 };
    this.pendingTap = null;
  }

  /** "Tap" on touch screens, "Click" with a mouse. */
  get tapWord() {
    return this.touch ? 'Tap' : 'Click';
  }

  start() {
    const { el } = this;
    el.top.hidden = false;
    el.right.hidden = true;
    el.miniWrap.hidden = false;
    el.speed.hidden = !this.single;
    const aspect = this.cw.H / this.cw.W;
    el.mini.width = 240;
    el.mini.height = Math.round(240 * aspect);
    this.unsub.push(this.cw.on((kind, data) => {
      if (kind === 'snap') this.onSnap(data);
      if (kind === 'events') this.onEvents(data);
    }));
    el.dock.innerHTML = DOCK.map(([k, ic, label]) => `<button data-dock="${k}"><img src="${icon(ic)}" alt="">${label}</button>`).join('');
    this.bindInput();
    this.bindPanels();
    // Keep the CSS informed of the top bar's real height (it wraps on phones).
    const measure = () => document.documentElement.style.setProperty('--top-h', `${Math.ceil(el.top.getBoundingClientRect().bottom)}px`);
    this.topObserver = new ResizeObserver(measure);
    this.topObserver.observe(el.top);
    measure();
    const relayout = () => {
      this.compact = this.mqCompact.matches;
      this.touch = this.mqTouch.matches;
      if (!this.compact) this.full = false;
      this.applyPanels();
      this.lastPanel = 0;
    };
    this.mqCompact.addEventListener('change', relayout);
    this.mqTouch.addEventListener('change', relayout);
    this.unsub.push(() => {
      this.mqCompact.removeEventListener('change', relayout);
      this.mqTouch.removeEventListener('change', relayout);
      this.topObserver.disconnect();
    });
    this.r.centerOn(this.cw.W / 2, this.cw.H / 2, this.compact ? 2 : 3);
    this.applyPanels();
  }

  destroy() {
    for (const u of this.unsub) u();
    for (const [t, fn, opts] of this.listeners || []) t.removeEventListener(fn[0], fn[1], opts);
    this.el.dock.hidden = true;
    this.el.hint.hidden = true;
    document.body.classList.remove('sheet-open', 'sheet-full');
  }

  // -------------------------------------------------------------------------
  // Layout: which panels show, and where the map is still visible

  applyPanels() {
    const { el, cw } = this;
    const snap = cw.snap;
    const placing = !!snap && snap.phase === 'placement' && cw.you >= 0 && !snap.kingdoms[cw.you].placed;
    const playing = !!snap && cw.you >= 0 && !placing;
    const rightWasHidden = el.right.hidden;
    if (this.compact) {
      if (this.sheet === 'select' && !this.hasLeft) this.sheet = null;
      // While choosing a target on the map, sheets step aside.
      el.left.hidden = this.sheet !== 'select' || !this.hasLeft || !!this.mode;
      el.right.hidden = !playing || this.sheet !== 'tab' || !!this.mode;
      el.dock.hidden = !playing;
    } else {
      el.left.hidden = !this.hasLeft;
      el.right.hidden = !playing;
      el.dock.hidden = true;
    }
    const open = this.compact && (!el.left.hidden || !el.right.hidden || !el.placement.hidden);
    for (const p of [el.left, el.right, el.placement]) p.classList.toggle('full', this.compact && this.full);
    document.body.classList.toggle('sheet-open', open);
    document.body.classList.toggle('sheet-full', open && this.full);
    this.updateDock();
    if (rightWasHidden && !el.right.hidden) this.renderTab();
  }

  updateDock() {
    const { el, cw } = this;
    if (el.dock.hidden) return;
    const props = cw.snap?.proposals || [];
    for (const b of el.dock.querySelectorAll('button')) {
      const k = b.dataset.dock;
      b.classList.toggle('on', (k === 'town' && this.sheet === 'select') || (this.sheet === 'tab' && this.tab === k));
      const alert = (k === 'trade' && props.some((p) => p.to === cw.you && !p.peace)) || (k === 'diplomacy' && props.some((p) => p.to === cw.you && p.peace));
      b.classList.toggle('alert', alert);
    }
  }

  dockTap(k) {
    if (k === 'town') {
      if (this.sheet === 'select') this.sheet = null;
      else if (this.r.selection && this.hasLeft) this.sheet = 'select';
      else {
        const cap = this.cw.me && this.cw.settlement(this.cw.me.capital);
        if (cap) {
          this.select({ type: 'settlement', id: cap.id });
          this.focusOn(cap.x, cap.y, Math.max(16, this.r.cam.ppt));
          return;
        }
      }
    } else if (this.sheet === 'tab' && this.tab === k) this.sheet = null;
    else {
      this.sheet = 'tab';
      this.tab = k;
    }
    this.applyPanels();
    this.renderTab();
  }

  /** The part of the screen not covered by bars and sheets (CSS pixels). */
  visibleRect() {
    const vw = this.r.vw;
    const vh = this.r.vh;
    const rect = { left: 0, top: this.el.top.getBoundingClientRect().bottom, right: vw, bottom: vh };
    if (!this.compact) return rect;
    const dock = this.el.dock;
    if (!dock.hidden) {
      const d = dock.getBoundingClientRect();
      if (d.height > d.width) rect.left = Math.max(rect.left, d.right);
      else rect.bottom = Math.min(rect.bottom, d.top);
    }
    for (const p of [this.el.left, this.el.right, this.el.placement]) {
      if (p.hidden) continue;
      const b = p.getBoundingClientRect();
      if (b.width >= vw * 0.9) rect.bottom = Math.min(rect.bottom, b.top);
      else rect.right = Math.min(rect.right, b.left);
    }
    return rect;
  }

  /** Centre the camera on a tile within the visible part of the screen. */
  focusOn(x, y, ppt = null) {
    this.r.centerOn(x, y, ppt);
    const v = this.visibleRect();
    this.r.cam.x -= ((v.left + v.right) / 2 - this.r.vw / 2) / this.r.cam.ppt;
    this.r.cam.y -= ((v.top + v.bottom) / 2 - this.r.vh / 2) / this.r.cam.ppt;
    this.r.clampCam();
  }

  /** Pan only if the tile is hidden behind a sheet or bar. */
  ensureVisible(x, y) {
    if (!this.compact) return;
    const v = this.visibleRect();
    const p = this.r.tileToScreen(x, y);
    const m = 28;
    if (p.x < v.left + m || p.x > v.right - m || p.y < v.top + m || p.y > v.bottom - m) this.focusOn(x, y);
  }

  /** A collapsible panel section that remembers whether it is open. */
  sec(key, title, body, count = '') {
    const open = this.secOpen[key] ?? true;
    return `<details class="sec" data-sec="${key}" ${open ? 'open' : ''}><summary>${title}${count !== '' ? `<span class="count">${count}</span>` : ''}</summary>${body}</details>`;
  }

  /** Last value typed into a panel form field, or its default. */
  fv(key, def) {
    return this.formVals[key] ?? def;
  }

  send(cmd) {
    this.tx.command(cmd);
  }

  // -------------------------------------------------------------------------
  // Snapshot handling

  onSnap(snap) {
    this.renderTop(snap);
    const placing = snap.phase === 'placement' && this.cw.you >= 0 && !snap.kingdoms[this.cw.you].placed;
    if (placing) this.renderPlacement(snap);
    else if (!this.el.placement.hidden) {
      this.el.placement.hidden = true;
      this.full = false;
      this.r.preview = null;
      const me = this.cw.me;
      const cap = me && this.cw.settlement(me.capital);
      if (cap) {
        this.select({ type: 'settlement', id: cap.id });
        this.focusOn(cap.x, cap.y, this.compact ? 16 : 24);
        this.focused = true;
      }
    } else if (!this.focused && snap.phase !== 'placement') {
      // Joining a match already under way (a saved realm, a reconnect): start at home.
      const cap = this.cw.me && this.cw.settlement(this.cw.me.capital);
      if (cap) this.focusOn(cap.x, cap.y, 16);
      this.focused = true;
    }
    this.applyPanels();
    const now = performance.now();
    if (now - this.lastPanel > 450) {
      this.lastPanel = now;
      this.renderLeft();
      this.renderTab();
    }
    if (snap.winner && !this.shownEnd) {
      this.shownEnd = true;
      this.showEnd(snap);
    }
  }

  onEvents(evs) {
    for (const e of evs) {
      if (!TOAST_KINDS.has(e.kind)) continue;
      if (e.kind === 'info' && !/begins|accepted|declined|agreement/i.test(e.text)) continue;
      this.toast(e.text, e.kind);
    }
  }

  toast(text, kind = 'info') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.el.toasts.appendChild(t);
    // Phones keep the map clear: fewer notices, shown more briefly (the chronicle keeps them all).
    const max = this.compact ? 2 : 4;
    while (this.el.toasts.children.length > max) this.el.toasts.firstChild.remove();
    setTimeout(() => t.remove(), kind === 'victory' ? 12000 : this.compact ? 3600 : 5200);
  }

  renderTop(snap) {
    const { el } = this;
    const me = this.cw.me;
    el.time.textContent = snap.phase === 'placement' ? (this.single ? 'Choose your capital' : `Placement ${Math.ceil(snap.placementLeft)}s`) : clock(snap.time);
    if (!me) {
      el.realm.textContent = 'Spectating';
      el.res.innerHTML = '';
      return;
    }
    el.crest.style.background = me.color;
    el.realm.textContent = me.name;
    if (!me.stock) return;
    const cells = {};
    for (const r of [...RES_KEYS, 'coin']) {
      const v = r === 'coin' ? me.coin : me.stock[r] || 0;
      const rate = (me.rates?.[r] || 0) * 60;
      const short = (r === 'food' && me.flags?.starving) || (r === 'fuel' && me.flags?.cold) || (r === 'coin' && me.flags?.unpaid);
      const name = r === 'coin' ? 'Coin' : RESOURCES[r].name;
      const trend = rate > 0.5 ? 'up' : rate < -0.5 ? 'down' : '';
      cells[r] = `<div class="res${short ? ' short' : ''} ${trend}" data-tip="${esc(name)}: ${Math.round(v)} (${rate >= 0 ? '+' : ''}${rate.toFixed(1)} per minute)">${iconImg(RES_ICON[r], name)}<b>${fmt(v)}</b><span class="rate ${trend}">${rate > 0.5 ? '▲' : rate < -0.5 ? '▼' : ''}</span></div>`;
    }
    const st = me.stats || {};
    cells.pop = `<div class="res" data-tip="Population: ${st.pop} (${st.workers || 0} working, ${st.idle || 0} idle)">${iconImg('pop', 'Population')}<b>${fmt(st.pop || 0)}</b></div>`;
    cells.soldiers = `<div class="res" data-tip="Soldiers in garrisons and armies: ${st.soldiers || 0}">${iconImg('soldier', 'Soldiers')}<b>${fmt(st.soldiers || 0)}</b></div>`;
    const order = this.compact ? COMPACT_ORDER : [...RES_KEYS, 'coin', 'pop', 'soldiers'];
    const html = order.map((k) => cells[k]).join('');
    // Rewriting the strip resets its scroll position on phones; only touch it when it changed.
    if (html !== this.lastRes) {
      const sl = el.res.scrollLeft;
      el.res.innerHTML = html;
      el.res.scrollLeft = sl;
      this.lastRes = html;
    }
    for (const b of el.speed.querySelectorAll('button')) b.classList.toggle('on', Number(b.dataset.speed) === this.speed);
  }

  // -------------------------------------------------------------------------
  // Selection panel

  select(sel) {
    const changed = JSON.stringify(sel) !== JSON.stringify(this.r.selection);
    this.r.selection = sel;
    if (this.compact) {
      if (sel) this.sheet = 'select';
      else if (this.sheet === 'select') this.sheet = null;
    }
    if (changed) this.full = false;
    this.lastPanel = 0;
    this.renderLeft();
  }

  renderLeft() {
    const { el, cw } = this;
    const sel = this.r.selection;
    if (el.left.contains(document.activeElement) && ['INPUT', 'SELECT'].includes(document.activeElement.tagName)) return;
    if (this.pressing && el.left.contains(this.pressing)) return; // never swap a button out from under a finger
    let html = '';
    if (sel && cw.snap) {
      if (sel.type === 'settlement') {
        const s = cw.settlement(sel.id);
        if (s) html = s.kingdom === cw.you ? this.ownSettlementHtml(s) : this.foreignSettlementHtml(s);
      } else if (sel.type === 'army') {
        const a = cw.army(sel.id);
        if (a) html = this.armyHtml(a);
      }
    }
    this.hasLeft = !!html;
    if (html && html !== this.lastLeft) {
      const scroll = el.left.querySelector('.scroll');
      const top = scroll ? scroll.scrollTop : 0;
      el.left.innerHTML = html;
      const ns = el.left.querySelector('.scroll');
      if (ns) ns.scrollTop = top;
      this.lastLeft = html;
    }
    if (!html) this.lastLeft = '';
    this.applyPanels();
  }

  /** Sheet header with a drag handle on phones. */
  headHtml(title, sub, subStyle = '') {
    return `<div class="head" data-grip><span class="grip" aria-hidden="true"></span><h2>${title}</h2><div class="sub"${subStyle ? ` style="${subStyle}"` : ''}>${sub}</div><button class="close" data-act="close" title="Close (Esc)">✕</button></div>`;
  }

  ownSettlementHtml(s) {
    const cw = this.cw;
    const me = cw.me;
    const stage = STAGES[s.stage];
    const L = cw.layouts.get(s.id);
    const style = L ? STYLES[L.style]?.name : '';
    const tags = [];
    tags.push(s.connected ? '<span class="tag good">Road to capital</span>' : '<span class="tag bad">No road to capital</span>');
    if (s.unrest > 0) tags.push(`<span class="tag bad">Unrest ${Math.ceil(s.unrest)}s</span>`);
    if (s.siege) tags.push('<span class="tag bad">Under siege!</span>');
    if (s.full) tags.push('<span class="tag bad">No room for houses</span>');
    if (s.crowded) tags.push('<span class="tag">Needs to grow for more houses</span>');
    if (s.site?.cold) tags.push('<span class="tag">Cold: burns fuel</span>');
    const out = [];
    for (const [r, v] of Object.entries(s.out || {})) if (v > 0.001) out.push(`<span>${iconImg(RES_ICON[r], r)} ${(v * 60).toFixed(1)}/min</span>`);
    const jobs = s.jobs?.assigned || {};
    const slots = s.jobs?.slots || {};
    const work = LABOR.filter((c) => slots[c]).map((c) => `<div class="row small"><span>${LABOR_NAMES[c]}</span><span>${jobs[c] || 0}/${slots[c]}</span></div>`).join('');
    const g = s.garrison || {};
    const hasTroops = Object.values(g).some((n) => n >= 1);
    // Growth.
    let grow = '';
    let canGrow = false;
    const next = STAGES[s.stage + 1];
    const growing = (s.projects || []).some((p) => p.type === 'stage');
    if (next) {
      const up = next.up;
      const popNeed = stagePopNeed(s);
      const reqs = [`${Math.floor(s.pop)}/${popNeed} people${popNeed < up.pop ? ' (out of room)' : ''}`];
      for (const n of up.needs || []) if (!(n === 'hall' && s.capital)) reqs.push(`${s.buildings[n] ? '✓' : '✗'} ${BUILDINGS[n].name}`);
      if (up.connected) reqs.push(`${s.connected ? '✓' : '✗'} road to the capital`);
      canGrow = s.pop >= popNeed && (up.needs || []).every((n) => (n === 'hall' && s.capital) || s.buildings[n]) && (!up.connected || s.connected) && canPay(me, up.cost) && !growing;
      grow = this.sec('grow', `Grow into a ${next.name.toLowerCase()}`, `
        <div class="small muted">${reqs.join(' · ')}</div>
        <div class="row"><span class="cost">${costHtml(up.cost, me)}</span><button class="btn go small" data-act="upgrade" ${canGrow ? '' : 'disabled'}>${growing ? 'Growing…' : 'Grow'}</button></div>
        <div class="small muted">A ${next.name.toLowerCase()} claims more land (radius ${next.radius}), holds up to ${next.maxHouses} houses and ${next.maxBuild} buildings.</div>`);
    }
    // Quick actions: what a ruler does most often, without scrolling.
    const canSettle = s.stage >= 1 && s.pop >= RULES.settlerMinPop;
    const quick = `<div class="quick">
        ${next ? `<button class="btn go" data-act="upgrade" ${canGrow ? '' : 'disabled'} title="Grow into a ${next.name.toLowerCase()}">${iconImg('crown')}${growing ? 'Growing' : 'Grow'}</button>` : ''}
        <button class="btn" data-act="mode-found" ${canSettle ? '' : 'disabled'} title="${RULES.settlerPop} settlers, ${RULES.settlerCost.wood} wood, ${RULES.settlerCost.food} food">${iconImg('house')}Settlers</button>
        <button class="btn" data-act="mode-scout" title="Explore the land">${iconImg('banner')}Scouts</button>
        <button class="btn" data-act="mode-road" title="Build a road to another settlement">${iconImg('stone')}Road</button>
        <button class="btn" data-act="army" ${hasTroops ? '' : 'disabled'} title="March the garrison out as an army">${iconImg('soldier')}Army</button>
      </div>
      <div class="small muted">${canSettle ? `Settlers take ${RULES.settlerPop} people, ${RULES.settlerCost.wood} wood and ${RULES.settlerCost.food} food to explored land.` : `Settlers leave from a hamlet of at least ${RULES.settlerMinPop} people.`}</div>`;
    // Projects.
    const projectList = s.projects || [];
    const projects = projectList.map((p) => {
      const name = p.type === 'house' ? 'House' : p.type === 'stage' ? `Growing to ${STAGES[p.to].name}` : p.type === 'walls' ? WALLS[p.to].name : BUILDINGS[p.kind]?.name || p.kind;
      const pct = Math.min(100, (p.progress / p.work) * 100);
      return `<div class="row small"><span style="flex:1">${esc(name)}<div class="bar warm"><i style="width:${pct}%"></i></div></span>${p.type === 'building' || p.type === 'house' ? `<button class="btn small" data-act="cancel" data-pid="${p.id}" title="Cancel (half the materials come back)">✕</button>` : ''}</div>`;
    }).join('') || '<div class="small muted">Nothing under construction.</div>';
    // Build list: what can be built now first, the rest folded away.
    const nonHouse = Object.entries(s.buildings).reduce((a, [k, v]) => a + (BUILDINGS[k] ? v : 0), 0) + projectList.filter((p) => p.type === 'building').length;
    const now = [];
    const later = [];
    for (const [kind, def] of Object.entries(BUILDINGS)) {
      let why = '';
      const have = (s.buildings[kind] || 0) + projectList.filter((p) => p.kind === kind).length;
      if (s.stage < def.stage) why = `needs a ${STAGES[def.stage].name.toLowerCase()}`;
      else if (def.capitalOnly && !s.capital) why = 'capital only';
      else if (def.notCapital && s.capital) why = 'not in the capital';
      else if (def.once && have) why = 'already built';
      else if (def.site && !(s.site?.[def.site] > 0)) why = { iron: 'no iron vein', coal: 'no coal seam', crystal: 'no crystal geode', water: 'no water nearby', coast: 'no coast' }[def.site] || 'unsuitable land';
      else if (nonHouse >= stage.maxBuild) why = 'settlement full: grow it';
      else if (s.unrest > 0) why = 'unrest';
      if (s.stage + 1 < def.stage) continue;
      const afford = canPay(me, def.cost);
      const count = s.buildings[kind] ? ` ×${s.buildings[kind]}` : '';
      const html = `<div class="item ${why ? 'disabled' : ''}"><span class="name">${esc(def.name)}${count}</span><button class="btn small ${afford && !why ? 'go' : ''}" data-act="build" data-kind="${kind}" ${why ? 'disabled' : ''}>Build</button><span class="cost">${costHtml(def.cost, me)}</span><span class="small muted">${def.jobs ? `${def.jobs} jobs` : ''}</span><span class="desc">${esc(why ? `${why} — ${def.desc}` : def.desc)}</span></div>`;
      (why ? later : now).push(html);
    }
    const build = `<div class="list">${now.join('') || '<div class="small muted">Nothing can be built here right now.</div>'}</div>${later.length ? `<details class="later"><summary>Not available here yet (${later.length})</summary><div class="list">${later.join('')}</div></details>` : ''}`;
    // Military.
    const garrison = Object.entries(g).filter(([, n]) => n >= 0.5).map(([u, n]) => `${UNITS[u].name} ${Math.floor(n)}`).join(', ') || 'none';
    const training = (s.training || []).map((t) => `${t.n} ${UNITS[t.unit].name.toLowerCase()} (${Math.ceil(t.t)}s)`).join(', ');
    const cap = (s.buildings.barracks || 0) * 10;
    const recruit = UNIT_ORDER.map((u) => {
      const def = UNITS[u];
      const need = def.needs === 'cavalry' ? s.buildings.stables : def.needs === 'siege' ? s.buildings.siegeworks : true;
      const off = !cap || !need;
      return `<div class="item ${off ? 'disabled' : ''}"><span class="name">${def.name} <span class="small muted">atk ${def.atk} def ${def.def}</span></span><span class="stepper"><input type="number" inputmode="numeric" min="1" max="10" value="${this.recruitN[u]}" data-n="${u}" aria-label="How many"><button class="btn small" data-act="recruit" data-unit="${u}" ${off ? 'disabled' : ''}>Train</button></span><span class="cost">${costHtml(def.cost, me)} each · ${def.train}s</span><span class="small muted">upkeep ${def.food} food, ${def.coin} coin/s</span></div>`;
    }).join('');
    const military = `<div class="small">${garrison}${training ? `<br><span class="muted">Training: ${training}</span>` : ''}</div>
        <div class="small muted">${cap ? `Barracks train ${cap} at a time.` : 'Build barracks to train soldiers.'} Recruits leave their jobs at once.</div>
        <div class="list">${recruit}</div>
        <div class="btns">
          <button class="btn small" data-act="levy" title="Call up militia: fast, weak, costs workers">Levy militia</button>
          <button class="btn small" data-act="demob" ${hasTroops ? '' : 'disabled'} title="Soldiers return to work after ${RULES.demobilizeTime}s">Send soldiers home</button>
        </div>`;
    const nextWall = WALLS[s.walls.level + 1];
    const walls = `<div class="row"><span>${s.walls.level ? `${WALLS[s.walls.level].name} (${Math.round(s.walls.hp)}/${WALLS[s.walls.level].hp})` : 'No walls'}</span>${nextWall ? `<button class="btn small" data-act="walls" ${s.stage >= 1 && (!nextWall.stage || s.stage >= nextWall.stage) && canPay(me, nextWall.cost) ? '' : 'disabled'}>${s.walls.level ? 'Upgrade' : 'Build'} ${esc(nextWall.name.toLowerCase())}</button>` : ''}</div>${nextWall ? `<div class="small muted">${costHtml(nextWall.cost, me)} · defenders ×${nextWall.def}${nextWall.stage ? ` · needs a ${STAGES[nextWall.stage].name.toLowerCase()}` : ''}</div>` : ''}`;
    const soldiersHere = Object.values(g).reduce((a, n) => a + n, 0);
    return `${this.headHtml(esc(s.name), `${stage.name}${s.capital ? ' · Capital' : ''} · ${esc(style)} style`)}
      <div class="scroll">
        <div class="row"><span>${iconImg('pop')} ${Math.floor(s.pop)} / ${s.housing} people</span><span class="small muted">${s.houses || 0}/${stage.maxHouses} houses · prosperity ${Math.round((s.prosperity || 1) * 100)}%</span></div>
        <div class="bar"><i style="width:${Math.min(100, (s.pop / Math.max(1, s.housing)) * 100)}%"></i></div>
        <div style="margin-top:6px">${tags.join('')}</div>
        ${out.length ? `<div class="chips">${out.join('')}</div>` : ''}
        ${quick}
        ${grow}
        ${this.sec('construction', 'Construction', projects, projectList.length || '')}
        ${this.sec('build', 'Build', build, now.length)}
        ${this.sec('work', 'Work', `${work || '<div class="small muted">No workplaces yet.</div>'}<div class="small muted">${s.jobs?.idle || 0} idle (they forage, gather deadwood and help build)</div>`, `${s.jobs?.idle || 0} idle`)}
        ${this.sec('military', 'Garrison and recruits', military, Math.floor(soldiersHere))}
        ${this.sec('walls', 'Walls', walls)}
      </div>`;
  }

  foreignSettlementHtml(s) {
    const cw = this.cw;
    const owner = s.hub ? 'Free city (neutral)' : cw.kingdom(s.kingdom)?.name || 'Unknown';
    const atWar = !s.hub && cw.me && cw.me.relations?.[s.kingdom] === 'war';
    const prices = s.hub ? RES_KEYS.map((r) => `<tr><td>${iconImg(RES_ICON[r])} ${RESOURCES[r].name}</td><td>${cw.snap.prices[r]}</td></tr>`).join('') : '';
    const marchHow = this.touch ? 'select one of your armies, tap Move… and then this town' : 'select an army and right-click this town';
    return `${this.headHtml(esc(s.name), esc(owner), `color:${cw.colorOf(s.kingdom)}`)}
      <div class="scroll">
        <div class="row"><span>${STAGES[s.stage].name}</span><span>${Math.floor(s.pop)} people</span></div>
        <div class="row"><span>Walls</span><span>${s.walls.level ? `${WALLS[s.walls.level].name} (${Math.round(s.walls.hp)})` : 'none'}</span></div>
        ${s.hub ? '' : `<div class="row"><span>Garrison (scouts' estimate)</span><span>~${s.garrisonApprox ?? '?'}</span></div>`}
        ${s.siege ? '<div class="tag bad">Under siege</div>' : ''}
        ${s.hub ? `<h3>Market prices</h3><table class="t">${prices}</table><p class="small muted">Free cities buy and sell everything. Caravans from your markets trade here; roads and harbours shorten the journey.</p>` : ''}
        ${atWar ? `<p class="small">You are at war: ${marchHow} to besiege it. Walls must fall before the town can be taken.</p>` : ''}
      </div>`;
  }

  armyHtml(a) {
    const cw = this.cw;
    const mine = a.kid === cw.you;
    if (!mine) {
      return `${this.headHtml('Army', esc(cw.kingdom(a.kid)?.name || ''), `color:${cw.colorOf(a.kid)}`)}
        <div class="scroll"><div class="row"><span>Strength</span><span>${Math.round(a.n)}</span></div><div class="row"><span>State</span><span>${a.state}</span></div></div>`;
    }
    const units = Object.entries(a.units || {}).filter(([, n]) => n >= 0.5).map(([u, n]) => `<div class="row"><span>${UNITS[u].name}</span><span>${Math.round(n)}</span></div>`).join('');
    const near = cw.mySettlements().find((s) => Math.hypot(s.x - a.x, s.y - a.y) < 2.5);
    const state = a.state === 'siege' ? 'Besieging' : a.state === 'battle' ? 'In battle!' : a.state === 'retreat' ? 'Retreating' : a.state === 'moving' ? 'Marching' : 'Waiting';
    return `${this.headHtml('Army', state)}
      <div class="scroll">
        <div class="quick"><button class="btn go" data-act="mode-move" ${a.state === 'retreat' ? 'disabled' : ''}>${iconImg('banner')}Move…</button><button class="btn" data-act="garrison" ${near ? '' : 'disabled'}>${iconImg('house')}${near ? `Into ${esc(near.name)}` : 'Garrison'}</button></div>
        ${units}
        <h3>Morale</h3><div class="bar ${a.morale < 0.4 ? 'red' : ''}"><i style="width:${Math.round(a.morale * 100)}%"></i></div>
        <h3>Supply</h3><div class="bar ${a.inSupply ? '' : 'warm'}"><i style="width:${Math.round((a.supply / RULES.supplyCap) * 100)}%"></i></div>
        <div class="small muted">${a.inSupply ? 'In supply: fed from your stores.' : `Out of supply range (${RULES.supplyRange} tiles from your land): eating carried rations. Starving armies lose men.`}</div>
        <p class="small muted">${this.touch ? 'Tap Move… and choose a place, or long-press the map, to march.' : 'Right-click the map to march.'} Armies cannot cross the borders of kingdoms you are at peace with. Roads double speed; rivers without bridges are slow and weaken attackers.</p>
      </div>`;
  }

  // -------------------------------------------------------------------------
  // Realm tabs

  renderTab() {
    const { el, cw } = this;
    if (el.right.hidden || !cw.snap || !cw.me) return;
    if (el.right.contains(document.activeElement) && ['INPUT', 'SELECT'].includes(document.activeElement.tagName)) return;
    if (this.pressing && el.right.contains(this.pressing)) return;
    for (const b of el.tabs.querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === this.tab);
    el.rightTitle.textContent = TAB_NAMES[this.tab];
    this.updateDock();
    const html = { realm: () => this.realmHtml(), trade: () => this.tradeHtml(), diplomacy: () => this.diplomacyHtml(), chronicle: () => this.chronicleHtml() }[this.tab]();
    if (html === this.lastTab) return;
    this.lastTab = html;
    const top = el.tabBody.scrollTop;
    el.tabBody.innerHTML = html;
    el.tabBody.scrollTop = top;
  }

  realmHtml() {
    const { cw } = this;
    const me = cw.me;
    const flags = [];
    if (me.flags?.starving) flags.push('<span class="tag bad">Starving</span>');
    if (me.flags?.cold) flags.push('<span class="tag bad">Out of fuel</span>');
    if (me.flags?.noHerbs) flags.push('<span class="tag bad">No herbs</span>');
    if (me.flags?.noGoods) flags.push('<span class="tag bad">No goods</span>');
    if (me.flags?.unpaid) flags.push('<span class="tag bad">Soldiers unpaid</span>');
    const prio = LABOR.map((c) => `<span>${LABOR_NAMES[c]}</span><span class="levels">${LEVELS.map((n, i) => `<button class="${me.priorities[c] === i ? 'on' : ''}" data-act="prio" data-cat="${c}" data-level="${i}">${n}</button>`).join('')}</span>`).join('');
    const towns = cw.mySettlements().sort((a, b) => b.pop - a.pop).map((s) => `<tr data-act="goto" data-sid="${s.id}" style="cursor:pointer"><td>${s.capital ? '★ ' : ''}${esc(s.name)}</td><td>${STAGES[s.stage].name}</td><td>${Math.floor(s.pop)}</td><td>${s.connected ? '' : '<span class="bad" title="No road to the capital: deliveries lose part of their goods">⚠</span>'}</td></tr>`).join('');
    const need = me.need ? `food ${(me.need.food * 60).toFixed(0)}, fuel ${(me.need.fuel * 60).toFixed(0)}, herbs ${(me.need.herbs * 60).toFixed(1)}, goods ${(me.need.goods * 60).toFixed(1)} per minute` : '';
    return `<h3>${esc(me.name)}</h3>
      <div class="grid2 small"><span>Population</span><b>${me.stats.pop}</b><span>Soldiers</span><b>${me.stats.soldiers}</b><span>Settlements</span><b>${me.stats.settlements}</b><span>Score</span><b>${me.score}</b></div>
      <div style="margin-top:6px">${flags.join('')}</div>
      ${need ? `<div class="small muted">Your people consume ${need}.</div>` : ''}
      ${me.wonderHeld > 0 ? `<div class="tag good">Grand Exchange held ${Math.floor(me.wonderHeld)}/${RULES.wonderHold}s</div>` : ''}
      ${me.domHeld > 0 ? `<div class="tag good">Dominating the realm ${Math.floor(me.domHeld)}/${RULES.dominationHold}s</div>` : ''}
      <h3>Labour priorities</h3>
      <div class="prio small">${prio}</div>
      <div class="small muted">Workers fill the jobs of high-priority work first. Building covers houses, projects and roads.</div>
      <h3>Settlements</h3>
      <table class="t"><tr><th>Name</th><th>Stage</th><th>Pop</th><th></th></tr>${towns}</table>`;
  }

  tradeHtml() {
    const { cw } = this;
    const me = cw.me;
    const snap = cw.snap;
    const prices = RES_KEYS.map((r) => {
      const p = snap.prices[r];
      const base = RESOURCES[r].price;
      const trend = p > base * 1.08 ? '<span class="bad">▲</span>' : p < base * 0.92 ? '<span class="good">▼</span>' : '';
      return `<tr><td>${iconImg(RES_ICON[r])} ${RESOURCES[r].name}</td><td>${p.toFixed(2)} ${trend}</td><td class="muted">${Math.floor(me.stock[r] || 0)}</td></tr>`;
    }).join('');
    const markets = cw.mySettlements().filter((s) => s.buildings.market || s.buildings.harbor);
    const caravans = snap.parties.filter((p) => p.kid === cw.you && p.kind === 'caravan').length;
    const slots = cw.mySettlements().reduce((a, s) => a + (s.buildings.market || 0) * 2 + (s.buildings.harbor || 0), 0);
    const orders = (me.orders || []).map((o) => `<div class="row small"><span>${o.side === 'sell' ? 'Sell' : 'Buy'} ${o.amount} ${o.res} when ${o.side === 'sell' ? `stock > ${o.keep} and price ≥ ${o.limit}` : `stock < ${o.keep} and price ≤ ${o.limit}`}</span><button class="btn small" data-act="cancel-order" data-oid="${o.id}">✕</button></div>`).join('') || '<div class="small muted">No standing orders.</div>';
    const ags = (snap.agreements || []).map((a) => {
      const other = cw.kingdom(a.a === cw.you ? a.b : a.a);
      const give = a.a === cw.you ? a.give : a.get;
      const get = a.a === cw.you ? a.get : a.give;
      return `<div class="small">With ${esc(other?.name)}: you give ${give.n} ${give.res}, get ${get.n} ${get.res} every ${a.every}s (${a.left} left)</div>`;
    }).join('') || '<div class="small muted">None.</div>';
    const incoming = (snap.proposals || []).filter((p) => p.to === cw.you && !p.peace).map((p) => `<div class="item"><span>${esc(cw.kingdom(p.from)?.name)} offers ${p.give.n} ${p.give.res} for your ${p.get.n} ${p.get.res}, ${p.times}× every ${p.every}s</span><span><button class="btn small go" data-act="respond" data-id="${p.id}" data-accept="1">Accept</button> <button class="btn small" data-act="respond" data-id="${p.id}" data-accept="0">No</button></span></div>`).join('');
    const resSel = this.fv('res', 'food');
    const opt = RES_KEYS.map((r) => `<option value="${r}" ${r === resSel ? 'selected' : ''}>${RESOURCES[r].name}</option>`).join('');
    const side = this.fv('side', 'sell');
    return `<h3>Free-city market</h3><table class="t"><tr><th>Good</th><th>Price</th><th>You have</th></tr>${prices}</table>
      <div class="small muted">Prices follow supply and demand at the free cities: selling a lot lowers the price, buying raises it. Caravans pay ${RULES.caravanCostPerTile} coin per tile each way and take time to travel; markets (2 caravans) and harbours (1, by sea) set your capacity.</div>
      <h3>Standing orders</h3>
      <div class="small">${markets.length ? `Caravans: ${caravans}/${slots}` : '<span class="bad">Build a market to trade.</span>'}</div>
      ${orders}
      <div class="form-grid">
        <span>Order</span><span class="propose"><select data-f="side"><option value="sell" ${side === 'sell' ? 'selected' : ''}>Sell</option><option value="buy" ${side === 'buy' ? 'selected' : ''}>Buy</option></select><input data-f="amount" type="number" inputmode="numeric" value="${esc(this.fv('amount', 40))}" min="1" max="200"><select data-f="res">${opt}</select></span>
        <span>${side === 'sell' ? 'While stock above' : 'While stock below'}</span><input data-f="keep" type="number" inputmode="numeric" value="${esc(this.fv('keep', 200))}">
        <span>${side === 'sell' ? 'At a price of at least' : 'At a price of at most'}</span><input data-f="limit" type="number" inputmode="decimal" step="0.1" value="${esc(this.fv('limit', 2))}">
        <span class="wide"><button class="btn small go" data-act="add-order" ${markets.length ? '' : 'disabled'}>Add standing order</button></span>
      </div>
      <h3>Agreements</h3>${ags}
      ${incoming ? `<h3>Proposals for you</h3>${incoming}` : ''}`;
  }

  diplomacyHtml() {
    const { cw } = this;
    const me = cw.me;
    const rows = cw.snap.kingdoms.filter((k) => k.id !== cw.you).map((k) => {
      const rel = me.relations?.[k.id] || 'peace';
      return `<div class="item"><span class="name" style="color:${k.color}">${esc(k.name)}${k.ai ? ` <span class="small muted">(${k.personality} AI)</span>` : ''}${k.alive ? '' : ' <span class="tag">fallen</span>'}</span><span class="tag ${rel === 'war' ? 'bad' : 'good'}">${rel}</span>
        <span class="small muted">pop ${k.stats?.pop ?? '?'} · soldiers ${k.stats?.soldiers ?? '?'} · towns ${k.stats?.settlements ?? '?'} · score ${k.score}</span>
        <span>${!k.alive ? '' : rel === 'war' ? `<button class="btn small" data-act="peace" data-to="${k.id}">Offer peace</button>` : `<button class="btn small primary" data-act="war" data-to="${k.id}">Declare war</button>`}</span>
        ${k.alive && rel !== 'war' ? `<span class="desc propose">Trade: give <input data-f="gn-${k.id}" type="number" inputmode="numeric" value="${esc(this.fv(`gn-${k.id}`, 20))}" aria-label="Amount to give"><select data-f="give-${k.id}">${RES_KEYS.map((r) => `<option ${r === this.fv(`give-${k.id}`, 'food') ? 'selected' : ''}>${r}</option>`).join('')}</select> for <input data-f="tn-${k.id}" type="number" inputmode="numeric" value="${esc(this.fv(`tn-${k.id}`, 20))}" aria-label="Amount to get"><select data-f="get-${k.id}">${RES_KEYS.map((r) => `<option ${r === this.fv(`get-${k.id}`, 'wood') ? 'selected' : ''}>${r}</option>`).join('')}</select> ×10, every 30s <button class="btn small" data-act="propose" data-to="${k.id}">Propose</button></span>` : ''}</div>`;
    }).join('');
    const peace = (cw.snap.proposals || []).filter((p) => p.peace && p.to === cw.you).map((p) => `<div class="item"><span>${esc(cw.kingdom(p.from)?.name)} offers peace</span><span><button class="btn small go" data-act="answer-peace" data-id="${p.id}" data-accept="1">Accept</button> <button class="btn small" data-act="answer-peace" data-id="${p.id}" data-accept="0">Refuse</button></span></div>`).join('');
    return `${peace ? `<h3>Peace offers</h3>${peace}` : ''}<h3>Kingdoms</h3><div class="list">${rows}</div>
      <div class="small muted">At peace, borders are closed to armies. War opens them, stops agreements and lets armies seize caravans. Victory: conquer every rival, hold two thirds of all towns and 60% of all people for ${RULES.dominationHold / 60} minutes, or build the Grand Exchange in a city and hold it for ${RULES.wonderHold / 60} minutes. Otherwise the best score wins when time runs out.</div>`;
  }

  chronicleHtml() {
    const evs = this.cw.events.slice(-120).reverse();
    return `${evs.map((e) => `<div class="small" ${e.x != null ? `data-act="goto-xy" data-x="${e.x}" data-y="${e.y}" style="cursor:pointer"` : ''}><span class="muted">${clock(e.t)}</span> ${esc(e.text)}</div>`).join('') || '<div class="muted">Nothing yet.</div>'}`;
  }

  // -------------------------------------------------------------------------
  // Placement

  renderPlacement(snap) {
    const { el, cw } = this;
    if (el.placement.hidden) {
      el.placement.hidden = false;
      el.placement.innerHTML = `<div class="head" data-grip><span class="grip" aria-hidden="true"></span><h2>Found your realm</h2><div class="sub muted small">Choose where to build your capital. Every site trades one strength for another. ${this.tapWord} the map to survey any spot.</div></div><div class="scroll"></div>`;
      this.applyPanels();
    }
    const body = el.placement.querySelector('.scroll');
    if (body.contains(document.activeElement)) return;
    if (this.pressing && el.placement.contains(this.pressing)) return;
    const sites = cw.init.startSites.map((s, k) => `<div class="site ${this.placingSite && this.placingSite.x === s.x && this.placingSite.y === s.y ? 'on' : ''}" data-act="site" data-k="${k}"><div class="title">${esc(s.title)}</div><div class="small">${esc(s.blurb)}</div><div>${s.pros.map((p) => `<span class="tag good">${esc(p)}</span>`).join('')}${s.cons.map((p) => `<span class="tag bad">${esc(p)}</span>`).join('')}</div></div>`).join('');
    const p = this.placingSite;
    let survey = '';
    if (p) {
      const err = this.placementError(p.x, p.y);
      const a = analyzeSite(cw.world, p.x, p.y);
      const d = describeSite(a);
      const biome = BIOMES[cw.world.biome[p.y * cw.W + p.x]].name;
      survey = `<div class="survey"><div class="row"><b>${esc(d.title)}</b><span class="small muted">${esc(biome)} · ${p.x}, ${p.y}</span></div><div>${d.pros.map((x) => `<span class="tag good">${esc(x)}</span>`).join('')}${d.cons.map((x) => `<span class="tag bad">${esc(x)}</span>`).join('')}</div>
        ${err ? `<div class="bad small">${esc(err)}</div>` : ''}
        <div class="btns"><button class="btn primary" style="flex:1" data-act="place" ${err ? 'disabled' : ''}>Found the capital here</button></div></div>`;
    }
    const taken = snap.kingdoms.filter((k) => k.placed).length;
    const html = `${survey}<h3>Suggested sites</h3>${sites}<div class="small muted">${taken} of ${snap.kingdoms.length} realms placed${this.single ? '. Rivals choose after you.' : '.'}</div>`;
    if (html !== this.lastPlacement) {
      body.innerHTML = html;
      this.lastPlacement = html;
    }
  }

  placementError(x, y) {
    const cw = this.cw;
    if (!canFoundAt(cw.world, x, y)) return 'Cannot settle on that terrain.';
    for (const s of cw.snap?.settlements || []) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (s.hub && d < 26) return 'Too close to a free city.';
      if (!s.hub && d < 20) return 'Too close to another kingdom.';
    }
    const a = analyzeSite(cw.world, x, y, { r: 7 });
    if (a.buildable < 50) return 'Not enough buildable land for a capital.';
    return null;
  }

  // -------------------------------------------------------------------------
  // Action modes

  setMode(mode) {
    this.mode = mode;
    this.r.mode = mode;
    this.r.preview = null;
    this.pendingTap = null;
    this.r.canvas.classList.toggle('targeting', !!mode);
    this.el.tip.hidden = true;
    this.applyPanels();
    this.renderHint();
  }

  /** The prompt shown while choosing a target; on touch screens it also confirms. */
  renderHint() {
    const { el } = this;
    const m = this.mode;
    if (!m) {
      el.hint.hidden = true;
      return;
    }
    const tap = this.tapWord;
    const ask = {
      found: `${tap} explored land to send settlers there.`,
      scout: `${tap} where the scouts should explore.`,
      road: `${tap} the settlement or free city the road should reach.`,
      move: `${tap} where the army should march.`,
    }[m.kind];
    const confirm = { found: 'Send settlers', scout: 'Send scouts', road: 'Build the road', move: 'March' }[m.kind];
    const p = this.pendingTap;
    const text = p ? p.html : `${ask}${this.touch ? ' You can check the spot before confirming.' : ' Esc cancels.'}`;
    el.hint.innerHTML = `<div class="hint-text">${text}</div><div class="hint-btns">${p ? `<button class="btn go" data-hint="confirm" ${p.ok ? '' : 'disabled'}>${confirm}</button>` : ''}<button class="btn" data-hint="cancel">Cancel</button></div>`;
    el.hint.hidden = false;
  }

  /** Carry out the active map order at tile t. */
  runMode(t) {
    const cw = this.cw;
    const m = this.mode;
    const x = Math.floor(t.x);
    const y = Math.floor(t.y);
    if (m.kind === 'found') this.send({ type: 'found', sid: m.sid, x, y });
    else if (m.kind === 'scout') this.send({ type: 'scout', sid: m.sid, x, y });
    else if (m.kind === 'road') {
      const s = cw.settlementAt(t.x, t.y);
      if (!s) return;
      this.send({ type: 'road', a: m.sid, b: s.id });
    } else if (m.kind === 'move') this.moveArmyTo(m.aid, t);
    this.setMode(null);
  }

  hoverTile(t) {
    const cw = this.cw;
    const x = Math.floor(t.x);
    const y = Math.floor(t.y);
    this.r.hoverTile = { x, y };
    const m = this.mode;
    if (!m) return null;
    if (m.kind === 'found') {
      const src = cw.settlement(m.sid);
      let err = null;
      if (!cw.isExplored(x, y)) err = 'Unexplored land';
      else if (!canFoundAt(cw.world, x, y)) err = 'Unsuitable terrain';
      else {
        const k = cw.ownerK[y * cw.W + x];
        if (k >= 0 && k !== cw.you) err = 'Another kingdom’s land';
        for (const s of cw.snap.settlements) if (Math.hypot(s.x - x, s.y - y) < (s.hub ? 14 : RULES.minSettlementGap)) err = `Too close to ${s.name}`;
      }
      this.r.preview = { x, y, ok: !err, radius: STAGES[0].radius, line: src };
      if (err) return `<b class="bad">${esc(err)}</b>`;
      const a = analyzeSite(cw.world, x, y, { r: 7, knownDeposit: (i) => cw.explored[i] });
      const d = describeSite(a);
      return `<b>${esc(d.title)}</b><br>${d.pros.map((p) => `<span class="tag good">${esc(p)}</span>`).join('')}${d.cons.map((p) => `<span class="tag bad">${esc(p)}</span>`).join('')}<br><span class="small muted">Distance ${Math.round(Math.hypot(src.x - x, src.y - y))} tiles from ${esc(src.name)}</span>`;
    }
    if (m.kind === 'road') {
      const s = cw.settlementAt(t.x, t.y);
      const src = cw.settlement(m.sid);
      this.r.preview = { x, y, ok: !!s && s.id !== m.sid && (s.kingdom === cw.you || s.hub), line: src };
      return s ? `Road from ${esc(src.name)} to <b>${esc(s.name)}</b> (${Math.round(Math.hypot(s.x - src.x, s.y - src.y))} tiles as the crow flies). Bridges cost stone.` : 'Choose a settlement';
    }
    if (m.kind === 'scout' || m.kind === 'move') {
      const from = m.kind === 'scout' ? cw.settlement(m.sid) : cw.army(m.aid);
      this.r.preview = { x, y, ok: true, line: from };
      return null;
    }
    return null;
  }

  clickTile(t, button = 0, touch = false) {
    const cw = this.cw;
    const x = Math.floor(t.x);
    const y = Math.floor(t.y);
    if (cw.snap?.phase === 'placement' && cw.me && !cw.me.placed) {
      this.placingSite = { x, y };
      this.r.preview = { x, y, ok: !this.placementError(x, y), radius: STAGES[1].radius };
      this.renderPlacement(cw.snap);
      this.ensureVisible(x, y);
      return;
    }
    const m = this.mode;
    if (m) {
      if (!touch) return this.runMode(t);
      // Touch: the first tap shows what would happen, a second tap (or Confirm) does it.
      const same = this.pendingTap && this.pendingTap.x === x && this.pendingTap.y === y;
      if (same && this.pendingTap.ok) return this.runMode(t);
      const info = this.hoverTile(t);
      const ok = this.r.preview ? this.r.preview.ok !== false : true;
      const fallback = { scout: `Scouts will explore around ${x}, ${y}.`, move: `March to ${x}, ${y}.`, road: 'Choose a settlement or free city.', found: '' }[m.kind];
      this.pendingTap = { x, y, t, ok: m.kind === 'road' ? ok && !!cw.settlementAt(t.x, t.y) : ok, html: info || fallback };
      this.renderHint();
      return;
    }
    if (button === 2) {
      const sel = this.r.selection;
      if (sel && sel.type === 'army' && cw.army(sel.id)?.kid === cw.you) this.moveArmyTo(sel.id, t);
      return;
    }
    const a = cw.armyAt(t.x - 0.5, t.y - 0.5);
    if (a) {
      this.select({ type: 'army', id: a.id });
      requestAnimationFrame(() => this.ensureVisible(a.x, a.y));
      return;
    }
    const s = cw.settlementAt(t.x, t.y);
    if (s) {
      this.select({ type: 'settlement', id: s.id });
      requestAnimationFrame(() => this.ensureVisible(s.x, s.y));
      return;
    }
    this.select(null);
    // On a phone, tapping open ground clears the screen for the map.
    if (this.compact && this.sheet) {
      this.sheet = null;
      this.applyPanels();
    }
  }

  /** Touch long-press: march the selected army there, like a right-click. */
  longPress(t) {
    const cw = this.cw;
    if (this.mode || cw.snap?.phase !== 'running') return;
    const sel = this.r.selection;
    if (sel && sel.type === 'army' && cw.army(sel.id)?.kid === cw.you) {
      navigator.vibrate?.(12);
      this.moveArmyTo(sel.id, t);
      this.toast('The army marches.', 'info');
    }
  }

  moveArmyTo(aid, t) {
    const s = this.cw.settlementAt(t.x, t.y);
    const x = s ? s.x : Math.floor(t.x);
    const y = s ? s.y : Math.floor(t.y);
    this.send({ type: 'move', aid, x, y });
  }

  // -------------------------------------------------------------------------
  // Wiring

  bindPanels() {
    const { el } = this;
    const on = (target, ev, fn) => {
      target.addEventListener(ev, fn);
      (this.listeners ||= []).push([target, [ev, fn]]);
    };
    on(el.left, 'click', (e) => this.panelClick(e, el.left));
    on(el.tabBody, 'click', (e) => this.panelClick(e, el.tabBody));
    on(el.placement, 'click', (e) => this.panelClick(e, el.placement));
    on(el.tabs, 'click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.tab = b.dataset.tab;
      this.renderTab();
    });
    on(el.speed, 'click', (e) => {
      const b = e.target.closest('button');
      if (b) this.setSpeed(Number(b.dataset.speed));
    });
    on(el.mini, 'click', (e) => {
      const rect = el.mini.getBoundingClientRect();
      this.r.centerOn(((e.clientX - rect.left) / rect.width) * this.cw.W, ((e.clientY - rect.top) / rect.height) * this.cw.H);
    });
    on(document.getElementById('btn-menu'), 'click', () => this.onQuit('menu'));
    on(document.body, 'mousemove', (e) => {
      const tipEl = e.target.closest?.('[data-tip]');
      if (tipEl && !e.target.closest('#view')) this.showTip(tipEl.dataset.tip, e.clientX, e.clientY, false);
      else if (!e.target.closest?.('#view')) this.el.tip.hidden = true;
    });
    // Touch screens have no hover: a tap on a resource shows its details briefly.
    on(document.body, 'click', (e) => {
      if (!this.touch) return;
      const tipEl = e.target.closest?.('[data-tip]');
      if (!tipEl) return;
      const r = tipEl.getBoundingClientRect();
      this.showTip(tipEl.dataset.tip, r.left, r.bottom + 6, false, 0);
      clearTimeout(this.tipTimer);
      this.tipTimer = setTimeout(() => {
        this.el.tip.hidden = true;
      }, 2600);
    });
    on(el.dock, 'click', (e) => {
      const b = e.target.closest('[data-dock]');
      if (b) this.dockTap(b.dataset.dock);
    });
    on(el.right, 'click', (e) => {
      if (!e.target.closest('[data-sheet-close]')) return;
      this.sheet = null;
      this.applyPanels();
    });
    on(el.hint, 'click', (e) => {
      const b = e.target.closest('[data-hint]');
      if (!b || b.disabled) return;
      if (b.dataset.hint === 'cancel') this.setMode(null);
      else if (this.pendingTap) this.runMode(this.pendingTap.t);
    });
    // Sections remember whether they are open.
    for (const root of [el.left, el.tabBody]) {
      on(root, 'toggle', (e) => {
        const k = e.target.dataset?.sec;
        if (!k || this.secOpen[k] === e.target.open) return;
        this.secOpen[k] = e.target.open;
        try {
          localStorage.setItem('realmwright:sections', JSON.stringify(this.secOpen));
        } catch {
          // storage unavailable: the choice lasts for this session
        }
      });
    }
    // Form values survive redraws.
    for (const root of [el.left, el.tabBody]) {
      const keep = (e) => {
        const d = e.target.dataset || {};
        if (d.f) this.formVals[d.f] = e.target.value;
        if (d.n) this.recruitN[d.n] = Math.max(1, Math.min(10, Number(e.target.value) || 1));
        if (d.f === 'side') {
          this.lastPanel = 0;
          setTimeout(() => this.renderTab(), 0);
        }
      };
      on(root, 'input', keep);
      on(root, 'change', keep);
    }
    // Remember which element a finger or mouse is pressing, so redraws wait for the click.
    for (const panel of [el.left, el.right, el.placement]) {
      on(panel, 'pointerdown', (e) => {
        this.pressing = e.target;
      });
    }
    const unpress = () => setTimeout(() => {
      this.pressing = null;
    }, 0);
    on(window, 'pointerup', unpress);
    on(window, 'pointercancel', unpress);
    // Sheet handles: drag up to expand, down to shrink or close, tap to toggle.
    for (const panel of [el.left, el.right, el.placement]) {
      on(panel, 'pointerdown', (e) => {
        if (!this.compact || !e.target.closest('[data-grip]') || e.target.closest('button')) return;
        if (window.matchMedia('(max-height: 500px) and (orientation: landscape)').matches) return;
        this.grip = { y: e.clientY, panel };
      });
    }
    on(window, 'pointerup', (e) => {
      const g = this.grip;
      this.grip = null;
      if (!g) return;
      const dy = e.clientY - g.y;
      if (Math.abs(dy) < 8) this.full = !this.full;
      else if (dy < -40) this.full = true;
      else if (dy > 40) {
        if (this.full) this.full = false;
        else if (g.panel === el.left) this.select(null);
        else if (g.panel === el.right) this.sheet = null;
      }
      this.applyPanels();
    });
  }

  setSpeed(v) {
    if (!this.single) return;
    this.speed = v;
    this.tx.setSpeed(v);
    if (this.cw.snap) this.renderTop(this.cw.snap);
  }

  showTip(html, x, y, isHtml = true, offset = 16) {
    const tip = this.el.tip;
    if (!html) {
      tip.hidden = true;
      return;
    }
    if (isHtml) tip.innerHTML = html;
    else tip.textContent = html;
    tip.hidden = false;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x + offset))}px`;
    tip.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, y + offset))}px`;
  }

  panelClick(e, root) {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const cw = this.cw;
    const sel = this.r.selection;
    const sid = sel && sel.type === 'settlement' ? sel.id : null;
    const d = b.dataset;
    const val = (f) => root.querySelector(`[data-f="${f}"]`)?.value;
    switch (d.act) {
      case 'close':
        this.select(null);
        break;
      case 'build':
        this.send({ type: 'build', sid, kind: d.kind });
        break;
      case 'cancel':
        this.send({ type: 'cancel', sid, pid: Number(d.pid) });
        break;
      case 'upgrade':
        this.send({ type: 'upgrade', sid });
        break;
      case 'walls':
        this.send({ type: 'walls', sid });
        break;
      case 'recruit': {
        const n = Number(root.querySelector(`[data-n="${d.unit}"]`)?.value || 1);
        this.send({ type: 'recruit', sid, unit: d.unit, n });
        break;
      }
      case 'levy':
        this.send({ type: 'levy', sid });
        break;
      case 'army':
        this.send({ type: 'formArmy', sid });
        this.toast(this.touch ? 'An army musters outside the town. Tap it, then Move…, to march.' : 'An army musters outside the town. Select it and right-click to march.', 'info');
        break;
      case 'demob': {
        const s = cw.settlement(sid);
        for (const [u, n] of Object.entries(s.garrison || {})) if (n >= 1) this.send({ type: 'demobilize', sid, unit: u, n: Math.floor(n) });
        break;
      }
      case 'mode-found':
        this.setMode({ kind: 'found', sid });
        break;
      case 'mode-scout':
        this.setMode({ kind: 'scout', sid });
        break;
      case 'mode-road':
        this.setMode({ kind: 'road', sid });
        break;
      case 'mode-move':
        this.setMode({ kind: 'move', aid: sel.id });
        break;
      case 'garrison':
        this.send({ type: 'garrison', aid: sel.id });
        this.select(null);
        break;
      case 'prio':
        this.send({ type: 'priority', cat: d.cat, level: Number(d.level) });
        if (cw.me) cw.me.priorities[d.cat] = Number(d.level);
        this.renderTab();
        break;
      case 'goto': {
        const s = cw.settlement(Number(d.sid));
        if (s) {
          this.select({ type: 'settlement', id: s.id });
          this.focusOn(s.x, s.y, Math.max(this.r.cam.ppt, 16));
        }
        break;
      }
      case 'goto-xy':
        if (this.compact) {
          this.sheet = null;
          this.applyPanels();
        }
        this.focusOn(Number(d.x), Number(d.y), Math.max(this.r.cam.ppt, 16));
        break;
      case 'add-order':
        this.send({ type: 'order', side: val('side'), res: val('res'), amount: Number(val('amount')), keep: Number(val('keep')), limit: Number(val('limit')) });
        break;
      case 'cancel-order':
        this.send({ type: 'cancelOrder', oid: Number(d.oid) });
        break;
      case 'respond':
        this.send({ type: 'respond', id: Number(d.id), accept: d.accept === '1' });
        break;
      case 'answer-peace':
        this.send({ type: 'answerPeace', id: Number(d.id), accept: d.accept === '1' });
        break;
      case 'war':
        if (window.confirm(`Declare war on ${cw.kingdom(Number(d.to))?.name}?`)) this.send({ type: 'declareWar', to: Number(d.to) });
        break;
      case 'peace':
        this.send({ type: 'offerPeace', to: Number(d.to) });
        break;
      case 'propose': {
        const k = d.to;
        this.send({ type: 'propose', to: Number(k), give: { res: val(`give-${k}`), n: Number(val(`gn-${k}`)) }, get: { res: val(`get-${k}`), n: Number(val(`tn-${k}`)) }, every: 30, times: 10 });
        this.toast('Proposal sent.', 'info');
        break;
      }
      case 'site': {
        const s = cw.init.startSites[Number(d.k)];
        this.placingSite = { x: s.x, y: s.y };
        this.focusOn(s.x, s.y, 8);
        this.r.preview = { x: s.x, y: s.y, ok: !this.placementError(s.x, s.y), radius: STAGES[1].radius };
        this.renderPlacement(cw.snap);
        break;
      }
      case 'place':
        if (this.placingSite) this.send({ type: 'place', x: this.placingSite.x, y: this.placingSite.y });
        break;
      default:
        break;
    }
    // Snappier panels after an action.
    setTimeout(() => {
      this.lastPanel = 0;
    }, 60);
  }

  bindInput() {
    const canvas = this.r.canvas;
    let drag = null;
    const on = (target, ev, fn, opts) => {
      target.addEventListener(ev, fn, opts);
      (this.listeners ||= []).push([target, [ev, fn], opts]);
    };
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
    on(canvas, 'pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        drag = { x: e.clientX, y: e.clientY, cx: this.r.cam.x, cy: this.r.cam.y, moved: false, button: e.button, touch: e.pointerType === 'touch', long: false };
        if (drag.touch) {
          const at = this.r.screenToTile(e.clientX, e.clientY);
          drag.longTimer = setTimeout(() => {
            if (!drag || drag.moved) return;
            drag.long = true;
            this.longPress(at);
          }, 520);
        }
      } else if (pts.size === 2) {
        clearLong();
        if (drag) drag.moved = true; // a second finger means no tap
        pinch = twoFinger();
      }
    });
    on(canvas, 'pointermove', (e) => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size >= 2) {
        const now = twoFinger();
        this.r.cam.x -= (now.x - pinch.x) / this.r.cam.ppt;
        this.r.cam.y -= (now.y - pinch.y) / this.r.cam.ppt;
        const ratio = now.d / Math.max(1, pinch.d);
        if (ratio > 1.3) {
          this.r.zoomAt(now.x, now.y, 1);
          pinch.d = now.d;
        } else if (ratio < 0.77) {
          this.r.zoomAt(now.x, now.y, -1);
          pinch.d = now.d;
        }
        pinch.x = now.x;
        pinch.y = now.y;
        this.r.clampCam();
        return;
      }
      if (drag && (drag.button === 0 || drag.button === 1)) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > (drag.touch ? 10 : 5)) {
          drag.moved = true;
          clearLong();
        }
        if (drag.moved) {
          canvas.classList.add('dragging');
          this.r.cam.x = drag.cx - dx / this.r.cam.ppt;
          this.r.cam.y = drag.cy - dy / this.r.cam.ppt;
          this.r.clampCam();
        }
      }
      if (e.pointerType !== 'mouse') return; // hover information needs a mouse
      const t = this.r.screenToTile(e.clientX, e.clientY);
      const tip = this.hoverTile(t);
      if (tip) this.showTip(tip, e.clientX, e.clientY);
      else {
        const s = this.cw.settlementAt(t.x, t.y);
        const a = this.cw.armyAt(t.x - 0.5, t.y - 0.5);
        if (a) this.showTip(`Army of <b>${esc(this.cw.kingdom(a.kid)?.name)}</b>: ${Math.round(a.n)} soldiers`, e.clientX, e.clientY);
        else if (s && this.r.cam.ppt < 16) this.showTip(`<b>${esc(s.name)}</b> · ${STAGES[s.stage].name} · ${Math.floor(s.pop)} people`, e.clientX, e.clientY);
        else this.el.tip.hidden = true;
      }
    });
    const release = (e, cancelled) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size > 0) return;
      canvas.classList.remove('dragging');
      const d = drag;
      clearLong();
      drag = null;
      if (cancelled || !d || d.moved || d.long) return;
      const t = this.r.screenToTile(e.clientX, e.clientY);
      // Double tap zooms in where the finger is.
      if (d.touch && lastTap && performance.now() - lastTap.at < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30 && !this.mode) {
        lastTap = null;
        this.r.zoomAt(e.clientX, e.clientY, 1);
        return;
      }
      lastTap = d.touch ? { at: performance.now(), x: e.clientX, y: e.clientY } : null;
      this.clickTile(t, d.button, d.touch);
    };
    on(canvas, 'pointerup', (e) => release(e, false));
    on(canvas, 'pointercancel', (e) => release(e, true));
    on(canvas, 'pointerleave', () => {
      this.el.tip.hidden = true;
    });
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'wheel', (e) => {
      e.preventDefault();
      this.r.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    on(window, 'keydown', (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === 'escape') {
        if (this.mode) this.setMode(null);
        else if (this.compact && this.sheet === 'tab') {
          this.sheet = null;
          this.applyPanels();
        }
        else if (this.r.selection) this.select(null);
        else this.onQuit('menu');
      } else if (k === ' ' && this.single) {
        e.preventDefault();
        this.setSpeed(this.speed === 0 ? 1 : 0);
      } else if (k === '1' || k === '2' || k === '3') this.setSpeed([1, 2, 4][Number(k) - 1]);
      else if (k === '+' || k === '=') this.r.zoomAt(this.r.vw / 2, this.r.vh / 2, 1);
      else if (k === '-') this.r.zoomAt(this.r.vw / 2, this.r.vh / 2, -1);
      else if (k === 'h') {
        const cap = this.cw.me && this.cw.settlement(this.cw.me.capital);
        if (cap) {
          this.r.centerOn(cap.x, cap.y, Math.max(16, this.r.cam.ppt));
          this.select({ type: 'settlement', id: cap.id });
        }
      }
    });
    on(window, 'keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    on(window, 'resize', () => this.r.resize());
  }

  /** Called every animation frame. */
  update(dt) {
    const k = this.keys;
    const speed = (600 / this.r.cam.ppt) * dt;
    if (k.has('w') || k.has('arrowup')) this.r.cam.y -= speed;
    if (k.has('s') || k.has('arrowdown')) this.r.cam.y += speed;
    if (k.has('a') || k.has('arrowleft')) this.r.cam.x -= speed;
    if (k.has('d') || k.has('arrowright')) this.r.cam.x += speed;
    this.r.clampCam();
  }

  showEnd(snap) {
    const cw = this.cw;
    const w = snap.winner;
    const k = cw.kingdom(w.kid);
    const how = { conquest: 'by conquest', domination: 'by dominating the realm', prosperity: 'by prosperity: the Grand Exchange stood', score: 'by score when time ran out' }[w.how];
    const rows = [...snap.kingdoms].sort((a, b) => b.score - a.score).map((q) => `<tr><td style="color:${q.color}">${esc(q.name)}</td><td>${q.score}</td><td>${q.stats?.pop ?? ''}</td><td>${q.stats?.settlements ?? ''}</td></tr>`).join('');
    const won = w.kid === cw.you;
    this.onQuit('end', `<h2>${won ? 'Victory!' : `${esc(k?.name)} prevails`}</h2><p>${esc(k?.name)} wins ${how}.</p><table class="t"><tr><th>Realm</th><th>Score</th><th>People</th><th>Towns</th></tr>${rows}</table>`);
  }
}

