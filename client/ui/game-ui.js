// In-game interface: resource bar, selection panel (settlement / army),
// realm tabs (labour, trade, diplomacy, chronicle), placement, action modes
// and input. Every action is sent as a command; the simulation validates it.

import { BUILDINGS, STAGES, WALLS, UNITS, RESOURCES, RES_KEYS, LABOR, RULES, HOUSE } from '../../engine/sim/defs.js';
import { analyzeSite, describeSite, canFoundAt } from '../../engine/world/sites.js';
import { BIOMES } from '../../engine/world/biomes.js';
import { STYLES } from '../../engine/settlement/styles.js';
import { iconImg } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.floor(v)}`);
const RES_ICON = { food: 'food', wood: 'wood', stone: 'stone', iron: 'iron', fuel: 'fuel', herbs: 'herbs', crystal: 'crystal', goods: 'goods', arms: 'arms', coin: 'coin' };
const LABOR_NAMES = { food: 'Food', wood: 'Timber', stone: 'Stone', iron: 'Iron', fuel: 'Fuel', herbs: 'Herbs', crystal: 'Crystal', industry: 'Industry', build: 'Building' };
const LEVELS = ['Off', 'Low', 'Normal', 'High'];
const UNIT_ORDER = ['inf', 'arch', 'cav', 'siege'];
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
    };
    this.keys = new Set();
    this.unsub = [];
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
    this.bindInput();
    this.bindPanels();
    if (this.cw.init.startSites.length) {
      const s = this.cw.init.startSites[0];
      this.r.centerOn(this.cw.W / 2, this.cw.H / 2, 3);
      void s;
    }
  }

  destroy() {
    for (const u of this.unsub) u();
    for (const [t, fn, opts] of this.listeners || []) t.removeEventListener(fn[0], fn[1], opts);
  }

  send(cmd) {
    this.tx.command(cmd);
  }

  // -------------------------------------------------------------------------
  // Snapshot handling

  onSnap(snap) {
    this.renderTop(snap);
    const placing = snap.phase === 'placement' && this.cw.you >= 0 && !snap.kingdoms[this.cw.you].placed;
    this.el.right.hidden = this.cw.you < 0 || placing;
    if (snap.phase === 'placement' && this.cw.you >= 0 && !snap.kingdoms[this.cw.you].placed) this.renderPlacement(snap);
    else if (!this.el.placement.hidden) {
      this.el.placement.hidden = true;
      this.r.preview = null;
      const me = this.cw.me;
      const cap = me && this.cw.settlement(me.capital);
      if (cap) {
        this.r.centerOn(cap.x, cap.y, 24);
        this.select({ type: 'settlement', id: cap.id });
      }
    }
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
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
    setTimeout(() => t.remove(), kind === 'victory' ? 12000 : 5200);
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
    const cells = [];
    for (const r of [...RES_KEYS, 'coin']) {
      const v = r === 'coin' ? me.coin : me.stock[r] || 0;
      const rate = (me.rates?.[r] || 0) * 60;
      const short = (r === 'food' && me.flags?.starving) || (r === 'fuel' && me.flags?.cold) || (r === 'coin' && me.flags?.unpaid);
      const name = r === 'coin' ? 'Coin' : RESOURCES[r].name;
      cells.push(`<div class="res${short ? ' short' : ''}" data-tip="${esc(name)}: ${Math.round(v)} (${rate >= 0 ? '+' : ''}${rate.toFixed(1)} per minute)">${iconImg(RES_ICON[r], name)}<b>${fmt(v)}</b><span class="rate ${rate > 0.5 ? 'up' : rate < -0.5 ? 'down' : ''}">${rate > 0.5 ? '▲' : rate < -0.5 ? '▼' : ''}</span></div>`);
    }
    const st = me.stats || {};
    cells.push(`<div class="res" data-tip="Population: ${st.pop} (${st.workers || 0} working, ${st.idle || 0} idle)">${iconImg('pop', 'Population')}<b>${fmt(st.pop || 0)}</b></div>`);
    cells.push(`<div class="res" data-tip="Soldiers in garrisons and armies">${iconImg('soldier', 'Soldiers')}<b>${fmt(st.soldiers || 0)}</b></div>`);
    el.res.innerHTML = cells.join('');
    for (const b of el.speed.querySelectorAll('button')) b.classList.toggle('on', Number(b.dataset.speed) === this.speed);
  }

  // -------------------------------------------------------------------------
  // Selection panel

  select(sel) {
    this.r.selection = sel;
    this.lastPanel = 0;
    this.renderLeft();
  }

  renderLeft() {
    const { el, cw } = this;
    const sel = this.r.selection;
    if (el.left.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    if (!sel || !cw.snap) {
      el.left.hidden = true;
      return;
    }
    let html = '';
    if (sel.type === 'settlement') {
      const s = cw.settlement(sel.id);
      if (!s) {
        el.left.hidden = true;
        return;
      }
      html = s.kingdom === cw.you ? this.ownSettlementHtml(s) : this.foreignSettlementHtml(s);
    } else if (sel.type === 'army') {
      const a = cw.army(sel.id);
      if (!a) {
        el.left.hidden = true;
        return;
      }
      html = this.armyHtml(a);
    }
    const scroll = el.left.querySelector('.scroll');
    const top = scroll ? scroll.scrollTop : 0;
    el.left.innerHTML = html;
    const ns = el.left.querySelector('.scroll');
    if (ns) ns.scrollTop = top;
    el.left.hidden = false;
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
    for (const [r, v] of Object.entries(s.out || {})) if (v > 0.001) out.push(`${iconImg(RES_ICON[r], r)} ${(v * 60).toFixed(1)}/min`);
    const jobs = s.jobs?.assigned || {};
    const slots = s.jobs?.slots || {};
    const work = LABOR.filter((c) => slots[c]).map((c) => `<div class="row small"><span>${LABOR_NAMES[c]}</span><span>${jobs[c] || 0}/${slots[c]}</span></div>`).join('');
    // Growth.
    let grow = '';
    const next = STAGES[s.stage + 1];
    if (next) {
      const up = next.up;
      const reqs = [`${Math.floor(s.pop)}/${up.pop} people`];
      for (const n of up.needs || []) if (!(n === 'hall' && s.capital)) reqs.push(`${s.buildings[n] ? '✓' : '✗'} ${BUILDINGS[n].name}`);
      if (up.connected) reqs.push(`${s.connected ? '✓' : '✗'} road to the capital`);
      const ok = s.pop >= up.pop && (up.needs || []).every((n) => (n === 'hall' && s.capital) || s.buildings[n]) && (!up.connected || s.connected) && canPay(me, up.cost);
      const growing = (s.projects || []).some((p) => p.type === 'stage');
      grow = `<h3>Grow into a ${next.name.toLowerCase()}</h3>
        <div class="small muted">${reqs.join(' · ')}</div>
        <div class="row"><span class="cost">${costHtml(up.cost, me)}</span><button class="btn go small" data-act="upgrade" ${ok && !growing ? '' : 'disabled'}>${growing ? 'Growing…' : 'Grow'}</button></div>
        <div class="small muted">A ${next.name.toLowerCase()} claims more land (radius ${next.radius}), holds up to ${next.maxHouses} houses and ${next.maxBuild} buildings.</div>`;
    }
    // Projects.
    const projects = (s.projects || []).map((p) => {
      const name = p.type === 'house' ? 'House' : p.type === 'stage' ? `Growing to ${STAGES[p.to].name}` : p.type === 'walls' ? WALLS[p.to].name : BUILDINGS[p.kind]?.name || p.kind;
      const pct = Math.min(100, (p.progress / p.work) * 100);
      return `<div class="row small"><span style="flex:1">${esc(name)}<div class="bar warm"><i style="width:${pct}%"></i></div></span>${p.type === 'building' || p.type === 'house' ? `<button class="btn small" data-act="cancel" data-pid="${p.id}" title="Cancel (half the materials come back)">✕</button>` : ''}</div>`;
    }).join('') || '<div class="small muted">Nothing under construction.</div>';
    // Build list.
    const nonHouse = Object.entries(s.buildings).reduce((a, [k, v]) => a + (BUILDINGS[k] ? v : 0), 0) + (s.projects || []).filter((p) => p.type === 'building').length;
    const build = Object.entries(BUILDINGS).map(([kind, def]) => {
      let why = '';
      const have = (s.buildings[kind] || 0) + (s.projects || []).filter((p) => p.kind === kind).length;
      if (s.stage < def.stage) why = `needs a ${STAGES[def.stage].name.toLowerCase()}`;
      else if (def.capitalOnly && !s.capital) why = 'capital only';
      else if (def.notCapital && s.capital) why = 'not in the capital';
      else if (def.once && have) why = 'already built';
      else if (def.site && !(s.site?.[def.site] > 0)) why = { iron: 'no iron vein', coal: 'no coal seam', crystal: 'no crystal geode', water: 'no water nearby', coast: 'no coast' }[def.site] || 'unsuitable land';
      else if (nonHouse >= stage.maxBuild) why = 'settlement full: grow it';
      else if (s.unrest > 0) why = 'unrest';
      if (s.stage + 1 < def.stage) return '';
      const afford = canPay(me, def.cost);
      const count = s.buildings[kind] ? ` ×${s.buildings[kind]}` : '';
      return `<div class="item ${why ? 'disabled' : ''}"><span class="name">${esc(def.name)}${count}</span><button class="btn small ${afford && !why ? 'go' : ''}" data-act="build" data-kind="${kind}" ${why ? 'disabled' : ''}>Build</button><span class="cost">${costHtml(def.cost, me)}</span><span class="small muted">${def.jobs ? `${def.jobs} jobs` : ''}</span><span class="desc">${esc(why ? `${why} — ${def.desc}` : def.desc)}</span></div>`;
    }).join('');
    // Military.
    const g = s.garrison || {};
    const garrison = Object.entries(g).filter(([, n]) => n >= 0.5).map(([u, n]) => `${UNITS[u].name} ${Math.floor(n)}`).join(', ') || 'none';
    const training = (s.training || []).map((t) => `${t.n} ${UNITS[t.unit].name.toLowerCase()} (${Math.ceil(t.t)}s)`).join(', ');
    const cap = (s.buildings.barracks || 0) * 10;
    const recruit = UNIT_ORDER.map((u) => {
      const def = UNITS[u];
      const need = def.needs === 'cavalry' ? s.buildings.stables : def.needs === 'siege' ? s.buildings.siegeworks : true;
      return `<div class="item ${!cap || !need ? 'disabled' : ''}"><span class="name">${def.name} <span class="small muted">atk ${def.atk} def ${def.def}</span></span><span><input type="number" min="1" max="10" value="${u === 'siege' ? 1 : 5}" data-n="${u}" style="width:44px"> <button class="btn small" data-act="recruit" data-unit="${u}" ${!cap || !need ? 'disabled' : ''}>Train</button></span><span class="cost">${costHtml(def.cost, me)} each · ${def.train}s</span><span class="small muted">upkeep ${def.food} food, ${def.coin} coin/s</span></div>`;
    }).join('');
    const nextWall = WALLS[s.walls.level + 1];
    const walls = `<div class="row"><span>${s.walls.level ? `${WALLS[s.walls.level].name} (${Math.round(s.walls.hp)}/${WALLS[s.walls.level].hp})` : 'No walls'}</span>${nextWall ? `<button class="btn small" data-act="walls" ${s.stage >= 1 && (!nextWall.stage || s.stage >= nextWall.stage) && canPay(me, nextWall.cost) ? '' : 'disabled'}>${s.walls.level ? 'Upgrade' : 'Build'} ${esc(nextWall.name.toLowerCase())}</button>` : ''}</div>${nextWall ? `<div class="small muted">${costHtml(nextWall.cost, me)} · defenders ×${nextWall.def}${nextWall.stage ? ` · needs a ${STAGES[nextWall.stage].name.toLowerCase()}` : ''}</div>` : ''}`;
    return `<div class="head"><h2>${esc(s.name)}</h2><div class="sub">${stage.name}${s.capital ? ' · Capital' : ''} · ${esc(style)} style</div><button class="close" data-act="close" title="Close (Esc)">✕</button></div>
      <div class="scroll">
        <div class="row"><span>${iconImg('pop')} ${Math.floor(s.pop)} / ${s.housing} people</span><span class="small muted">${s.houses || 0}/${stage.maxHouses} houses · prosperity ${Math.round((s.prosperity || 1) * 100)}%</span></div>
        <div class="bar"><i style="width:${Math.min(100, (s.pop / Math.max(1, s.housing)) * 100)}%"></i></div>
        <div style="margin-top:6px">${tags.join('')}</div>
        ${out.length ? `<div class="small" style="margin-top:6px">${out.join(' · ')}</div>` : ''}
        ${grow}
        <h3>Work</h3>${work || '<div class="small muted">No workplaces yet.</div>'}<div class="small muted">${s.jobs?.idle || 0} idle (they forage and help build)</div>
        <h3>Construction</h3>${projects}
        <h3>Build</h3><div class="list">${build}</div>
        <h3>Garrison</h3><div class="small">${garrison}${training ? `<br><span class="muted">Training: ${training}</span>` : ''}</div>
        <div class="small muted">Barracks train ${cap} at a time. Recruits leave their jobs at once.</div>
        <div class="list">${recruit}</div>
        <div class="btns">
          <button class="btn small" data-act="levy" title="Call up militia: fast, weak, costs workers">Levy militia</button>
          <button class="btn small" data-act="army" ${Object.values(g).some((n) => n >= 1) ? '' : 'disabled'}>Form army</button>
          <button class="btn small" data-act="demob" ${Object.values(g).some((n) => n >= 1) ? '' : 'disabled'} title="Soldiers return to work after ${RULES.demobilizeTime}s">Send soldiers home</button>
        </div>
        <h3>Walls</h3>${walls}
        <h3>Expansion</h3>
        <div class="btns">
          <button class="btn small" data-act="mode-found" ${s.stage >= 1 && s.pop >= RULES.settlerMinPop ? '' : 'disabled'} title="${RULES.settlerPop} settlers, ${RULES.settlerCost.wood} wood, ${RULES.settlerCost.food} food">Send settlers…</button>
          <button class="btn small" data-act="mode-scout">Send scouts…</button>
          <button class="btn small" data-act="mode-road">Build road…</button>
        </div>
        <div class="small muted">Settlers need ${RULES.settlerPop} people, ${RULES.settlerCost.wood} wood and ${RULES.settlerCost.food} food and must reach explored land. A new outpost produces nothing until you build there.</div>
      </div>`;
  }

  foreignSettlementHtml(s) {
    const cw = this.cw;
    const owner = s.hub ? 'Free city (neutral)' : cw.kingdom(s.kingdom)?.name || 'Unknown';
    const atWar = !s.hub && cw.me && cw.me.relations?.[s.kingdom] === 'war';
    const prices = s.hub ? RES_KEYS.map((r) => `<tr><td>${iconImg(RES_ICON[r])} ${RESOURCES[r].name}</td><td>${cw.snap.prices[r]}</td></tr>`).join('') : '';
    return `<div class="head"><h2>${esc(s.name)}</h2><div class="sub" style="color:${cw.colorOf(s.kingdom)}">${esc(owner)}</div><button class="close" data-act="close">✕</button></div>
      <div class="scroll">
        <div class="row"><span>${STAGES[s.stage].name}</span><span>${Math.floor(s.pop)} people</span></div>
        <div class="row"><span>Walls</span><span>${s.walls.level ? `${WALLS[s.walls.level].name} (${Math.round(s.walls.hp)})` : 'none'}</span></div>
        ${s.hub ? '' : `<div class="row"><span>Garrison (scouts' estimate)</span><span>~${s.garrisonApprox ?? '?'}</span></div>`}
        ${s.siege ? '<div class="tag bad">Under siege</div>' : ''}
        ${s.hub ? `<h3>Market prices</h3><table class="t">${prices}</table><p class="small muted">Free cities buy and sell everything. Caravans from your markets trade here; roads and harbours shorten the journey.</p>` : ''}
        ${atWar ? '<p class="small">You are at war: select an army and right-click this town to besiege it. Walls must fall before the town can be taken.</p>' : ''}
      </div>`;
  }

  armyHtml(a) {
    const cw = this.cw;
    const mine = a.kid === cw.you;
    if (!mine) {
      return `<div class="head"><h2>Army</h2><div class="sub" style="color:${cw.colorOf(a.kid)}">${esc(cw.kingdom(a.kid)?.name || '')}</div><button class="close" data-act="close">✕</button></div>
        <div class="scroll"><div class="row"><span>Strength</span><span>${Math.round(a.n)}</span></div><div class="row"><span>State</span><span>${a.state}</span></div></div>`;
    }
    const units = Object.entries(a.units || {}).filter(([, n]) => n >= 0.5).map(([u, n]) => `<div class="row"><span>${UNITS[u].name}</span><span>${Math.round(n)}</span></div>`).join('');
    const near = cw.mySettlements().find((s) => Math.hypot(s.x - a.x, s.y - a.y) < 2.5);
    return `<div class="head"><h2>Army</h2><div class="sub">${a.state === 'siege' ? 'Besieging' : a.state === 'battle' ? 'In battle!' : a.state === 'retreat' ? 'Retreating' : a.state === 'moving' ? 'Marching' : 'Waiting'}</div><button class="close" data-act="close">✕</button></div>
      <div class="scroll">
        ${units}
        <h3>Morale</h3><div class="bar ${a.morale < 0.4 ? 'red' : ''}"><i style="width:${Math.round(a.morale * 100)}%"></i></div>
        <h3>Supply</h3><div class="bar ${a.inSupply ? '' : 'warm'}"><i style="width:${Math.round((a.supply / RULES.supplyCap) * 100)}%"></i></div>
        <div class="small muted">${a.inSupply ? 'In supply: fed from your stores.' : `Out of supply range (${RULES.supplyRange} tiles from your land): eating carried rations. Starving armies lose men.`}</div>
        <div class="btns"><button class="btn small" data-act="mode-move">Move…</button><button class="btn small" data-act="garrison" ${near ? '' : 'disabled'}>Garrison in ${esc(near?.name || 'town')}</button></div>
        <p class="small muted">Right-click the map to march. Armies cannot cross the borders of kingdoms you are at peace with. Roads double speed; rivers without bridges are slow and weaken attackers.</p>
      </div>`;
  }

  // -------------------------------------------------------------------------
  // Realm tabs

  renderTab() {
    const { el, cw } = this;
    if (el.right.hidden || !cw.snap || !cw.me) return;
    if (el.right.contains(document.activeElement) && ['INPUT', 'SELECT'].includes(document.activeElement.tagName)) return;
    for (const b of el.tabs.querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === this.tab);
    const html = { realm: () => this.realmHtml(), trade: () => this.tradeHtml(), diplomacy: () => this.diplomacyHtml(), chronicle: () => this.chronicleHtml() }[this.tab]();
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
    const opt = RES_KEYS.map((r) => `<option value="${r}">${RESOURCES[r].name}</option>`).join('');
    return `<h3>Free-city market</h3><table class="t"><tr><th>Good</th><th>Price</th><th>You have</th></tr>${prices}</table>
      <div class="small muted">Prices follow supply and demand at the free cities: selling a lot lowers the price, buying raises it. Caravans pay ${RULES.caravanCostPerTile} coin per tile each way and take time to travel; markets (2 caravans) and harbours (1, by sea) set your capacity.</div>
      <h3>Standing orders</h3>
      <div class="small">${markets.length ? `Caravans: ${caravans}/${slots}` : '<span class="bad">Build a market to trade.</span>'}</div>
      ${orders}
      <div class="item"><span class="small">
        <select data-f="side"><option value="sell">Sell</option><option value="buy">Buy</option></select>
        <input data-f="amount" type="number" value="40" min="1" max="200" style="width:52px">
        <select data-f="res">${opt}</select><br>
        stock threshold <input data-f="keep" type="number" value="200" style="width:56px">
        price limit <input data-f="limit" type="number" step="0.1" value="2" style="width:56px">
      </span><button class="btn small go" data-act="add-order" ${markets.length ? '' : 'disabled'}>Add</button></div>
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
        ${k.alive && rel !== 'war' ? `<span class="desc"><select data-f="give-${k.id}">${RES_KEYS.map((r) => `<option>${r}</option>`).join('')}</select><input data-f="gn-${k.id}" type="number" value="20" style="width:44px"> for <select data-f="get-${k.id}">${RES_KEYS.map((r, i) => `<option ${i === 1 ? 'selected' : ''}>${r}</option>`).join('')}</select><input data-f="tn-${k.id}" type="number" value="20" style="width:44px"> ×10 every 30s <button class="btn small" data-act="propose" data-to="${k.id}">Propose</button></span>` : ''}</div>`;
    }).join('');
    const peace = (cw.snap.proposals || []).filter((p) => p.peace && p.to === cw.you).map((p) => `<div class="item"><span>${esc(cw.kingdom(p.from)?.name)} offers peace</span><span><button class="btn small go" data-act="answer-peace" data-id="${p.id}" data-accept="1">Accept</button> <button class="btn small" data-act="answer-peace" data-id="${p.id}" data-accept="0">Refuse</button></span></div>`).join('');
    return `${peace ? `<h3>Peace offers</h3>${peace}` : ''}<h3>Kingdoms</h3><div class="list">${rows}</div>
      <div class="small muted">At peace, borders are closed to armies. War opens them, stops agreements and lets armies seize caravans. Victory: conquer every rival, hold 70% of all towns, or build the Grand Exchange in a city and hold it for ${RULES.wonderHold / 60} minutes. Otherwise the best score wins when time runs out.</div>`;
  }

  chronicleHtml() {
    const evs = this.cw.events.slice(-120).reverse();
    return `<h3>Chronicle</h3>${evs.map((e) => `<div class="small" ${e.x != null ? `data-act="goto-xy" data-x="${e.x}" data-y="${e.y}" style="cursor:pointer"` : ''}><span class="muted">${clock(e.t)}</span> ${esc(e.text)}</div>`).join('') || '<div class="muted">Nothing yet.</div>'}`;
  }

  // -------------------------------------------------------------------------
  // Placement

  renderPlacement(snap) {
    const { el, cw } = this;
    if (el.placement.hidden) {
      el.placement.hidden = false;
      el.placement.innerHTML = `<div class="head" style="padding:10px 12px;border-bottom:2px solid var(--parch-3)"><h2 style="font-family:var(--title-font);font-weight:400;font-size:34px;margin:0">Found your realm</h2><div class="sub muted">Choose where to build your capital. Every site trades one strength for another. Click the map to survey any spot.</div></div><div class="scroll"></div>`;
    }
    const body = el.placement.querySelector('.scroll');
    if (body.contains(document.activeElement)) return;
    const sites = cw.init.startSites.map((s, k) => `<div class="site ${this.placingSite && this.placingSite.x === s.x && this.placingSite.y === s.y ? 'on' : ''}" data-act="site" data-k="${k}"><div class="title">${esc(s.title)}</div><div class="small">${esc(s.blurb)}</div><div>${s.pros.map((p) => `<span class="tag good">${esc(p)}</span>`).join('')}${s.cons.map((p) => `<span class="tag bad">${esc(p)}</span>`).join('')}</div></div>`).join('');
    const p = this.placingSite;
    let survey = '';
    if (p) {
      const err = this.placementError(p.x, p.y);
      const a = analyzeSite(cw.world, p.x, p.y);
      const d = describeSite(a);
      const biome = BIOMES[cw.world.biome[p.y * cw.W + p.x]].name;
      survey = `<h3>Survey of ${p.x}, ${p.y}</h3><div class="small">${esc(biome)} · best for: ${esc(d.title)}</div><div>${d.pros.map((x) => `<span class="tag good">${esc(x)}</span>`).join('')}${d.cons.map((x) => `<span class="tag bad">${esc(x)}</span>`).join('')}</div>
        ${err ? `<div class="bad small">${esc(err)}</div>` : ''}
        <div class="btns"><button class="btn primary" data-act="place" ${err ? 'disabled' : ''}>Found the capital here</button></div>`;
    }
    const taken = snap.kingdoms.filter((k) => k.placed).length;
    body.innerHTML = `${survey}<h3>Suggested sites</h3>${sites}<div class="small muted">${taken} of ${snap.kingdoms.length} realms placed${this.single ? '. Rivals choose after you.' : '.'}</div>`;
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
    const canvas = this.r.canvas;
    canvas.classList.toggle('targeting', !!mode);
    const hints = {
      found: 'Click explored land to send settlers there. Esc cancels.',
      scout: 'Click where the scouts should explore. Esc cancels.',
      road: 'Click the settlement or free city the road should reach. Esc cancels.',
      move: 'Click (or right-click) where the army should march. Esc cancels.',
    };
    this.el.hint.hidden = !mode;
    if (mode) this.el.hint.textContent = hints[mode.kind];
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

  clickTile(t, button = 0) {
    const cw = this.cw;
    const x = Math.floor(t.x);
    const y = Math.floor(t.y);
    if (cw.snap?.phase === 'placement' && cw.me && !cw.me.placed) {
      this.placingSite = { x, y };
      this.r.preview = { x, y, ok: !this.placementError(x, y), radius: STAGES[1].radius };
      this.renderPlacement(cw.snap);
      return;
    }
    const m = this.mode;
    if (m) {
      if (m.kind === 'found') this.send({ type: 'found', sid: m.sid, x, y });
      else if (m.kind === 'scout') this.send({ type: 'scout', sid: m.sid, x, y });
      else if (m.kind === 'road') {
        const s = cw.settlementAt(t.x, t.y);
        if (!s) return;
        this.send({ type: 'road', a: m.sid, b: s.id });
      } else if (m.kind === 'move') this.moveArmyTo(m.aid, t);
      this.setMode(null);
      return;
    }
    if (button === 2) {
      const sel = this.r.selection;
      if (sel && sel.type === 'army' && cw.army(sel.id)?.kid === cw.you) this.moveArmyTo(sel.id, t);
      return;
    }
    const a = cw.armyAt(t.x - 0.5, t.y - 0.5);
    if (a) return this.select({ type: 'army', id: a.id });
    const s = cw.settlementAt(t.x, t.y);
    if (s) return this.select({ type: 'settlement', id: s.id });
    this.select(null);
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
  }

  setSpeed(v) {
    if (!this.single) return;
    this.speed = v;
    this.tx.setSpeed(v);
    if (this.cw.snap) this.renderTop(this.cw.snap);
  }

  showTip(html, x, y, isHtml = true) {
    const tip = this.el.tip;
    if (!html) {
      tip.hidden = true;
      return;
    }
    if (isHtml) tip.innerHTML = html;
    else tip.textContent = html;
    tip.hidden = false;
    tip.style.left = `${Math.min(window.innerWidth - 310, x + 16)}px`;
    tip.style.top = `${Math.min(window.innerHeight - 80, y + 16)}px`;
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
        this.toast('An army musters outside the town. Select it and right-click to march.', 'info');
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
          this.r.centerOn(s.x, s.y, Math.max(this.r.cam.ppt, 16));
          this.select({ type: 'settlement', id: s.id });
        }
        break;
      }
      case 'goto-xy':
        this.r.centerOn(Number(d.x), Number(d.y), Math.max(this.r.cam.ppt, 16));
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
        this.r.centerOn(s.x, s.y, 8);
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
    on(canvas, 'pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, cx: this.r.cam.x, cy: this.r.cam.y, moved: false, button: e.button };
    });
    on(canvas, 'pointermove', (e) => {
      const t = this.r.screenToTile(e.clientX, e.clientY);
      if (drag && (drag.button === 0 || drag.button === 1)) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
        if (drag.moved) {
          canvas.classList.add('dragging');
          this.r.cam.x = drag.cx - dx / this.r.cam.ppt;
          this.r.cam.y = drag.cy - dy / this.r.cam.ppt;
          this.r.clampCam();
        }
      }
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
    on(canvas, 'pointerup', (e) => {
      canvas.classList.remove('dragging');
      if (drag && !drag.moved) this.clickTile(this.r.screenToTile(e.clientX, e.clientY), drag.button);
      drag = null;
    });
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

export { HOUSE };
