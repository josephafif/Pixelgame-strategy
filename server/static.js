// Static file serving for the client and the shared engine modules.

import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

// Only these top-level folders are served; server code and tests are not.
const PUBLIC = ['client', 'engine'];

export function makeStaticHandler(root) {
  const base = resolve(root);
  return (req, res) => {
    let url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/' || url === '/index.html') url = '/client/index.html';
    const rel = normalize(url).replace(/^([/\\])+/, '');
    const top = rel.split(/[/\\]/)[0];
    if (!PUBLIC.includes(top)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const file = join(base, rel);
    if (!file.startsWith(base)) {
      res.writeHead(403);
      res.end();
      return;
    }
    let st;
    try {
      st = statSync(file);
    } catch {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    if (st.isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    createReadStream(file).pipe(res);
  };
}
