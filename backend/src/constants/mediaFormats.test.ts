import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    isSupportedExtension,
    isSupportedMimeType,
    mimeForExtension,
    SUPPORTED_EXTENSIONS,
    SUPPORTED_MIME_TYPES,
} from './mediaFormats.js';

describe('media format allowlist', () => {
    it('accepts the MIME types the upload flow issues presigns for', () => {
        expect(isSupportedMimeType('image/jpeg')).toBe(true);
        expect(isSupportedMimeType('video/quicktime')).toBe(true);
    });

    it('is case-insensitive, because browsers are inconsistent', () => {
        expect(isSupportedMimeType('IMAGE/JPEG')).toBe(true);
        expect(isSupportedExtension('.JPG')).toBe(true);
    });

    it('rejects anything not on the list', () => {
        expect(isSupportedMimeType('application/zip')).toBe(false);
        expect(isSupportedMimeType('text/html')).toBe(false);
        expect(isSupportedExtension('exe')).toBe(false);
    });

    /**
     * The regression this file exists for: `tif` was absent from the frontend's
     * extension list while `image/tiff` was present in the backend's MIME set, so
     * dropping a folder containing `photo.tif` silently skipped it ("No supported
     * photos or videos found") while selecting the same file through the file picker
     * uploaded it fine.
     */
    it('has an extension for every supported MIME type', () => {
        for (const mime of SUPPORTED_MIME_TYPES) {
            const hasExtension = SUPPORTED_EXTENSIONS.some((ext) => mimeForExtension(ext) === mime);
            expect(hasExtension, `no extension maps to ${mime}`).toBe(true);
        }
    });

    it('maps every supported extension to a supported MIME type', () => {
        for (const ext of SUPPORTED_EXTENSIONS) {
            const mime = mimeForExtension(ext);
            expect(mime, `${ext} maps to nothing`).toBeDefined();
            expect(SUPPORTED_MIME_TYPES).toContain(mime!);
        }
    });

    it('covers tiff via both of its extensions', () => {
        expect(mimeForExtension('tif')).toBe('image/tiff');
        expect(mimeForExtension('tiff')).toBe('image/tiff');
    });

    it('has no duplicate extensions across formats', () => {
        // A duplicate would make mimeForExtension's answer depend on declaration order.
        expect(new Set(SUPPORTED_EXTENSIONS).size).toBe(SUPPORTED_EXTENSIONS.length);
    });
});

/**
 * The frontend keeps its own copy of these lists (it cannot import from the backend
 * package). This asserts the copy is derived from the same data rather than hand-typed,
 * which is how the `tif` divergence happened in the first place.
 */
describe('frontend mirror', () => {
    const frontendConstants = join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        'frontend',
        'src',
        'lib',
        'constants',
        'mediaFormats.ts'
    );

    /**
     * Both files declare one table of `{ mime, extensions }` entries and derive their
     * lists from it, so the table is what has to match. Comparing the full mapping (not
     * just the extension list) also catches an extension being moved to the wrong MIME
     * type, which would make the presign request send a type the backend rejects.
     */
    function parseFormatTable(source: string): Record<string, string[]> {
        const table: Record<string, string[]> = {};
        const entry = /\{\s*mime:\s*'([^']+)',\s*extensions:\s*\[([^\]]*)\]\s*\}/g;
        for (const match of source.matchAll(entry)) {
            table[match[1]!] = [...match[2]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
        }
        return table;
    }

    it('declares exactly the same mime-to-extension table as the frontend', () => {
        let frontendSource: string;
        try {
            frontendSource = readFileSync(frontendConstants, 'utf-8');
        }
        catch {
            // Backend checked out standalone.
            return;
        }

        const backendSource = readFileSync(
            join(import.meta.dirname, 'mediaFormats.ts'),
            'utf-8'
        );

        const frontendTable = parseFormatTable(frontendSource);
        const backendTable = parseFormatTable(backendSource);

        expect(
            Object.keys(backendTable).length,
            'failed to parse the backend format table'
        ).toBeGreaterThan(0);
        expect(frontendTable).toEqual(backendTable);
    });

    it('derives the same flattened extension list as the parsed table', () => {
        const backendSource = readFileSync(
            join(import.meta.dirname, 'mediaFormats.ts'),
            'utf-8'
        );
        const fromSource = Object.values(parseFormatTable(backendSource)).flat();

        expect([...fromSource].sort()).toEqual([...SUPPORTED_EXTENSIONS].sort());
    });
});
