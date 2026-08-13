/**
 * Single source of truth for S3 object layout.
 *
 * The prefix list previously existed in four places (s3.service key generators,
 * the /internal upload-url zod enum, the worker's s3.py, and the CloudFront
 * bucket policy), so adding a variant meant four coordinated edits and a typo
 * silently mis-filed objects instead of failing.
 */
export const STORAGE_PREFIXES = [
    'originals',
    'thumbnails',
    'web',
    'streaming',
    'crops',
] as const;

export type StoragePrefix = (typeof STORAGE_PREFIXES)[number];

/**
 * Prefixes the worker is allowed to request an upload URL for. `originals` is
 * excluded: only the user-facing presign flow may write originals.
 */
export const WORKER_WRITABLE_PREFIXES = [
    'thumbnails',
    'web',
    'streaming',
    'crops',
] as const;

/**
 * Prefixes served by the public CDN. Must stay in sync with the
 * aws_s3_bucket_policy in infra/main.tf. `originals` is deliberately absent —
 * originals are only ever served via short-lived presigned URLs.
 */
export const CDN_SERVED_PREFIXES = ['thumbnails', 'web', 'crops'] as const;

export type WorkerWritablePrefix = (typeof WORKER_WRITABLE_PREFIXES)[number];

/**
 * Widths in the responsive thumbnail ladder, smallest first.
 *
 * Mirrors `worker/src/worker/thumbnail.py` THUMBNAIL_WIDTHS and
 * `frontend/src/lib/api/media.ts` THUMBNAIL_WIDTHS. The backend needs its own copy
 * because deletion has to name these objects: they live at keys derived from
 * `thumbnailKey` and are recorded in no column, so nothing else can enumerate them.
 */
export const THUMBNAIL_WIDTHS = [200, 400, 800] as const;

/** `originals/2026/08/<uuid>.<ext>` */
const KEY_PATTERN = new RegExp(
    `^(${STORAGE_PREFIXES.join('|')})/\\d{4}/\\d{2}/[0-9a-f-]{36}\\.[a-z0-9]{1,12}$`
);

/** As above, but allowing a responsive-variant suffix: `<uuid>@400w.webp`. */
const VARIANT_KEY_PATTERN = new RegExp(
    `^(${STORAGE_PREFIXES.join('|')})/\\d{4}/\\d{2}/[0-9a-f-]{36}(@\\d{2,5}w)?\\.[a-z0-9]{1,12}$`
);

/**
 * Validates that a string is a key this application generated.
 *
 * Used to gate /internal/s3/download, which accepts a caller-supplied key and
 * returns a presigned GET for it. Without this, that route is an arbitrary-read
 * primitive over the entire bucket.
 */
export function isManagedStorageKey(key: string): boolean {
    return KEY_PATTERN.test(key) || VARIANT_KEY_PATTERN.test(key);
}

/** Accepts the width-variant form used by the responsive thumbnail ladder. */
export function isManagedVariantKey(key: string): boolean {
    return VARIANT_KEY_PATTERN.test(key);
}

export function keyPrefix(key: string): StoragePrefix | null {
    const candidate = key.split('/')[0];
    return STORAGE_PREFIXES.includes(candidate as StoragePrefix)
        ? (candidate as StoragePrefix)
        : null;
}

/**
 * Normalises a user-supplied filename into a safe object-key extension.
 *
 * The old implementation was `fileName.split('.').pop()`, interpolated straight
 * into the key — so a filename like `a.jpg/../../evil` produced a key containing
 * path segments and `..`, and any extension length or character was accepted.
 */
export function safeExtension(fileName: string, fallback = 'bin'): string {
    const dot = fileName.lastIndexOf('.');
    if (dot === -1 || dot === fileName.length - 1) return fallback;
    const raw = fileName.slice(dot + 1).toLowerCase();
    return /^[a-z0-9]{1,12}$/.test(raw) ? raw : fallback;
}
