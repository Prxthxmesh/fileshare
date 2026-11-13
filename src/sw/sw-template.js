/* FileShare service worker — generated at build time from src/sw/sw-template.js.
 *
 * Scope of caching (deliberately narrow):
 *   - Precaches the static application shell (HTML, JS, CSS, icons, manifest).
 *   - Never caches anything that is not part of the build output.
 *   - Never touches transferred files, text, or WebRTC/SDP pairing payloads:
 *     those travel over WebRTC DataChannels and QR codes, never over HTTP.
 */
const VERSION = '__FILESHARE_VERSION__';
const CACHE = `fileshare-shell-${VERSION}`;
const PRECACHE = __FILESHARE_PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('fileshare-shell-') && k !== CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network first (to pick up new deployments), fall back to the
  // cached shell so the app opens offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          return res;
        } catch {
          const cache = await caches.open(CACHE);
          return (await cache.match('./index.html', { ignoreVary: true })) || Response.error();
        }
      })(),
    );
    return;
  }

  // Build assets: cache first. Only files that are part of the precache list
  // are ever served from (or stored in) the cache.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
      if (hit) return hit;
      return fetch(req);
    })(),
  );
});
