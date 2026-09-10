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
// v4 retires v3, whose eviction pass could leave the cache far below its target.
const VERSION = 'v4';
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
/**
 * Puts between two budget checks.
 *
 * A check is one `cache.keys()`; at 64 puts apart that is well under one per screenful
 * even on the densest mobile grid, and the worst the interval costs is a few MB of
 * overshoot before an over-budget cache is trimmed.
 */
const TRIM_CHECK_INTERVAL = 64;
/** Entries the cache always keeps, however large they turn out to be. */
const THUMB_MIN_ENTRIES = 200;

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

/** A fetch that reports failure as null rather than rejecting. A CORS check the response
 * fails rejects here exactly like an offline network does. */
async function tryFetch(request, init) {
    try {
        return await fetch(request, init);
    }
    catch {
        return null;
    }
}

/** Bytes an entry occupies, from the response we already hold. */
function responseSize(response) {
    const length = Number(response?.headers.get('Content-Length') ?? 0);
    return length > 0 ? length : UNKNOWN_SIZE_ESTIMATE;
}

/**
 * Running mean of stored thumbnail sizes, and how many samples it is built from.
 *
 * The budget is denominated in bytes but enforced in *entries*, and this is the
 * conversion between the two. It has to be measured rather than assumed because the
 * same cache serves wildly different entry sizes: a phone at six columns requests the
 * 200w rung (~10 KB), a desktop justified row requests the 800w rung (~80 KB). A fixed
 * entry cap would hold a third of the budget on one and four times it on the other.
 *
 * The sample count is capped so the mean tracks the density currently being scrolled
 * instead of being pinned by the first few thousand entries of the session.
 */
let meanEntryBytes = UNKNOWN_SIZE_ESTIMATE;
let entrySamples = 0;
const MAX_ENTRY_SAMPLES = 512;

function noteEntrySize(bytes) {
    entrySamples = Math.min(entrySamples + 1, MAX_ENTRY_SAMPLES);
    meanEntryBytes += (bytes - meanEntryBytes) / entrySamples;
}

/** Puts since the last budget check, and whether a check is already running. */
let putsSinceCheck = 0;
let trimming = false;

/**
 * Evict oldest-first until the cache is back under the target.
 *
 * cache.keys() returns insertion order, so deleting from the front is FIFO.
 *
 * This used to read *every* entry back with `cache.match` to sum Content-Length, and
 * it ran after every single successful put — including the overwhelmingly common case
 * where the cache was nowhere near its budget, because the early-out sat after the
 * sweep rather than before it. At the ~12,000 entries a 120 MB budget holds at mobile
 * thumbnail sizes that is 12,000 storage round trips per stored thumbnail, and a
 * six-column grid stores upwards of sixty per screenful — roughly 800,000 Cache API
 * operations for one flick, all of them queued on the same per-origin queue that every
 * incoming `fetch` event has to get through. Since the worker answers thumbnails with
 * `event.respondWith`, the browser will not fetch around it: the <img> simply never
 * resolves and the cell stays on its blurhash background. Worse, each in-flight sweep
 * retained an array of every Request in the cache, and dozens ran concurrently, which
 * is enough memory pressure for iOS to kill the worker outright.
 *
 * Now the hot path is an integer increment. A check costs one `cache.keys()` and
 * happens once per TRIM_CHECK_INTERVAL puts, deletes touch only the entries actually
 * being evicted, and the whole thing is coalesced so concurrent puts cannot stack
 * sweeps on top of each other.
 */
async function trimThumbCache(cache) {
    if (trimming) return;
    if (++putsSinceCheck < TRIM_CHECK_INTERVAL) return;
    putsSinceCheck = 0;

    trimming = true;
    try {
        const keys = await cache.keys();
        const maxEntries = Math.max(
            THUMB_MIN_ENTRIES,
            Math.floor(THUMB_MAX_BYTES / meanEntryBytes)
        );
        if (keys.length <= maxEntries) return;

        const targetEntries = Math.max(
            THUMB_MIN_ENTRIES,
            Math.floor(THUMB_TRIM_TARGET_BYTES / meanEntryBytes)
        );
        const evict = keys.length - targetEntries;
        for (let i = 0; i < evict; i++) {
            await cache.delete(keys[i]);
        }
    }
    catch {
        // Storage errors here are not worth surfacing: the cache is a cache, and the
        // next check will try again.
    }
    finally {
        trimming = false;
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

    let response = await tryFetch(request);

    // A thumbnail can be pinned to a *failure* in the browser's HTTP cache, and nothing
    // below this line would ever notice. Every CDN response carries
    // `Cache-Control: public, max-age=31536000, immutable` — including the 403 S3 returns
    // for a ladder variant the worker has not written yet, because CloudFront applies the
    // header policy to error responses and a viewer-response function cannot strip it
    // (those do not run for 4xx). So a thumbnail requested a few seconds too early, or
    // fetched while the CDN was still missing its CORS headers, keeps failing for a year:
    // a reload re-runs this fetch, which happily replays the cached failure.
    //
    // `cache: 'reload'` is the only way past that entry, and it overwrites it with
    // whatever the CDN says now. Cost when the variant genuinely is not written yet: one
    // extra request per attempt, against a 403 that is a few hundred bytes.
    //
    // Opaque is excluded, not overlooked: a no-cors response reports ok=false whether it
    // was a 200 or a 404, so retrying every one of them would double the request count for
    // the surfaces that load thumbnails without crossorigin, and the retry would come back
    // just as opaque.
    if (!response || (!response.ok && response.type !== 'opaque')) {
        const revalidated = await tryFetch(request, { cache: 'reload' });
        if (revalidated) response = revalidated;
    }

    if (!response) return Response.error();

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
        // Sized from the response already in hand, so the budget never costs a read back
        // out of the cache.
        const size = responseSize(response);
        event.waitUntil(
            safePut(cache, key, copy).then((stored) => {
                if (!stored) return;
                noteEntrySize(size);
                return trimThumbCache(cache);
            })
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
