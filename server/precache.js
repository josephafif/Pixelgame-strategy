// The files an installed copy of the game keeps for offline play: the client
// and the shared engine (not the debug pages), as paths relative to the
// client folder, where the service worker lives. Used by the server (which
// answers client/precache.json) and by the static build (which writes it).

import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export function precacheList(root) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== 'debug') walk(p);
      } else if (!name.startsWith('.') && name !== 'sw.js' && name !== 'precache.json') files.push(p);
    }
  };
  walk(join(root, 'client'));
  walk(join(root, 'engine'));
  const client = join(root, 'client');
  return ['./', ...files.map((f) => relative(client, f).split(sep).join('/')).map((f) => (f.startsWith('.') ? f : `./${f}`))];
}
