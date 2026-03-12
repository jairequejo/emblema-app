// sw.js — Service Worker JR Stars Scanner v1.0
const SW_VERSION = '1.0.2';
const CACHE_NAME = 'jr-scanner-v' + SW_VERSION;

const STATIC_CACHE = [
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
];

self.addEventListener('install', e => {
  console.log('[SW] Install v' + SW_VERSION);
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(STATIC_CACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  console.log('[SW] Activate v' + SW_VERSION);
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API → siempre red
  if (url.pathname.startsWith('/attendance') ||
      url.pathname.startsWith('/public') ||
      url.pathname.startsWith('/admin')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // JS, HTML, CSS → red primero (nunca cache vieja)
  if (url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.html') ||
      url.pathname.endsWith('.css') ||
      url.pathname === '/scanner' ||
      url.pathname === '/scanner/') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Assets → cache primero
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      });
    })
  );
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});