// Minimal service worker for installability and basic offline shell.

const CACHE_NAME = 'doclittle-shell-v5';
const SHELL_URLS = [
  '/unified-dashboard/business/business-dashboard.html',
  '/unified-dashboard/patients/patient-dashboard.html',
  '/unified-dashboard/patients/appointments.html',
  '/unified-dashboard/patients/wallet.html',
  '/unified-dashboard/patients/my-records.html',
  '/unified-dashboard/assets/css/global.css',
  '/unified-dashboard/assets/js/config.js',
  '/unified-dashboard/assets/js/navigation.js',
  '/unified-dashboard/assets/js/patient-shell.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (request.url.includes('/api/')) return;

  // For page navigations, prefer network so users always get latest HTML.
  // Fall back to cache when offline.
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request);
    })
  );
});

