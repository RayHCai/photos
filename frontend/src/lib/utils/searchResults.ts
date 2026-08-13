import type { MediaShellItem } from '../types/media';
import type { SearchResultItem } from '../types/search';

/**
 * Project a search result into the gallery's item shape.
 *
 * Shared so every search surface agrees. The home page used to build this inline and
 * fabricate the two fields the endpoint did not return:
 *
 *   - `processingStatus: 'COMPLETED'` — a still-processing match therefore rendered as
 *     a clickable tile whose lightbox never resolved.
 *   - `createdAt: takenAt || new Date()` — a match with no capture date was filed
 *     under "Today" in search results but under its real upload date in the timeline,
 *     so the same photo appeared under two different headings.
 *
 * The search endpoint now returns both, plus `takenAtLocal` so day grouping matches
 * the timeline exactly.
 */
export function searchResultToShellItem(item: SearchResultItem): MediaShellItem {
    return {
        id: item.id,
        type: item.type,
        thumbnailKey: item.thumbnailKey,
        blurHash: item.blurHash ?? null,
        width: item.width,
        height: item.height,
        durationSeconds: item.durationSeconds,
        takenAt: item.takenAt,
        takenAtLocal: item.takenAtLocal,
        processingStatus: item.processingStatus,
        createdAt: item.createdAt,
        ...(item.fileName !== undefined && { fileName: item.fileName }),
    };
}
