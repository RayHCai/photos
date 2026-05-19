import type { MediaListItem } from './media';

export interface ShareLink {
    id: string;
    slug: string;
    collectionId: string;
    expiresAt: string | null;
    viewCount: number;
    createdAt: string;
}

export interface SharedCollection {
    id: string;
    name: string;
    items: Array<{
        id: string;
        sortOrder: number;
        mediaItem: MediaListItem;
    }>;
}
