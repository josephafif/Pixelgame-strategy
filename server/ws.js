// A small, dependency-free WebSocket server (RFC 6455): handshake, text
// frames, fragmentation, ping/pong and close. Enough for game traffic.

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 64 * 1024;

export class WsConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.open = true;
    socket.setNoDelay(true);
    socket.on('data', (d) => this._data(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }

  _closed() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }

  _data(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.buf.length >= 2) {
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const hi = this.buf.readUInt32BE(2);
        len = hi * 2 ** 32 + this.buf.readUInt32BE(6);
        off = 10;
      }
      if (len > MAX_MESSAGE) {
        this.close(1009, 'message too big');
        return;
      }
      if (!masked) {
        this.close(1002, 'client frames must be masked');
        return;
      }
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      if (op === 0x8) {
        this.close(1000);
        return;
      }
      if (op === 0x9) {
        this._send(0xa, payload);
        continue;
      }
      if (op === 0xa) continue;
      if (op === 0x1 || op === 0x2 || op === 0x0) {
        this.frags.push(payload);
        if (fin) {
          const msg = Buffer.concat(this.frags);
          this.frags = [];
          if (msg.length > MAX_MESSAGE) {
            this.close(1009, 'message too big');
            return;
          }
          this.emit('message', msg.toString('utf8'));
        }
      }
    }
  }

  _send(op, payload) {
    if (!this.open) return;
    const len = payload.length;
    let head;
    if (len < 126) {
      head = Buffer.from([0x80 | op, len]);
    } else if (len < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x80 | op;
      head[1] = 126;
      head.writeUInt16BE(len, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | op;
      head[1] = 127;
      head.writeUInt32BE(Math.floor(len / 2 ** 32), 2);
      head.writeUInt32BE(len >>> 0, 6);
    }
    this.socket.write(Buffer.concat([head, payload]));
  }

  /** Bytes queued but not yet flushed to the network. */
  get backlog() {
    return this.socket.writableLength;
  }

  send(obj) {
    this._send(0x1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8'));
  }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    const p = Buffer.alloc(2 + Buffer.byteLength(reason));
    p.writeUInt16BE(code, 0);
    p.write(reason, 2);
    try {
      this._send(0x8, p);
      this.socket.end();
    } catch {
      // socket already gone
    }
    this._closed();
  }
}

/** Attach WebSocket handling to an http.Server at `path`. */
export function attachWebSocket(server, path, onConnection) {
  server.on('upgrade', (req, socket) => {
    const url = (req.url || '').split('?')[0];
    const key = req.headers['sec-websocket-key'];
    if (url !== path || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'));
    onConnection(new WsConnection(socket), req);
  });
}
