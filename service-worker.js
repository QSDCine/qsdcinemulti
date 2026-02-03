const CACHE_NAME = 'qsdcinemulti-v3';
const CORE_ASSETS = [
  './',
  'index.html',
  'style.css',
  'script.js',
  'lobby.html',
  'lobby.js',
  'game.html',
  'game.js',
  'firestore-utils.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
];
// Instalar: cachea lo esencial
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

// Activar: limpiar caches antiguas
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first SOLO para same-origin GET
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Solo GET
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Nunca interceptar Firebase/Firestore/CDNs
  const blockedHosts = [
    "firestore.googleapis.com",
    "www.gstatic.com",
    "firebase.googleapis.com",
    "identitytoolkit.googleapis.com",
    "securetoken.googleapis.com"
  ];
  if (blockedHosts.includes(url.hostname)) {
    // network-only
    return;
  }

  // Solo cache si es tu mismo origen
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // guarda copia en cache
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      });
    })
  );
});
