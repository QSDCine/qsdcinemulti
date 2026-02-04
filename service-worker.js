const CACHE_NAME = "qsdcinemulti-v5"; // cambia versión para forzar update
const CORE_ASSETS = [
  "./",
  "index.html",
  "style.css",
  "script.js",
  "lobby.html",
  "lobby.js",
  "game.html",
  "game.js",
  "firestore-utils.js",
  "movies.js",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
];

// Instalar: cachea lo esencial
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

// Activar: limpiar caches antiguas
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
// ✅ Evita 206 (Range) y evita cachear audio
self.addEventListener("fetch", (event) => {
  const req = event.request;

  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 🚫 No tocar llamadas a otros dominios (Firestore, gstatic, etc.)
  if (url.origin !== self.location.origin) return;

  // 🚫 No cachear peticiones con Range (audio/video suelen usarlo)
  if (req.headers.has("range")) return;

  // 🚫 No cachear audios (evita 206 y problemas de streams)
  if (/\.(mp3|wav|ogg)$/i.test(url.pathname)) return;

  const accept = req.headers.get("accept") || "";
  const isHTML = accept.includes("text/html");

  // Network-first para HTML
  if (isHTML) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);

          // Solo cachear respuestas normales 200
          if (res && res.status === 200) {
            const copy = res.clone();
            const cache = await caches.open(CACHE_NAME);
            await cache.put(req, copy);
          }

          return res;
        } catch {
          const cached = await caches.match(req);
          return cached || new Response("Offline", { status: 503 });
        }
      })()
    );
    return;
  }

  // Cache-first para assets
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;

      try {
        const res = await fetch(req);

        // Solo cachear 200
        if (res && res.status === 200) {
          const copy = res.clone();
          const cache = await caches.open(CACHE_NAME);
          await cache.put(req, copy);
        }

        return res;
      } catch {
        return new Response("Archivo no disponible offline", { status: 503 });
      }
    })()
  );
});
