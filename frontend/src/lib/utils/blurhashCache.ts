import { decode } from 'blurhash';

/**
 * Module-level cache of decoded blurhash → data URL.
 *
 * Decoding a blurhash (`decode()` + `canvas.toDataURL()`) is a synchronous
 * main-thread cost. Without a cache it runs once per *mounted* item and again
 * on every remount (the gallery virtualizes, so scroll-back and skip-scroll
 * remount the same items repeatedly). Caching by hash means each unique hash is
 * decoded at most once across all mounts/remounts for the lifetime of the page.
 *
 * A small LRU bound keeps memory in check for very large libraries.
 */
const cache = new Map<string, string>();
const MAX_ENTRIES = 1000;

function decodeToDataUrl(hash: string, width: number, height: number): string | null {
    if (typeof document === 'undefined') return null;
    const pixels = decode(hash, width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL();
}

/**
 * Returns a (cached) data URL for the given blurhash, decoding it only once.
 * Returns null on the server or if decoding fails.
 */
export function blurhashToDataUrl(hash: string, width = 32, height = 32): string | null {
    const key = `${hash}:${width}x${height}`;

    const hit = cache.get(key);
    if (hit !== undefined) {
        // LRU touch: re-insert so it becomes most-recently-used.
        cache.delete(key);
        cache.set(key, hit);
        return hit;
    }

    let url: string | null;
    try {
        url = decodeToDataUrl(hash, width, height);
    }
    catch {
        url = null;
    }
    if (!url) return null;

    cache.set(key, url);
    if (cache.size > MAX_ENTRIES) {
        // Evict the oldest (least-recently-used) entry.
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    return url;
}
