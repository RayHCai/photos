import { Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import { prisma } from '../config/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import * as s3Service from './s3.service.js';
import * as collectionsService from './collections.service.js';
import * as shareService from './share.service.js';
import { findOrThrow, applyCursor, paginateResults } from '../utils/db.js';
import { MEDIA_ITEM_SUMMARY_SELECT } from '../utils/select.js';
import { logger } from '../utils/logger.js';
import { HIDDEN_EXCLUSION } from '../utils/filters.js';

export async function listPersons() {
    const persons = await prisma.person.findMany({
        orderBy: { name: 'asc' },
        include: {
            _count: {
                select: {
                    faces: {
                        where: { mediaItem: HIDDEN_EXCLUSION },
                    },
                },
            },
        },
    });
    return persons.filter(p => p._count.faces > 0);
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
    return findOrThrow(
        () => prisma.person.update({ where: { id }, data: { name } }),
        'Person'
    );
}

export async function mergePersons(targetId: string, sourceId: string) {
    await Promise.all([
        findOrThrow(() => prisma.person.findUnique({ where: { id: targetId } }), 'Target person'),
        findOrThrow(() => prisma.person.findUnique({ where: { id: sourceId } }), 'Source person'),
    ]);

    await prisma.$transaction([
        prisma.face.updateMany({
            where: { personId: sourceId },
            data: { personId: targetId },
        }),
        prisma.person.delete({ where: { id: sourceId } }),
    ]);

    // Sync target person's shared collection
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
    const cropKeys = faces.map(f => f.cropKey).filter((k): k is string => k !== null);

    await prisma.$transaction([
        prisma.face.deleteMany({ where: { personId: id } }),
        prisma.person.delete({ where: { id } }),
    ]);

    if (cropKeys.length > 0) {
        await s3Service.deleteObjects(cropKeys);
    }
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

export async function getPersonMedia(
    personId: string,
    limit = 50,
    cursor?: string
) {
    await findOrThrow(
        () => prisma.person.findUnique({ where: { id: personId } }),
        'Person'
    );

    const faces = await prisma.face.findMany({
        where: { personId, mediaItem: HIDDEN_EXCLUSION },
        take: limit + 1,
        ...applyCursor(cursor),
        include: {
            mediaItem: { select: MEDIA_ITEM_SUMMARY_SELECT },
        },
        orderBy: { createdAt: 'desc' },
    });

    const { items, nextCursor, hasMore } = paginateResults(faces, limit);

    // Deduplicate media items (multiple faces per photo)
    const seen = new Set<string>();
    const mediaItems = items
        .map((f) => f.mediaItem)
        .filter((m) => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
        });

    return { items: mediaItems, nextCursor, hasMore };
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

export async function syncPersonCollection(personId: string) {
    const collection = await prisma.collection.findUnique({
        where: { personId },
    });
    if (!collection) return;

    const mediaItemIds = await getPersonMediaIds(personId);

    await prisma.collectionItem.deleteMany({
        where: { collectionId: collection.id },
    });

    if (mediaItemIds.length > 0) {
        await collectionsService.addItems(collection.id, mediaItemIds);
    }

    logger.debug({ personId, collectionId: collection.id, itemCount: mediaItemIds.length }, 'person collection synced');
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
    } else {
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
