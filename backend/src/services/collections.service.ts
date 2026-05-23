import { prisma } from '../config/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { findOrThrow } from '../utils/db.js';
import { MEDIA_ITEM_SUMMARY_SELECT } from '../utils/select.js';

export async function listCollections() {
    const collections = await prisma.collection.findMany({
        where: { systemType: { not: 'HIDDEN' } },
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

export async function getCollection(id: string) {
    return findOrThrow(
        () => prisma.collection.findUnique({
            where: { id },
            include: {
                items: {
                    orderBy: { sortOrder: 'asc' },
                    include: {
                        mediaItem: { select: MEDIA_ITEM_SUMMARY_SELECT },
                    },
                },
                shareLinks: true,
            },
        }),
        'Collection'
    );
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

export async function getOrCreateSystemCollection(systemType: string, defaultName: string) {
    let collection = await prisma.collection.findUnique({
        where: { systemType },
        include: {
            _count: { select: { items: true } },
            items: {
                orderBy: { sortOrder: 'asc' },
                include: {
                    mediaItem: { select: MEDIA_ITEM_SUMMARY_SELECT },
                },
            },
        },
    });

    if (!collection) {
        collection = await prisma.collection.create({
            data: { name: defaultName, systemType },
            include: {
                _count: { select: { items: true } },
                items: {
                    orderBy: { sortOrder: 'asc' },
                    include: {
                        mediaItem: { select: MEDIA_ITEM_SUMMARY_SELECT },
                    },
                },
            },
        });
    }

    return collection;
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
