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

/**
 * One canvas for every decode, rather than one per call.
 *
 * `createElement('canvas')` plus `getContext('2d')` allocates a fresh backing store,
 * which on iOS goes through the GPU surface allocator. Doing that once per newly mounted
 * cell — up to a hundred per screenful on a dense mobile grid — is pure churn, since the
 * canvas is written and read within the same synchronous call and never retained.
 */
let scratchCanvas: HTMLCanvasElement | null = null;

function decodeToDataUrl(hash: string, width: number, height: number): string | null {
    if (typeof document === 'undefined') return null;
    const pixels = decode(hash, width, height);
    if (!scratchCanvas) scratchCanvas = document.createElement('canvas');
    const canvas = scratchCanvas;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL();
}

const BASE83 =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

/**
 * The blurhash's average colour, as a CSS `rgb()` string — arithmetic only, no canvas.
 *
 * The full decode is a real cost: `decode()` plus `putImageData` plus a `toDataURL()`
 * PNG encode and base64, all synchronously inside a component's render, and the cache is
 * keyed by hash so scrolling *forward* misses every time by construction. At six columns
 * that is roughly a hundred misses per new screenful, tens of milliseconds of blocked
 * main thread each time, on the same thread the scroll depends on.
 *
 * At small cell sizes it also buys nothing: a 62px cell cannot resolve a 32x32 gradient,
 * so the flat average is visually equivalent. Characters 2 to 5 of the hash carry the DC
 * term as a 24-bit sRGB triple (character 0 is the component counts, character 1 the
 * maximum AC value), so it is four base83 digits and three shifts.
 */
export function blurhashAverageColor(hash: string): string | null {
    if (hash.length < 6) return null;

    let value = 0;
    for (let i = 2; i < 6; i++) {
        const digit = BASE83.indexOf(hash[i]!);
        if (digit === -1) return null;
        value = value * 83 + digit;
    }

    return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
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
