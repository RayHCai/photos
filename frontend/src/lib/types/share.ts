/** A share link as created — the shape `POST /collections/:id/share` returns. */
export interface ShareLinkBase {
    id: string;
    slug: string;
    collectionId: string;
    expiresAt: string | null;
    viewCount: number;
    /** Owner-facing name, shown in the change log and upload emails. */
    label: string | null;
    createdAt: string;
}

/** A share link as listed, with what its guests have uploaded so far. */
export interface ShareLink extends ShareLinkBase {
    /** Bytes held against the quota: unreviewed uploads plus approved ones. */
    usedBytes: number;
    quotaBytes: number;
    pendingCount: number;
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
    /** Present when the link takes uploads (any of the owner's own albums). */
    upload?: {
        usedBytes: number;
        quotaBytes: number;
        maxFileBytes: number;
        /** False while no worker is running; the server then refuses new uploads. */
        workerOnline: boolean;
    };
}
