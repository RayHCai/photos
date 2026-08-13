/**
 * Collects every S3 object owned by a media item.
 *
 * Previously this omitted face crop keys, so deleting a photo orphaned every
 * face crop it had generated: those objects were referenced by nothing and never
 * cleaned up, because crops were only deleted when a *person* was deleted.
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
