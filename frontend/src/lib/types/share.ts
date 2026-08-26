export interface ShareLink {
    id: string;
    slug: string;
    collectionId: string;
    expiresAt: string | null;
    viewCount: number;
    createdAt: string;
}

/**
 * A shared collection's metadata. The items no longer travel with it — a large
 * public link used to ship its entire album in one payload — and come from the
 * paginated {@link import('../api/share').getSharedItems} instead.
 */
export interface SharedCollection {
    id: string;
    name: string;
    itemCount: number;
}
