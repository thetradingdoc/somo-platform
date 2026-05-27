// Minimal service worker for installability and basic offline shell.

const CACHE_NAME = 'doclittle-shell-v9';
const SHELL_URLS = [
  '/unified-dashboard/business/today.html',
  '/unified-dashboard/patients/patient-dashboard.html',
  '/unified-dashboard/patients/appointments.html',
  '/unified-dashboard/patients/wallet.html',
  '/unified-dashboard/patients/my-records.html',
  '/unified-dashboard/assets/css/global.css',
  '/unified-dashboard/assets/css/provider-portal.css',
  '/unified-dashboard/assets/js/config.js',
  '/unified-dashboard/assets/js/provider-shell.js',
  '/unified-dashboard/assets/js/provider-layout.js',
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
  let reqUrl = null;
  try {
    reqUrl = new URL(request.url);
  } catch (_) {}
  // Never proxy Stripe through SW; let browser fetch directly.
  if (reqUrl && (reqUrl.hostname === 'js.stripe.com' || reqUrl.hostname === 'api.stripe.com' || reqUrl.hostname === 'hooks.stripe.com')) {
    return;
  }
  // Do not proxy cross-origin webfont requests through SW fetch().
  // This prevents CSP connect-src violations for fonts.gstatic.com and similar CDNs.
  const isCrossOrigin = !!(reqUrl && reqUrl.origin !== self.location.origin);
  const fontHosts = new Set([
    'fonts.gstatic.com',
    'fonts.googleapis.com',
    'use.typekit.net',
    'use.fontawesome.com',
    'cdn.jsdelivr.net',
    'unpkg.com'
  ]);
  const pathLower = reqUrl ? String(reqUrl.pathname || '').toLowerCase() : '';
  const looksLikeFontFile =
    pathLower.endsWith('.woff2') ||
    pathLower.endsWith('.woff') ||
    pathLower.endsWith('.ttf') ||
    pathLower.endsWith('.otf');
  const isFontRequest =
    request.destination === 'font' ||
    !!(reqUrl && fontHosts.has(reqUrl.hostname)) ||
    (isCrossOrigin && looksLikeFontFile);
  if (isCrossOrigin && isFontRequest) return;

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

  // Keep hashed build assets fresh (landing React bundles under /static/*).
  // Old cache-first behavior can pin stale hero copy/icons after deploys.
  if (reqUrl && reqUrl.origin === self.location.origin && reqUrl.pathname.startsWith('/static/')) {
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
      return fetch(request).catch(() => {
        // Avoid unhandled promise rejections in SW console for transient
        // network failures on non-document requests.
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});

