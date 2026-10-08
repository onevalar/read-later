/* global self, caches, URL, fetch, Response */
const CACHE = '__BUILD_CACHE__';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '__BUILD_ASSETS__'];
self.addEventListener('install', event =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener('activate', event =>
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys.filter(key => key.startsWith('read-later-shell-') && key !== CACHE).map(key => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search) return;
  const isShell = SHELL.includes(url.pathname) || event.request.mode === 'navigate';
  if (!isShell) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok && SHELL.includes(url.pathname)) {
          const clone = response.clone();
          event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, clone)));
        }
        return response;
      })
      .catch(async () => {
        // The shell is identical for every Origin. Static hosts may set Vary: Origin, while
        // precaching has no Origin header and module requests do. Match only this build's cache.
        const cache = await caches.open(CACHE);
        return (
          (await cache.match(event.request, { ignoreVary: true })) ||
          (event.request.mode === 'navigate' ? await cache.match('/', { ignoreVary: true }) : undefined) ||
          Response.error()
        );
      }),
  );
});
