export function collectS3Keys(item: {
    originalKey: string;
    thumbnailKey?: string | null;
    streamingKey?: string | null;
    webKey?: string | null;
}): string[] {
    return [item.originalKey, item.thumbnailKey, item.streamingKey, item.webKey]
        .filter((k): k is string => k !== null && k !== undefined);
}
