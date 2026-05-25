/**
 * Taring Naga Lab — Service Worker
 * Strategy:
 *  - App shell: cache-first (offline-ready)
 *  - CDN (fonts, react, chart): stale-while-revalidate
 *  - Apps Script sync API: network-first with offline queue (handled in app)
 */

const VERSION = 'tn-lab-v1.0.2';
const SHELL_CACHE = `${VERSION}-shell`;
const CDN_CACHE = `${VERSION}-cdn`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg',
];

const CDN_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'unpkg.com',
  'cdn.jsdelivr.net',
];

const API_HOSTS = [
  'script.google.com',
  'script.googleusercontent.com',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(SHELL_CACHE).then((c) =>
      Promise.all(SHELL_ASSETS.map((a) => c.add(a).catch(() => null)))
    )
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(VERSION))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // Only cache GETs
  const url = new URL(req.url);

  // API: network-first, no cache pollution
  if (API_HOSTS.some((h) => url.hostname.endsWith(h))) {
    e.respondWith(fetch(req).catch(() => new Response(JSON.stringify({ offline: true }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  // CDN: stale-while-revalidate
  if (CDN_HOSTS.some((h) => url.hostname.endsWith(h))) {
    e.respondWith(staleWhileRevalidate(req, CDN_CACHE));
    return;
  }

  // App shell: cache-first
  if (url.origin === self.location.origin) {
    e.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }

  // Default: network
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) {
    // Refresh in background
    fetch(req).then((res) => res.ok && cache.put(req, res.clone())).catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    // Offline fallback for navigation
    if (req.mode === 'navigate') {
      return cache.match('./index.html');
    }
    return new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}

// Push messages from app (e.g. trigger immediate sync poll)
self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
