import { describe, expect, it } from 'vitest';
import { collectMediaS3Keys, thumbnailVariantKeys } from './s3.js';
import { THUMBNAIL_WIDTHS } from '../constants/storage.js';

const THUMB = 'thumbnails/2026/08/11111111-1111-1111-1111-111111111111.webp';

describe('thumbnailVariantKeys', () => {
    it('derives one key per ladder width, matching the worker key form', () => {
        // The worker builds these as `${stem}${suffix}${ext}` in
        // s3.upload_bytes_to_derived_key; the shapes must agree exactly or deletion
        // names objects that do not exist and leaves the real ones behind.
        expect(thumbnailVariantKeys(THUMB)).toEqual([
            'thumbnails/2026/08/11111111-1111-1111-1111-111111111111@200w.webp',
            'thumbnails/2026/08/11111111-1111-1111-1111-111111111111@400w.webp',
            'thumbnails/2026/08/11111111-1111-1111-1111-111111111111@800w.webp',
        ]);
    });

    it('emits exactly as many variants as there are widths', () => {
        expect(thumbnailVariantKeys(THUMB)).toHaveLength(THUMBNAIL_WIDTHS.length);
    });

    it('returns nothing for a key with no extension rather than guessing', () => {
        expect(thumbnailVariantKeys('thumbnails/2026/08/no-extension')).toEqual([]);
    });

    it('splits on the last dot, so a dotted directory is not mistaken for the extension', () => {
        expect(thumbnailVariantKeys('thumbnails/v1.2/abc.webp')).toContain(
            'thumbnails/v1.2/abc@200w.webp'
        );
    });
});

describe('collectMediaS3Keys', () => {
    it('collects the ladder variants, not just the canonical thumbnail', () => {
        // This is the regression under test: the ladder was introduced as a perf fix
        // but deletion never learned about it, so every delete stranded 3 objects
        // per photo with nothing left to reference them.
        const keys = collectMediaS3Keys({
            originalKey: 'originals/2026/08/22222222-2222-2222-2222-222222222222.jpg',
            thumbnailKey: THUMB,
        });

        for (const width of THUMBNAIL_WIDTHS) {
            expect(keys).toContain(
                `thumbnails/2026/08/11111111-1111-1111-1111-111111111111@${width}w.webp`
            );
        }
    });

    it('collects every derived artefact a media item owns', () => {
        const keys = collectMediaS3Keys({
            originalKey: 'originals/2026/08/a.jpg',
            thumbnailKey: THUMB,
            webKey: 'web/2026/08/b.webp',
            streamingKey: 'streaming/2026/08/c.mp4',
            faces: [{ cropKey: 'crops/2026/08/d.webp' }, { cropKey: 'crops/2026/08/e.webp' }],
        });

        expect(keys).toEqual(
            expect.arrayContaining([
                'originals/2026/08/a.jpg',
                THUMB,
                'web/2026/08/b.webp',
                'streaming/2026/08/c.mp4',
                'crops/2026/08/d.webp',
                'crops/2026/08/e.webp',
            ])
        );
        // 4 base + 2 crops + 3 ladder
        expect(keys).toHaveLength(9);
    });

    it('emits no ladder keys when the item has no thumbnail yet', () => {
        // An item that failed processing, or is still queued.
        const keys = collectMediaS3Keys({ originalKey: 'originals/2026/08/a.jpg' });
        expect(keys).toEqual(['originals/2026/08/a.jpg']);
    });

    it('drops null and empty keys so DeleteObjects is never handed a blank key', () => {
        const keys = collectMediaS3Keys({
            originalKey: 'originals/2026/08/a.jpg',
            thumbnailKey: null,
            webKey: '',
            streamingKey: undefined,
            faces: [{ cropKey: null }],
        });
        expect(keys).toEqual(['originals/2026/08/a.jpg']);
    });
});
