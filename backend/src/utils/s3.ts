import { THUMBNAIL_WIDTHS } from '../constants/storage.js';

/**
 * The responsive thumbnail variants derived from a base thumbnail key.
 *
 * The worker uploads `thumbnails/…/<uuid>@200w.webp` alongside
 * `thumbnails/…/<uuid>.webp`, and those siblings are not recorded in any column —
 * the client reconstructs them from `thumbnailKey`. That means deletion has to
 * reconstruct them too, or every variant is orphaned in the bucket forever.
 */
export function thumbnailVariantKeys(thumbnailKey: string): string[] {
    const dot = thumbnailKey.lastIndexOf('.');
    if (dot === -1) return [];

    const stem = thumbnailKey.slice(0, dot);
    const ext = thumbnailKey.slice(dot);
    return THUMBNAIL_WIDTHS.map((width) => `${stem}@${width}w${ext}`);
}

/**
 * Collects every S3 object owned by a media item.
 *
 * Two classes of orphan have been fixed here. Face crop keys were omitted, so
 * deleting a photo stranded every crop it had generated (crops were only deleted
 * when a *person* was deleted). And the responsive thumbnail ladder is stored at
 * derived keys with no column of its own, so it has to be reconstructed rather
 * than read.
 *
 * Over-listing is safe: S3 DeleteObjects treats a missing key as success, so
 * naming a variant that was never generated (an older item, or a failed ladder
 * upload) costs nothing.
 */
export function collectMediaS3Keys(item: {
    originalKey: string;
    thumbnailKey?: string | null;
    streamingKey?: string | null;
    webKey?: string | null;
    faces?: Array<{ cropKey: string | null }>;
}): string[] {
    const keys: Array<string | null | undefined> = [
        item.originalKey,
        item.thumbnailKey,
        item.streamingKey,
        item.webKey,
    ];

    if (item.thumbnailKey) {
        keys.push(...thumbnailVariantKeys(item.thumbnailKey));
    }

    for (const face of item.faces ?? []) {
        keys.push(face.cropKey);
    }

    return keys.filter((k): k is string => typeof k === 'string' && k.length > 0);
}

/** Select clause that satisfies collectMediaS3Keys. */
export const MEDIA_S3_KEY_SELECT = {
    id: true,
    originalKey: true,
    thumbnailKey: true,
    streamingKey: true,
    webKey: true,
    faces: { select: { cropKey: true } },
} as const;
