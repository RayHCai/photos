import type { MediaListItem } from './media';

export interface Collection {
    id: string;
    name: string;
    coverKey: string | null;
    createdAt: string;
    updatedAt: string;
    _count: { items: number };
    shareLinks: Array<{ id: string; slug: string }>;
    coverItem: {
        id: string;
        thumbnailKey: string | null;
        processingStatus: string;
    } | null;
}

export interface CollectionWithItems extends Collection {
    items: CollectionItem[];
}

export interface CollectionItem {
    id: string;
    sortOrder: number;
    mediaItem: MediaListItem;
}
