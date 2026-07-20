const CACHE_NAME = 'savor-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/css/index.css',
  '/js/main.js',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/favicon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only intercept GET requests
  if (event.request.method !== 'GET') return;
  
  // Exclude API calls and dynamic paths from strict caching (let them go to network first)
  if (event.request.url.includes('/api/') || event.request.url.includes('/recipes/') || event.request.url.includes('/collections/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached asset if found
        if (response) {
          return response;
        }
        // Otherwise fetch from network
        return fetch(event.request).catch(() => {
          // Fallback if offline
          console.warn('Offline: Could not fetch', event.request.url);
        });
      })
  );
});
