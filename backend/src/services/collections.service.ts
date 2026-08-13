import { prisma } from '../config/prisma.js';
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

export async function getCollection(
    id: string,
    opts: { cursor?: string; limit?: number } = {}
) {
    const limit = Math.min(opts.limit ?? COLLECTION_ITEMS_PAGE_SIZE, COLLECTION_ITEMS_PAGE_SIZE);

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

    const rows = await prisma.collectionItem.findMany({
        where: { collectionId: id },
        orderBy: { sortOrder: 'asc' },
        take: limit + 1,
        ...applyCursor(opts.cursor),
        select: {
            id: true,
            sortOrder: true,
            mediaItem: { select: MEDIA_ITEM_SUMMARY_SELECT },
        },
    });

    const { items, nextCursor, hasMore } = paginateResults(rows, limit);

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
    opts: { cursor?: string; limit?: number } = {}
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

    const limit = Math.min(opts.limit ?? COLLECTION_ITEMS_PAGE_SIZE, COLLECTION_ITEMS_PAGE_SIZE);

    const rows = await prisma.collectionItem.findMany({
        where: { collectionId: collection.id },
        orderBy: { sortOrder: 'asc' },
        take: limit + 1,
        ...applyCursor(opts.cursor),
        select: {
            id: true,
            sortOrder: true,
            mediaItem: { select: MEDIA_ITEM_SUMMARY_SELECT },
        },
    });

    const { items, nextCursor, hasMore } = paginateResults(rows, limit);
    return { ...collection, items, nextCursor, hasMore };
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
