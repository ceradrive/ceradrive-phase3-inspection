const CACHE_NAME = 'cfc-cashbook-v0.9.2';
const APP_SHELL = [
  './?v=0.9.2',
  './index.html?v=0.9.2',
  './styles.css?v=0.9.2',
  './app.js?v=0.9.2',
  './manifest.webmanifest?v=0.9.2',
  './config.js?v=0.9.2',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL).catch(() => null)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.includes('supabase.co')) return;
  event.respondWith(
    fetch(req).then((res) => {
      const clone = res.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
      return res;
    }).catch(() => caches.match(req).then(res => res || caches.match('./index.html?v=0.9.2').then(fallback => fallback || caches.match('./index.html'))))
  );
});
