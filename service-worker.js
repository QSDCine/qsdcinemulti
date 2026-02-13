const CACHE_NAME = "qsdcinemulti-v36";
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
  "buzzer.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 🚫 No tocar llamadas a otros dominios (Firestore, gstatic, etc.)
  if (url.origin !== self.location.origin) return;

  // 🚫 Si viene con Range (206) -> no cachear
  if (req.headers.has("range")) return;

  // 🚫 No cachear audios
  if (url.pathname.endsWith(".mp3") || url.pathname.endsWith(".wav") || url.pathname.endsWith(".ogg")) return;

  const isHTML = req.headers.get("accept")?.includes("text/html");

  if (isHTML) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // No cachear errores o parciales
          if (!res || !res.ok || res.status === 206) return res;
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
        if (!res || !res.ok || res.status === 206) return res;
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        return res;
      });
    })
  );
});
