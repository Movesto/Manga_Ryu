/* Manga Ryu service worker — hand-rolled for the React Router SSR app.
 *
 * Strategy (GET only; POST/api are always network):
 *   /assets/*         cache-first  (hashed, immutable build files)
 *   /media/*          cache-first  (manga covers & pages never change → offline re-reads)
 *   fonts/icons/img   cache-first
 *   navigations(HTML) network-first + offline fallback (HTML is dynamic: session/CSRF)
 *   /api/*            network-only  (never cached)
 *
 * Bump CACHE_VERSION to invalidate old caches on deploy.
 */
const CACHE_VERSION = "ryu-v1";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const MEDIA_CACHE = `${CACHE_VERSION}-media`;
const MEDIA_MAX = 600; // cap cached images so storage doesn't grow unbounded

const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll([OFFLINE_URL, "/manifest.json"]).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

function isAsset(url) {
  return url.pathname.startsWith("/assets/");
}
function isMedia(url) {
  return url.pathname.startsWith("/media/");
}
function isApi(url) {
  return url.pathname.startsWith("/api/");
}

async function cacheFirst(request, cacheName, cap) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    cache.put(request, res.clone());
    if (cap) trimCache(cacheName, cap);
  }
  return res;
}

async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > max) {
    // FIFO eviction of the oldest entries
    for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
  }
}

async function networkFirstNav(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match(OFFLINE_URL)) ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never touch POST/PUT/etc.

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return; // only same-origin
  if (isApi(url)) return; // dynamic — always hit network

  if (isAsset(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
  } else if (isMedia(url)) {
    event.respondWith(cacheFirst(request, MEDIA_CACHE, MEDIA_MAX));
  } else if (request.mode === "navigate") {
    event.respondWith(networkFirstNav(request));
  }
  // everything else: let the browser handle it normally
});
