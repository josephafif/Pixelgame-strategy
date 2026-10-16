// The client's picture of the match: the terrain (regenerated locally from
// the seed), the latest snapshot, and versioned bulk data (territory, roads,
// exploration, settlement layouts). It tracks which render caches are dirty.

import { generateWorld, WORLD_SIZES } from '../../engine/world/worldgen.js';
import { deserializeLayout, N as LN } from '../../engine/settlement/planner.js';
import { unrle } from '../../engine/net/protocol.js';
import { makeOverlays, restampArea } from '../render/settlement-layer.js';
import { CHUNK } from '../render/ground.js';

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
    this.owner = new Int32Array(W * H).fill(-1);
    this.ownerK = new Int8Array(W * H).fill(-1);
    this.explored = new Uint8Array(W * H);
    if (this.you < 0) this.explored.fill(1);
    this.sidKingdom = new Map();
    this.snap = null;
    this.prevSnap = null;
    this.snapAt = 0;
    this.dirtyChunks = new Set();
    this.layerDirty = new Set();
    this.territoryDirty = true;
    this.fogDirty = true;
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
      case 'terr': {
        this.owner = unrle(msg.owner, Int32Array, this.W * this.H);
        this.recomputeOwnerK();
        break;
      }
      case 'roads': {
        const next = unrle(msg.data, Uint8Array, this.W * this.H);
        const prev = this.ov.worldRoad;
        const changed = [];
        for (let i = 0; i < next.length; i++) if (next[i] !== prev[i]) changed.push(i);
        this.ov.worldRoad = next;
        const all = [...this.layouts.values()];
        for (const i of changed) {
          const x = i % this.W;
          const y = (i / this.W) | 0;
          restampArea(this.world, this.ov, all, x - 1, y - 1, x + 1, y + 1);
          this.markArea(x, y, x, y);
        }
        break;
      }
      case 'explored': {
        this.explored = unrle(msg.data, Uint8Array, this.W * this.H);
        this.fogDirty = true;
        this.territoryDirty = true;
        break;
      }
      case 'layout': {
        const L = deserializeLayout(msg.data);
        this.layouts.set(msg.sid, L);
        restampArea(this.world, this.ov, [...this.layouts.values()], L.ox, L.oy, L.ox + LN - 1, L.oy + LN - 1);
        this.markArea(L.ox, L.oy, L.ox + LN - 1, L.oy + LN - 1);
        this.layerDirty.add(msg.sid);
        break;
      }
      case 'snap': {
        this.prevSnap = this.snap;
        this.snap = msg;
        this.snapAt = performance.now();
        let ownerChange = false;
        for (const s of msg.settlements) {
          if (this.sidKingdom.get(s.id) !== s.kingdom) {
            this.sidKingdom.set(s.id, s.kingdom);
            this.layerDirty.add(s.id);
            ownerChange = true;
          }
        }
        if (ownerChange) this.recomputeOwnerK();
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

  recomputeOwnerK() {
    const map = this.sidKingdom;
    for (let i = 0; i < this.owner.length; i++) {
      const o = this.owner[i];
      this.ownerK[i] = o < 0 ? -1 : map.has(o) ? map.get(o) : -3; // -3: unknown (unexplored) owner
    }
    this.territoryDirty = true;
  }

  // Convenience accessors over the latest snapshot.
  get me() {
    return this.snap && this.you >= 0 ? this.snap.kingdoms[this.you] : null;
  }

  kingdom(id) {
    return this.snap ? this.snap.kingdoms[id] : null;
  }

  settlement(id) {
    return this.snap ? this.snap.settlements.find((s) => s.id === id) : null;
  }

  army(id) {
    return this.snap ? this.snap.armies.find((a) => a.id === id) : null;
  }

  mySettlements() {
    return this.snap ? this.snap.settlements.filter((s) => s.kingdom === this.you) : [];
  }

  colorOf(kid) {
    if (kid === -2) return '#c8b88a';
    const k = this.kingdom(kid);
    return k ? k.color : '#888888';
  }

  isExplored(x, y) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return false;
    return !!this.explored[y * this.W + x];
  }

  /** Settlement under a world tile (nearest centre within its built area). */
  settlementAt(x, y) {
    if (!this.snap) return null;
    let best = null;
    for (const s of this.snap.settlements) {
      const r = 3 + s.stage * 1.5;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= r && (!best || d < best.d)) best = { s, d };
    }
    return best ? best.s : null;
  }

  armyAt(x, y, radius = 1.2) {
    if (!this.snap) return null;
    let best = null;
    for (const a of this.snap.armies) {
      const d = Math.hypot(a.x - x, a.y - y);
      if (d <= radius && (!best || d < best.d)) best = { a, d };
    }
    return best ? best.a : null;
  }
}
