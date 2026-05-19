import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import * as s3Service from './s3.service.js';
import { findOrThrow, applyCursor, paginateResults } from '../utils/db.js';
import { MEDIA_ITEM_SUMMARY_SELECT } from '../utils/select.js';

export async function listPersons() {
    return prisma.person.findMany({
        orderBy: { name: 'asc' },
        include: {
            _count: { select: { faces: true } },
        },
    });
}

export async function getPerson(id: string) {
    return findOrThrow(
        () => prisma.person.findUnique({
            where: { id },
            include: { _count: { select: { faces: true } } },
        }),
        'Person'
    );
}

export async function renamePerson(id: string, name: string) {
    await findOrThrow(() => prisma.person.findUnique({ where: { id } }), 'Person');
    return prisma.person.update({ where: { id }, data: { name } });
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

    return prisma.person.findUnique({
        where: { id: targetId },
        include: { _count: { select: { faces: true } } },
    });
}

export async function deletePerson(id: string) {
    await findOrThrow(() => prisma.person.findUnique({ where: { id } }), 'Person');
    await prisma.$transaction([
        prisma.face.updateMany({
            where: { personId: id },
            data: { personId: null },
        }),
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
        where: { personId },
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
