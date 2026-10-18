// Service worker for the installed game (PWA). On install it stores every
// file of the client and the engine (listed in precache.json), so the game
// starts and plays offline; single player needs no server. Online, every
// request still goes to the network first and refreshes the stored copy, so
// a new version shows on the next start; when the network fails (or keeps
// the game waiting more than a few seconds) the stored copy answers. The
// pixel fonts from Google are kept the same way.

const CACHE = 'realmwright-v1';
const FONTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const PATIENCE = 4000; // ms to wait for the network before the stored copy answers

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const list = await (await fetch('precache.json', { cache: 'no-store' })).json();
        // One at a time is gentle on phones; a file that fails is fetched again later.
        for (const path of list) {
          try {
            const res = await fetch(path, { cache: 'no-cache' });
            if (res.ok) await cache.put(new URL(path, self.location).href, res);
          } catch {
            // offline or gone: the fetch handler fills it in when it can
          }
        }
      } catch {
        // no list (e.g. offline while updating): stay with what is stored
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

/** The stored answer for a request: pages by their path alone, so ?autostart=1 still opens offline. */
async function stored(req) {
  const cache = await caches.open(CACHE);
  const url = new URL(req.url);
  if (req.mode === 'navigate') return (await cache.match(url.origin + url.pathname)) || (await cache.match(new URL('./', self.location).href));
  return cache.match(req, { ignoreSearch: url.origin === self.location.origin });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const own = url.origin === self.location.origin;
  if (!own && !FONTS.includes(url.hostname)) return;
  if (own && url.pathname.endsWith('/precache.json')) return;
  const net = fetch(req).then((res) => {
    if (res.ok || res.type === 'opaque') {
      const copy = res.clone();
      const key = req.mode === 'navigate' ? url.origin + url.pathname : req;
      e.waitUntil(caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {}));
    }
    return res;
  });
  // The network if it answers; the stored copy if it fails or dawdles.
  const fallback = net.catch(async (err) => (await stored(req)) || Promise.reject(err));
  const slow = new Promise((resolve) => setTimeout(resolve, PATIENCE)).then(async () => (await stored(req)) || fallback);
  e.respondWith(Promise.race([fallback, slow]));
});
