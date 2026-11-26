const CACHE_NAME = 'lectio-v3';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/app.css',
  './src/app.js',
  './src/ui-utils.js',
  './src/modals.js',
  './src/shortcuts.js',
  './src/views/library.js',
  './src/views/player.js',
  './src/formats.js',
  './src/metadata.js',
  './src/db.js',
  './src/importer.js',
  './src/player.js',
  './src/bookmarks.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('lectio-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

async function networkFirst(request, cacheKey = request) {
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === 'basic') {
      const clone = response.clone();
      const cache = await caches.open(CACHE_NAME);
      await cache.put(cacheKey, clone);
    }
    return response;
  } catch {
    const cached = await caches.match(cacheKey);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      return caches.match('./index.html');
    }
    throw new Error('Network unavailable and asset not cached');
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    const clone = response.clone();
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, clone);
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }

  // Keep icons cache-first; serve HTML, JS, CSS, and manifest network-first
  // so a new deploy never mixes updated HTML with stale JS/CSS.
  if (url.pathname.includes('/icons/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});
