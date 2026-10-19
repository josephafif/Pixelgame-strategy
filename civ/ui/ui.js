// The panels round the map: the clock and speeds, the realms list, the
// chronicle, the inspector (towns, realms, armies), leading a realm, the
// powers of fate, map modes, history charts and the menu.

import { ERAS, TECHS, available } from '../../engine/civ/tech.js';
import { GOV } from '../../engine/civ/names.js';
import { yearText } from '../../engine/civ/sim.js';
import { drawChart } from './charts.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function fmt(n) {
  n = Math.round(n);
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

const ICONS = { era: '✦', war: '⚔', peace: '🕊', capture: '🏰', battle: '⚔', fall: '☠', collapse: '💔', revolt: '🔥', faith: '✝', plague: '☣', drought: '☀', quake: '⛰', volcano: '🌋', fire: '🔥', golden: '✨', found: '⌂', people: '⛺', gov: '♛', ally: '🤝', build: '🏛', walls: '🧱', bounty: '🌾', gift: '🎁' };
const MAJOR = new Set(['war', 'peace', 'capture', 'fall', 'collapse', 'revolt', 'faith', 'plague', 'volcano', 'golden', 'people', 'gov', 'battle']);

const FATE = [
  { key: 'spawn', icon: '⛺', name: 'New people', hint: 'Tap empty land to settle a new people there.' },
  { key: 'plague', icon: '☣', name: 'Plague', hint: 'Tap a town to send a plague.' },
  { key: 'drought', icon: '☀', name: 'Drought', hint: 'Tap the land to wither its harvests for years.' },
  { key: 'quake', icon: '⛰', name: 'Earthquake', hint: 'Tap where the earth should shake.' },
  { key: 'eruption', icon: '🌋', name: 'Eruption', hint: 'Tap where a volcano should erupt.' },
  { key: 'fire', icon: '🔥', name: 'Great fire', hint: 'Tap a town to set it ablaze.' },
  { key: 'bounty', icon: '🌾', name: 'Rich harvest', hint: 'Tap a town for a bountiful harvest.' },
  { key: 'grow', icon: '👪', name: 'Boom', hint: 'Tap a town: half as many people again.' },
  { key: 'golden', icon: '✨', name: 'Golden age', hint: 'Tap a realm to begin its golden age.' },
  { key: 'rebel', icon: '🔥', name: 'Rebellion', hint: 'Tap a town to make it break away.' },
  { key: 'give', icon: '🎁', name: 'Hand over', hint: 'Tap a town, then choose who gets it.' },
  { key: 'teach', icon: '📖', name: 'Teach', hint: 'Tap a realm, then choose what it learns.' },
];

export class UI {
  constructor(app) {
    this.app = app;
    this.m = app.mirror;
    this.v = app.view;
    this.tool = 'look';
    this.fate = null;
    this.aim = null; // { kind: 'found' | 'order', army }
    this.sel = null; // { type: 'town' | 'civ' | 'army', id }
    this.filter = 'major';
    this.follow = false;
    this.followAt = 0;
    this.dirty = { panel: true, realms: true, events: true, chip: true };
    this.lastUi = 0;
    this.seenEvent = 0;
    this.history = null;
    this.historyAt = 0;
    this.chartCiv = 0;
    this.off = [];
    this.unsub = this.m.on((d) => this.onDelta(d));
    this.bind();
    this.renderPanel();
    this.syncSpeed();
    // Start on the oldest realm's land, a little zoomed.
    const first = this.m.ranking()[0];
    if (first) {
      const t = this.m.towns.get(first.capital);
      if (t) this.v.flyTo(t.x, t.y, Math.max(this.v.ppt, 3));
    }
    this.seenEvent = this.m.events.length ? this.m.events[this.m.events.length - 1].id : 0;
  }

  destroy() {
    this.unsub();
    for (const [el, ev, fn] of this.off) el.removeEventListener(ev, fn);
  }

  on(el, ev, fn) {
    el.addEventListener(ev, fn);
    this.off.push([el, ev, fn]);
  }

  bind() {
    this.on($('speeds'), 'click', (e) => {
      const b = e.target.closest('button');
      if (b) this.setSpeed(b.dataset.speed);
    });
    this.on($('btn-realms'), 'click', () => this.toggleDrawer('realms'));
    this.on($('btn-chronicle'), 'click', () => this.toggleDrawer('chronicle'));
    this.on($('btn-menu'), 'click', () => this.menu());
    for (const b of document.querySelectorAll('[data-close]')) this.on(b, 'click', () => this.toggleDrawer(b.dataset.close, false));
    this.on($('tools'), 'click', (e) => {
      const b = e.target.closest('button');
      if (b) this.setTool(b.dataset.tool);
    });
    this.on($('chron-tabs'), 'click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.filter = b.dataset.f;
      for (const x of $('chron-tabs').children) x.classList.toggle('on', x === b);
      this.dirty.events = true;
    });
    this.on($('follow'), 'change', () => {
      this.follow = $('follow').checked;
    });
    this.on($('realm-list'), 'click', (e) => {
      const r = e.target.closest('[data-civ]');
      if (r) this.select({ type: 'civ', id: Number(r.dataset.civ) }, true);
    });
    this.on($('events'), 'click', (e) => {
      const r = e.target.closest('[data-x]');
      if (r) this.goto(Number(r.dataset.x), Number(r.dataset.y), r.dataset.civ ? Number(r.dataset.civ) : 0);
    });
    this.on($('ticker'), 'click', (e) => {
      const r = e.target.closest('[data-x]');
      if (r) this.goto(Number(r.dataset.x), Number(r.dataset.y));
    });
    this.on($('realm-chip'), 'click', () => {
      const p = this.m.player();
      if (p) this.select({ type: 'civ', id: p.id }, true);
    });
    this.on($('panel'), 'click', (e) => this.panelClick(e));
    this.on($('panel'), 'input', (e) => this.panelInput(e));
    this.on($('panel'), 'change', (e) => this.panelChange(e));
    this.on($('hint'), 'click', (e) => {
      if (e.target.closest('[data-cancel]')) this.cancelAim();
    });
  }

  onDelta(d) {
    if (d.civs.length) {
      this.dirty.realms = true;
      this.dirty.chip = true;
    }
    if (d.civs.length || d.towns.length) this.dirty.panel = true;
    if (d.events && d.events.length) this.dirty.events = true;
  }

  // -------------------------------------------------------------------------
  // Per frame (DOM work only a few times a second)

  frame(now) {
    if (now - this.lastUi < 250) return;
    this.lastUi = now;
    const m = this.m;
    $('year').textContent = yearText(m.year);
    const lead = m.player() || m.ranking()[0];
    $('era-name').textContent = lead ? `${ERAS[lead.era].name}${m.player() ? '' : ' (leading realm)'}` : '';
    if (this.dirty.chip) this.renderChip();
    if (!$('realms').hidden && this.dirty.realms) this.renderRealms();
    if (!$('chronicle').hidden && this.dirty.events) this.renderEvents();
    if (this.dirty.panel && !$('panel').hidden && now - (this.panelAt || 0) > 600) this.renderPanel();
    this.newEvents(now);
    this.syncSpeed();
  }

  syncSpeed() {
    const s = this.m.speed;
    const key = s === Infinity || s === null ? 'max' : String(s);
    for (const b of $('speeds').children) b.classList.toggle('on', b.dataset.speed === key);
  }

  setSpeed(v) {
    if (v !== '0') this.lastSpeed = v;
    this.app.send({ t: 'speed', v });
    this.m.speed = v === 'max' ? Infinity : Number(v);
    this.syncSpeed();
  }

  togglePause() {
    if (this.m.speed) this.setSpeed('0');
    else this.setSpeed(this.lastSpeed || '1');
  }

  toggleDrawer(id, on = null) {
    const el = $(id);
    const show = on === null ? el.hidden : on;
    el.hidden = !show;
    $(`btn-${id}`).classList.toggle('on', show);
    if (show && window.innerWidth < 640) {
      // Phones: one drawer at a time, the inspector out of the way.
      for (const other of ['realms', 'chronicle']) {
        if (other !== id) {
          $(other).hidden = true;
          $(`btn-${other}`).classList.remove('on');
        }
      }
      $('panel').hidden = true;
    }
    if (show) {
      this.dirty.realms = true;
      this.dirty.events = true;
    }
  }

  escape() {
    if (!$('modal-back').hidden) {
      $('modal-back').hidden = true;
      return;
    }
    if (this.aim || this.fate) {
      this.cancelAim();
      return;
    }
    if (this.sel) {
      this.select(null);
      return;
    }
    this.menu();
  }

  renderChip() {
    this.dirty.chip = false;
    const p = this.m.player();
    const el = $('realm-chip');
    if (!p) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = `<span class="dot" style="background:${p.color}"></span><span class="nm">${esc(p.name)}</span><span class="st">👥 ${fmt(p.pop)} · ⌂ ${p.towns} · ⚖ ${Math.round(p.stability)}</span>`;
  }

  renderRealms() {
    this.dirty.realms = false;
    const list = this.m.ranking();
    const total = list.reduce((s, c) => s + c.pop, 0);
    $('world-pop').textContent = `${fmt(total)} people`;
    $('realm-list').innerHTML = list.map((c) => `<div class="realm${this.sel?.type === 'civ' && this.sel.id === c.id ? ' sel' : ''}" data-civ="${c.id}"><span class="dot" style="background:${c.color}"></span><span class="nm">${esc(c.name)}${c.player ? ' 👑' : ''}</span><span class="pop">${fmt(c.pop)}</span><span class="meta"><span>${ERAS[c.era].name}</span><span>${c.towns} town${c.towns === 1 ? '' : 's'}</span>${c.wars.length ? `<span class="bad">⚔ ${c.wars.length}</span>` : ''}</span></div>`).join('');
  }

  eventVisible(e) {
    if (this.filter === 'all') return true;
    if (this.filter === 'mine') {
      const p = this.m.player();
      return p && e.civs && e.civs.includes(p.id);
    }
    return e.weight >= 2 || (MAJOR.has(e.type) && e.weight >= 1 && e.type !== 'battle');
  }

  renderEvents() {
    this.dirty.events = false;
    const evs = [];
    for (let i = this.m.events.length - 1; i >= 0 && evs.length < 220; i--) {
      const e = this.m.events[i];
      if (this.eventVisible(e)) evs.push(e);
    }
    $('events').innerHTML = evs.map((e) => `<div class="ev${e.weight >= 2 ? ' big' : ''}" ${e.x >= 0 ? `data-x="${e.x}" data-y="${e.y}"` : ''} ${e.civs && e.civs[0] ? `data-civ="${e.civs[0]}"` : ''}><span class="y">${yearText(e.year)}</span><span class="t"><i>${ICONS[e.type] || '•'}</i>${esc(e.text)}</span></div>`).join('') || '<p class="muted small" style="padding:8px">Nothing yet. History is young.</p>';
  }

  /** Great new events: a line in the ticker, and the camera if following. */
  newEvents(now) {
    const evs = this.m.events;
    if (!evs.length) return;
    const lastId = evs[evs.length - 1].id;
    if (lastId <= this.seenEvent) return;
    const fresh = [];
    for (let i = evs.length - 1; i >= 0 && evs[i].id > this.seenEvent; i--) fresh.push(evs[i]);
    this.seenEvent = lastId;
    const p = this.m.player();
    const big = fresh.filter((e) => e.weight >= 2 || (p && e.civs?.includes(p.id) && e.weight >= 1));
    const tk = $('ticker');
    for (const e of big.slice(0, 2).reverse()) {
      const el = document.createElement('div');
      el.className = 'tk';
      if (e.x >= 0) {
        el.dataset.x = e.x;
        el.dataset.y = e.y;
      }
      el.innerHTML = `<b>${yearText(e.year)}</b>${ICONS[e.type] || ''} ${esc(e.text)}`;
      tk.appendChild(el);
      setTimeout(() => el.remove(), 7000);
      while (tk.children.length > 4) tk.firstChild.remove();
    }
    if (this.follow && now - this.followAt > 5000) {
      const e = big.find((x) => x.x >= 0);
      if (e) {
        this.followAt = now;
        this.v.flyTo(e.x, e.y, Math.max(6, Math.min(12, this.v.ppt)));
        this.v.ping(e.x, e.y);
      }
    }
  }

  goto(x, y, civ = 0) {
    this.v.flyTo(x, y, Math.max(this.v.ppt, 8));
    this.v.ping(x, y);
    const t = this.townNear(x + 0.5, y + 0.5, 1.5);
    if (t) this.select({ type: 'town', id: t.id });
    else if (civ) this.select({ type: 'civ', id: civ });
    if (window.innerWidth < 640) this.toggleDrawer('chronicle', false);
  }

  // -------------------------------------------------------------------------
  // Tools and taps

  setTool(tool) {
    if (tool === this.tool && tool !== 'look') tool = 'look';
    this.tool = tool;
    this.fate = null;
    this.aim = null;
    for (const b of $('tools').children) b.classList.toggle('on', b.dataset.tool === tool);
    this.updateHint();
    if (tool === 'history') this.loadHistory(true);
    $('panel').hidden = tool === 'look' && !this.sel;
    this.dirty.panel = true;
    this.renderPanel();
  }

  updateHint() {
    const h = $('hint');
    let text = '';
    if (this.fate) text = FATE.find((f) => f.key === this.fate)?.hint;
    else if (this.aim?.kind === 'found') text = 'Tap the land where settlers should found a town.';
    else if (this.aim?.kind === 'order') text = 'Tap where the army should march (an enemy town to besiege it).';
    else if (this.aim?.kind === 'give2') text = 'Choose the realm that gets the town in the panel.';
    h.hidden = !text;
    if (text) h.innerHTML = `<span>${esc(text)}</span><button class="btn small" data-cancel>Cancel</button>`;
    $('map').classList.toggle('aim', !!text);
  }

  cancelAim() {
    this.fate = null;
    this.aim = null;
    this.v.preview = null;
    this.updateHint();
    this.dirty.panel = true;
    this.renderPanel();
  }

  townNear(tx, ty, r) {
    let best = null;
    let bd = r;
    for (const t of this.m.towns.values()) {
      if (!t.alive) continue;
      const d = Math.hypot(t.x + 0.5 - tx, t.y + 0.5 - ty);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  armyNear(sx, sy) {
    let best = null;
    let bd = 16;
    for (const a of this.m.armies) {
      const [px, py] = this.v.tileToScreen(a[2] + 0.5, a[3] + 0.5);
      const d = Math.hypot(px - sx, py - sy);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  hover(sx, sy) {
    if (!this.fate && !this.aim) {
      this.v.preview = null;
      return;
    }
    const [tx, ty] = this.v.screenToTile(sx, sy);
    const r = this.fate === 'drought' ? 14 : this.fate === 'quake' ? 7 : this.fate === 'eruption' ? 9 : 1;
    this.v.preview = { x: Math.floor(tx), y: Math.floor(ty), r, ok: true };
  }

  async tap(sx, sy, { long = false, button = 0 } = {}) {
    const v = this.v;
    const [tx, ty] = v.screenToTile(sx, sy);
    const x = Math.floor(tx);
    const y = Math.floor(ty);
    const pickR = Math.max(1.2, 14 / v.ppt);
    const town = this.townNear(tx, ty, pickR);
    const i = y * this.m.W + x;
    const civAt = x >= 0 && y >= 0 && x < this.m.W && y < this.m.H ? this.m.civAt(i) : 0;
    if (this.fate) return this.applyFate(this.fate, x, y, town, civAt);
    if (this.aim?.kind === 'found') {
      const p = this.m.player();
      if (!p) return this.cancelAim();
      return this.cmd({ type: 'found', civ: p.id, x, y }, 'Settlers are on their way.').then((ok) => ok && this.cancelAim());
    }
    if (this.aim?.kind === 'order') {
      const a = this.aim.army;
      const tgt = town && town.civ !== this.m.player()?.id ? town : null;
      const ok = await this.cmd({ type: 'move', army: a, x: tgt ? tgt.x : x, y: tgt ? tgt.y : y }, tgt ? `Marching on ${tgt.name}.` : 'Marching.');
      if (ok) this.cancelAim();
      return undefined;
    }
    if (button === 2 || long) {
      // Right click or long press: the realm, not the town.
      if (civAt) this.select({ type: 'civ', id: civAt });
      return undefined;
    }
    const army = this.armyNear(sx, sy);
    if (army && (!town || v.ppt >= 4)) return this.select({ type: 'army', id: army[0] });
    if (town) return this.select({ type: 'town', id: town.id });
    if (civAt) return this.select({ type: 'civ', id: civAt });
    this.select(null);
    return undefined;
  }

  async cmd(c, okText = null) {
    try {
      await this.app.command(c);
      if (okText) this.app.toast(okText);
      this.dirty.panel = true;
      return true;
    } catch (e) {
      this.app.toast(e.message, true);
      return false;
    }
  }

  async applyFate(key, x, y, town, civAt) {
    const t = town;
    const need = (thing) => {
      this.app.toast(`Tap ${thing}.`, true);
      return false;
    };
    switch (key) {
      case 'spawn':
        if (await this.cmd({ type: 'spawn', x, y }, 'A new people takes root.')) this.v.ping(x, y);
        break;
      case 'plague':
      case 'fire':
      case 'bounty':
      case 'grow':
      case 'rebel':
        if (!t) return need('a town');
        if (await this.cmd({ type: key, town: t.id })) this.v.ping(t.x, t.y);
        break;
      case 'drought':
      case 'quake':
      case 'eruption':
        if (await this.cmd({ type: key, x, y })) this.v.ping(x, y);
        break;
      case 'golden':
        if (!civAt) return need('a realm');
        await this.cmd({ type: 'golden', civ: civAt });
        break;
      case 'give':
        if (!t) return need('a town');
        this.aim = { kind: 'give2', town: t.id };
        this.fate = null;
        this.select({ type: 'town', id: t.id });
        this.updateHint();
        return true;
      case 'teach':
        if (!civAt) return need('a realm');
        this.fate = null;
        this.select({ type: 'civ', id: civAt });
        this.teachMode = true;
        this.updateHint();
        this.renderPanel();
        return true;
      default:
        break;
    }
    return true;
  }

  select(sel, fly = false) {
    this.sel = sel;
    this.v.selTown = sel?.type === 'town' ? sel.id : 0;
    this.v.selArmy = sel?.type === 'army' ? sel.id : 0;
    this.v.selCiv = sel?.type === 'civ' ? sel.id : 0;
    if (sel?.type !== 'civ') this.teachMode = false;
    if (fly && sel?.type === 'civ') {
      const c = this.m.civs.get(sel.id);
      const t = c && this.m.towns.get(c.capital);
      if (t) this.v.flyTo(t.x, t.y, Math.max(this.v.ppt, 5));
    }
    if (sel && window.innerWidth < 640) {
      this.toggleDrawer('realms', false);
      this.toggleDrawer('chronicle', false);
    }
    if (this.tool !== 'look' && sel && this.tool !== 'lead' && this.tool !== 'fate') this.setTool('look');
    $('panel').hidden = !sel && this.tool === 'look';
    this.dirty.panel = true;
    this.dirty.realms = true;
    this.renderPanel();
  }

  // -------------------------------------------------------------------------
  // Panel

  renderPanel() {
    this.dirty.panel = false;
    this.panelAt = performance.now();
    const p = $('panel');
    if (p.hidden) return;
    // Keep keyboard focus and slider drags undisturbed.
    if (p.contains(document.activeElement) && document.activeElement.matches('input[type=range], input[type=text], select')) return;
    let html = '';
    if (this.aim?.kind === 'give2') html = this.giveHtml();
    else if (this.sel?.type === 'town') html = this.townHtml(this.sel.id);
    else if (this.sel?.type === 'civ') html = this.teachMode ? this.teachHtml(this.sel.id) : this.civHtml(this.sel.id);
    else if (this.sel?.type === 'army') html = this.armyHtml(this.sel.id);
    else if (this.tool === 'lead') html = this.leadHtml();
    else if (this.tool === 'fate') html = this.fateHtml();
    else if (this.tool === 'map') html = this.mapHtml();
    else if (this.tool === 'history') html = this.historyHtml();
    if (this.sel && (this.tool === 'lead' || this.tool === 'fate' || this.tool === 'map' || this.tool === 'history')) {
      // The selection first, the tool below it.
      const extra = this.tool === 'lead' ? this.leadHtml(true) : this.tool === 'fate' ? this.fateHtml() : this.tool === 'map' ? this.mapHtml() : '';
      if (extra) html += `<hr style="border:0;border-top:1px solid var(--line);margin:12px 0">${extra}`;
    }
    const scroll = p.scrollTop;
    p.innerHTML = html || '<p class="muted">Tap a town, an army or a realm.</p>';
    p.scrollTop = scroll;
    if (this.tool === 'history' && !this.sel) this.drawHistory();
  }

  close() {
    return '<button class="x" data-act="close">✕</button>';
  }

  townHtml(id) {
    const t = this.m.towns.get(id);
    if (!t) return '';
    const c = this.m.civs.get(t.civ);
    const p = this.m.player();
    const faith = t.religion ? this.m.faiths[t.religion] : null;
    const size = t.urban > 200000 ? 'Metropolis' : t.urban > 40000 ? 'Great city' : t.urban > 8000 ? 'City' : t.urban > 1500 ? 'Town' : t.urban > 300 ? 'Village' : 'Hamlet';
    const mine = p && p.id === t.civ;
    const food = t.K ? Math.round((t.pop / t.K) * 100) : 0;
    let actions = '';
    if (mine) actions += `<button class="btn small" data-act="raise" data-town="${t.id}">Raise an army here</button>`;
    if (this.tool === 'fate') actions += FATE.filter((f) => ['plague', 'fire', 'bounty', 'grow', 'rebel', 'give'].includes(f.key)).map((f) => `<button class="btn small" data-act="fate-town" data-k="${f.key}" data-town="${t.id}">${f.icon} ${f.name}</button>`).join('');
    return `<div class="head"><div><h2>${esc(t.name)}${t.capital ? ' ♛' : ''}</h2><div class="sub">${size} of ${c ? `<a href="#" data-act="civ" data-civ="${c.id}" style="color:inherit">${esc(c.name)}</a>` : '—'}</div></div>${this.close()}</div>
      <dl class="kv">
        <dt>People</dt><dd>${fmt(t.pop)} <span class="muted small">(${fmt(t.urban)} in town)</span></dd>
        <dt>Harvests</dt><dd>${food > 100 ? `<span class="bad">hungry: ${food}% of what the land feeds</span>` : `${food}% of what the land feeds`}</dd>
        <dt>Faith</dt><dd>${faith ? `<span class="dot" style="background:${faith.color}"></span>${esc(faith.name)}` : '<span class="muted">old gods</span>'}</dd>
        <dt>Founded</dt><dd>${yearText(t.founded)}</dd>
        <dt>Trade</dt><dd>${t.routes ? `${t.routes} route${t.routes > 1 ? 's' : ''}` : '<span class="muted">none</span>'}${t.port ? ' · harbour' : ''}${t.walls ? ' · walled' : ''}</dd>
        ${t.plague ? '<dt>Plague</dt><dd class="bad">the sickness is here</dd>' : ''}
      </dl>
      ${actions ? `<div class="row">${actions}</div>` : ''}
      ${c && !c.player ? `<div class="row"><button class="btn small" data-act="lead" data-civ="${c.id}">👑 Lead ${esc(c.names.land)}</button></div>` : ''}`;
  }

  civHtml(id) {
    const c = this.m.civs.get(id);
    if (!c) return '';
    const cap = this.m.towns.get(c.capital);
    const faith = c.religion ? this.m.faiths[c.religion] : null;
    const p = this.m.player();
    const rel = new Map(c.relations);
    const names = (ids, cls) => ids.map((i) => this.m.civs.get(i)).filter(Boolean).map((o) => `<button class="chip2 ${cls}" data-act="civ" data-civ="${o.id}"><span class="dot" style="background:${o.color}"></span>${esc(o.names.land)}</button>`).join('');
    const res = c.research ? TECHS.find((t) => t.key === c.research) : null;
    let diplo = '';
    if (p && p.id !== c.id && c.alive) {
      const atWar = p.wars.includes(c.id);
      const allied = p.allies.includes(c.id);
      diplo = `<div class="row">${atWar ? `<button class="btn small go" data-act="peace" data-civ="${c.id}">🕊 Make peace</button>` : `<button class="btn small primary" data-act="war" data-civ="${c.id}">⚔ Declare war</button>`}${!atWar && !allied ? `<button class="btn small" data-act="ally" data-civ="${c.id}">🤝 Alliance</button>` : ''}${allied ? `<button class="btn small" data-act="unally" data-civ="${c.id}">End alliance</button>` : ''}</div>`;
    }
    return `<div class="head"><span class="dot" style="background:${c.color};width:16px;height:16px;margin-top:5px"></span><div><h2>${esc(c.name)}</h2><div class="sub">${c.alive ? `${GOV[c.gov].name} · ${ERAS[c.era].name}` : `fell in ${yearText(c.fell)}`}</div></div>${this.close()}</div>
      <dl class="kv">
        <dt>People</dt><dd>${fmt(c.pop)} in ${c.towns} town${c.towns === 1 ? '' : 's'}</dd>
        <dt>Land</dt><dd>${fmt(c.land)} tiles</dd>
        <dt>Capital</dt><dd>${cap ? `<a href="#" data-act="town" data-town="${cap.id}" style="color:inherit">${esc(cap.name)}</a>` : '—'}</dd>
        <dt>Loyalty</dt><dd><div class="bar" style="width:140px;display:inline-block;vertical-align:middle"><i style="width:${Math.round(c.stability)}%;background:${c.stability < 30 ? 'var(--red)' : c.stability < 55 ? 'var(--gold)' : 'var(--green)'}"></i></div> ${Math.round(c.stability)}</dd>
        <dt>Treasury</dt><dd>${fmt(c.wealth)} <span class="muted small">(${c.income >= 0 ? '+' : ''}${fmt(c.income)} a year)</span></dd>
        <dt>Soldiers</dt><dd>${fmt(c.army)}</dd>
        <dt>Faith</dt><dd>${faith ? `<span class="dot" style="background:${faith.color}"></span>${esc(faith.name)}` : '<span class="muted">old gods</span>'}</dd>
        <dt>Studying</dt><dd>${res ? esc(res.name) : '—'}</dd>
        <dt>Since</dt><dd>${yearText(c.founded)}${c.parent ? ` <span class="muted small">(broke from ${esc(this.m.civs.get(c.parent)?.names.land || '?')})</span>` : ''}</dd>
      </dl>
      ${c.wars.length ? `<h3>At war with</h3><div class="chips">${names(c.wars, 'war')}</div>` : ''}
      ${c.allies.length ? `<h3>Allies</h3><div class="chips">${names(c.allies, 'ally')}</div>` : ''}
      ${diplo}
      <div class="row">${c.alive && !c.player ? `<button class="btn small" data-act="lead" data-civ="${c.id}">👑 Lead this realm</button>` : ''}${c.player ? '<button class="btn small" data-act="release">Let it rule itself</button>' : ''}<button class="btn small" data-act="chart" data-civ="${c.id}">📈 History</button></div>
      ${rel.size && p && p.id === c.id ? '' : ''}`;
  }

  teachHtml(id) {
    const c = this.m.civs.get(id);
    if (!c) return '';
    const can = new Set(available(new Set(c.techs)).map((t) => t.key));
    return `<div class="head"><div><h2>Teach ${esc(c.names.land)}</h2><div class="sub">Grant knowledge they are ready for.</div></div>${this.close()}</div>
      <div class="techs">${TECHS.filter((t) => can.has(t.key)).map((t) => `<button class="tech can" data-act="teach" data-civ="${c.id}" data-tech="${t.key}"><b>${esc(t.name)}</b><span class="era">${ERAS[t.era].name}</span>${esc(t.text || '')}</button>`).join('') || '<p class="muted">Nothing more to learn.</p>'}</div>
      <div class="row"><button class="btn small" data-act="civ" data-civ="${c.id}">Done</button></div>`;
  }

  giveHtml() {
    const t = this.m.towns.get(this.aim.town);
    if (!t) return '';
    const list = this.m.ranking().filter((c) => c.id !== t.civ);
    return `<div class="head"><div><h2>Hand over ${esc(t.name)}</h2><div class="sub">To which realm?</div></div><button class="x" data-act="cancel">✕</button></div>
      <div class="chips" style="margin-top:8px">${list.map((c) => `<button class="chip2" data-act="give" data-civ="${c.id}" data-town="${t.id}"><span class="dot" style="background:${c.color}"></span>${esc(c.names.land)}</button>`).join('')}</div>`;
  }

  armyHtml(id) {
    const a = this.m.armies.find((x) => x[0] === id);
    if (!a) return `<p class="muted">That army is no more.</p>`;
    const [, civId, , , size, mode, era, target] = a;
    const c = this.m.civs.get(civId);
    const t = target ? this.m.towns.get(target) : null;
    const p = this.m.player();
    const mine = p && p.id === civId;
    const what = { march: t ? `marching on ${t.name}` : 'on the march', siege: t ? `besieging ${t.name}` : 'besieging', home: 'going home', idle: 'encamped' }[mode] || mode;
    return `<div class="head"><span class="dot" style="background:${c?.color};width:16px;height:16px;margin-top:5px"></span><div><h2>${esc(c ? c.names.adj : '')} army</h2><div class="sub">${fmt(size)} soldiers of the ${ERAS[era].name}, ${esc(what)}</div></div>${this.close()}</div>
      ${mine ? `<div class="row"><button class="btn small primary" data-act="order" data-army="${id}">⚑ March to…</button><button class="btn small" data-act="disband" data-army="${id}">Send home</button></div>` : ''}`;
  }

  leadHtml(below = false) {
    const p = this.m.player();
    if (!p) {
      const list = this.m.ranking().slice(0, 12);
      return `<div class="head"><div><h2>Lead a realm</h2><div class="sub">Rule its policies, studies, wars and settlers, or leave things to its advisers.</div></div>${below ? '' : this.close()}</div>
        <div class="chips" style="margin-top:10px">${list.map((c) => `<button class="chip2" data-act="lead" data-civ="${c.id}"><span class="dot" style="background:${c.color}"></span>${esc(c.names.land)} · ${fmt(c.pop)}</button>`).join('')}</div>
        <p class="muted small">Or tap any realm on the map and choose “Lead this realm”.</p>`;
    }
    const pol = p.policy;
    const auto = p.auto;
    const slider = (k, label) => `<div class="slider"><span>${label}</span><input type="range" min="0" max="100" value="${Math.round(pol[k] * 100)}" data-pol="${k}"><b>${Math.round(pol[k] * 100)}</b></div>`;
    const tog = (k, label) => `<label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-auto="${k}" ${auto[k] ? 'checked' : ''}> ${label}</label>`;
    const known = new Set(p.techs);
    const can = new Set(available(known).map((t) => t.key));
    const res = TECHS.find((t) => t.key === p.research);
    const armies = this.m.armies.filter((a) => a[1] === p.id);
    const others = this.m.ranking().filter((c) => c.id !== p.id).slice(0, 30);
    const rel = new Map(p.relations);
    return `<div class="head"><span class="dot" style="background:${p.color};width:16px;height:16px;margin-top:5px"></span><div><h2>${esc(p.name)}</h2><div class="sub">You lead this realm · ${ERAS[p.era].name}</div></div>${below ? '' : this.close()}</div>
      <div class="row"><button class="btn small go" data-act="found-tool">⌂ Found a town</button><button class="btn small" data-act="suggest">Where?</button><button class="btn small" data-act="raise" data-town="${p.capital}">⚔ Raise an army</button><button class="btn small" data-act="release">Stop leading</button></div>
      <h3>Priorities</h3>
      ${slider('growth', 'Growth')}${slider('science', 'Learning')}${slider('trade', 'Trade')}${slider('military', 'Army')}${slider('expansion', 'Settling')}
      <h3>Advisers decide</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">${tog('research', 'what to study')}${tog('expansion', 'where to settle')}${tog('diplomacy', 'war and peace')}${tog('military', 'raising armies')}</div>
      <h3>Learning</h3>
      <div class="small">${res ? `Studying <b>${esc(res.name)}</b>` : 'Nothing left to study.'}</div>
      <div class="techs" style="margin-top:6px">${TECHS.filter((t) => t.cost && (known.has(t.key) ? t.era >= p.era - 1 : t.era <= p.era + 1)).map((t) => `<button class="tech${known.has(t.key) ? ' known' : ''}${t.key === p.research ? ' now' : ''}${can.has(t.key) ? ' can' : ''}" ${can.has(t.key) ? `data-act="research" data-tech="${t.key}"` : ''}><b>${esc(t.name)}</b><span class="era">${ERAS[t.era].name}${known.has(t.key) ? ' · known' : ''}</span></button>`).join('')}</div>
      <h3>Armies</h3>
      ${armies.length ? armies.map((a) => `<div class="row" style="margin-top:4px;align-items:center"><button class="chip2" data-act="army" data-army="${a[0]}">⚑ ${fmt(a[4])} · ${a[5]}</button><button class="btn small" data-act="order" data-army="${a[0]}">March to…</button></div>`).join('') : '<p class="muted small">No armies in the field.</p>'}
      <h3>Other realms</h3>
      <div class="chips">${others.map((c) => {
        const w = p.wars.includes(c.id);
        const al = p.allies.includes(c.id);
        const op = rel.get(c.id);
        return `<button class="chip2 ${w ? 'war' : al ? 'ally' : ''}" data-act="civ" data-civ="${c.id}"><span class="dot" style="background:${c.color}"></span>${esc(c.names.land)}${op !== undefined ? ` <span class="dim">${op > 0 ? '+' : ''}${op}</span>` : ''}</button>`;
      }).join('')}</div>`;
  }

  fateHtml() {
    const s = this.m.settings;
    const sl = (k, label) => `<div class="slider"><span>${label}</span><input type="range" min="0" max="300" value="${Math.round(s[k] * 100)}" data-set="${k}"><b>${Math.round(s[k] * 100)}%</b></div>`;
    return `<div class="head"><div><h2>The hand of fate</h2><div class="sub">Choose a power, then tap the map.</div></div>${this.sel ? '' : this.close()}</div>
      <div class="grid-tools">${FATE.map((f) => `<button class="tool${this.fate === f.key ? ' on' : ''}" data-act="fate" data-k="${f.key}"><span>${f.icon}</span><i>${f.name}</i></button>`).join('')}</div>
      <h3>The world's nature</h3>
      ${sl('growth', 'Births')}${sl('tech', 'Learning')}${sl('aggression', 'Warfare')}${sl('disasters', 'Disasters')}
      <label class="small" style="display:flex;gap:6px;align-items:center;margin-top:4px"><input type="checkbox" data-set-bool="newPeoples" ${s.newPeoples ? 'checked' : ''}> New peoples appear on empty land</label>`;
  }

  mapHtml() {
    const modes = [['political', '♛ Realms'], ['religion', '✝ Faiths'], ['trade', '⇄ Trade'], ['terrain', '⛰ Land only']];
    return `<div class="head"><div><h2>Map</h2></div>${this.sel ? '' : this.close()}</div>
      <div class="grid-tools">${modes.map(([k, n]) => `<button class="tool${this.v.mode === k ? ' on' : ''}" data-act="mode" data-k="${k}"><i>${n}</i></button>`).join('')}</div>
      <div class="row"><button class="btn small" data-act="fit">Whole world</button>${this.m.player() ? '<button class="btn small" data-act="home">My capital</button>' : ''}</div>`;
  }

  historyHtml() {
    return `<div class="head"><div><h2>History</h2><div class="sub">People of the greatest realms, every ten years.</div></div>${this.close()}</div>
      <canvas class="chart" id="chart"></canvas><div class="legend" id="legend"></div>
      <h3>Ages</h3><div id="ages" class="small"></div>`;
  }

  async loadHistory(force = false) {
    if (!force && performance.now() - this.historyAt < 5000) return;
    this.historyAt = performance.now();
    try {
      const r = await this.app.request('history');
      this.history = r.history;
      if (this.tool === 'history' && !this.sel) this.drawHistory();
    } catch (e) {
      console.error(e);
    }
  }

  drawHistory() {
    const cv = $('chart');
    if (!cv || !this.history) {
      this.loadHistory();
      return;
    }
    const legend = drawChart(cv, this.history, this.m, this.chartCiv);
    $('legend').innerHTML = legend.map((l) => `<span><span class="dot" style="background:${l.color}"></span>${esc(l.name)}</span>`).join('');
    const firsts = this.m.events.filter((e) => e.type === 'era' && e.weight >= 3);
    $('ages').innerHTML = firsts.map((e) => `<div>${yearText(e.year)}: ${esc(e.text)}</div>`).join('') || '<span class="muted">Every people is still in the Stone Age.</span>';
    if (performance.now() - this.historyAt > 4000) this.loadHistory();
  }

  // -------------------------------------------------------------------------
  // Panel events

  async panelClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    e.preventDefault();
    const d = b.dataset;
    const civ = Number(d.civ);
    const p = this.m.player();
    switch (d.act) {
      case 'close':
        this.select(null);
        if (this.tool !== 'look') this.setTool('look');
        $('panel').hidden = true;
        break;
      case 'civ':
        this.teachMode = false;
        this.select({ type: 'civ', id: civ }, true);
        break;
      case 'town': {
        const t = this.m.towns.get(Number(d.town));
        if (t) {
          this.v.flyTo(t.x, t.y, Math.max(this.v.ppt, 8));
          this.select({ type: 'town', id: t.id });
        }
        break;
      }
      case 'army': {
        const a = this.m.armies.find((x) => x[0] === Number(d.army));
        if (a) {
          this.v.flyTo(a[2], a[3], Math.max(this.v.ppt, 8));
          this.select({ type: 'army', id: a[0] });
        }
        break;
      }
      case 'lead':
        if (await this.cmd({ type: 'lead', civ }, 'You lead the realm now. Its advisers still handle what you leave to them.')) {
          this.tool = 'lead';
          for (const x of $('tools').children) x.classList.toggle('on', x.dataset.tool === 'lead');
          this.sel = null;
          this.dirty.chip = true;
          setTimeout(() => this.renderPanel(), 150);
        }
        break;
      case 'release':
        await this.cmd({ type: 'release' }, 'The realm rules itself again.');
        this.dirty.chip = true;
        break;
      case 'war':
        if (p) await this.cmd({ type: 'war', civ: p.id, target: civ });
        break;
      case 'peace':
        if (p) await this.cmd({ type: 'peace', civ: p.id, target: civ });
        break;
      case 'ally':
        if (p) await this.cmd({ type: 'ally', civ: p.id, target: civ });
        break;
      case 'unally':
        if (p) await this.cmd({ type: 'unally', civ: p.id, target: civ });
        break;
      case 'research':
        if (p) await this.cmd({ type: 'research', civ: p.id, tech: d.tech });
        break;
      case 'found-tool':
        this.aim = { kind: 'found' };
        this.updateHint();
        break;
      case 'suggest':
        if (p) {
          try {
            const r = await this.app.command({ type: 'suggest', civ: p.id });
            if (r.r.x >= 0) {
              this.v.flyTo(r.r.x, r.r.y, Math.max(this.v.ppt, 8));
              this.v.ping(r.r.x, r.r.y);
            } else this.app.toast('No good land within reach.', true);
          } catch (err) {
            this.app.toast(err.message, true);
          }
        }
        break;
      case 'raise':
        if (p) await this.cmd({ type: 'raise', civ: p.id, town: Number(d.town) }, 'Soldiers gather.');
        break;
      case 'order':
        this.aim = { kind: 'order', army: Number(d.army) };
        this.updateHint();
        break;
      case 'disband':
        await this.cmd({ type: 'disband', army: Number(d.army) }, 'The army goes home.');
        break;
      case 'fate':
        this.fate = this.fate === d.k ? null : d.k;
        this.aim = null;
        this.updateHint();
        this.renderPanel();
        break;
      case 'fate-town': {
        const t = this.m.towns.get(Number(d.town));
        if (t) await this.applyFate(d.k, t.x, t.y, t, t.civ);
        break;
      }
      case 'give':
        if (await this.cmd({ type: 'give', town: Number(d.town), civ })) {
          this.aim = null;
          this.updateHint();
          this.select({ type: 'town', id: Number(d.town) });
        }
        break;
      case 'teach':
        await this.cmd({ type: 'teach', civ, tech: d.tech }, 'They have learnt it.');
        break;
      case 'cancel':
        this.cancelAim();
        break;
      case 'mode':
        this.v.setMode(d.k);
        this.renderPanel();
        break;
      case 'fit':
        this.v.fitWorld();
        break;
      case 'home':
        if (p) {
          const t = this.m.towns.get(p.capital);
          if (t) this.v.flyTo(t.x, t.y, 10);
        }
        break;
      case 'chart':
        this.chartCiv = civ;
        this.sel = null;
        this.setTool('history');
        break;
      default:
        break;
    }
    this.dirty.panel = true;
  }

  panelInput(e) {
    const el = e.target;
    if (el.dataset.pol || el.dataset.set) {
      const b = el.parentElement.querySelector('b');
      if (b) b.textContent = el.dataset.set ? `${el.value}%` : el.value;
    }
  }

  async panelChange(e) {
    const el = e.target;
    const p = this.m.player();
    if (el.dataset.pol && p) await this.cmd({ type: 'policy', civ: p.id, policy: { [el.dataset.pol]: Number(el.value) / 100 } });
    else if (el.dataset.auto && p) await this.cmd({ type: 'auto', civ: p.id, auto: { [el.dataset.auto]: el.checked } });
    else if (el.dataset.set) {
      await this.cmd({ type: 'settings', settings: { [el.dataset.set]: Number(el.value) / 100 } });
      this.m.settings[el.dataset.set] = Number(el.value) / 100;
    } else if (el.dataset.setBool) {
      await this.cmd({ type: 'settings', settings: { [el.dataset.setBool]: el.checked } });
      this.m.settings[el.dataset.setBool] = el.checked;
    }
  }

  // -------------------------------------------------------------------------
  // Menu

  menu() {
    const back = $('modal-back');
    const box = $('modal');
    box.innerHTML = `<h2>Annals</h2><div class="menu">
      <button class="btn" data-m="save">Save this world</button>
      <button class="btn" data-m="download">Download the save file</button>
      <button class="btn" data-m="new">A new world…</button>
      <button class="btn" data-m="help">How it works</button>
      <button class="btn go" data-m="close">Back to history</button></div>
      <p class="muted small" style="margin-top:12px">${yearText(this.m.year)} · ${this.m.ranking().length} realms · seed ${this.m.seed} · ${this.m.opts.size}</p>`;
    back.hidden = false;
    box.onclick = async (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      const k = b.dataset.m;
      if (k === 'close') back.hidden = true;
      else if (k === 'save' || k === 'download') {
        b.disabled = true;
        try {
          await this.app.saveNow(k === 'download');
          this.app.toast('The world is saved.');
        } catch (err) {
          this.app.toast(err.message, true);
        }
        back.hidden = true;
      } else if (k === 'new') {
        back.hidden = true;
        $('ui').hidden = true;
        $('screen').hidden = false;
      } else if (k === 'help') this.help();
    };
    back.onclick = (e) => {
      if (e.target === back) back.hidden = true;
    };
  }

  help() {
    $('modal').innerHTML = `<h2>How it works</h2>
      <p>Peoples farm the land they can reach; the more food it gives, the more people it feeds, and the bigger their towns grow. Rivers, lakes and coasts feed most. Every town rules the land round it as far as its people can govern, and borders settle along mountains, marshes and rivers.</p>
      <p>Realms learn: from the Stone Age through bronze, iron, the classical world, the Middle Ages, the Renaissance and industry to the modern age. Neighbours learn from each other, so knowledge spreads. Each age feeds more people, builds differently and reaches further.</p>
      <p>Towns grow on their own: streets branch and lengthen, houses fill the lots (in rows in the old centre), temples, markets, palaces, harbours and walls go up, fields spread round them. Buildings keep the style of the age they were built in and are rebuilt little by little.</p>
      <p>Crowded realms send settlers to found new towns. Realms trade along roads that become paved roads and railways, spread their faiths, make alliances, and go to war when they are strong, hungry or offended. Large, far-flung or war-weary realms lose their people's loyalty; provinces break away and empires fall apart. Plagues, droughts, quakes and eruptions strike.</p>
      <p><b>Watch</b> at any speed and follow the chronicle; tick “Follow” and the camera goes where history happens. <b>Lead</b> any realm: set its priorities, choose what it studies, found towns, raise and march armies, declare war and make peace; leave the rest to its advisers. <b>Fate</b> lets you send plagues, droughts, earthquakes and golden ages, start rebellions, hand towns over and change the nature of the world.</p>
      <p class="muted small">Drag to move, pinch or scroll to zoom, tap to look. Space pauses, 1–5 set the speed.</p>
      <div class="row"><button class="btn go" data-m="close">Back</button></div>`;
  }
}
