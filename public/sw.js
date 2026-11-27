// APEX ZERO: Neon Velo — offline cache service worker.
// Strategy: network-first for navigations (falling back to cached shell),
// stale-while-revalidate for /assets/, and safe cache preservation across upgrades.
const CACHE_NAME = 'apex-zero-v4';
const SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      if (!keys.includes(CACHE_NAME)) return;
      const current = await caches.open(CACHE_NAME);
      const hasShell = await current.match('./index.html');
      if (!hasShell) return;
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    })
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache LAN/Online API or WebSocket endpoints.
  if (url.pathname.includes('/api/') || url.pathname.endsWith('/ws')) return;

  // Navigations: network-first, fall back to cached relative shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put('./index.html', copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Bundled game assets (GLB/FBX/WAV/MP3/JS/CSS chunks): cache-first with safe revalidation when online.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) {
          if (navigator.onLine) {
            fetch(req)
              .then((res) => {
                if (res && res.status === 200 && res.type === 'basic') {
                  caches.open(CACHE_NAME).then((c) => c.put(req, res.clone())).catch(() => {});
                }
              })
              .catch(() => {});
          }
          return cached;
        }
        return fetch(req).then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        });
      })
    );
    return;
  }

  // Other same-origin static files: cache-first with network writeback.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached || Response.error());
    })
  );
});
