const CACHE_NAME = 'sdp-oab-v3'; // incrementado
const ASSETS_TO_CACHE = [
  '/oabgo-sdp-pauta-virtual/',
  '/oabgo-sdp-pauta-virtual/index.html',
  '/oabgo-sdp-pauta-virtual/voto.html',
  '/oabgo-sdp-pauta-virtual/css/style.css',
  '/oabgo-sdp-pauta-virtual/js/scripts.js',
  '/oabgo-sdp-pauta-virtual/js/presenca.js',
  '/oabgo-sdp-pauta-virtual/js/votacao.js',
  '/oabgo-sdp-pauta-virtual/js/pauta.js',
  '/oabgo-sdp-pauta-virtual/js/voto.js',
  '/oabgo-sdp-pauta-virtual/images/logo-sdp-192.png',
  '/oabgo-sdp-pauta-virtual/images/logo-sdp-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        ASSETS_TO_CACHE.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[sw] falha ao cachear (ignorado):', url, err.message);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  clients.claim(); // assume controle das páginas abertas
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return; // deixa passar direto pra rede
  if (event.request.url.includes('script.google.com')) return; // sempre direto à rede

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, response.clone());
          return response;
        });
      })
      .catch(() => caches.match(event.request))
  );
});