// The client's picture of the match: the terrain (regenerated locally from
// the seed), the territory (sent in full once, then as changed tiles), the
// latest snapshot and the settlement layouts. It records which tiles and
// layouts changed so the renderer only repaints those.

import { generateWorld, WORLD_SIZES } from '../../engine/world/worldgen.js';
import { deserializeLayout, N as LN } from '../../engine/settlement/planner.js';
import { unrle, applyDelta } from '../../engine/net/protocol.js';
import { makeOverlays, restampArea } from '../render/settlement-layer.js';
import { CHUNK } from '../render/ground.js';
import { isOpenWater } from '../../engine/world/biomes.js';

export class ClientWorld {
  constructor(init) {
    this.init = init;
    this.you = init.you;
    const t0 = performance.now();
    this.world = generateWorld({ seed: init.seed, ...WORLD_SIZES[init.size] });
    this.genMs = performance.now() - t0;
    const W = this.world.width;
    const H = this.world.height;
    this.W = W;
    this.H = H;
    this.ov = makeOverlays(this.world);
    this.layouts = new Map();
    this.owner = new Int16Array(W * H).fill(-1);
    this.land = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) this.land[i] = isOpenWater(this.world.biome[i]) ? 0 : 1;
    this.snap = null;
    this.prevSnap = null;
    this.snapAt = 0;
    this.snapGap = 200;
    this.dirtyChunks = new Set();
    this.layerDirty = new Set();
    this.terrAll = true; // repaint the whole territory image
    this.terrTiles = []; // or just these tiles
    this.terrV = 0;
    this.events = [];
    this.listeners = new Set();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(kind, data) {
    for (const fn of this.listeners) fn(kind, data);
  }

  markArea(x0, y0, x1, y1) {
    for (let cy = Math.floor((y0 - 1) / CHUNK); cy <= Math.floor((y1 + 1) / CHUNK); cy++) {
      for (let cx = Math.floor((x0 - 1) / CHUNK); cx <= Math.floor((x1 + 1) / CHUNK); cx++) this.dirtyChunks.add(`${cx},${cy}`);
    }
  }

  apply(msg) {
    switch (msg.t) {
      case 'terr':
        this.owner = unrle(msg.owner, Int16Array, this.W * this.H);
        this.terrAll = true;
        this.terrTiles = [];
        this.terrV++;
        break;
      case 'layout': {
        const L = deserializeLayout(msg.data);
        this.layouts.set(msg.sid, L);
        restampArea(this.world, this.ov, [...this.layouts.values()], L.ox, L.oy, L.ox + LN - 1, L.oy + LN - 1);
        this.markArea(L.ox, L.oy, L.ox + LN - 1, L.oy + LN - 1);
        this.layerDirty.add(msg.sid);
        break;
      }
      case 'snap': {
        if (msg.td && msg.td.length) {
          const list = this.terrTiles;
          applyDelta(this.owner, msg.td, (i) => list.push(i));
          if (list.length > 60000) {
            this.terrAll = true;
            this.terrTiles = [];
          }
          this.terrV++;
        }
        const now = performance.now();
        if (this.snap) this.snapGap = Math.max(60, Math.min(600, now - this.snapAt));
        this.prevSnap = this.snap;
        this.snap = msg;
        this.snapAt = now;
        this.players = msg.players;
        this.byId = new Map(msg.structures.map((s) => [s.id, s]));
        // A structure that changed hands needs its banners repainted.
        if (this.prevSnap) {
          const before = new Map(this.prevSnap.structures.map((s) => [s.id, s.owner]));
          for (const s of msg.structures) if (before.get(s.id) !== s.owner) this.layerDirty.add(s.id);
        }
        if (msg.events && msg.events.length) {
          for (const e of msg.events) this.events.push(e);
          if (this.events.length > 300) this.events.splice(0, this.events.length - 250);
          this.emit('events', msg.events);
        }
        this.emit('snap', msg);
        break;
      }
      default:
        break;
    }
  }

  // Convenience accessors over the latest snapshot.
  get me() {
    return this.snap && this.you >= 0 ? this.snap.players[this.you] : null;
  }

  player(id) {
    return this.snap && id >= 0 ? this.snap.players[id] : null;
  }

  structure(id) {
    return this.byId?.get(id) || null;
  }

  colorOf(pid) {
    const p = this.player(pid);
    return p ? p.color : '#888888';
  }

  ownerAt(x, y) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return -1;
    return this.owner[y * this.W + x];
  }

  isLand(x, y) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return false;
    return !!this.land[y * this.W + x];
  }

  allied(a, b) {
    if (!this.snap || a < 0 || b < 0 || a === b) return false;
    return this.snap.alliances.some((q) => (q.a === a && q.b === b) || (q.a === b && q.b === a));
  }

  alliance(a, b) {
    return this.snap?.alliances.find((q) => (q.a === a && q.b === b) || (q.a === b && q.b === a)) || null;
  }

  /** The structure nearest (x, y) within r tiles. */
  structureAt(x, y, r = 2.5) {
    if (!this.snap) return null;
    let best = null;
    for (const s of this.snap.structures) {
      const d = Math.hypot(s.x + 0.5 - x, s.y + 0.5 - y);
      if (d <= r && (!best || d < best.d)) best = { s, d };
    }
    return best ? best.s : null;
  }

  share(pid) {
    const p = this.player(pid);
    return p ? p.tiles / Math.max(1, this.init.landTotal) : 0;
  }
}
