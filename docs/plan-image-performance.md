# Image-Loading Performance — Analysis & Implementation Plan

> Status: Proposed
> Date: 2026-06-14
> Scope: Image loading across four user scenarios — (1) first load, (2) regular scroll, (3) skip scroll, (4) opening a file to full view.
> Method: 13-agent audit (parallel finders per scenario + backend + frontend-compute + completeness critic), every finding adversarially re-verified against source. External facts (worker output sizes, S3 headers, CloudFront config) confirmed directly.

---

## 1. TL;DR

Two structural decisions drive most of the cost:

1. **The whole library's metadata is loaded up front** in a single unpaginated payload (`GET /media/shell`) and turned into one giant client-side virtualized timeline. First paint, scroll recompute, and skip-scroll all scale with *total library size*, not screen size — and the payload is re-fetched every 30 s and on every tab refocus.
2. **`CDN_BASE_URL` is backend-only**, so the browser — which already receives `thumbnailKey` for every item — cannot build a thumbnail URL itself. An entire machinery of batch URL-resolution calls and per-item 302 redirects exists *only to translate a key the client already holds*.

**Do these first** (high impact, low effort, no architectural change):

| # | Change | Fixes |
|---|--------|-------|
| 1 | Remove `refetchInterval` from `useShellData`; set `refetchOnWindowFocus: false` | Periodic + refocus full-library reload & re-layout |
| 2 | Expose `NEXT_PUBLIC_CDN_BASE_URL`; build thumbnail/lightbox `src` directly from `thumbnailKey` | **Keystone** — removes batch round-trip, 150 ms debounce gap, per-item proxy+DB+302 fallback, *and* the grid re-render storm |
| 3 | `Cache-Control: public, max-age=31536000, immutable` on S3/CloudFront image objects | Repeat-visit & scroll-back caching |
| 4 | Module-level blurhash cache + `decoding="async"` | Scroll / skip-scroll jank |
| 5 | rAF-throttle the timeline-scrollbar drag | Skip-scroll jank |
| 6 | Fix `/web` null-`webKey` fallback (never serve raw HEIC) + add full-view resolution ladder + `fetchpriority` + video poster | Full view |
| 7 | preconnect to the CDN origin; service-worker thumbnail caching | First load / repeat visits |

Then medium (Phase 2) and the architectural pagination change (Phase 3) below.

---

## 2. Current Architecture (as-is)

### 2.1 Data flow

- **Main gallery** (`frontend/src/app/(app)/page.tsx:24`) renders from `useShellData()` → `GET /media/shell` → `media.service.getShellData()`: `prisma.mediaItem.findMany({ where, orderBy, select })` with **no `take`/`cursor`** — the entire library. `useShellData` has `staleTime: 60_000` and `refetchInterval: 30_000`.
- **Timeline scrollbar** uses `useTimeline()` → `GET /media/timeline` (raw SQL month counts). The entire library's virtual rows are computed client-side (`groupByDate` + `computeJustifiedLayout` over **all** items) in `GalleryGrid`; `@tanstack/react-virtual` virtualizes the rows.
- **Thumbnails**: `GalleryItem` renders `<img src={thumbnailSrc ?? thumbnailUrl(item.id)}>`.
  - `thumbnailUrl(id)` = `/media/{id}/thumbnail` → per-item `findUnique` then `cachedRedirect` (302, `Cache-Control: private, max-age=3300`) to a CDN or presigned S3 URL.
  - `useThumbnailPrefetch` batches `POST /media/thumbnail-urls` (`getBatchThumbnailUrls`) for ±20 rows around the visible range after a 150 ms debounce, caches resolved URLs in a ref, and on resolve flips `thumbnailSrc` from `undefined` via a `version` state bump.
- **blurhash**: `GalleryItem` decodes `item.blurHash` on the main thread via `blurhash.decode()` + `canvas.toDataURL()` inside a `useMemo`, per mounted item, used as a CSS background.
- **Lightbox** (`MediaLightbox.tsx`): shows the grid thumbnail scaled to 90vh as a placeholder, then `GET /media/{id}/web` fades in; preloads neighbors' web; also calls `getMediaById` (`GET /media/{id}`, faces+person join) for filename/EXIF. `getWebUrl`: photo → `webKey` via CDN, else **original** presigned; video → `streamingKey`.
- **Zoom**: `useImageZoom` applies a CSS `transform: scale()` (max 4×) to the container wrapping the thumbnail+web `<img>`. **No resolution swap** — zoom upscales the 2000px web bitmap. The original is never displayed in the viewer; it's only fetched for download/copy/share.

### 2.2 Backend / S3 / CDN

- `s3Service.getMediaUrl(key)` returns a CDN URL if `CDN_BASE_URL` is set, else a presigned GET URL cached in Redis 55 min.
- Express has `compression()` (gzip, no brotli) and a default weak ETag on `res.json`.
- Prisma indexes: separate `@@index([takenAt])` and `@@index([createdAt])` — no composite matching the `ORDER BY takenAt DESC NULLS LAST, createdAt DESC`.

### 2.3 Worker output (confirmed in `worker/src/worker/`)

- Thumbnail: **400px max, WebP, quality 80** (`thumbnail.py:15,22,26`).
- Web: **2000px max, WebP, quality 80** (`thumbnail.py:16,40,44`).
- blurhash computed from a 64px downscale (`thumbnail.py:119`).
- No AVIF, no responsive/multi-size variants.
- S3 uploads send **only `Content-Type`** — no `Cache-Control` (`s3.py:50,69`).

### 2.4 Infra (confirmed in `infra/main.tf`)

- CloudFront distribution fronts `thumbnails/*`, `web/*`, `crops/*`; **`originals/*` blocked** by a CloudFront Function; cache policy `default_ttl = 86400` (1 day). A public CDN base therefore exists and is safe to expose to the browser.

### 2.5 Key file index

| Concern | File |
|---|---|
| Gallery page | `frontend/src/app/(app)/page.tsx` |
| Grid / virtualization | `frontend/src/components/gallery/GalleryGrid.tsx` |
| Row / item | `frontend/src/components/gallery/GalleryRow.tsx`, `GalleryItem.tsx` |
| Timeline scrollbar | `frontend/src/components/gallery/TimelineScrollbar.tsx`, `frontend/src/lib/hooks/useTimelineScrollbar.ts` |
| Lightbox | `frontend/src/components/media/MediaLightbox.tsx`, `VideoPlayer.tsx` |
| Zoom | `frontend/src/lib/hooks/useImageZoom.ts` |
| Data hooks | `frontend/src/lib/hooks/useShellData.ts`, `useMediaList.ts`, `useTimeline.ts`, `useThumbnailPrefetch.ts` |
| API client | `frontend/src/lib/api/media.ts`, `client.ts` |
| Layout / group utils | `frontend/src/lib/utils/imageLayout.ts`, `groupByDate.ts` |
| React Query config | `frontend/src/app/providers.tsx` |
| Media service / controller | `backend/src/services/media.service.ts`, `backend/src/controllers/media.controller.ts` |
| S3 service | `backend/src/services/s3.service.ts` |
| Redirect helper | `backend/src/utils/response.ts` |
| Select | `backend/src/utils/select.ts` |
| Schema | `backend/prisma/schema.prisma` |
| Worker image gen | `worker/src/worker/thumbnail.py`, `pipeline.py`, `s3.py` |
| Infra | `infra/main.tf` |

---

## 3. Verified Findings

Severity reflects the post-verification assessment. Two original findings were **rejected** in verification — see §3.7.

### 3.1 First load

| ID | Severity | Finding | Files |
|---|---|---|---|
| FL-1 | **Critical** | Unpaginated full-library `/media/shell` gates first paint; nothing renders until the whole array arrives + parses + lays out | `media.service.ts:202`, `page.tsx:24`, `PhotoGallery.tsx:73` |
| FL-2 | High | `groupByDate` runs over the whole library **twice** (PhotoGallery + GalleryGrid), each with `new Date()` + date-fns `format()` per item | `PhotoGallery.tsx:60`, `GalleryGrid.tsx:94`, `groupByDate.ts:16` |
| FL-3 | Medium | First render emits zero rows (`containerWidth<=0`); requires a post-mount ResizeObserver/layout-effect cycle before any item mounts, delaying the first prefetch | `GalleryGrid.tsx:62-92` |
| FL-4 | Medium | No `preconnect`/`dns-prefetch` to CDN/S3; first thumbnail pays full DNS+TCP+TLS | `frontend/src/app/layout.tsx` head |
| FL-5 | Low | Shell over-fetches `fileName` the gallery never renders | `select.ts:5` |
| FL-6 | Medium | No cheap server-side short-circuit (ETag version token) and no SSR/parallel-with-auth prefetch | `media.controller.ts:20`, `providers.tsx`, `AuthGuard.tsx:18` |

### 3.2 Regular scroll

| ID | Severity | Finding | Files |
|---|---|---|---|
| RS-1 | High | Prefetch `version` bump gives `thumbnailSrcFn` a new identity → defeats `React.memo` on **every** mounted row/item on each batch resolve | `useThumbnailPrefetch.ts:17-20,57`, `GalleryRow.tsx:75` |
| RS-2 | High | blurhash `decode()` + `canvas.toDataURL()` on the main thread per mounted item; re-decoded on every remount (component-local memo, no cross-mount cache) | `GalleryItem.tsx:12-23,66-74` |
| RS-3 | Medium | Thumbnail fallback path (`/media/{id}/thumbnail`) until the debounced batch resolves = proxy hop + per-item `findUnique` + 302. *(Not a duplicate byte download — same final URL → cache hit.)* | `GalleryItem.tsx:94`, `media.service.ts:276-290` |
| RS-4 | Medium | Missing `decoding="async"`; opacity fade gated on a manual `img.decode()` + per-image `setState` burst | `GalleryItem.tsx:59-64,93-100` |
| RS-5 | Low | `will-change: transform` permanently on every rendered row | `GalleryGrid.tsx:203-209` |
| RS-6 | Low | `favoriteIds`/`selectedIds` Sets passed unmemoized as props weaken row memo on refetch/selection | `useFavorites.ts:15`, `GalleryGrid.tsx:218-222` |

### 3.3 Skip scroll

| ID | Severity | Finding | Files |
|---|---|---|---|
| SS-1 | High | Drag writes `scrollTop` on **every raw `pointermove`** — unthrottled — so react-virtual mounts/unmounts rows (and re-decodes blurhashes) continuously across the jump | `useTimelineScrollbar.ts:221-237,192` |
| SS-2 | High | Blank/blurhash-only landing: the 150 ms debounce never fires during a drag, so the landing screen falls back to N per-item `/thumbnail` redirects | `useThumbnailPrefetch.ts:28,63`, `GalleryItem.tsx:94` |
| SS-3 | Medium | Per-item DB `findUnique` on the landing fallback (vs one `findMany` for the batch) | `media.service.ts:276-290` |
| SS-4 | Low | In-flight stale batches never aborted; undebounced ResizeObserver `setWrapperHeight`; `setActiveLabel`/`format` per `pointermove` | `useThumbnailPrefetch.ts:48-64`, `useTimelineScrollbar.ts:83-96,193-199` |

### 3.4 Full view

| ID | Severity | Finding | Files |
|---|---|---|---|
| FV-1 | **High** | `getWeb` serves the full-res **original** when `webKey` is null. For JPG/PNG that's a heavy/slow download; for **HEIC/HEIF/TIFF** the original is **undecodable in Chrome/Firefox** → permanent blur/broken image | `media.service.ts:334-337` |
| FV-2 | — | Viewer caps at the 2000px web variant; **original never displayed**; zoom CSS-upscales the web bitmap (blurry past 1:1) | `MediaLightbox.tsx:319`, `useImageZoom.ts:51-55` |
| FV-3 | Medium | 3 full web images (prev/current/next) mounted & fetched at equal priority; current image lacks `fetchpriority="high"`/`decoding="async"` | `MediaLightbox.tsx:278-353,319` |
| FV-4 | Medium | Placeholder re-requests the thumbnail via proxy+DB+302 instead of reusing the grid's decoded thumbnail/blurhash | `MediaLightbox.tsx:311` |
| FV-5 | Low | Tiny 400px thumb stretched to 90vh then jumps straight to 2000px — no intermediate resolution | `MediaLightbox.tsx:310-330` |
| FV-6 | Medium | Video: no `poster`, no `preload` → black box until first frame buffers | `VideoPlayer.tsx:7-15` |
| FV-7 | Low | `getMediaById` runs a faces+person join on **every** open just for the filename | `MediaLightbox.tsx:66-70`, `media.service.ts:222-234` |
| FV-8 | Low | Copy/Share re-fetch the full original + canvas PNG re-encode on the main thread | `MediaLightbox.tsx:85-124` |

### 3.5 Backend / infra (cross-cutting)

| ID | Severity | Finding | Files |
|---|---|---|---|
| BE-1 | **High** | `CDN_BASE_URL` is backend-only; the browser holds `thumbnailKey` but cannot build a URL → forces the batch/redirect machinery to exist | `env.ts:22`, `select.ts:5`, `infra/main.tf` |
| BE-2 | **High** | S3 image objects uploaded with only `Content-Type` — no `Cache-Control`; content-addressed keys never marked immutable → browser doesn't disk-cache | `worker/s3.py:50`, `s3.service.ts:46-61` |
| BE-3 | High | Service worker explicitly bypasses `/api/*` (incl. thumbnails); only navigations are cached → zero persistent thumbnail cache | `frontend/public/sw.js:37-51` |
| BE-4 | High | No ETag/version-token short-circuit on `/shell`/`/timeline`; the 30 s refetch re-runs the full query+serialize | `media.controller.ts:20-28` |
| BE-5 | Medium | No composite index matching the `ORDER BY (takenAt DESC NULLS LAST, createdAt DESC)` | `schema.prisma:70-73` |
| BE-6 | Medium | `getBatchThumbnailUrls` fans out N parallel `getMediaUrl`; in presigned mode = up to N SigV4 presigns per request | `media.service.ts:292-306` |
| BE-7 | Medium | Single 400px WebP thumbnail for all grid sizes incl. retina; no `srcset`/`sizes`; no AVIF | `worker/thumbnail.py`, `GalleryItem.tsx:93-100` |
| BE-8 | Medium | Shared-link thumbnails resolve one URL per request with a heavy nested join; no batch endpoint | `share.service.ts:97-129` |
| BE-9 | Low | gzip-only compression (no brotli) for the large `/shell` JSON | `app.ts:22` |
| BE-10 | Low | `cachedRedirect` uses `private, max-age=3300` (no `immutable`) for effectively-immutable mappings | `response.ts:3-8` |

### 3.6 Frontend data layer / compute (cross-cutting)

| ID | Severity | Finding | Files |
|---|---|---|---|
| FE-1 | **Critical** | `useShellData` refetches the entire library every 30 s, re-running all client layout/decoding | `useShellData.ts:10-11` |
| FE-2 | High | `refetchOnWindowFocus` left at default `true` → every tab refocus refetches the full shell + mounted detail queries | `providers.tsx:11-19` |
| FE-3 | High | `computeJustifiedLayout` recomputed for **all** groups on any `containerWidth` change (resize / sidebar toggle); no per-group memo | `GalleryGrid.tsx:91-167` |
| FE-4 | Low | `mediaMap` rebuilt O(n) on every `items` change (compounds with shell refetch) | `GalleryGrid.tsx:83-89` |
| FE-5 | Low | `useMediaList` polls every 10 s but is mounted unconditionally on collection pages (polls even with picker closed) | `useMediaList.ts:23`, `CollectionItemPicker.tsx:27` |
| FE-6 | Low | Search-result mapping allocates a new array + `new Date().toISOString()` fallback feeding the same double-`groupByDate` path | `page.tsx:77-91` |

### 3.7 Rejected findings (kept for the record)

- **"Thumbnails are downloaded twice"** — REJECTED. The fallback 302 and the batch endpoint resolve to the **same** final CDN/presigned URL (both go through `getMediaUrl`; presigned URLs are Redis-cached identically), so the `src` swap is a cache hit, not a second byte download. The *real* waste in the fallback path is the proxy hop + per-item `findUnique` + 302, captured in RS-3/SS-3.
- **"Presigned URLs differ between the two paths and bust the image cache"** — REJECTED. Both read the same `presigned:${key}` Redis entry within the 55 min TTL and return an identical string; the "have both paths share a cache" fix is already implemented.

---

## 4. Implementation Plan (phased)

Dependencies are noted per task. Phases are ordered by value-to-effort; within a phase, tasks are independent unless stated.

### Phase 0 — Keystone (do these together)

These two unlock the largest wins and simplify several later tasks.

#### P0-A — Expose the CDN base; build thumbnail URLs client-side
*Fixes BE-1, RS-3, SS-2/SS-3 (network half), RS-1 (removes the prefetch hook on the main gallery), FV-4.*

1. Add a public env var for the frontend (the CloudFront domain):
   - `frontend/.env`: `NEXT_PUBLIC_CDN_BASE_URL=https://<cloudfront-domain>`
2. Add a key→URL helper in `frontend/src/lib/api/media.ts`:
   ```ts
   const CDN_BASE = process.env.NEXT_PUBLIC_CDN_BASE_URL;

   /** Direct CDN URL from a stored key, or the redirect endpoint as a fallback (presigned mode). */
   export function thumbnailUrlFromKey(thumbnailKey: string | null, id: string): string {
       if (CDN_BASE && thumbnailKey) return `${CDN_BASE}/${thumbnailKey}`;
       return apiUrl(`/media/${id}/thumbnail`); // presigned-mode fallback
   }
   export function cdnUrlFromKey(key: string | null): string | null {
       return CDN_BASE && key ? `${CDN_BASE}/${key}` : null;
   }
   ```
3. In `GalleryItem.tsx`, use the key already present on the item:
   ```tsx
   src={thumbnailSrc ?? thumbnailUrlFromKey(item.thumbnailKey, item.id)}
   ```
4. When `NEXT_PUBLIC_CDN_BASE_URL` is set, the main gallery no longer needs `useThumbnailPrefetch` (and its `version`-bump re-render storm, RS-1). Gate it: keep the prefetch path **only** as the presigned-mode fallback. In `GalleryGrid.tsx`, when CDN is configured, pass `thumbnailSrcFn = undefined` so `GalleryItem` resolves directly from the key.

> Acceptance: with CDN configured, a cold gallery open issues **no** `POST /media/thumbnail-urls` and **no** `/media/{id}/thumbnail` requests — thumbnails load directly from the CloudFront domain. Network panel shows thumbnail requests starting the instant rows mount (no 150 ms gap).

#### P0-B — Cache-Control on image objects
*Fixes BE-2, BE-10, BE-3 (makes SW caching meaningful).*

Keys are content-addressed UUIDs (`s3.service.ts:18-24`), so the bytes are immutable. Set long-lived caching. Pick one:

- **Preferred (no object backfill, CDN mode):** add a CloudFront `response_headers_policy` in `infra/main.tf` injecting `Cache-Control: public, max-age=31536000, immutable` on the `thumbnails/*`, `web/*`, `crops/*` behaviors.
- **Origin object header (covers presigned mode too):** add `CacheControl: 'public, max-age=31536000, immutable'` to `PutObjectCommand` in `getPresignedUploadUrl` (`s3.service.ts:51-56`) **and** have the worker send the matching `Cache-Control` header on its PUT (`worker/s3.py:50`) so the signature matches. For the presigned **GET** path, add `ResponseCacheControl` to the `GetObjectCommand` in `getPresignedDownloadUrl`.

> Acceptance: a thumbnail response carries `Cache-Control: public, max-age=31536000, immutable`; a second view of the same image is served from disk cache (Network: "(disk cache)").

### Phase 1 — Quick wins

#### P1-1 — Stop the polling
*Fixes FE-1, FE-2, FE-5.*

- `useShellData.ts`: remove `refetchInterval: 30_000` (membership already invalidates on mutation via `queryClient.invalidateQueries(['media'])` — `page.tsx:57`). Keep a generous `staleTime`.
- `providers.tsx`: in `defaultOptions.queries` add `refetchOnWindowFocus: false` and a deliberate `gcTime`.
- `useMediaList.ts`: remove `refetchInterval: 10_000` (or gate with `enabled` tied to the picker being open).

> Acceptance: idle gallery issues no periodic `/media/shell`; alt-tab back triggers no full reload.

#### P1-2 — Blurhash off the hot path
*Fixes RS-2, SS-2 (decode half), RS-4.*

- Add a **module-level LRU** keyed by `blurHash` so a hash is decoded once across all mounts/remounts.
- Avoid `toDataURL` (synchronous PNG encode): draw the decoded `ImageData` to a small persistent `<canvas>`, or precompute a [thumbhash](https://github.com/evanw/thumbhash) (see P2-5).
- Add `decoding="async"` to the grid `<img>`; drop the manual `img.decode()`-gated fade in favor of CSS/`load`.

```ts
// frontend/src/lib/utils/blurhashCache.ts
const cache = new Map<string, string>(); // blurHash -> dataURL
const MAX = 1000;
export function blurhashDataUrl(hash: string): string | null {
    const hit = cache.get(hash);
    if (hit) { cache.delete(hash); cache.set(hash, hit); return hit; } // LRU touch
    const url = decodeToDataUrl(hash); // existing decode logic
    if (!url) return null;
    cache.set(hash, url);
    if (cache.size > MAX) cache.delete(cache.keys().next().value);
    return url;
}
```

> Acceptance: scroll-back over previously-seen rows triggers no new decodes (profiler shows no `toDataURL` on remount); fast scroll long-tasks shrink.

#### P1-3 — rAF-throttle the timeline drag
*Fixes SS-1, SS-4 (partial).*

In `useTimelineScrollbar.ts`, store the latest fraction in a ref and apply `scrollTop` at most once per frame; fold `setThumbFraction`/`setActiveLabel` into the same frame and skip `setActiveLabel` when the label is unchanged.

```ts
const pendingFraction = useRef<number | null>(null);
const dragRaf = useRef<number | null>(null);
const scheduleScroll = (fraction: number) => {
    pendingFraction.current = fraction;
    if (dragRaf.current != null) return;
    dragRaf.current = requestAnimationFrame(() => {
        dragRaf.current = null;
        const f = pendingFraction.current!;
        // ...write scrollTop, update thumb fraction + label once...
    });
};
```

> Acceptance: dragging the scrollbar across the full library no longer flickers; profiler shows one scroll write per frame instead of per pointer event.

#### P1-4 — `/web` null-`webKey` fallback (the FV-1 bug)
*Fixes FV-1. Pairs with P1-6 (resolution ladder) and the worker change in Phase 3.*

`getWebUrl` (`media.service.ts:320-338`) must never hand a raw HEIC/RAW original to a browser `<img>`. Make the fallback the thumbnail (always a browser-safe WebP) and enqueue web generation:

```ts
// select needs mimeType for a format-aware variant
if (item.webKey) return s3Service.getMediaUrl(item.webKey);
// no web variant yet → return the (always-decodable) thumbnail instead of the raw original
if (item.thumbnailKey) {
    // optional: enqueue web-optimize for this item so the gap self-heals
    return s3Service.getMediaUrl(item.thumbnailKey);
}
// last resort: 202/placeholder; do NOT serve raw HEIC/RAW originals
```

> Note: this only governs the **web** (fast first-paint) layer. Showing the actual full-resolution original is the resolution ladder (P1-6), not this endpoint.
>
> Acceptance: opening a freshly-uploaded HEIC shows the thumbnail (then the web variant once ready), never a broken image; a 12 MP JPG without a web variant no longer triggers a multi-MB download for the fit-to-screen view.

#### P1-5 — Lightbox priority hints + video poster
*Fixes FV-3, FV-6, FV-7.*

- Current web `<img>`: add `fetchPriority="high"` and `decoding="async"`. Neighbor slides: `fetchPriority="low"` (and/or gate their `src` until the current image's `onLoad`).
- `VideoPlayer`: accept a `poster` prop and pass the grid thumbnail; render a placeholder for the VIDEO branch.
- `getMediaById` on open: use the `mediaType` prop already passed for the type guard; lazy-load EXIF/faces only when the info panel opens (split a cheap filename select from the faces join).

#### P1-6 — Full-view resolution ladder (the "I want the full original" feature)
*Fixes FV-2, FV-5; builds on P0-A and P1-4.*

Add a third image layer so the viewer goes **placeholder → web → original**, with the original loaded lazily so it never blocks first sharp paint. This matches Google Photos/Drive: serve a screen-appropriate image for the fit view, fetch the true original on **zoom** (or an explicit "view original" control).

Layers in the current slide (extend the existing thumbnail→web crossfade at `MediaLightbox.tsx:308-336`):

```
Layer 1  blurhash / cached 400px grid thumb   → instant placeholder
Layer 2  2000px web (webKey)                   → first sharp paint  (existing)
Layer 3  full original (originalKey)           → crossfades in, on demand  (NEW)
```

Implementation notes:
- Rename the misleading `originalLoaded` state (it currently tracks the **web** load) to `webLoaded`; add a separate `fullResLoaded`.
- Trigger Layer 3 when `useImageZoom` reports `isZoomed` (or on an explicit control). Optionally also background-prefetch the original after the web paints **only on a fast connection** (`navigator.connection.effectiveType`, honor `saveData`).
- Only the **current** slide loads the original (never prev/next). Add `fetchPriority="high"` to the original once requested; abort the fetch on navigation (`AbortController`).
- Crossfade the original over the web on `load`+`decode`, identical to the existing thumbnail→web pattern.

HEIC caveat: for JPEG/PNG/WebP/GIF, `urls.original(id)` is directly viewable and the ladder works end-to-end. For **HEIC/HEIF/TIFF** the raw original cannot go in an `<img>`; Layer 3 must point at a **full-res browser-safe derivative** (does not exist today — web caps at 2000px). See P3-3.

> Acceptance: opening a JPG shows the web image fast, then zooming in fetches and swaps in the full-resolution original (crisp at 1:1); casual swiping never downloads originals.

#### P1-7 — First-load polish
*Fixes FL-3, FL-4, FL-5.*

- `GalleryGrid.tsx`: seed a sensible default container width (e.g. `window.innerWidth` fallback) so the first synchronous render produces rows; refine via ResizeObserver.
- `layout.tsx` head: `<link rel="preconnect" crossorigin href={NEXT_PUBLIC_CDN_BASE_URL}>` + `<link rel="dns-prefetch" ...>`.
- Give the shell its own select without `fileName` (keep `MEDIA_ITEM_SUMMARY_SELECT` for the list endpoint, which needs it).

#### P1-8 — Service-worker thumbnail caching
*Fixes BE-3 (depends on P0-B for correct freshness).*

Add a cache-first / stale-while-revalidate route in `sw.js` for thumbnail object URLs (the CloudFront domain, and/or `/media/*/thumbnail`), backed by a separate size-capped cache with LRU eviction.

### Phase 2 — Medium

- **P2-1 (FL-2, FE-6):** compute `groupByDate` once and share between `PhotoGallery` and `GalleryGrid`; replace `format(new Date(s),'yyyy-MM-dd')` with `s.slice(0,10)` (apply consistently — it keys by UTC vs local day).
- **P2-2 (FE-3):** memoize `computeJustifiedLayout` per group keyed by `(groupId, bucketedWidth)`; quantize/rAF-coalesce the measured width so resize drags don't recompute the whole library.
- **P2-3 (BE-4):** version-token ETag on `/shell` and `/timeline` — `COUNT(*)` + `MAX(updated_at)` or a Redis counter bumped on insert/delete; return `304` without running the `findMany` on `If-None-Match` match.
- **P2-4 (BE-5):** composite index `@@index([takenAt(sort: Desc), createdAt(sort: Desc)])`; verify the generated DDL emits `NULLS LAST`. Chiefly benefits the paginated path (P3-1).
- **P2-5 (RS-2 best fix):** precompute a thumbhash at ingest (worker), add to `MEDIA_ITEM_SUMMARY_SELECT`, use directly as the placeholder — eliminates client-side blurhash decode entirely.
- **P2-6 (BE-8):** batched shared-thumbnail endpoint (or, once CDN is exposed, build shared thumbnail URLs from the keys already in `getSharedCollection`'s payload); replace `include: { mediaItem: true }` with a narrow `select`.
- **P2-7 (FV-5):** worker emits a ~1024px "preview" variant; render it as a middle layer between thumbnail and web.

### Phase 3 — Architectural

- **P3-1 (FL-1, FE-1 root):** paginate the first screen. Paint the first page from the existing cursor-paginated `GET /media` (`useMediaList`, raise `limit`) so thumbnails start loading immediately, then hydrate the rest in the background. Reconcile with the timeline scrollbar, which currently needs the whole library client-side: drive skip-scroll from `/media/timeline` month counts + fetch item windows on demand around the landing position. **Tradeoff:** instant arbitrary-date jumping currently relies on having all layout client-side; a windowed approach trades a little jump latency for vastly cheaper first load. (This is the one change that subsumes FL-1/FE-1 fully.)
- **P3-2 (BE-7):** responsive thumbnails — worker emits 200/400/800 WebP; extend the shell/CDN URL building to emit `srcset` + `sizes` on the grid `<img>`.
- **P3-3 (FV full-res for HEIC):** worker emits a **full-resolution browser-safe derivative** (raise `WEB_MAX_DIMENSION` or add a dedicated "full" JPEG/WebP) so the resolution ladder (P1-6) has a real full-res asset for HEIC/RAW. Alternative/fallback: client-side HEIC decode via libheif/`heic2any` WASM on demand.
- **P3-4 (BE-7):** AVIF variants via `<picture>` or content negotiation (~20-30% smaller than WebP).
- **P3-5 (BE-9):** brotli for `application/json` at whatever proxies `/api` (only worthwhile after P3-1 shrinks the payload).

---

## 5. Per-scenario impact map

| Scenario | Primary tasks |
|---|---|
| **First load** | P3-1 (root), P0-A, P1-1, P1-7, P2-1, P2-3, BE-9/P3-5 |
| **Regular scroll** | P0-A (removes RS-1/RS-3), P1-2, P1-1, P2-2, RS-5/RS-6 |
| **Skip scroll** | P1-3, P0-A + P1-2 (collapse the blank-landing window), SS-4 |
| **Full view** | P1-4 (bug), P1-6 (ladder), P1-5, P0-A (placeholder), P2-7, P3-3, FV-8 |
| **All / repeat visits** | P0-B, P1-8, P0-A |

---

## 6. How to measure (before/after)

- **Time-to-first-thumbnail:** Chrome DevTools Performance trace from navigation → first thumbnail paint; watch the `/media/shell` response time + the JSON `parse` long-task. Track across library sizes (1k vs 10k vs 50k items).
- **Scroll FPS / long tasks:** Performance panel while scrolling; look for `toDataURL`, re-render storms (React Profiler "why did this render"), and dropped frames per scroll step.
- **Skip-scroll:** trace a full-library drag; count virtual-row mounts and the blank-landing duration after `pointerup`.
- **Network:** confirm thumbnails come from the CDN domain and hit disk cache on revisit; confirm no `/thumbnail-urls` / per-item `/thumbnail` in CDN mode.
- **Full view:** time-to-sharp on open and per prev/next; confirm originals load only on zoom; confirm HEIC never shows a broken image.
- **Backend:** DB query count/latency for `/shell` and the redirect endpoints; `304` rate after P2-3.

---

## 7. Risks & tradeoffs

- **CDN exposure (P0-A):** safe given `infra/main.tf` blocks `originals/*` at CloudFront and only `thumbnails/*`/`web/*`/`crops/*` are public. In presigned (no-CDN) deployments the batch/redirect path remains the fallback — keep it.
- **`immutable` cache (P0-B):** correct only because keys are content-addressed UUIDs; never reuse a key for different bytes.
- **`s.slice(0,10)` grouping (P2-1):** keys by UTC date vs the current local-date grouping — apply consistently to both the group key and the label or photos can shift day buckets.
- **Pagination (P3-1):** trades instant whole-library timeline jumps for cheaper first load; mitigate with `/media/timeline`-driven windowed fetching.
- **Original-on-zoom (P1-6):** background-prefetch of originals must be gated on connection quality or it reintroduces the bandwidth problem P1-4 fixes.
- **`/web` thumbnail fallback (P1-4):** an unprocessed JPG shows at 400px until its web variant exists — acceptable transient state; the ladder still delivers full-res on demand.

---

## 8. Appendix — verification provenance

Findings came from a multi-agent audit; each was independently re-read against source by an adversarial verifier, and severities here reflect the post-verification assessment. External facts were confirmed directly: worker output sizes/formats (`worker/src/worker/thumbnail.py`), S3 upload headers (`worker/src/worker/s3.py`), and the CloudFront distribution (`infra/main.tf`). Two findings were rejected in verification and are recorded in §3.7 to prevent re-introduction.
