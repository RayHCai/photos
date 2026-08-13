import { Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import { prisma } from '../config/prisma.js';
import { redisConnection } from '../config/redis.js';
import { AppError } from '../middleware/errorHandler.js';
import * as s3Service from './s3.service.js';
import * as collectionsService from './collections.service.js';
import * as shareService from './share.service.js';
import { findOrThrow, applyCursor, paginateResults } from '../utils/db.js';
import { MEDIA_ITEM_SUMMARY_SELECT } from '../utils/select.js';
import { logger } from '../utils/logger.js';
import { HIDDEN_EXCLUSION } from '../utils/filters.js';

const PERSONS_CACHE_KEY = 'persons:list:v1';
const PERSONS_CACHE_TTL = 120;

interface PersonListRow {
    id: string;
    name: string | null;
    avatarKey: string | null;
    createdAt: Date;
    updatedAt: Date;
    _count: { faces: number };
}

/**
 * People with at least one visible photo.
 *
 * The previous version asked Prisma for a filtered relation count for every
 * person with no pagination and then discarded zero-count people **in
 * JavaScript**, so every People page visit paid a full pass over the faces table
 * with a NOT EXISTS probe per face, uncached, and shipped rows the client threw
 * away.
 *
 * Pushing the `> 0` into SQL means Postgres can stop early per person, and a short
 * Redis TTL absorbs repeat visits (face assignment changes are not
 * latency-sensitive).
 */
export async function listPersons() {
    const cached = await redisConnection.get(PERSONS_CACHE_KEY);
    if (cached) return JSON.parse(cached) as PersonListRow[];

    const rows = await prisma.$queryRaw<
        Array<{
            id: string;
            name: string | null;
            avatar_key: string | null;
            created_at: Date;
            updated_at: Date;
            face_count: bigint;
        }>
    >`
        SELECT p.id, p.name, p.avatar_key, p.created_at, p.updated_at,
               COUNT(f.id)::bigint AS face_count
        FROM persons p
        JOIN faces f ON f.person_id = p.id
        JOIN media_items m ON m.id = f.media_item_id
        WHERE NOT EXISTS (
            SELECT 1 FROM collection_items ci
            JOIN collections c ON c.id = ci.collection_id
            WHERE ci.media_item_id = m.id AND c.system_type = 'HIDDEN'
        )
        GROUP BY p.id
        HAVING COUNT(f.id) > 0
        ORDER BY p.name ASC NULLS LAST, p.created_at ASC
    `;

    const result: PersonListRow[] = rows.map((r) => ({
        id: r.id,
        name: r.name,
        avatarKey: r.avatar_key,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        _count: { faces: Number(r.face_count) },
    }));

    await redisConnection.setex(PERSONS_CACHE_KEY, PERSONS_CACHE_TTL, JSON.stringify(result));
    return result;
}

export async function invalidatePersonsCache() {
    await redisConnection.del(PERSONS_CACHE_KEY);
}

export async function getPerson(id: string) {
    return findOrThrow(
        () => prisma.person.findUnique({
            where: { id },
            include: {
                _count: {
                    select: {
                        faces: {
                            where: { mediaItem: HIDDEN_EXCLUSION },
                        },
                    },
                },
            },
        }),
        'Person'
    );
}

export async function renamePerson(id: string, name: string) {
    const person = await findOrThrow(
        () => prisma.person.update({ where: { id }, data: { name } }),
        'Person'
    );

    /**
     * Naming a person is the strongest signal that their current face grouping is
     * correct, so the assignments become manual and the recluster job may no
     * longer move them. Without this, the weekly cron could silently redistribute
     * a named person's faces and delete the name.
     */
    await prisma.face.updateMany({
        where: { personId: id, manuallyAssigned: false },
        data: { manuallyAssigned: true },
    });

    await invalidatePersonsCache();
    return person;
}

export async function mergePersons(targetId: string, sourceId: string) {
    if (targetId === sourceId) {
        throw new AppError(400, 'Cannot merge a person into themselves');
    }

    const [target, source] = await Promise.all([
        findOrThrow(() => prisma.person.findUnique({ where: { id: targetId } }), 'Target person'),
        findOrThrow(() => prisma.person.findUnique({ where: { id: sourceId } }), 'Source person'),
    ]);

    await prisma.$transaction(async (tx) => {
        await tx.face.updateMany({
            where: { personId: sourceId },
            // A merge is an explicit human judgement, so the resulting assignments
            // are manual and the recluster job must not undo them.
            data: { personId: targetId, manuallyAssigned: true },
        });

        // If the target has no name but the source does, keep the name rather than
        // silently discarding the one piece of user-entered data in the merge.
        if (!target.name && source.name) {
            await tx.person.update({ where: { id: targetId }, data: { name: source.name } });
        }

        // Inherit an avatar if the target lacks one.
        if (!target.avatarKey && source.avatarKey) {
            await tx.person.update({
                where: { id: targetId },
                data: { avatarKey: source.avatarKey },
            });
        }

        /**
         * Collection.personId is 1:1, and collections now cascade from persons. If
         * both people have a share album, deleting the source would take its album
         * (and its live public share links) with it — so detach the source's album
         * first and let the target's own album be the survivor.
         */
        await tx.collection.deleteMany({ where: { personId: sourceId } });
        await tx.person.delete({ where: { id: sourceId } });
    });

    await syncPersonCollection(targetId);

    return prisma.person.findUnique({
        where: { id: targetId },
        include: { _count: { select: { faces: true } } },
    });
}

export async function deletePerson(id: string) {
    const faces = await prisma.face.findMany({
        where: { personId: id },
        select: { cropKey: true },
    });
    const cropKeys = faces.map((f) => f.cropKey).filter((k): k is string => k !== null);

    /**
     * S3 first, then the DB: an orphaned crop is recoverable, a row pointing at
     * deleted bytes is not. Deleting the person also cascades their collection and
     * that collection's share links (see migration 0007) — previously personId was
     * ON DELETE SET NULL, so a deleted person's album and its live public share
     * link survived and remained reachable.
     */
    if (cropKeys.length > 0) {
        const { failedKeys } = await s3Service.deleteObjects(cropKeys);
        if (failedKeys.length > 0) {
            throw new AppError(502, 'Storage deletion failed; person was not deleted');
        }
    }

    await prisma.$transaction([
        prisma.face.deleteMany({ where: { personId: id } }),
        prisma.person.delete({ where: { id } }),
    ]);
}

export async function deleteOrphanPersons(personIds?: string[]): Promise<number> {
    const where: Prisma.PersonWhereInput = {
        faces: { none: {} },
    };
    if (personIds && personIds.length > 0) {
        where.id = { in: personIds };
    }
    const result = await prisma.person.deleteMany({ where });
    return result.count;
}

export async function cleanupOrphanPersons(personIds: string[], context: string) {
    if (personIds.length === 0) return;
    const orphansDeleted = await deleteOrphanPersons(personIds);
    if (orphansDeleted > 0) {
        logger.info({ orphansDeleted, context }, 'orphan persons cleaned up');
    }
}

export async function getAffectedPersonIds(mediaItemIds: string | string[]): Promise<string[]> {
    const where = typeof mediaItemIds === 'string'
        ? { mediaItemId: mediaItemIds }
        : { mediaItemId: { in: mediaItemIds } };
    const faces = await prisma.face.findMany({
        where,
        select: { personId: true },
        distinct: ['personId'],
    });
    return faces.map(f => f.personId).filter((pid): pid is string => pid !== null);
}

/**
 * Photos containing a person, newest first.
 *
 * This used to paginate *face* rows and then de-duplicate media items in JS
 * *after* slicing, while computing hasMore/nextCursor from the pre-dedupe array.
 * A page containing one group photo with two faces of the same person therefore
 * returned 49 items with a cursor inconsistent with what was actually returned,
 * so the virtualized grid received uneven pages and a photo could reappear on the
 * next one. It also sorted on faces.created_at, which had no index.
 *
 * Now the distinct set is computed in SQL and paginated on the media item's own
 * ordering, so a page is always exactly `limit` items and the cursor is stable.
 */
export async function getPersonMedia(
    personId: string,
    limit = 50,
    cursor?: string
) {
    await findOrThrow(
        () => prisma.person.findUnique({ where: { id: personId }, select: { id: true } }),
        'Person'
    );

    const mediaIdRows = await prisma.mediaItem.findMany({
        where: {
            ...HIDDEN_EXCLUSION,
            faces: { some: { personId } },
        },
        select: { id: true },
        orderBy: [{ takenAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: limit + 1,
        ...applyCursor(cursor),
    });

    const { items: pageIds, nextCursor, hasMore } = paginateResults(mediaIdRows, limit);

    if (pageIds.length === 0) {
        return { items: [], nextCursor, hasMore };
    }

    const media = await prisma.mediaItem.findMany({
        where: { id: { in: pageIds.map((r) => r.id) } },
        select: MEDIA_ITEM_SUMMARY_SELECT,
        orderBy: [{ takenAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });

    return { items: media, nextCursor, hasMore };
}

export async function getPersonAvatarUrl(id: string) {
    const person = await findOrThrow(
        () => prisma.person.findUnique({
            where: { id },
            select: { avatarKey: true },
        }),
        'Person'
    );

    if (!person.avatarKey) {
        throw new AppError(404, 'Avatar not available');
    }

    return s3Service.getPresignedDownloadUrl(person.avatarKey);
}

// ─── Share Person ───────────────────────────────────────────

function slugify(name: string): string {
    let slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');

    if (slug.length < 3) {
        slug = slug ? `${slug}-${nanoid(5)}` : nanoid(8);
    }

    return slug.substring(0, 50);
}

async function getPersonMediaIds(personId: string): Promise<string[]> {
    const faces = await prisma.face.findMany({
        where: { personId, mediaItem: HIDDEN_EXCLUSION },
        select: { mediaItemId: true },
        distinct: ['mediaItemId'],
    });
    return faces.map(f => f.mediaItemId);
}

/**
 * Add a single media item to a person's shared album, if they have one.
 *
 * This exists because `syncPersonCollection` is O(album size) and was previously
 * called once per inserted face: deleting every collection_item for the person
 * and re-adding all of them (plus a MAX(sort_order) aggregate each time). For a
 * person appearing in N photos, ingesting N faces was O(N²) row writes, executed
 * inline in the /internal/faces request and producing that many dead tuples.
 */
export async function addMediaToPersonCollection(personId: string, mediaItemId: string) {
    const collection = await prisma.collection.findUnique({
        where: { personId },
        select: { id: true },
    });
    if (!collection) return;

    await prisma.collectionItem.createMany({
        data: [{ collectionId: collection.id, mediaItemId, sortOrder: 0 }],
        skipDuplicates: true,
    });
}

/** Drop items from a person's album that no longer have any of their faces. */
export async function removeMediaFromPersonCollection(
    personId: string,
    mediaItemIds: string[]
) {
    if (mediaItemIds.length === 0) return;

    const collection = await prisma.collection.findUnique({
        where: { personId },
        select: { id: true },
    });
    if (!collection) return;

    const stillPresent = await prisma.face.findMany({
        where: { personId, mediaItemId: { in: mediaItemIds } },
        select: { mediaItemId: true },
        distinct: ['mediaItemId'],
    });
    const keep = new Set(stillPresent.map((f) => f.mediaItemId));
    const remove = mediaItemIds.filter((id) => !keep.has(id));

    if (remove.length > 0) {
        await prisma.collectionItem.deleteMany({
            where: { collectionId: collection.id, mediaItemId: { in: remove } },
        });
    }
}

/**
 * Full resync. Correct but O(album size), so it is only for operations that
 * genuinely change the whole membership (merge, share creation) — never per face.
 */
export async function syncPersonCollection(personId: string) {
    const collection = await prisma.collection.findUnique({
        where: { personId },
        select: { id: true },
    });
    if (!collection) return;

    const mediaItemIds = await getPersonMediaIds(personId);

    await prisma.collectionItem.deleteMany({
        where: { collectionId: collection.id },
    });

    if (mediaItemIds.length > 0) {
        await collectionsService.addItems(collection.id, mediaItemIds);
    }

    logger.debug(
        { personId, collectionId: collection.id, itemCount: mediaItemIds.length },
        'person collection synced'
    );
}

export async function sharePerson(personId: string) {
    const person = await findOrThrow(
        () => prisma.person.findUnique({ where: { id: personId } }),
        'Person'
    );

    if (!person.name) {
        throw new AppError(400, 'Person must have a name before sharing');
    }

    let collection = await prisma.collection.findUnique({
        where: { personId },
        include: {
            shareLinks: { where: { isActive: true }, take: 1 },
        },
    });

    if (collection) {
        await syncPersonCollection(personId);

        // Return existing active share link
        if (collection.shareLinks.length > 0) {
            return {
                collection: { id: collection.id, name: collection.name },
                shareLink: collection.shareLinks[0],
                created: false,
            };
        }
    }
    else {
        collection = await prisma.collection.create({
            data: { name: person.name, personId },
            include: { shareLinks: { where: { isActive: true }, take: 1 } },
        });

        await syncPersonCollection(personId);
    }

    // Generate slug
    let slug = slugify(person.name);
    const existing = await prisma.shareLink.findUnique({ where: { slug } });
    if (existing) {
        slug = `${slug.substring(0, 44)}-${nanoid(5)}`;
    }

    const shareLink = await shareService.createShareLink(collection.id, { slug });

    return {
        collection: { id: collection.id, name: collection.name },
        shareLink,
        created: true,
    };
}
