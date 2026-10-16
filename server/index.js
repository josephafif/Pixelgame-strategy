// Realmwright server: serves the client and hosts authoritative multiplayer
// matches over WebSocket (/ws).
//
//   node server/index.js [--port 8080] [--host 0.0.0.0]

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeStaticHandler } from './static.js';
import { attachWebSocket } from './ws.js';
import { Room, roomCode, sanitizeName } from './rooms.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CMD_PER_SEC = 25;

export function createGameServer({ root = ROOT, log = console.log } = {}) {
  const rooms = new Map();
  let nextClient = 1;
  const http = createServer(makeStaticHandler(root));

  const handle = (c, msg) => {
    const reply = (o) => c.ws.send(o);
    switch (msg.t) {
      case 'hello':
        c.name = sanitizeName(msg.name);
        reply({ t: 'welcome', id: c.id, name: c.name });
        break;
      case 'list':
        reply({ t: 'rooms', rooms: [...rooms.values()].filter((r) => r.phase === 'lobby').map((r) => r.info()) });
        break;
      case 'create': {
        if (c.room) c.room.remove(c);
        const code = roomCode(rooms);
        const room = new Room(code, c, msg.opts || {});
        rooms.set(code, room);
        room.add(c, msg.name || c.name);
        log(`room ${code} created by ${c.name}`);
        break;
      }
      case 'join': {
        const room = rooms.get(String(msg.code || '').toUpperCase().trim());
        if (!room) return reply({ t: 'error', text: 'No room with that code.' });
        if (c.room && c.room !== room) c.room.remove(c);
        const r = room.add(c, msg.name || c.name, msg.token);
        if (typeof r === 'string') reply({ t: 'error', text: r });
        break;
      }
      case 'opts': {
        const err = c.room ? c.room.setOpts(c, msg.opts) : 'Not in a room.';
        if (err) reply({ t: 'error', text: err });
        break;
      }
      case 'start': {
        const err = c.room ? c.room.start(c) : 'Not in a room.';
        if (err) reply({ t: 'error', text: err });
        else log(`room ${c.room.code} started (${c.room.members.length} humans, ${c.room.opts.ais} AI)`);
        break;
      }
      case 'cmd': {
        const now = Date.now();
        if (now - c.windowStart > 1000) {
          c.windowStart = now;
          c.cmds = 0;
        }
        if (++c.cmds > CMD_PER_SEC) return reply({ t: 'error', text: 'Too many commands; slow down.' });
        const err = c.room ? c.room.command(c, msg.cmd) : 'Not in a room.';
        if (err) reply({ t: 'error', text: err });
        break;
      }
      case 'leave':
        if (c.room) c.room.remove(c);
        c.room = null;
        break;
      case 'ping':
        reply({ t: 'pong', at: msg.at });
        break;
      default:
        reply({ t: 'error', text: 'Unknown message.' });
    }
    return undefined;
  };

  attachWebSocket(http, '/ws', (ws) => {
    const c = { id: nextClient++, ws, name: 'Lord', room: null, cmds: 0, windowStart: 0 };
    ws.on('message', (text) => {
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        ws.send({ t: 'error', text: 'Bad message.' });
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      try {
        handle(c, msg);
      } catch (e) {
        log('handler error', e);
        ws.send({ t: 'error', text: 'Server error.' });
      }
    });
    ws.on('close', () => {
      if (c.room) c.room.remove(c);
    });
  });

  const sweep = setInterval(() => {
    for (const [code, r] of rooms) {
      if (r.idle()) {
        r.close();
        rooms.delete(code);
      }
    }
  }, 60 * 1000);
  sweep.unref();

  return {
    http,
    rooms,
    listen(port, host) {
      return new Promise((resolve) => http.listen(port, host, () => resolve(http.address().port)));
    },
    close() {
      for (const r of rooms.values()) r.close();
      clearInterval(sweep);
      return new Promise((resolve) => http.close(() => resolve()));
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (name, d) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : d;
  };
  const port = Number(arg('--port', process.env.PORT || 8080));
  const host = arg('--host', process.env.HOST || '0.0.0.0');
  const srv = createGameServer();
  srv.listen(port, host).then((p) => console.log(`Realmwright on http://localhost:${p}  (multiplayer at ws://<host>:${p}/ws)`));
}
