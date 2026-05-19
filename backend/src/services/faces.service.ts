import { prisma } from '../config/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import * as s3Service from './s3.service.js';
import { findOrThrow, applyCursor, paginateResults } from '../utils/db.js';

export async function listUnassignedFaces(limit = 50, cursor?: string) {
    const faces = await prisma.face.findMany({
        where: { personId: null },
        take: limit + 1,
        ...applyCursor(cursor),
        include: {
            mediaItem: {
                select: {
                    id: true,
                    fileName: true,
                    thumbnailKey: true,
                },
            },
        },
        orderBy: { createdAt: 'desc' },
    });

    return paginateResults(faces, limit);
}

export async function assignFace(faceId: string, personId: string) {
    const face = await findOrThrow(
        () => prisma.face.findUnique({ where: { id: faceId } }),
        'Face'
    );
    const person = await findOrThrow(
        () => prisma.person.findUnique({ where: { id: personId } }),
        'Person'
    );

    const updated = await prisma.face.update({
        where: { id: faceId },
        data: { personId },
    });

    // Auto-set person avatar if they don't have one yet
    if (!person.avatarKey && face.cropKey) {
        await prisma.person.update({
            where: { id: personId },
            data: { avatarKey: face.cropKey },
        });
    }

    return updated;
}

export async function unassignFace(faceId: string) {
    await findOrThrow(
        () => prisma.face.findUnique({ where: { id: faceId } }),
        'Face'
    );
    return prisma.face.update({
        where: { id: faceId },
        data: { personId: null },
    });
}

export async function getFaceCropUrl(faceId: string) {
    const face = await findOrThrow(
        () => prisma.face.findUnique({
            where: { id: faceId },
            select: { cropKey: true },
        }),
        'Face'
    );

    if (!face.cropKey) {
        throw new AppError(404, 'Face crop not available');
    }

    return s3Service.getPresignedDownloadUrl(face.cropKey);
}
