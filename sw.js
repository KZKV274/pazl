/**
 * sw.js
 * Cache-first offline shell.
 *
 * IMPORTANT — bump CACHE_VERSION on every deploy that changes any cached
 * file. This forces a new cache to be created and the old one deleted,
 * so returning players always get the new code instead of a stale
 * cached copy. See README.md "Как изменить версию приложения".
 */
const CACHE_VERSION = 'v1';
const CACHE_NAME = `puzzle-cache-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './game.js',
  './puzzle.js',
  './storage.js',
  './audio.js',
  './ui.js',
  './manifest.json',
  './assets/icons/icon-72.png',
  './assets/icons/icon-96.png',
  './assets/icons/icon-128.png',
  './assets/icons/icon-144.png',
  './assets/icons/icon-152.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-384.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-192-maskable.png',
  './assets/icons/icon-512-maskable.png',
  './assets/puzzles/nature_1.jpg',
  './assets/puzzles/nature_2.jpg',
  './assets/puzzles/cities_1.jpg',
  './assets/puzzles/cities_2.jpg',
  './assets/puzzles/animals_1.jpg',
  './assets/puzzles/animals_2.jpg',
  './assets/puzzles/space_1.jpg',
  './assets/puzzles/space_2.jpg',
  './assets/puzzles/abstraction_1.jpg',
  './assets/puzzles/abstraction_2.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never intercept cross-origin

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req)
        .then(res => {
          if (res && res.ok && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => {
          if (req.mode === 'navigate') return caches.match('./index.html');
          return undefined;
        });
    })
  );
});

// Lets app.js/ui code trigger an immediate update if it ever wants to.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
