import { describe, expect, it } from 'vitest';
import {
    CDN_SERVED_PREFIXES,
    isManagedStorageKey,
    isManagedVariantKey,
    keyPrefix,
    safeExtension,
    STORAGE_PREFIXES,
    WORKER_WRITABLE_PREFIXES,
} from './storage.js';

/**
 * These functions are the guard on `GET /internal/s3/download/:key(*)`, which takes a
 * caller-supplied key and returns a presigned GET for it. Without validation that route
 * is an arbitrary-read primitive over the entire bucket — and with the old fail-open
 * service auth it was reachable unauthenticated.
 */
describe('isManagedStorageKey', () => {
    const validKey = 'originals/2026/08/0189cf9e-4d3a-7c11-9a5e-2b1f6c8d4e70.jpg';

    it('accepts a key this application generated', () => {
        expect(isManagedStorageKey(validKey)).toBe(true);
    });

    it.each(STORAGE_PREFIXES)('accepts the %s prefix', (prefix) => {
        expect(
            isManagedStorageKey(`${prefix}/2026/08/0189cf9e-4d3a-7c11-9a5e-2b1f6c8d4e70.webp`)
        ).toBe(true);
    });

    it('accepts a responsive width variant', () => {
        expect(
            isManagedStorageKey(
                'thumbnails/2026/08/0189cf9e-4d3a-7c11-9a5e-2b1f6c8d4e70@400w.webp'
            )
        ).toBe(true);
    });

    it.each([
        // Traversal, absolute paths and prefix escapes.
        ['../../etc/passwd'],
        ['originals/../../secrets/key.pem'],
        ['/originals/2026/08/0189cf9e-4d3a-7c11-9a5e-2b1f6c8d4e70.jpg'],
        ['originals/2026/08/../../../config.json'],
        // Wrong or unknown prefix.
        ['secrets/2026/08/0189cf9e-4d3a-7c11-9a5e-2b1f6c8d4e70.jpg'],
        ['2026/08/0189cf9e-4d3a-7c11-9a5e-2b1f6c8d4e70.jpg'],
        // Not a UUID, so not something we minted.
        ['originals/2026/08/anything-at-all.jpg'],
        ['originals/2026/08/.jpg'],
        // Malformed date segments.
        ['originals/20268/08/0189cf9e-4d3a-7c11-9a5e-2b1f6c8d4e70.jpg'],
        ['originals/2026/8/0189cf9e-4d3a-7c11-9a5e-2b1f6c8d4e70.jpg'],
        // Missing or absurd extension.
        ['originals/2026/08/0189cf9e-4d3a-7c11-9a5e-2b1f6c8d4e70'],
        ['originals/2026/08/0189cf9e-4d3a-7c11-9a5e-2b1f6c8d4e70.verylongextension'],
        // Newline injection, and a key that merely *contains* a valid one.
        ['originals/2026/08/0189cf9e-4d3a-7c11-9a5e-2b1f6c8d4e70.jpg\nx'],
        ['x/originals/2026/08/0189cf9e-4d3a-7c11-9a5e-2b1f6c8d4e70.jpg'],
        [''],
    ])('rejects %j', (key) => {
        expect(isManagedStorageKey(key)).toBe(false);
    });
});

describe('isManagedVariantKey', () => {
    it('accepts a width variant', () => {
        expect(
            isManagedVariantKey(
                'thumbnails/2026/08/0189cf9e-4d3a-7c11-9a5e-2b1f6c8d4e70@200w.webp'
            )
        ).toBe(true);
    });

    it('accepts the un-suffixed base key', () => {
        expect(
            isManagedVariantKey('thumbnails/2026/08/0189cf9e-4d3a-7c11-9a5e-2b1f6c8d4e70.webp')
        ).toBe(true);
    });

    it('rejects an arbitrary suffix', () => {
        expect(
            isManagedVariantKey(
                'thumbnails/2026/08/0189cf9e-4d3a-7c11-9a5e-2b1f6c8d4e70@evil.webp'
            )
        ).toBe(false);
    });
});

describe('keyPrefix', () => {
    it('extracts a known prefix', () => {
        expect(keyPrefix('web/2026/08/x.webp')).toBe('web');
    });

    it('returns null for an unknown prefix', () => {
        expect(keyPrefix('secrets/2026/08/x.webp')).toBeNull();
    });
});

describe('prefix policy', () => {
    it('never lets the worker write originals', () => {
        // Only the user-facing presign flow may create originals.
        expect(WORKER_WRITABLE_PREFIXES as readonly string[]).not.toContain('originals');
    });

    it('never serves originals from the public CDN', () => {
        // The distribution has no signed URLs, so anything reachable through it is
        // world-readable to whoever holds the URL and cannot be revoked.
        expect(CDN_SERVED_PREFIXES as readonly string[]).not.toContain('originals');
    });
});

describe('safeExtension', () => {
    it('extracts a normal extension', () => {
        expect(safeExtension('holiday.JPG')).toBe('jpg');
    });

    it('takes the last extension of a multi-dot name', () => {
        expect(safeExtension('archive.tar.gz')).toBe('gz');
    });

    it.each([
        // The old implementation was `fileName.split('.').pop()`, interpolated straight
        // into the object key — so everything after the *first* dot, path separators
        // included, ended up inside the key. Anything that is not a plain short
        // alphanumeric token now falls back.
        ['a.tar.gz/../../x'],
        ['name.'],
        ['noextension'],
        ['a.<script>'],
        ['a.jpg\nx'],
        ['a.thisextensioniswaytoolong'],
        [''],
    ])('falls back to the default for %j', (fileName) => {
        expect(safeExtension(fileName)).toBe('bin');
    });

    it('discards everything before the final dot, including traversal', () => {
        // The traversal characters all precede the last dot, so they are dropped and
        // what remains is a plain token. The resulting key is
        // `originals/<y>/<m>/<uuid>.html` — inert, with no separators.
        expect(safeExtension('a.jpg/../../thumbnails/evil.html')).toBe('html');
    });

    it('honours a caller-supplied fallback', () => {
        expect(safeExtension('noextension', 'webp')).toBe('webp');
    });

    it('never returns a value containing a path separator', () => {
        const hostile = ['a.jpg/../b', 'a./x', 'a.\\y'];
        for (const name of hostile) {
            const ext = safeExtension(name);
            expect(ext).not.toContain('/');
            expect(ext).not.toContain('\\');
            expect(ext).not.toContain('.');
        }
    });
});
