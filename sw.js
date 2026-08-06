const CACHE_NAME = 'sdp-oab-v2'; // incremente a versão sempre que alterar o sw.js
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
  self.skipWaiting(); // força a ativação imediata
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
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Se a rede respondeu, atualiza o cache e retorna a resposta
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, response.clone());
          return response;
        });
      })
      .catch(() => {
        // Se a rede falhar, serve do cache
        return caches.match(event.request);
      })
  );
});