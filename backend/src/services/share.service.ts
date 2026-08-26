import { nanoid } from 'nanoid';
import { prisma } from '../config/prisma.js';
import { redisConnection } from '../config/redis.js';
import { AppError } from '../middleware/errorHandler.js';
import * as s3Service from './s3.service.js';
import { logger } from '../utils/logger.js';
import { fireAndForget } from '../utils/async.js';
import { applyCursor, paginateResults } from '../utils/db.js';
import { MEDIA_ITEM_SUMMARY_SELECT } from '../utils/select.js';
import { HIDDEN_EXCLUSION } from '../utils/filters.js';
import { COLLECTION_ITEM_ORDER_BY } from './collections.service.js';

/** 10 nanoid chars ≈ 60 bits of entropy, which is not brute-forcible. */
const SLUG_LENGTH = 10;

const SHARE_RESOLVE_TTL = 60;
const shareCacheKey = (slug: string) => `share:resolved:${slug}`;

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

    const slug = options?.slug || nanoid(SLUG_LENGTH);

    /**
     * Create-and-catch rather than check-then-create: the previous findUnique
     * followed by create was a race that surfaced a raw Prisma P2002 as a 500.
     */
    try {
        const link = await prisma.shareLink.create({
            data: {
                collectionId,
                slug,
                ...(options?.expiresAt ? { expiresAt: options.expiresAt } : {}),
            },
        });
        logger.info({ linkId: link.id, collectionId }, 'share: link created');
        return link;
    }
    catch (err) {
        if ((err as { code?: string }).code === 'P2002') {
            logger.warn('share: slug already in use');
            throw new AppError(409, 'Slug already in use');
        }
        throw err;
    }
}

export async function listShareLinks(collectionId: string) {
    return prisma.shareLink.findMany({
        where: { collectionId, isActive: true },
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

    // Drop the resolve cache immediately so revocation takes effect now rather
    // than after the TTL.
    await redisConnection.del(shareCacheKey(link.slug));
    logger.info({ linkId }, 'share: link revoked');
}

/**
 * Resolve a slug to its collection id, cached.
 *
 * Every shared thumbnail request used to re-run a slug lookup joined through the
 * collection to its filtered items with `include: { mediaItem: true }` — a full
 * SELECT * including the FTS document — so viewing one album issued one such
 * query per image.
 */
async function resolveSlug(slug: string): Promise<{ linkId: string; collectionId: string }> {
    const cached = await redisConnection.get(shareCacheKey(slug));
    if (cached) {
        return JSON.parse(cached) as { linkId: string; collectionId: string };
    }

    const link = await prisma.shareLink.findUnique({
        where: { slug },
        select: { id: true, collectionId: true, isActive: true, expiresAt: true },
    });

    validateShareLink(link);

    const resolved = { linkId: link!.id, collectionId: link!.collectionId };
    await redisConnection.setex(shareCacheKey(slug), SHARE_RESOLVE_TTL, JSON.stringify(resolved));
    return resolved;
}

/** Cap on a page of shared items, and the public timeline's cache lifetime. */
const SHARED_ITEMS_PAGE_SIZE = 500;
const SHARE_TIMELINE_TTL = 60;
const shareTimelineKey = (collectionId: string) => `timeline:share:${collectionId}`;

/**
 * A shared collection's metadata — no items.
 *
 * This used to return the entire collection (every non-hidden item) in one
 * payload, so opening a large public link held the whole album in the guest tab
 * and DoSed it. Items now come from {@link getSharedItems}, paginated and windowed
 * exactly like the authenticated gallery; this endpoint carries only the header
 * (name) and the total, and is the request that counts a view.
 */
export async function getSharedCollection(slug: string) {
    const { linkId, collectionId } = await resolveSlug(slug);

    const collection = await prisma.collection.findUnique({
        where: { id: collectionId },
        select: { id: true, name: true, description: true },
    });

    if (!collection) {
        throw new AppError(404, 'Share link not found or inactive');
    }

    // Non-hidden count only: hidden photos are excluded from every public read
    // (items, timeline, media URLs), so the header total must exclude them too or
    // it would not match the number of items the guest can actually reach.
    const itemCount = await prisma.collectionItem.count({
        where: { collectionId, mediaItem: HIDDEN_EXCLUSION },
    });

    /**
     * View counting is fire-and-forget. It used to be an awaited UPDATE on the
     * read path, which serialized every concurrent viewer of a slug behind a row
     * lock.
     */
    fireAndForget(
        () => prisma.shareLink.update({
            where: { id: linkId },
            data: { viewCount: { increment: 1 } },
        }),
        (err) => logger.warn({ err }, 'share: view count increment failed')
    );

    return { ...collection, itemCount };
}

/**
 * A page of a shared collection's items, addressed by `cursor` or `offset` like
 * the authenticated shell. Hidden items are excluded, and the date ordering
 * matches both the authenticated collection read and the public timeline so the
 * scrollbar's item-index math lines up.
 */
export async function getSharedItems(
    slug: string,
    opts: { cursor?: string; offset?: number; limit?: number } = {}
) {
    const { collectionId } = await resolveSlug(slug);
    const limit = Math.min(opts.limit ?? SHARED_ITEMS_PAGE_SIZE, SHARED_ITEMS_PAGE_SIZE);

    const rows = await prisma.collectionItem.findMany({
        where: { collectionId, mediaItem: HIDDEN_EXCLUSION },
        orderBy: COLLECTION_ITEM_ORDER_BY,
        take: limit + 1,
        ...(opts.cursor
            ? applyCursor(opts.cursor)
            : opts.offset
                ? { skip: opts.offset }
                : {}),
        select: {
            id: true,
            mediaItem: { select: MEDIA_ITEM_SUMMARY_SELECT },
        },
    });

    const { items, nextCursor, hasMore } = paginateResults(rows, limit);
    return { items: items.map((r) => r.mediaItem), nextCursor, hasMore };
}

/**
 * Month counts for a shared collection's timeline scrollbar — the public,
 * hidden-excluded analogue of the per-collection timeline. Cached briefly; a
 * membership change on the underlying collection shows up within the TTL.
 */
export async function getSharedTimeline(slug: string) {
    const { collectionId } = await resolveSlug(slug);

    const cacheKey = shareTimelineKey(collectionId);
    const cached = await redisConnection.get(cacheKey);
    if (cached) {
        return JSON.parse(cached) as Array<{ month: string; count: number }>;
    }

    const rows = await prisma.$queryRaw<Array<{ month: string; count: bigint }>>`
        SELECT to_char(COALESCE(mi."taken_at_local", mi."taken_at", mi."created_at"), 'YYYY-MM') AS month,
               COUNT(*)::bigint AS count
        FROM "collection_items" ci
        JOIN "media_items" mi ON mi.id = ci."media_item_id"
        WHERE ci."collection_id" = ${collectionId}
          AND NOT EXISTS (
              SELECT 1 FROM "collection_items" hci
              JOIN "collections" hc ON hc.id = hci."collection_id"
              WHERE hci."media_item_id" = mi.id AND hc."system_type" = 'HIDDEN'
          )
        GROUP BY month
        ORDER BY month DESC
    `;

    const result = rows.map((r) => ({ month: r.month, count: Number(r.count) }));
    await redisConnection.setex(cacheKey, SHARE_TIMELINE_TTL, JSON.stringify(result));
    return result;
}

export type SharedVariant = 'thumbnail' | 'web' | 'original';

/**
 * Resolve a media URL for a shared collection.
 *
 * `web` is new. The shared lightbox previously had no web route, so its `web`
 * accessor was wired to `original` — a guest on a phone downloaded
 * full-resolution originals three at a time (prev/current/next), and HEIC or HEVC
 * originals failed to decode outside Safari entirely.
 */
export async function getSharedMediaUrl(
    slug: string,
    mediaId: string,
    variant: SharedVariant,
    /**
     * Force a save instead of an inline render. Needed because a browser ignores
     * an <a download> hint once the request redirects cross-origin, so only S3's
     * own Content-Disposition can make the file download.
     */
    asAttachment = false
) {
    const { collectionId } = await resolveSlug(slug);

    const row = await prisma.collectionItem.findFirst({
        where: {
            collectionId,
            mediaItemId: mediaId,
            mediaItem: HIDDEN_EXCLUSION,
        },
        select: {
            mediaItem: {
                select: {
                    fileName: true,
                    originalKey: true,
                    thumbnailKey: true,
                    webKey: true,
                    streamingKey: true,
                    type: true,
                },
            },
        },
    });

    if (!row) {
        throw new AppError(404, 'Media not found in shared collection');
    }

    const media = row.mediaItem;

    if (asAttachment) {
        return s3Service.getMediaUrlWithExpiry(media.originalKey, media.fileName);
    }

    if (variant === 'thumbnail') {
        if (!media.thumbnailKey) throw new AppError(404, 'thumbnail not available');
        return s3Service.getMediaUrlWithExpiry(media.thumbnailKey);
    }

    if (variant === 'web') {
        // Videos need the transcoded stream; photos prefer the 2000px web variant
        // and fall back to the thumbnail. Never the original.
        if (media.type === 'VIDEO') {
            return s3Service.getMediaUrlWithExpiry(media.streamingKey ?? media.originalKey);
        }
        if (media.webKey) return s3Service.getMediaUrlWithExpiry(media.webKey);
        if (media.thumbnailKey) return s3Service.getMediaUrlWithExpiry(media.thumbnailKey);
        throw new AppError(404, 'web version not available');
    }

    // variant === 'original' — always presigned, never the public CDN.
    return s3Service.getMediaUrlWithExpiry(media.originalKey, undefined, false);
}
