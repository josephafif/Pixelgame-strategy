// Server-side persistence: running matches are written to disk regularly and
// when the server stops, and a room is brought back from disk when a player
// rejoins with its code. A restart therefore does not end anyone's game.

import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CODE = /^[A-Z2-9]{5}$/;
const MAX_AGE = 7 * 24 * 3600 * 1000;

export class SaveStore {
  constructor(dir, log = () => {}) {
    this.dir = dir;
    this.log = log;
    mkdirSync(dir, { recursive: true });
    this.prune();
  }

  file(code) {
    if (!CODE.test(code)) throw new Error('bad room code');
    return join(this.dir, `${code}.json`);
  }

  has(code) {
    if (!CODE.test(code)) return false;
    try {
      return statSync(this.file(code)).isFile();
    } catch {
      return false;
    }
  }

  /** Atomic write: a crash mid-write never leaves a half file behind. */
  write(code, data) {
    const f = this.file(code);
    const tmp = `${f}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, f);
  }

  read(code) {
    if (!this.has(code)) return null;
    try {
      return JSON.parse(readFileSync(this.file(code), 'utf8'));
    } catch (e) {
      this.log(`save ${code} unreadable: ${e.message}`);
      return null;
    }
  }

  remove(code) {
    try {
      unlinkSync(this.file(code));
    } catch {
      // already gone
    }
  }

  /** Forget saves nobody has come back to for a week. */
  prune() {
    const now = Date.now();
    for (const name of readdirSync(this.dir)) {
      if (!/^[A-Z2-9]{5}\.json$/.test(name)) continue;
      try {
        if (now - statSync(join(this.dir, name)).mtimeMs > MAX_AGE) unlinkSync(join(this.dir, name));
      } catch {
        // ignore
      }
    }
  }
}
