import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/index.js';
import { unrle, applyDelta } from '../engine/net/protocol.js';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  const waiters = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    inbox.push(msg);
    for (const w of waiters.slice()) {
      if (w.pred(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  });
  const opened = new Promise((r) => ws.addEventListener('open', r));
  return {
    ws,
    inbox,
    opened,
    send: (o) => ws.send(JSON.stringify(o)),
    wait(pred, ms = 20000) {
      const hit = inbox.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => reject(new Error('timeout waiting for message')), ms);
      });
    },
    latest(type) {
      for (let i = inbox.length - 1; i >= 0; i--) if (inbox[i].t === type) return inbox[i];
      return null;
    },
  };
}

test('two players join a room, choose where to start and share one authoritative match', { timeout: 120000 }, async () => {
  const srv = createGameServer({ log: () => {} });
  const port = await srv.listen(0, '127.0.0.1');
  try {
    const a = client(port);
    const b = client(port);
    await Promise.all([a.opened, b.opened]);
    a.send({ t: 'hello', name: 'Aster' });
    b.send({ t: 'hello', name: 'Brann<script>' });
    await a.wait((m) => m.t === 'welcome');
    const bw = await b.wait((m) => m.t === 'welcome');
    assert.equal(bw.name, 'Brannscript', 'names are sanitised');

    a.send({ t: 'create', opts: { seed: 77, size: 'small', ais: 1, placementTime: 15 } });
    const lobby = await a.wait((m) => m.t === 'lobby');
    const code = lobby.room.code;
    assert.match(code, /^[A-Z0-9]{5}$/);
    b.send({ t: 'join', code });
    await a.wait((m) => m.t === 'lobby' && m.room.players.length === 2);

    // Only the host may start.
    b.send({ t: 'start' });
    const err = await b.wait((m) => m.t === 'error');
    assert.match(err.text, /host/);

    a.send({ t: 'start' });
    const ia = await a.wait((m) => m.t === 'init');
    const ib = await b.wait((m) => m.t === 'init');
    assert.equal(ia.seed, 77);
    assert.equal(ib.seed, 77);
    assert.notEqual(ia.you, ib.you);
    assert.ok(ia.startSites.length >= 3);
    await a.wait((m) => m.t === 'snap' && m.phase === 'placement');

    // Each player places on a different suggested site.
    a.send({ t: 'cmd', cmd: { type: 'place', x: ia.startSites[0].x, y: ia.startSites[0].y } });
    const far = ib.startSites.find((s) => Math.hypot(s.x - ia.startSites[0].x, s.y - ia.startSites[0].y) > 30);
    b.send({ t: 'cmd', cmd: { type: 'place', x: far.x, y: far.y } });
    const runA = await a.wait((m) => m.t === 'snap' && m.phase === 'running', 40000);
    const runB = await b.wait((m) => m.t === 'snap' && m.phase === 'running', 40000);
    assert.equal(runA.players.length, 3, 'two humans and one AI');

    // Private data only reaches its owner.
    const meA = runA.players[ia.you];
    const otherA = runA.players[ib.you];
    assert.ok(meA.gold !== undefined && meA.troopShare !== undefined);
    assert.equal(otherA.gold, undefined, 'no peeking at rivals');
    assert.ok(otherA.troops > 0, 'troops are public');
    assert.ok(runB.players[ib.you].gold !== undefined);

    // Bulk data arrives: territory, layouts for the starting town.
    const terr = a.latest('terr');
    assert.ok(terr && terr.owner.length >= 2);
    const owner = unrle(terr.owner, Int16Array, 320 * 224);
    for (const m of a.inbox.slice(a.inbox.lastIndexOf(terr))) if (m.t === 'snap' && m.td) applyDelta(owner, m.td);
    assert.ok(owner.some((v) => v === ia.you), 'the start shows up in the territory');
    const capA = runA.structures.find((s) => s.owner === ia.you && s.capital);
    assert.ok(capA, 'a starting town');
    assert.ok(a.inbox.some((m) => m.t === 'layout' && m.sid === capA.id));

    // A command goes through server-side validation; errors come back as events.
    a.send({ t: 'cmd', cmd: { type: 'build', kind: 'town', x: far.x, y: far.y } });
    const errSnap = await a.wait((m) => m.t === 'snap' && (m.events || []).some((e) => e.kind === 'error'));
    assert.ok(errSnap.events.some((e) => /own land|costs/i.test(e.text)));
    // A valid command changes authoritative state, visible to its owner.
    a.send({ t: 'cmd', cmd: { type: 'troops', share: 0.25 } });
    const moved = await a.wait((m) => m.t === 'snap' && m.players[ia.you].troopShare === 0.25);
    assert.ok(moved);
    // Nobody can give orders to another player's town.
    b.send({ t: 'cmd', cmd: { type: 'upgrade', sid: capA.id } });
    const refused = await b.wait((m) => m.t === 'snap' && (m.events || []).some((e) => /Not your town/.test(e.text)));
    assert.ok(refused);
    // Territory changes arrive as small deltas.
    await a.wait((m) => m.t === 'snap' && m.td && m.td.length > 0, 30000);

    // Both clients observe the same public clock and the same rival positions.
    const sa = a.latest('snap');
    const sb = b.latest('snap');
    assert.ok(Math.abs(sa.tick - sb.tick) <= 2);

    // Reconnecting with the token restores the player's kingdom.
    const joinedB = b.inbox.find((m) => m.t === 'joined');
    b.ws.close();
    await new Promise((r) => setTimeout(r, 300));
    const b2 = client(port);
    await b2.opened;
    b2.send({ t: 'hello', name: 'Brann' });
    b2.send({ t: 'join', code, token: joinedB.token });
    const ib2 = await b2.wait((m) => m.t === 'init');
    assert.equal(ib2.you, ib.you);
    await b2.wait((m) => m.t === 'snap' && m.players[ib.you].gold !== undefined);
    a.ws.close();
    b2.ws.close();
  } finally {
    await srv.close();
  }
});

test('the server serves the client but not server code', async () => {
  const srv = createGameServer({ log: () => {} });
  const port = await srv.listen(0, '127.0.0.1');
  try {
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200, 'root redirects to the client');
    assert.match(await page.text(), /<html/i);
    const eng = await fetch(`http://127.0.0.1:${port}/engine/sim/defs.js`);
    assert.equal(eng.status, 200);
    const secret = await fetch(`http://127.0.0.1:${port}/server/index.js`);
    assert.equal(secret.status, 404);
    const trav = await fetch(`http://127.0.0.1:${port}/client/../server/rooms.js`);
    assert.equal(trav.status, 404);
  } finally {
    await srv.close();
  }
});

test('a running match survives a server restart and players rejoin with their token', { timeout: 120000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'realmwright-saves-'));
  try {
    let srv = createGameServer({ log: () => {}, saveDir: dir });
    let port = await srv.listen(0, '127.0.0.1');
    const a = client(port);
    await a.opened;
    a.send({ t: 'hello', name: 'Aster' });
    a.send({ t: 'create', opts: { seed: 31, size: 'small', ais: 1, placementTime: 10 } });
    const lobby = await a.wait((m) => m.t === 'lobby');
    const code = lobby.room.code;
    const joined = await a.wait((m) => m.t === 'joined');
    a.send({ t: 'start' });
    const init = await a.wait((m) => m.t === 'init');
    a.send({ t: 'cmd', cmd: { type: 'place', x: init.startSites[0].x, y: init.startSites[0].y } });
    await a.wait((m) => m.t === 'snap' && m.phase === 'running', 40000);
    const before = await a.wait((m) => m.t === 'snap' && m.phase === 'running' && m.time > 3, 40000);
    a.ws.close();
    await new Promise((r) => setTimeout(r, 200));
    await srv.close();
    assert.deepEqual(readdirSync(dir), [`${code}.json`], 'the match was written to disk');

    // A new server process on the same save directory.
    srv = createGameServer({ log: () => {}, saveDir: dir });
    port = await srv.listen(0, '127.0.0.1');
    assert.equal(srv.rooms.size, 0, 'rooms load lazily');
    const a2 = client(port);
    await a2.opened;
    a2.send({ t: 'hello', name: 'Aster' });
    a2.send({ t: 'join', code, token: joined.token });
    const init2 = await a2.wait((m) => m.t === 'init');
    assert.equal(init2.you, init.you, 'same kingdom after the restart');
    const snap = await a2.wait((m) => m.t === 'snap' && m.players[init.you].gold !== undefined);
    assert.equal(snap.phase, 'running');
    assert.ok(snap.time >= before.time, `clock continues (${snap.time} >= ${before.time})`);
    assert.ok(snap.structures.some((s) => s.owner === init.you), 'the starting town is still there');
    // And the match runs on.
    await a2.wait((m) => m.t === 'snap' && m.time > snap.time + 1, 20000);
    // A stranger with a wrong token only gets to watch.
    const c = client(port);
    await c.opened;
    c.send({ t: 'hello', name: 'Corin' });
    c.send({ t: 'join', code, token: 'nope' });
    const ic = await c.wait((m) => m.t === 'init');
    assert.equal(ic.you, -1);
    a2.ws.close();
    c.ws.close();
    await new Promise((r) => setTimeout(r, 200));
    await srv.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
