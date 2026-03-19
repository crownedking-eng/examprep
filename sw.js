// ─────────────────────────────────────────────────────────────────────────────
//  ExamPrep — sw.js  (Service Worker)
//
//  Caching strategy:
//    App shell  (HTML/JS/CSS/icons/manifest) → Cache-first, pre-cached on install
//    Data JSON  (manifest.json + year files) → Network-first, cache fallback
//    Google Fonts                            → Stale-while-revalidate, separate cache
//
//  Bump CACHE_VERSION whenever the app shell changes so old caches are purged.
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_VERSION = 'v1';
const SHELL_CACHE   = `examprep-shell-${CACHE_VERSION}`;
const DATA_CACHE    = `examprep-data-${CACHE_VERSION}`;
const FONT_CACHE    = `examprep-fonts-${CACHE_VERSION}`;

// Files that form the app shell — all pre-cached on install.
const SHELL_URLS = [
  './index.html',
  './app.js',
  './style.css',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
];

// ─── INSTALL ─────────────────────────────────────────────────────────────────
// Pre-cache the entire app shell, then activate immediately.
// skipWaiting() is chained after cache.addAll so the SW never activates
// before the shell cache is fully populated.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE ────────────────────────────────────────────────────────────────
// Purge caches from previous versions, then take control of all open clients.
self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL_CACHE, DATA_CACHE, FONT_CACHE]);
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('examprep-') && !keep.has(k))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ─── FETCH ───────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only intercept GET requests.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // ── Google Fonts ─────────────────────────────────────────────────────────
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }

  // Only intercept same-origin requests from this point on.
  if (url.origin !== self.location.origin) return;

  // ── Data JSON files (network-first) ──────────────────────────────────────
  if (url.pathname.includes('/data/') && url.pathname.endsWith('.json')) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  // ── App shell (cache-first) ───────────────────────────────────────────────
  event.respondWith(cacheFirst(request, SHELL_CACHE));
});

// ─── STRATEGY HELPERS ────────────────────────────────────────────────────────

// Cache-first: serve from cache; on miss fetch → cache → return.
// Falls back to index.html for navigation requests when fully offline.
async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (_err) {
    if (request.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response('Offline', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

// Network-first: try the network; on failure serve from cache.
// If neither is available, return a 503 JSON so app.js can show an error.
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (_err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ error: 'offline' }),
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// Stale-while-revalidate: return cached version immediately while
// refreshing the cache in the background.
async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) return cached;

  const networkResponse = await networkFetch;
  if (networkResponse) return networkResponse;

  return new Response('Offline', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain' },
  });
}
