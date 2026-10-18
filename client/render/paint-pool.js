// A small pool of paint workers. The renderer says each frame what it would
// like painted (with a priority: nearest the centre of the view first); the
// pool keeps every worker busy with the most wanted jobs and hands finished
// bitmaps back. Without worker support it reports `ok = false` and the
// renderer paints on the main thread instead.

const IN_FLIGHT = 2; // jobs queued per worker, so a worker never idles between messages

export class PaintPool {
  constructor(world, onResult) {
    this.onResult = onResult;
    this.wanted = new Map(); // key -> { prio, make }
    this.flight = new Map(); // key -> worker
    this.workers = [];
    this.ok = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof OffscreenCanvas.prototype.transferToImageBitmap === 'function';
    if (!this.ok) return;
    // Phones keep cores free for the page and the simulation.
    const touch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
    const n = Math.max(1, Math.min(touch ? 2 : 3, (navigator.hardwareConcurrency || 2) - 1));
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./paint-worker.js', import.meta.url), { type: 'module' });
        w.jobs = 0;
        w.addEventListener('message', (e) => this.finish(w, e.data));
        w.addEventListener('error', (e) => {
          console.error('paint worker failed', e.message || e);
          this.fail();
        });
        w.postMessage({ t: 'world', world });
        this.workers.push(w);
      }
    } catch (e) {
      console.error('paint workers unavailable', e);
      this.fail();
    }
  }

  fail() {
    this.ok = false;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.flight.clear();
  }

  /** Start of a frame: forget last frame's wishes (the view may have moved). */
  begin() {
    this.wanted.clear();
  }

  busy(key) {
    return this.flight.has(key);
  }

  /** Ask for a job; `make()` builds its message only when a worker takes it. */
  want(key, prio, make) {
    if (this.flight.has(key)) return;
    const w = this.wanted.get(key);
    if (!w || prio < w.prio) this.wanted.set(key, { prio, make });
  }

  /** Hand the most wanted jobs to free workers. */
  pump() {
    if (!this.ok || !this.wanted.size) return;
    const free = this.workers.filter((w) => w.jobs < IN_FLIGHT);
    if (!free.length) return;
    const queue = [...this.wanted].sort((a, b) => a[1].prio - b[1].prio);
    for (const [key, job] of queue) {
      const w = free.sort((a, b) => a.jobs - b.jobs)[0];
      if (!w || w.jobs >= IN_FLIGHT) break;
      const { msg, transfer } = job.make();
      msg.key = key;
      w.jobs++;
      this.flight.set(key, w);
      this.wanted.delete(key);
      w.postMessage(msg, transfer || []);
    }
  }

  finish(w, data) {
    w.jobs = Math.max(0, w.jobs - 1);
    this.flight.delete(data.key);
    if (data.error) {
      console.error('paint job failed', data.key, data.error);
      return;
    }
    this.onResult(data);
  }

  destroy() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}
