const CACHE_NAME = 'qsdcinemulti-v2'; // 👈 cambia el nombre para forzar actualización
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
self.addEventListener('install', (e) => {
  console.log('[SW] Instalando...');
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

// Activar: limpiar caches antiguas si hay
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
  console.log('[SW] Activado y listo');
});

// Fetch: cache-first SOLO para tu web (same-origin) y SOLO GET.
// Deja Firebase/Firestore completamente en paz.
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // 1) No tocar nada que no sea GET
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 2) No tocar peticiones fuera de tu dominio (CDNs, Firebase, etc.)
  if (url.origin !== self.location.origin) return;

  // 3) “Corta” cualquier ruta que pueda engancharse a cosas raras (por si acaso)
  const host = url.hostname;
  const isFirebase =
    host.includes("firestore.googleapis.com") ||
    host.includes("firebase.googleapis.com") ||
    host.includes("googleapis.com") ||
    host.includes("gstatic.com");

  if (isFirebase) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {

        if (res && res.status === 200 && res.type === "basic") {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      });
    }).catch(() => {
      return new Response("Archivo no disponible offline", {
        status: 503,
        statusText: "Offline y sin caché",
      });
    })
  );
});
