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
const CACHE_VERSION = "ryu-v2";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const MEDIA_CACHE = `${CACHE_VERSION}-media`;
const MEDIA_MAX = 600; // cap cached images so storage doesn't grow unbounded

// Permanent bucket for user-downloaded chapter images (see app/lib/downloads.ts
// and public/downloads.html). Never auto-trimmed — only the user deletes it.
const DL_CACHE = "ryu-dl-images";

const OFFLINE_URL = "/offline.html";
const DOWNLOADS_URL = "/downloads.html"; // self-contained offline library + reader

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.addAll([OFFLINE_URL, DOWNLOADS_URL, "/manifest.json"]).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        // Drop old versioned caches, but NEVER the permanent user-downloads bucket.
        keys
          .filter((k) => k !== DL_CACHE && !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
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

// Media: serve a permanently-downloaded image first (so downloaded chapters read
// offline), else the runtime media cache, else network → runtime cache.
async function mediaHandler(request) {
  const dl = await caches.open(DL_CACHE);
  const saved = await dl.match(request);
  if (saved) return saved;
  return cacheFirst(request, MEDIA_CACHE, MEDIA_MAX);
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
    // Offline: send the user to the self-contained Downloads app (their saved
    // chapters are readable there with no connection). Fall back to the plain
    // offline page only if downloads.html somehow isn't cached.
    const cache = await caches.open(SHELL_CACHE);
    return (
      (await cache.match(DOWNLOADS_URL)) ??
      (await cache.match(OFFLINE_URL)) ??
      Response.error()
    );
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
    event.respondWith(mediaHandler(request));
  } else if (request.mode === "navigate") {
    event.respondWith(networkFirstNav(request));
  }
  // everything else: let the browser handle it normally
});
