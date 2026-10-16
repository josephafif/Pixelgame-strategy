// Static build for hosts without a game server (Netlify and the like):
// copies the client and the shared engine into dist/. Single player runs
// entirely in the browser; multiplayer needs a server started with npm start.
// Usage: node tools/build-static.mjs [outDir]
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, process.argv[2] || 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const dir of ['client', 'engine']) cpSync(join(root, dir), join(out, dir), { recursive: true });
// Tell the client it is hosted statically (no /ws endpoint on this origin).
const index = join(out, 'client', 'index.html');
writeFileSync(index, readFileSync(index, 'utf8').replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="realmwright-hosting" content="static">'));
// The client uses relative URLs, so it lives under /client/.
writeFileSync(join(out, '_redirects'), '/  /client/  302\n');
writeFileSync(join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=client/"><title>Realmwright</title><a href="client/">Realmwright</a>\n');
console.log(`static build written to ${out}`);
