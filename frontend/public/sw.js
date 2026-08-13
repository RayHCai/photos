/**
 * Service worker.
 *
 * Fixes over the previous version:
 *  - CACHE_NAME is versioned, so a deploy retires old caches instead of accumulating
 *    hashed chunks from every release forever.
 *  - The thumbnail cache is bounded by *bytes*, not by a 400-entry count. 400 entries is
 *    about ten desktop screenfuls, so everything the user scrolled past was evicted long
 *    before they scrolled back — the persistent cache delivered almost nothing.
 *  - Cache hits no longer re-fetch. Every hit fired a background revalidation for an
 *    object whose key is a random UUID and whose response is stamped immutable, so a
 *    scroll through 500 thumbnails made 500 pointless requests.
 *  - Every cache.put is guarded: a quota error used to reject unhandled.
 *  - Failures are no longer cached as if they were images. See thumbnailStrategy.
 */

// Bump on each deploy. Anything not in CURRENT_CACHES is deleted on activate.
// v3 retires the v2 thumbnail cache, which may hold 404s stored as valid thumbnails.
const VERSION = 'v3';
const CACHE_NAME = `photos-app-${VERSION}`;
const THUMB_CACHE = `photos-thumbs-${VERSION}`;

const CURRENT_CACHES = [CACHE_NAME, THUMB_CACHE];

/**
 * Byte budget for cached thumbnails. Enough to hold a few thousand ~25 KB WebP
 * thumbnails — deep enough that scrolling back is a cache hit — while staying well inside
 * a mobile origin's storage quota.
 */
const THUMB_MAX_BYTES = 120 * 1024 * 1024;
/** Trim in batches so a single put does not pay for a full sweep. */
const THUMB_TRIM_TARGET_BYTES = 100 * 1024 * 1024;
/** Fallback charge for an entry whose response declares no Content-Length. */
const UNKNOWN_SIZE_ESTIMATE = 30 * 1024;

const PRECACHE_URLS = ['/', '/manifest.json', '/icon.svg'];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            // Individually, so one 404 does not abort the entire install.
            .then((cache) => Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((names) =>
                Promise.all(
                    names
                        .filter((name) => !CURRENT_CACHES.includes(name))
                        .map((name) => caches.delete(name))
                )
            )
            .then(() => self.clients.claim())
    );
});

/**
 * A stable, query-stripped cache key, so a re-signed presigned URL (rotating
 * X-Amz-Signature) still hits the bytes already cached for the same object.
 */
function thumbCacheKey(url) {
    return url.origin + url.pathname;
}

/**
 * Is this a request whose bytes the browser's download manager owns? These redirect to a
 * presigned S3 URL, and a service worker in the middle of that redirect can only get in
 * the way — there is nothing to cache either.
 */
function isDownloadRequest(url) {
    return (
        /\/media\/[^/]+\/download$/.test(url.pathname) ||
        url.searchParams.get('download') === '1'
    );
}

function isThumbnailRequest(url) {
    if (url.origin === self.location.origin) {
        // Same-origin proxy/redirect endpoint: /api/v1/media/{id}/thumbnail
        return /\/media\/[^/]+\/thumbnail$/.test(url.pathname);
    }
    // Cross-origin CDN/S3 thumbnail objects live under a thumbnails/ prefix
    // (virtual-hosted and path-style URLs both contain it).
    return url.pathname.includes('/thumbnails/');
}

/** Best-effort put: a quota error must not reject into the void. */
async function safePut(cache, key, response) {
    try {
        await cache.put(key, response);
        return true;
    }
    catch {
        return false;
    }
}

/**
 * Evict oldest-first until the cache is back under the target.
 *
 * cache.keys() returns insertion order, so deleting from the front is FIFO.
 */
async function trimThumbCache(cache) {
    const keys = await cache.keys();

    let total = 0;
    const sizes = [];
    for (const request of keys) {
        const response = await cache.match(request);
        const length = Number(response?.headers.get('Content-Length') ?? 0);
        const size = length > 0 ? length : UNKNOWN_SIZE_ESTIMATE;
        sizes.push({ request, size });
        total += size;
    }

    if (total <= THUMB_MAX_BYTES) return;

    for (const { request, size } of sizes) {
        if (total <= THUMB_TRIM_TARGET_BYTES) break;
        await cache.delete(request);
        total -= size;
    }
}

/**
 * Cache-first for thumbnails.
 *
 * Deliberately *not* stale-while-revalidate: object keys are random UUIDs and responses
 * are immutable, so the bytes behind a key never change. Revalidating on every hit was
 * pure waste, and on a mobile connection it competed with the thumbnails actually being
 * scrolled into view.
 *
 * That reasoning holds for a key that *exists*. The one transition a key can undergo is
 * absent -> present: a ladder variant 404s until the worker (or a backfill) writes it.
 * Since nothing here ever revalidates, storing that 404 pins it forever — the object
 * appearing later is never noticed. So an absence is simply never written down; the next
 * request for the key misses, goes to the network, and picks up the object once it is
 * there. No invalidation, no version token, no change notification.
 */
async function thumbnailStrategy(event, url) {
    const { request } = event;
    const cache = await caches.open(THUMB_CACHE);
    const key = thumbCacheKey(url);

    const cached = await cache.match(key);
    if (cached) return cached;

    let response;
    try {
        response = await fetch(request);
    }
    catch {
        return Response.error();
    }

    // Persist only responses we can *verify* succeeded, and that cache.put accepts: a
    // redirected (same-origin 302) or partial (206) response makes it throw.
    //
    // `ok` is load-bearing and used to be unreachable. An opaque (no-cors) response
    // reports status 0 and ok=false whether it was a 200 or a 404, so the old
    // `|| response.type === 'opaque'` arm stored failures indistinguishably from
    // images. Grid thumbnails are now requested with CORS (crossorigin="anonymous"
    // against a CDN that returns Access-Control-Allow-Origin), which makes the status
    // readable. Anything still opaque is served to the page but not cached — we cannot
    // tell whether it is a thumbnail or a 404 dressed as one.
    if (response.ok && !response.redirected && response.status !== 206) {
        const copy = response.clone();
        event.waitUntil(
            safePut(cache, key, copy).then((stored) => (stored ? trimThumbCache(cache) : undefined))
        );
    }

    return response;
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // File saves go straight to the network, untouched.
    if (isDownloadRequest(url)) return;

    // Thumbnails → dedicated byte-capped cache. Checked before the same-origin guard (so
    // cross-origin CDN thumbnails qualify) and before the /api branch (same-origin
    // thumbnails live under /api/v1).
    if (isThumbnailRequest(url)) {
        event.respondWith(thumbnailStrategy(event, url));
        return;
    }

    // Skip cross-origin non-thumbnail requests.
    if (url.origin !== self.location.origin) return;

    // Never cache API responses: they are per-session and authenticated, and a stale one
    // is worse than an error.
    if (url.pathname.startsWith('/api/')) return;

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const copy = response.clone();
                        event.waitUntil(
                            caches.open(CACHE_NAME).then((cache) => safePut(cache, request, copy))
                        );
                    }
                    return response;
                })
                // Falls back to cache so the shell still opens offline.
                .catch(async () => (await caches.match(request)) ?? Response.error())
        );
        return;
    }

    // Cache-first for static assets. Next.js content-hashes these filenames, so a hit can
    // never be stale for a given URL, and activate drops the whole versioned cache on
    // deploy.
    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) return cached;
            return fetch(request).then((response) => {
                if (response.ok) {
                    const copy = response.clone();
                    event.waitUntil(
                        caches.open(CACHE_NAME).then((cache) => safePut(cache, request, copy))
                    );
                }
                return response;
            });
        })
    );
});

/**
 * Lets the app clear cached photo bytes — on sign-out, for instance, where a browser
 * storage's worth of the previous session's thumbnails would otherwise remain readable
 * offline.
 */
self.addEventListener('message', (event) => {
    if (event.data?.type === 'CLEAR_MEDIA_CACHE') {
        event.waitUntil(caches.delete(THUMB_CACHE));
    }
});
