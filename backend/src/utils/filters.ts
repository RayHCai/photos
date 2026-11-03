import { Prisma } from '@prisma/client';

export const HIDDEN_EXCLUSION: Prisma.MediaItemWhereInput = {
    collectionItems: { none: { collection: { systemType: 'HIDDEN' } } },
};

export const HIDDEN_NOT_EXISTS = Prisma.sql`NOT EXISTS (
    SELECT 1 FROM collection_items ci
    JOIN collections c ON c.id = ci.collection_id
    WHERE ci.media_item_id = m.id AND c.system_type = 'HIDDEN'
)`;

/**
 * What the library shows: not hidden, and not a guest upload still waiting for
 * review. Those live in their album only until approved.
 */
export const LIBRARY_WHERE: Prisma.MediaItemWhereInput = {
    ...HIDDEN_EXCLUSION,
    pendingReview: false,
};

export const LIBRARY_SQL = Prisma.sql`m.pending_review = false AND ${HIDDEN_NOT_EXISTS}`;

/**
 * Guest uploads that hold a share of their link's quota: everything in flight,
 * and finished ones whose item still exists. Denied and removed ones have had
 * their bytes deleted, so they give their space back.
 */
export const QUOTA_HOLDING_CONTRIBUTIONS: Prisma.ContributionWhereInput = {
    OR: [
        { status: 'UPLOADING' },
        { status: { in: ['PENDING', 'APPROVED'] }, mediaItemId: { not: null } },
    ],
};
