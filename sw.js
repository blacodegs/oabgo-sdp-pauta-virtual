const CACHE_NAME = 'sdp-oab-v1';
const ASSETS_TO_CACHE = [
  '/oabgo-sdp-pauta-virtual/',
  '/oabgo-sdp-pauta-virtual/index.html',
  '/oabgo-sdp-pauta-virtual/css/style.css',
  '/oabgo-sdp-pauta-virtual/js/scripts.js',
  '/oabgo-sdp-pauta-virtual/js/presenca.js',
  '/oabgo-sdp-pauta-virtual/js/votacao.js',
  '/oabgo-sdp-pauta-virtual/js/pauta.js',
  '/oabgo-sdp-pauta-virtual/images/logo-sdp-192.png',
  '/oabgo-sdp-pauta-virtual/images/logo-sdp-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request);
    })
  );
});