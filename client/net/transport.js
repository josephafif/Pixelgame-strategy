// Transports: the client talks to a match through the same message
// protocol whether the match runs on a server (WebSocket) or locally in a
// Web Worker (single player). Both expose send(msg) and onMessage(fn).

export class SocketTransport {
  constructor(url) {
    this.url = url;
    this.handlers = new Set();
    this.queue = [];
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => {
        for (const m of this.queue) this.ws.send(JSON.stringify(m));
        this.queue = [];
        resolve();
      });
      this.ws.addEventListener('error', () => reject(new Error(`Cannot reach ${url}`)));
    });
    this.ws.addEventListener('message', (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      for (const h of this.handlers) h(msg);
    });
    this.ws.addEventListener('close', () => {
      for (const h of this.handlers) h({ t: 'disconnected' });
    });
  }

  send(msg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  /** Game commands are wrapped for the server. */
  command(cmd) {
    this.send({ t: 'cmd', cmd });
  }

  onMessage(fn) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  close() {
    this.ws.close();
  }
}

export class WorkerTransport {
  constructor(opts) {
    this.handlers = new Set();
    this.worker = new Worker(new URL('./local-worker.js', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', (e) => {
      for (const h of this.handlers) h(e.data);
    });
    this.worker.addEventListener('error', (e) => {
      for (const h of this.handlers) h({ t: 'error', text: `Simulation error: ${e.message || 'unknown'}` });
    });
    this.worker.postMessage({ t: 'start', opts });
  }

  send(msg) {
    this.worker.postMessage(msg);
  }

  command(cmd) {
    this.worker.postMessage({ t: 'cmd', cmd });
  }

  setSpeed(v) {
    this.worker.postMessage({ t: 'speed', v });
  }

  /** Ask the simulation for a saved game: resolves to { text, info } (text: the save as JSON). */
  save() {
    const id = (this.saveId = (this.saveId || 0) + 1);
    return new Promise((resolve, reject) => {
      const off = this.onMessage((msg) => {
        if (msg.t !== 'saved' || msg.id !== id) return;
        off();
        if (msg.error) reject(new Error(msg.error));
        else resolve({ text: msg.text, info: msg.info });
      });
      this.worker.postMessage({ t: 'save', id });
    });
  }

  onMessage(fn) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  close() {
    this.worker.terminate();
  }
}
