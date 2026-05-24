import { nanoid } from 'nanoid';
import { prisma } from '../config/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import * as s3Service from './s3.service.js';
import { logger } from '../utils/logger.js';
import { MEDIA_ITEM_SUMMARY_SELECT } from '../utils/select.js';

function validateShareLink(link: { isActive: boolean; expiresAt: Date | null } | null): void {
    if (!link || !link.isActive) {
        throw new AppError(404, 'Share link not found or inactive');
    }
    if (link.expiresAt && link.expiresAt < new Date()) {
        throw new AppError(410, 'Share link has expired');
    }
}

export async function createShareLink(
    collectionId: string,
    options?: { slug?: string; expiresAt?: Date }
) {
    const collection = await prisma.collection.findUnique({
        where: { id: collectionId },
    });
    if (!collection) {
        throw new AppError(404, 'Collection not found');
    }

    const slug = options?.slug || nanoid(10);

    const existing = await prisma.shareLink.findUnique({ where: { slug } });
    if (existing) {
        logger.warn({ slug }, 'share: slug already in use');
        throw new AppError(409, 'Slug already in use');
    }

    const link = await prisma.shareLink.create({
        data: {
            collectionId,
            slug,
            expiresAt: options?.expiresAt,
        },
    });
    logger.info({ linkId: link.id, collectionId, slug }, 'share: link created');
    return link;
}

export async function listShareLinks(collectionId: string) {
    return prisma.shareLink.findMany({
        where: { collectionId },
        orderBy: { createdAt: 'desc' },
    });
}

export async function revokeShareLink(linkId: string) {
    const link = await prisma.shareLink.findUnique({
        where: { id: linkId },
    });
    if (!link) {
        throw new AppError(404, 'Share link not found');
    }

    await prisma.shareLink.update({
        where: { id: linkId },
        data: { isActive: false },
    });
    logger.info({ linkId, slug: link.slug }, 'share: link revoked');
}

export async function getSharedCollection(slug: string) {
    const link = await prisma.shareLink.findUnique({
        where: { slug },
        include: {
            collection: {
                include: {
                    items: {
                        orderBy: { sortOrder: 'asc' },
                        include: {
                            mediaItem: { select: MEDIA_ITEM_SUMMARY_SELECT },
                        },
                    },
                },
            },
        },
    });

    validateShareLink(link);

    await prisma.shareLink.update({
        where: { id: link!.id },
        data: { viewCount: { increment: 1 } },
    });

    logger.info({ slug, viewCount: (link as any).viewCount + 1 }, 'share: collection viewed');
    return link!.collection;
}

export async function getSharedMediaUrl(
    slug: string,
    mediaId: string,
    variant: 'thumbnail' | 'original'
) {
    const link = await prisma.shareLink.findUnique({
        where: { slug },
        include: {
            collection: {
                include: {
                    items: {
                        where: { mediaItemId: mediaId },
                        include: { mediaItem: true },
                    },
                },
            },
        },
    });

    validateShareLink(link);

    const item = link!.collection.items[0]?.mediaItem;
    if (!item) {
        throw new AppError(404, 'Media not found in shared collection');
    }

    const key = variant === 'thumbnail' ? item.thumbnailKey : item.originalKey;
    if (!key) {
        throw new AppError(404, `${variant} not available`);
    }

    return s3Service.getMediaUrl(key, variant === 'thumbnail');
}
