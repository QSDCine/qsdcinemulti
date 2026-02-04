const CACHE_NAME = "qsdcinemulti-v4";

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
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "movies.js",
  "service-worker.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(CORE_ASSETS))
  );
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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 🚫 No tocar otros dominios (Firebase/gstatic/etc.)
  if (url.origin !== self.location.origin) return;

  // 🚫 No cachear requests con Range (audio suele pedir 206)
  if (req.headers.has("range")) return;

  // 🚫 No cachear audios
  if (url.pathname.endsWith(".mp3") || url.pathname.endsWith(".wav") || url.pathname.endsWith(".ogg")) return;

  const isHTML = req.headers.get("accept")?.includes("text/html");

  if (isHTML) {
    // network-first para HTML
    event.respondWith(
      fetch(req)
        .then((res) => {
          // si por lo que sea viene parcial, no cachear
          if (res.status === 206) return res;

          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // cache-first para el resto de assets
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req).then((res) => {
        if (res.status === 206) return res; // jamás cachear parciales
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        return res;
      });
    })
  );
});
