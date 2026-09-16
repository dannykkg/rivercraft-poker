const CACHE_NAME = "rivercraft-v2";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const indexResponse = await fetch("./");
    await cache.put("./", indexResponse.clone());
    const html = await indexResponse.text();
    const localAssets = [...html.matchAll(/(?:src|href)=["'](\.\/[^"']+)["']/g)].map((match) => match[1]);
    await Promise.all([...new Set(["./manifest.webmanifest", "./favicon.svg", ...localAssets])]
      .map(async (url) => { try { await cache.add(url); } catch { /* keep the rest of the offline shell */ } }));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./"))),
  );
});
