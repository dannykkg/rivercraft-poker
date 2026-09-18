// The build plugin replaces this token and includes every lazy chunk and worker.
const BUILD_ID = "__BUILD_ID__";
const ROOT = new URL("./", self.location.href);
const PREFIX = `rivercraft-${encodeURIComponent(ROOT.pathname)}-`;
const CACHE_NAME = `${PREFIX}${BUILD_ID}`;

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const response = await fetch(new URL("offline-assets.json", ROOT));
    if (!response.ok) throw new Error("Offline manifest unavailable");
    const manifest = await response.json();
    if (manifest.version !== 1 || !Array.isArray(manifest.assets)) throw new Error("Invalid offline manifest");
    const cache = await caches.open(CACHE_NAME);
    const assets = [ROOT.href, new URL("offline-assets.json", ROOT).href, ...manifest.assets.map(name => new URL(name, ROOT).href)];
    // Fail installation rather than advertise a half-cached learning application.
    await cache.addAll([...new Set(assets)]);
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached && event.request.mode !== "navigate") return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone()).catch(() => undefined);
      return response;
    } catch {
      if (cached) return cached;
      if (event.request.mode === "navigate") return await cache.match(ROOT.href) || Response.error();
      // Never return HTML for missing JS, CSS, worker or media requests.
      return Response.error();
    }
  })());
});
