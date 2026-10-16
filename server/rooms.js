// Multiplayer rooms: a lobby, then an authoritative match ticking on the
// server. Clients send commands; the server validates them through the
// simulation and streams per-player snapshots back.

import { randomBytes } from 'node:crypto';
import { Match, PERSONALITIES } from '../engine/sim/match.js';
import { TICK } from '../engine/sim/defs.js';
import { PlayerView, initMessage } from '../engine/net/protocol.js';
import { saveMatch, loadMatch } from '../engine/sim/persist.js';

const SIZES = ['small', 'medium', 'large'];
const MAX_PLAYERS = 8;
const MAX_AIS = 24;
const SEND_EVERY = 2; // ticks between snapshots (0.2 s)
export const DEFAULT_AIS = { small: 6, medium: 10, large: 16 };
const MAX_BACKLOG = 1 << 20;

export function sanitizeName(name) {
  const s = String(name || '').replace(/[^\p{L}\p{N} _'.-]/gu, '').trim().slice(0, 20);
  return s || 'Lord';
}

export function sanitizeOpts(o = {}, prev = {}) {
  const num = (v, d, lo, hi) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d);
  const size = SIZES.includes(o.size) ? o.size : prev.size || 'medium';
  return {
    seed: num(o.seed ?? prev.seed, prev.seed ?? Math.floor(Math.random() * 1e6), 1, 2 ** 31 - 1),
    size,
    ais: num(o.ais ?? prev.ais, prev.ais ?? DEFAULT_AIS[size], 0, MAX_AIS),
    placementTime: num(o.placementTime ?? prev.placementTime, prev.placementTime ?? 20, 10, 120),
    timeLimit: num(o.timeLimit ?? prev.timeLimit, prev.timeLimit ?? 20, 5, 60),
    difficulty: ['easy', 'normal', 'hard'].includes(o.difficulty) ? o.difficulty : prev.difficulty || 'normal',
  };
}

export class Room {
  constructor(code, hostClient, opts) {
    this.code = code;
    this.host = hostClient.id;
    this.opts = sanitizeOpts(opts);
    this.members = []; // { client, name, token, kid, online }
    this.match = null;
    this.views = new Map();
    this.timer = null;
    this.ticks = 0;
    this.created = Date.now();
    this.lastActive = Date.now();
  }

  /** Everything needed to bring the room back after a restart. */
  toSave() {
    return {
      format: 'realmwright-room',
      version: 1,
      code: this.code,
      opts: this.opts,
      created: this.created,
      members: this.members.map((m) => ({ name: m.name, token: m.token, kid: m.kid })),
      match: saveMatch(this.match),
    };
  }

  /** A room restored from disk: everyone is away and the match is paused until someone returns. */
  static fromSave(data) {
    if (!data || data.format !== 'realmwright-room' || data.version !== 1) throw new Error('not a room save');
    const room = Object.create(Room.prototype);
    room.code = data.code;
    room.host = null;
    room.opts = sanitizeOpts(data.opts);
    room.members = data.members.map((m) => ({ client: null, name: sanitizeName(m.name), token: String(m.token), kid: m.kid | 0, online: false }));
    room.match = loadMatch(data.match);
    room.views = new Map();
    room.timer = null;
    room.ticks = 0;
    room.created = data.created || Date.now();
    room.lastActive = Date.now();
    room.restored = true;
    return room;
  }

  get paused() {
    return !!this.match && !this.timer;
  }

  resume() {
    if (this.timer || !this.match) return;
    this.timer = setInterval(() => this.tick(), TICK * 1000);
  }

  get phase() {
    return this.match ? this.match.state.phase : 'lobby';
  }

  info() {
    return {
      code: this.code,
      phase: this.phase,
      host: this.members.find((m) => m.client && m.client.id === this.host)?.name || '?',
      players: this.members.map((m) => ({ name: m.name, kid: m.kid, online: m.online, host: m.client && m.client.id === this.host })),
      opts: this.opts,
    };
  }

  broadcastLobby() {
    const msg = { t: 'lobby', room: this.info() };
    for (const m of this.members) if (m.online) m.client.ws.send(msg);
  }

  /** Join (or rejoin with a token). Returns the member or an error string. */
  add(client, name, token) {
    this.lastActive = Date.now();
    const existing = token && this.members.find((m) => m.token === token);
    if (existing) {
      existing.client = client;
      existing.online = true;
      client.room = this;
      client.member = existing;
      client.ws.send({ t: 'joined', code: this.code, token: existing.token, kid: existing.kid });
      if (this.match) {
        this.sendInit(existing);
        this.resume(); // a restored match waits for its first returning player
      } else this.broadcastLobby();
      return existing;
    }
    if (this.match) {
      // Late arrivals watch as spectators.
      const m = { client, name: sanitizeName(name), token: randomBytes(12).toString('hex'), kid: -1, online: true };
      this.members.push(m);
      client.room = this;
      client.member = m;
      client.ws.send({ t: 'joined', code: this.code, token: m.token, kid: -1 });
      this.sendInit(m);
      return m;
    }
    if (this.members.length >= MAX_PLAYERS) return 'The room is full.';
    const m = { client, name: sanitizeName(name), token: randomBytes(12).toString('hex'), kid: -1, online: true };
    this.members.push(m);
    client.room = this;
    client.member = m;
    client.ws.send({ t: 'joined', code: this.code, token: m.token, kid: -1 });
    this.broadcastLobby();
    return m;
  }

  remove(client) {
    const m = this.members.find((q) => q.client === client);
    if (!m) return;
    m.online = false;
    if (!this.match) {
      this.members = this.members.filter((q) => q !== m);
      if (client.id === this.host && this.members.length) this.host = this.members[0].client.id;
      this.broadcastLobby();
    }
  }

  setOpts(client, opts) {
    if (client.id !== this.host || this.match) return 'Only the host can change settings before the start.';
    this.opts = sanitizeOpts(opts, this.opts);
    this.broadcastLobby();
    return null;
  }

  start(client) {
    if (client.id !== this.host) return 'Only the host can start the match.';
    if (this.match) return 'Already started.';
    const humans = this.members.filter((m) => m.online);
    const players = humans.map((m) => ({ name: m.name }));
    const total = Math.min(MAX_PLAYERS + MAX_AIS, players.length + this.opts.ais);
    for (let i = players.length; i < total; i++) players.push({ ai: true, personality: PERSONALITIES[i % 3] });
    this.match = new Match({ seed: this.opts.seed, size: this.opts.size, players, placementTime: this.opts.placementTime, timeLimit: this.opts.timeLimit * 60, difficulty: this.opts.difficulty });
    humans.forEach((m, k) => {
      m.kid = k;
    });
    for (const m of this.members) if (m.online) this.sendInit(m);
    this.resume();
    return null;
  }

  sendInit(m) {
    const view = new PlayerView(this.match, m.kid);
    this.views.set(m, view);
    m.client.ws.send(initMessage(this.match, m.kid));
    for (const msg of view.messages(true)) m.client.ws.send(msg);
  }

  command(client, cmd) {
    const m = this.members.find((q) => q.client === client);
    if (!m || !this.match || m.kid < 0) return 'You are not playing in this match.';
    this.lastActive = Date.now();
    this.match.command(m.kid, cmd);
    return null;
  }

  tick() {
    const match = this.match;
    const t0 = performance.now();
    match.step();
    this.ticks++;
    this.stepMs = performance.now() - t0;
    if (this.ticks % SEND_EVERY !== 0) return;
    for (const m of this.members) {
      if (!m.online || !m.client.ws.open) continue;
      if (m.client.ws.backlog > MAX_BACKLOG) continue; // slow client: skip a frame
      const view = this.views.get(m);
      if (!view) continue;
      for (const msg of view.messages()) m.client.ws.send(msg);
    }
  }

  idle() {
    const online = this.members.some((m) => m.online);
    return !online && Date.now() - this.lastActive > 10 * 60 * 1000;
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export function roomCode(existing) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    const b = randomBytes(5);
    for (let i = 0; i < 5; i++) c += A[b[i] % A.length];
    if (!existing.has(c)) return c;
  }
}
