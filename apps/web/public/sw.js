// Squirrelcade's service worker: keeps Squirrelcade's own files (its page and the files the build lists in
// offline-files.json) on the device, so Squirrelcade opens with no connection at all and Store Mode answers from the
// copy of its answers it keeps (apps/web/src/offline.ts). Nothing from the API is kept here. After an update, the
// first visit with a connection swaps in the new files. Registered only while Settings > Interface > "Answer
// without a connection" is on (App.tsx), which removes it again when turned off.
const CACHE = 'squirrelcade-files';
const LIST = '/offline-files.json';
const VERSION_KEY = '/__squirrelcade-files-version';

self.addEventListener('install', () => self.skipWaiting());
// Any other cache of this site's (one kept under an earlier name) goes, so a device keeps a single copy of the files.
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
      await self.clients.claim();
    })(),
  ),
);

/** Keeps the build's files when its list changed: the old version's files go, the new ones come. */
async function refreshFiles() {
  const response = await fetch(LIST, { cache: 'no-store' });
  if (!response.ok || response.type !== 'basic') return;
  const list = await response.json();
  if (!list || !Array.isArray(list.files)) return;
  const cache = await caches.open(CACHE);
  const kept = await cache.match(VERSION_KEY);
  if (kept && (await kept.text()) === list.version) return;
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/assets/')) await cache.delete(request);
  }
  // One at a time: a phone on a store's weak signal shouldn't open dozens of downloads at once.
  for (const file of list.files) {
    try {
      const res = await fetch(file, { cache: 'no-store' });
      if (res.ok && res.type === 'basic') await cache.put(file, res);
    } catch {
      return;
    }
  }
  await cache.put(VERSION_KEY, new Response(list.version));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          // Only Squirrelcade's own page is kept, never a sign-in gate's page in front of it (a redirect isn't "basic").
          if (response.ok && response.type === 'basic' && (response.headers.get('content-type') || '').includes('text/html')) {
            const cache = await caches.open(CACHE);
            await cache.put('/', response.clone());
            event.waitUntil(refreshFiles().catch(() => undefined));
          }
          return response;
        } catch {
          return (await caches.match('/')) || Response.error();
        }
      })(),
    );
    return;
  }

  // The build's own files are named by what's in them, so a kept one is never out of date: it answers at once.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      })(),
    );
    return;
  }

  // The icons and the manifest keep their names from one version to the next: fresh while there's a connection (an
  // update's new logo shows on its first visit), the kept copy only without one.
  if (/\.(svg|png|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          return (await caches.match(request, { ignoreSearch: true })) || Response.error();
        }
      })(),
    );
  }
});
