const CACHE_NAME = 'qsdcinemulti-v4';
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
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// ✅ Cachea SOLO same-origin GET. Nada de Firebase/Google APIs.
self.addEventListener("fetch", (event) => {
  const req = event.request;

  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 🚫 No tocar llamadas a otros dominios (Firestore, gstatic, etc.)
  if (url.origin !== self.location.origin) return;

  // Cache-first para assets; network-first para HTML
  const isHTML = req.headers.get("accept")?.includes("text/html");

  if (isHTML) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        return res;
      });
    })
  );
});
