import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { redisConnection } from '../config/redis.js';
import { AppError } from '../middleware/errorHandler.js';
import { findOrThrow, applyCursor, paginateResults } from '../utils/db.js';
import { MEDIA_ITEM_SUMMARY_SELECT } from '../utils/select.js';

export async function listCollections() {
    const collections = await prisma.collection.findMany({
        where: { OR: [{ systemType: null }, { systemType: { not: 'HIDDEN' } }] },
        orderBy: { updatedAt: 'desc' },
        include: {
            _count: { select: { items: true } },
            shareLinks: {
                where: { isActive: true },
                select: { id: true, slug: true },
            },
            items: {
                orderBy: { sortOrder: 'asc' },
                take: 1,
                include: {
                    mediaItem: {
                        select: {
                            id: true,
                            thumbnailKey: true,
                            processingStatus: true,
                        },
                    },
                },
            },
        },
    });

    return collections.map(({ items, ...rest }) => ({
        ...rest,
        coverItem: items[0]?.mediaItem ?? null,
    }));
}

export async function createCollection(data: {
    name: string;
    description?: string;
}) {
    return prisma.collection.create({ data });
}

/**
 * Cap on items returned per collection read.
 *
 * These reads had no `take` at all, so FAVORITES, HIDDEN and person albums — which
 * grow with the library — returned every row with full media payloads on every
 * request.
 */
export const COLLECTION_ITEMS_PAGE_SIZE = 500;

/**
 * Item order for a collection read, matching the gallery shell.
 *
 * Collections used to be served in `sortOrder` (insertion order), but the gallery
 * regroups every response by date before painting (see groupByDate on the client),
 * so what the user actually saw was already date-descending — the fetch order was
 * invisible. Serving date order directly is what lets a collection use the same
 * windowed pagination, timeline scrollbar and seek as the home gallery: the fetch
 * offset, the on-screen order and the per-month timeline counts all agree.
 *
 * `id` is the final tiebreaker so a bulk import sharing one capture timestamp still
 * has a *total* order — offset pages are independent queries and would otherwise
 * skip or repeat a tied row at a boundary.
 */
export const COLLECTION_ITEM_ORDER_BY: Prisma.CollectionItemOrderByWithRelationInput[] = [
    { mediaItem: { takenAt: { sort: 'desc', nulls: 'last' } } },
    { mediaItem: { createdAt: 'desc' } },
    { id: 'desc' },
];

/**
 * One page of a collection's items, addressed by `cursor` (sequential scroll) or
 * `offset` (a timeline jump), exactly like the shell. A cursor wins when both are
 * present; an `offset` of 0 is a no-op skip, which is why the truthiness check is
 * correct rather than `!== undefined`.
 */
async function fetchCollectionItemsPage(
    collectionId: string,
    opts: { cursor?: string; offset?: number; limit?: number }
) {
    const limit = Math.min(opts.limit ?? COLLECTION_ITEMS_PAGE_SIZE, COLLECTION_ITEMS_PAGE_SIZE);

    const rows = await prisma.collectionItem.findMany({
        where: { collectionId },
        orderBy: COLLECTION_ITEM_ORDER_BY,
        take: limit + 1,
        ...(opts.cursor
            ? applyCursor(opts.cursor)
            : opts.offset
                ? { skip: opts.offset }
                : {}),
        select: {
            id: true,
            sortOrder: true,
            mediaItem: { select: MEDIA_ITEM_SUMMARY_SELECT },
        },
    });

    return paginateResults(rows, limit);
}

export async function getCollection(
    id: string,
    opts: { cursor?: string; offset?: number; limit?: number } = {}
) {
    const collection = await findOrThrow(
        () => prisma.collection.findUnique({
            where: { id },
            include: {
                _count: { select: { items: true } },
                shareLinks: true,
            },
        }),
        'Collection'
    );

    const { items, nextCursor, hasMore } = await fetchCollectionItemsPage(id, opts);

    return { ...collection, items, nextCursor, hasMore };
}

export async function updateCollection(
    id: string,
    data: { name?: string; description?: string; coverKey?: string }
) {
    return findOrThrow(
        () => prisma.collection.update({ where: { id }, data }),
        'Collection'
    );
}

export async function deleteCollection(id: string) {
    const existing = await findOrThrow(
        () => prisma.collection.findUnique({ where: { id }, select: { id: true, systemType: true } }),
        'Collection'
    );
    if (existing.systemType) {
        throw new AppError(403, 'System collections cannot be deleted');
    }
    return prisma.collection.delete({ where: { id } });
}

export async function getOrCreateSystemCollection(
    systemType: string,
    defaultName: string,
    opts: { cursor?: string; offset?: number; limit?: number } = {}
) {
    let collection = await prisma.collection.findUnique({
        where: { systemType },
        include: { _count: { select: { items: true } } },
    });

    if (!collection) {
        collection = await prisma.collection.create({
            data: { name: defaultName, systemType },
            include: { _count: { select: { items: true } } },
        });
    }

    const { items, nextCursor, hasMore } = await fetchCollectionItemsPage(collection.id, opts);
    return { ...collection, items, nextCursor, hasMore };
}

const COLLECTION_TIMELINE_TTL = 60;
const collectionTimelineKey = (id: string) => `timeline:collection:${id}`;

/**
 * Month counts driving a collection's timeline scrollbar — the per-collection
 * analogue of media.service `getTimeline`.
 *
 * The client previously derived this from the items it had loaded, so the
 * scrollbar only described the pages fetched so far and every marker shifted as
 * more loaded. Counting the whole collection server-side (grouped the same way as
 * the item order, by capture wall-clock month, newest first) gives a stable track
 * the windowed gallery can seek against.
 *
 * No hidden exclusion: a collection read returns all its members, so its timeline
 * must count all of them or the total would not match the item list the scrollbar
 * is mapping onto. Cached briefly and dropped explicitly on membership change.
 */
export async function getCollectionTimeline(id: string) {
    const cacheKey = collectionTimelineKey(id);
    const cached = await redisConnection.get(cacheKey);
    if (cached) {
        return JSON.parse(cached) as Array<{ month: string; count: number }>;
    }

    const rows = await prisma.$queryRaw<Array<{ month: string; count: bigint }>>`
        SELECT to_char(COALESCE(mi."taken_at_local", mi."taken_at", mi."created_at"), 'YYYY-MM') AS month,
               COUNT(*)::bigint AS count
        FROM "collection_items" ci
        JOIN "media_items" mi ON mi.id = ci."media_item_id"
        WHERE ci."collection_id" = ${id}
        GROUP BY month
        ORDER BY month DESC
    `;

    const result = rows.map((r) => ({ month: r.month, count: Number(r.count) }));
    await redisConnection.setex(cacheKey, COLLECTION_TIMELINE_TTL, JSON.stringify(result));
    return result;
}

async function invalidateCollectionTimelineCache(id: string) {
    await redisConnection.del(collectionTimelineKey(id));
}

/**
 * Just the member ids for a system collection.
 *
 * useFavorites and useHidden only ever needed a Set of ids, but they fetched the
 * full item payload — including complete media rows — for every mount of the home
 * page and every collection detail page, and refetched on any ['collections']
 * invalidation.
 */
export async function getSystemCollectionIds(systemType: string): Promise<string[]> {
    const collection = await prisma.collection.findUnique({
        where: { systemType },
        select: { id: true },
    });
    if (!collection) return [];

    const rows = await prisma.collectionItem.findMany({
        where: { collectionId: collection.id },
        select: { mediaItemId: true },
        orderBy: { sortOrder: 'asc' },
    });
    return rows.map((r) => r.mediaItemId);
}

export async function addItems(
    collectionId: string,
    mediaItemIds: string[]
) {
    const maxOrder = await prisma.collectionItem.aggregate({
        where: { collectionId },
        _max: { sortOrder: true },
    });

    let nextOrder = (maxOrder._max.sortOrder ?? -1) + 1;

    const items = mediaItemIds.map((mediaItemId) => ({
        collectionId,
        mediaItemId,
        sortOrder: nextOrder++,
    }));

    await prisma.collectionItem.createMany({
        data: items,
        skipDuplicates: true,
    });

    await invalidateCollectionTimelineCache(collectionId);
}

export async function removeItems(
    collectionId: string,
    mediaItemIds: string[]
) {
    await prisma.collectionItem.deleteMany({
        where: {
            collectionId,
            mediaItemId: { in: mediaItemIds },
        },
    });

    await invalidateCollectionTimelineCache(collectionId);
}

export async function getCollectionMembership(mediaItemIds: string[]) {
    // Distinct guard: a duplicated id in the request would inflate the count and
    // make the "contains all" comparison fail.
    const unique = [...new Set(mediaItemIds)];

    const memberships = await prisma.collectionItem.groupBy({
        by: ['collectionId'],
        where: { mediaItemId: { in: unique } },
        _count: { mediaItemId: true },
    });

    return memberships
        .filter((m) => m._count.mediaItemId === unique.length)
        .map((m) => m.collectionId);
}
