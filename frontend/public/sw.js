const CACHE_NAME = 'photos-v1';
// Dedicated, size-capped cache for thumbnail image objects.
const THUMB_CACHE = 'photos-thumbs-v1';
const THUMB_MAX_ENTRIES = 400;

// Assets to precache on install
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Remove old caches, but keep the current app + thumbnail caches.
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME && name !== THUMB_CACHE)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// A stable, query-stripped cache key so a re-signed presigned URL (rotating
// X-Amz-Signature) still hits the bytes already cached for the same object.
function thumbCacheKey(url) {
  return url.origin + url.pathname;
}

// Is this request for a thumbnail image we want to persist?
function isThumbnailRequest(url) {
  if (url.origin === self.location.origin) {
    // Same-origin proxy/redirect endpoint: /api/v1/media/{id}/thumbnail
    return /\/media\/[^/]+\/thumbnail$/.test(url.pathname);
  }
  // Cross-origin CDN/S3 thumbnail objects live under a thumbnails/ prefix
  // (virtual-hosted or path-style URLs both contain it).
  return url.pathname.includes('/thumbnails/');
}

// Trim the thumbnail cache to a soft cap. cache.keys() returns insertion order,
// so deleting from the front evicts the oldest entries; revalidation re-puts on
// each hit, refreshing recency (≈ LRU).
async function trimThumbCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - THUMB_MAX_ENTRIES;
  for (let i = 0; i < excess; i++) {
    await cache.delete(keys[i]);
  }
}

// Cache-first + stale-while-revalidate for thumbnails: return the cached copy
// instantly and refresh it in the background; otherwise fetch, cache, return.
// Caches opaque cross-origin (no-cors) responses too — both CDN objects and the
// same-origin /thumbnail redirect resolve to opaque image responses.
async function thumbnailStrategy(event, url) {
  const { request } = event;
  const cache = await caches.open(THUMB_CACHE);
  const key = thumbCacheKey(url);
  const cached = await cache.match(key);

  const networkFetch = fetch(request)
    .then((response) => {
      // Persist only fully-formed responses: a redirected (e.g. same-origin 302)
      // or partial (206) response makes cache.put throw. Fire-and-forget so a put
      // rejection can never null out the response we hand back to the page.
      if ((response.ok || response.type === 'opaque') && !response.redirected && response.status !== 206) {
        cache.put(key, response.clone())
          .then(() => trimThumbCache(cache))
          .catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    // Revalidate in the background without blocking the response.
    event.waitUntil(networkFetch.catch(() => {}));
    return cached;
  }

  const response = await networkFetch;
  return response || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Thumbnails → dedicated size-capped cache (cache-first SWR). Checked before
  // the same-origin guard (so cross-origin CDN thumbnails qualify) and before
  // the /api network-first branch (same-origin thumbnails live under /api/v1).
  if (isThumbnailRequest(url)) {
    event.respondWith(thumbnailStrategy(event, url));
    return;
  }

  // Skip cross-origin (non-thumbnail) requests
  if (url.origin !== self.location.origin) return;

  // Network-first for API calls and navigation
  if (url.pathname.startsWith('/api/') || request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful navigation responses
          if (request.mode === 'navigate' && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for static assets (JS, CSS, images, fonts)
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
