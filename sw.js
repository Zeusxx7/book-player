const CACHE_NAME = 'lectio-v5';

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

const NETWORK_TIMEOUT_MS = 3000;

async function fetchAndCache(request, cacheKey) {
  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    const clone = response.clone();
    const cache = await caches.open(CACHE_NAME);
    await cache.put(cacheKey, clone);
  }
  return response;
}

async function networkFirst(request, cacheKey = request) {
  const networkPromise = fetchAndCache(request, cacheKey);
  try {
    // On a very slow connection, fall back to the cached copy after a timeout
    // (the network fetch keeps running and refreshes the cache for next time).
    const cached = await caches.match(cacheKey);
    if (!cached) return await networkPromise;

    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(cached), NETWORK_TIMEOUT_MS);
    });
    networkPromise.catch(() => {}); // avoid an unhandled rejection if the timeout wins
    try {
      return await Promise.race([networkPromise, timeout]);
    } finally {
      clearTimeout(timer);
    }
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
