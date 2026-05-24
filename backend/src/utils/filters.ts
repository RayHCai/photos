import { Prisma } from '@prisma/client';

export const HIDDEN_EXCLUSION: Prisma.MediaItemWhereInput = {
    collectionItems: { none: { collection: { systemType: 'HIDDEN' } } },
};

export const HIDDEN_NOT_EXISTS = Prisma.sql`NOT EXISTS (
    SELECT 1 FROM collection_items ci
    JOIN collections c ON c.id = ci.collection_id
    WHERE ci.media_item_id = m.id AND c.system_type = 'HIDDEN'
)`;
