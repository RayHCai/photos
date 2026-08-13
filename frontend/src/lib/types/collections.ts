import type { MediaListItem, ProcessingStatus } from './media';

/**
 * These types are split per endpoint because the endpoints genuinely return
 * different shapes.
 *
 * Previously `CollectionWithItems extends Collection`, so every collection was
 * typed as always having `_count`, `coverItem` and `shareLinks`. But
 * `GET /collections/:id` returns items and shareLinks and *not* coverItem, while
 * `GET /collections/favorites|hidden` returns `_count` and items and *not*
 * shareLinks or coverItem. TypeScript therefore happily allowed
 * `collection._count.items` on the detail page, which threw at runtime with no
 * compile error.
 */

/** Fields every collection response carries. */
export interface Collection {
    id: string;
    name: string;
    description: string | null;
    coverKey: string | null;
    systemType: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface CollectionCoverItem {
    id: string;
    thumbnailKey: string | null;
    processingStatus: ProcessingStatus;
}

export interface ShareLinkSummary {
    id: string;
    slug: string;
}

/** `GET /collections` — list view: counts and a cover, no items. */
export interface CollectionSummary extends Collection {
    _count: { items: number };
    shareLinks: ShareLinkSummary[];
    coverItem: CollectionCoverItem | null;
}

/** `GET /collections/:id` and the system-collection endpoints. */
export interface CollectionWithItems extends Collection {
    _count: { items: number };
    shareLinks: ShareLinkSummary[];
    items: CollectionItem[];
    /** Cursor for the next page of items, or null when exhausted. */
    nextCursor: string | null;
    hasMore: boolean;
}

/** Minimal reference, for resolving a system collection's id. */
export interface SystemCollectionRef {
    id: string;
    name: string;
}

export interface CollectionItem {
    id: string;
    sortOrder: number;
    mediaItem: MediaListItem;
}
