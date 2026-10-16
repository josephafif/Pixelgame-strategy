// Static-only server used by visual inspection tools: node server/dev-static.mjs [port]
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeStaticHandler } from './static.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 8090);
createServer(makeStaticHandler(root)).listen(port, () => console.log(`static on http://localhost:${port}`));
