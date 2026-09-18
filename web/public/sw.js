// The build plugin replaces this token and includes every lazy chunk and worker.
const BUILD_ID = "__BUILD_ID__";
const ROOT = new URL("./", self.location.href);
const PREFIX = `rivercraft-${encodeURIComponent(ROOT.pathname)}-`;
const CACHE_NAME = `${PREFIX}${BUILD_ID}`;
const MANIFEST_URL = new URL("offline-assets.json", ROOT).href;
let allowedAssets;

const assetURLs = manifest => {
  if (manifest.version !== 1 || !Array.isArray(manifest.assets)) throw new Error("Invalid offline manifest");
  const urls = manifest.assets.map(name => {
    if (typeof name !== "string") throw new Error("Invalid offline asset");
    const url = new URL(name, ROOT);
    if (url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) throw new Error("Offline asset outside app scope");
    return url.href;
  });
  return new Set([ROOT.href, MANIFEST_URL, ...urls]);
};
const knownAssets = async cache => {
  if (!allowedAssets) allowedAssets = (async () => {
    const response = await cache.match(MANIFEST_URL, { ignoreVary: true });
    if (!response) throw new Error("Offline manifest missing from installed cache");
    return assetURLs(await response.json());
  })().catch(error => { allowedAssets = undefined; throw error; });
  return allowedAssets;
};
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const response = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Offline manifest unavailable");
    const urls = assetURLs(await response.json());
    const cache = await caches.open(CACHE_NAME);
    // Fail installation instead of advertising partially cached offline support.
    await cache.addAll([...urls]);
    allowedAssets = Promise.resolve(urls);
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
    const assets = await knownAssets(cache);
    const isStatic = assets.has(url.href);
    const isAppNavigation = event.request.mode === "navigate"
      && (url.pathname === ROOT.pathname || url.pathname === new URL("index.html", ROOT).pathname);
    // Do not cache future API routes, arbitrary authenticated responses or out-of-manifest URLs.
    if (!isStatic && !isAppNavigation) return fetch(event.request);
    // Module requests carry Origin, whereas cache.addAll requests may not. Vite
    // preview serves Vary: Origin. Public immutable build assets have identical
    // bytes, so ignore Vary only for this explicit static allowlist / app shell.
    const cached = await cache.match(event.request, { ignoreVary: true });
    if (cached && !isAppNavigation) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone()).catch(() => undefined);
      return response;
    } catch {
      if (cached) return cached;
      if (isAppNavigation) return await cache.match(ROOT.href, { ignoreVary: true }) || Response.error();
      // Missing JavaScript, CSS and workers must never receive an HTML fallback.
      return Response.error();
    }
  })());
});
