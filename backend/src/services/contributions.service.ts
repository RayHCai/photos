import { randomUUID } from 'node:crypto';
import type { Contribution, ContributionStatus } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import * as s3Service from './s3.service.js';
import * as queueService from './queue.service.js';
import * as mediaService from './media.service.js';
import * as shareService from './share.service.js';
import { invalidateCollectionTimelineCache } from './collections.service.js';
import { recordEvent } from './collectionEvents.service.js';
import { sendUploadDigestIfDue } from './uploadDigest.service.js';
import { isEmailConfigured } from './email.service.js';
import { logger } from '../utils/logger.js';
import { fireAndForget } from '../utils/async.js';
import { QUOTA_HOLDING_CONTRIBUTIONS } from '../utils/filters.js';
import { cleanContributorName } from '../utils/contributorName.js';
import {
    signContributionToken,
    verifyContributionToken,
    type ContributionClaims,
} from '../utils/uploadToken.js';
import { safeExtension } from '../constants/storage.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * S3's minimum part size. A client never needs more parts than this implies, so
 * anything past it is an attempt to push more bytes than the upload declared.
 */
const MIN_PART_BYTES = 5 * 1024 * 1024;

export interface GuestFile {
    fileName: string;
    mimeType: string;
    fileSize: number;
    contributorName?: string;
}

type UploadLink = Awaited<ReturnType<typeof shareService.resolveUploadLink>>;

const formatGb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(bytes % 1024 ** 3 ? 1 : 0)} GB`;

/**
 * Reserve room for one guest upload and record it as UPLOADING.
 *
 * The space is taken at presign time, not at confirm, because the bytes land in
 * S3 in between: checking only at confirm would let a guest fire a hundred
 * presigns at once, each seeing the same headroom. The check and the insert run
 * under a per-link advisory lock for the same reason.
 */
async function reserveContribution(link: UploadLink, file: GuestFile): Promise<Contribution> {
    const { quotaBytes, maxFileBytes, maxPending } = shareService.uploadLimits();

    mediaService.validateMimeType(file.mimeType);
    if (file.fileSize > maxFileBytes) {
        throw new AppError(413, `Files can be at most ${formatGb(maxFileBytes)}`);
    }

    // Straight into originals/, carrying the pending tag like the library's own
    // uploads, so the item confirm creates can own it without a copy.
    const objectKey = s3Service.generateOriginalKey(safeExtension(file.fileName));

    return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`share-link-uploads:${link.linkId}`}))`;

        const waiting = await tx.contribution.count({
            where: {
                shareLinkId: link.linkId,
                OR: [{ status: 'UPLOADING' }, { status: 'PENDING', mediaItemId: { not: null } }],
            },
        });
        if (waiting >= maxPending) {
            throw new AppError(429, 'This album has too many uploads waiting for review. Try again later.');
        }

        const held = await tx.contribution.aggregate({
            where: { shareLinkId: link.linkId, ...QUOTA_HOLDING_CONTRIBUTIONS },
            _sum: { fileSize: true },
        });
        if (Number(held._sum.fileSize ?? 0) + file.fileSize > quotaBytes) {
            throw new AppError(413, `This link is out of upload space (${formatGb(quotaBytes)} limit)`);
        }

        return tx.contribution.create({
            data: {
                shareLinkId: link.linkId,
                collectionId: link.collectionId,
                objectKey,
                fileName: file.fileName,
                mimeType: file.mimeType,
                fileSize: file.fileSize,
                contributorName: cleanContributorName(file.contributorName),
            },
        });
    });
}

function claimsFor(row: Contribution, uploadId?: string): ContributionClaims {
    return {
        key: row.objectKey,
        fileName: row.fileName,
        mimeType: row.mimeType,
        fileSize: Number(row.fileSize),
        contributionId: row.id,
        ...(uploadId ? { uploadId } : {}),
    };
}

/**
 * Presign a guest's single-PUT upload. Mirrors the library's own presign, with a
 * token that only the guest routes accept.
 */
export async function presignGuestUpload(slug: string, file: GuestFile) {
    const link = await shareService.resolveUploadLink(slug);
    const row = await reserveContribution(link, file);

    const presignedUrl = await s3Service.getPresignedUploadUrl(
        row.objectKey,
        file.mimeType,
        file.fileSize,
        { tagging: s3Service.PENDING_UPLOAD_TAGGING }
    );

    return {
        presignedUrl,
        headers: { 'x-amz-tagging': s3Service.PENDING_UPLOAD_TAGGING },
        uploadToken: signContributionToken(claimsFor(row)),
    };
}

export async function initGuestMultipart(slug: string, file: GuestFile) {
    const link = await shareService.resolveUploadLink(slug);
    const row = await reserveContribution(link, file);
    const uploadId = await s3Service.initMultipartUpload(row.objectKey, file.mimeType);
    return { uploadToken: signContributionToken(claimsFor(row, uploadId)) };
}

function verifyGuestMultipart(uploadToken: string) {
    const claims = verifyContributionToken(uploadToken);
    if (!claims.uploadId) throw new AppError(400, 'Not a multipart upload token');
    return { ...claims, uploadId: claims.uploadId };
}

export async function getGuestPartUrl(slug: string, uploadToken: string, partNumber: number) {
    await shareService.resolveUploadLink(slug);
    const { key, uploadId, fileSize } = verifyGuestMultipart(uploadToken);
    if (partNumber > Math.max(1, Math.ceil(fileSize / MIN_PART_BYTES))) {
        throw new AppError(400, 'More parts than the declared size allows');
    }
    const presignedUrl = await s3Service.getPresignedPartUrl(key, uploadId, partNumber);
    return { presignedUrl, partNumber };
}

export async function completeGuestMultipart(
    slug: string,
    uploadToken: string,
    parts: Array<{ PartNumber: number; ETag: string }>
) {
    const link = await shareService.resolveUploadLink(slug);
    const claims = verifyGuestMultipart(uploadToken);
    try {
        await s3Service.completeMultipartUpload(claims.key, claims.uploadId, parts);
    }
    catch (err) {
        // As in the library flow: a retry after a completion whose response was
        // lost finds the upload id gone, and the object existing proves it worked.
        if (await s3Service.getObjectState(claims.key) !== 'exists') throw err;
    }
    return finalizeContribution(link, claims);
}

export async function confirmGuestUpload(slug: string, uploadToken: string) {
    const link = await shareService.resolveUploadLink(slug);
    return finalizeContribution(link, verifyContributionToken(uploadToken));
}

/**
 * Turn a finished guest upload into an item in its album.
 *
 * The item is created straight away, flagged `pendingReview`: the album (and its
 * share link) shows it at once, while the library, search and timeline leave it
 * out until the owner approves it. It goes through the normal processing
 * pipeline, which skips face detection while the flag is set.
 *
 * Safe to repeat, like the library's confirm: a row that is already past
 * UPLOADING just answers with its id.
 */
async function finalizeContribution(link: UploadLink, claims: ContributionClaims) {
    const row = await prisma.contribution.findUnique({ where: { id: claims.contributionId } });
    if (!row || row.shareLinkId !== link.linkId || row.objectKey !== claims.key) {
        throw new AppError(404, 'Upload not found');
    }
    if (row.status !== 'UPLOADING') return { id: row.id };

    const size = await s3Service.getObjectSize(claims.key);
    if (size === null) throw new AppError(409, 'Upload not found in storage');

    if (size > claims.fileSize) {
        // Only reachable through multipart, whose parts nothing bounds. Letting it
        // through would hand the guest more of the quota than was reserved.
        await s3Service.deleteObjects([claims.key]);
        await prisma.contribution.delete({ where: { id: row.id } });
        throw new AppError(413, 'Upload is larger than declared');
    }

    // Off the lifecycle rule's list: from here the item owns the object.
    await s3Service.clearPendingUploadTag(claims.key);

    const taskId = randomUUID();
    const item = await prisma.$transaction(async (tx) => {
        const claimed = await tx.contribution.updateMany({
            where: { id: row.id, status: 'UPLOADING' },
            data: { status: 'PENDING', uploadedAt: new Date(), fileSize: size },
        });
        if (claimed.count === 0) return null;

        // Serialises the append with other uploads finishing into the same album,
        // which would otherwise read the same last position.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`collection-items:${row.collectionId}`}))`;
        const last = await tx.collectionItem.aggregate({
            where: { collectionId: row.collectionId },
            _max: { sortOrder: true },
        });

        const created = await tx.mediaItem.create({
            data: {
                ...mediaService.newMediaItemData(row.fileName, row.mimeType, size, row.objectKey),
                sourceCollectionId: row.collectionId,
                pendingReview: true,
                currentTaskId: taskId,
            },
            select: { id: true, type: true },
        });
        await tx.contribution.update({
            where: { id: row.id },
            data: { mediaItemId: created.id },
        });
        await tx.collectionItem.create({
            data: {
                collectionId: row.collectionId,
                mediaItemId: created.id,
                sortOrder: (last._max.sortOrder ?? -1) + 1,
            },
        });
        return created;
    });
    if (!item) return { id: row.id };

    await queueService.enqueueMediaProcessing({
        mediaItemId: item.id,
        taskId,
        originalKey: row.objectKey,
        mimeType: row.mimeType,
        type: item.type,
    });
    await invalidateCollectionTimelineCache(row.collectionId);
    await recordEvent({
        collectionId: row.collectionId,
        type: 'UPLOADED',
        actor: 'GUEST',
        shareLinkId: row.shareLinkId,
        contributorName: row.contributorName,
        mediaItemIds: [item.id],
        contributionIds: [row.id],
    });
    return { id: row.id };
}

// ─── Review ────────────────────────────────────────────────

/** Where one upload stands, as the change log and its review modal show it. */
export type ReviewState = 'pending' | 'approved' | 'denied' | 'removed';

export function reviewState(row: { status: ContributionStatus; mediaItemId: string | null }): ReviewState {
    if (row.status === 'REJECTED') return 'denied';
    // Its item was deleted since, whether by remove-by-link or from the library.
    if (!row.mediaItemId) return 'removed';
    if (row.status === 'APPROVED') return 'approved';
    if (row.status === 'PENDING') return 'pending';
    return 'removed';
}

export interface ReviewSummary {
    pending: number;
    approved: number;
    /** Denied, or deleted after the fact. */
    declined: number;
}

/** Tally where each group's uploads stand, for many groups in one query. */
export async function summarizeReviews(groups: Map<string, string[]>): Promise<Map<string, ReviewSummary>> {
    const ids = [...new Set([...groups.values()].flat())];
    const rows = ids.length === 0
        ? []
        : await prisma.contribution.findMany({
            where: { id: { in: ids } },
            select: { id: true, status: true, mediaItemId: true },
        });
    const stateOf = new Map(rows.map((r) => [r.id, reviewState(r)]));

    const result = new Map<string, ReviewSummary>();
    for (const [key, groupIds] of groups) {
        const summary: ReviewSummary = { pending: 0, approved: 0, declined: 0 };
        for (const id of groupIds) {
            const state = stateOf.get(id);
            if (state === 'pending') summary.pending++;
            else if (state === 'approved') summary.approved++;
            else if (state) summary.declined++;
        }
        result.set(key, summary);
    }
    return result;
}

/** Every file in one upload entry of an album's change log, in upload order. */
export async function listEventUploads(collectionId: string, eventId: string) {
    const event = await prisma.collectionEvent.findFirst({
        where: { id: eventId, collectionId, type: 'UPLOADED' },
        select: { contributionIds: true },
    });
    if (!event) throw new AppError(404, 'Upload not found');

    const rows = await prisma.contribution.findMany({
        where: { id: { in: event.contributionIds } },
        orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
        select: {
            id: true,
            fileName: true,
            mimeType: true,
            fileSize: true,
            status: true,
            mediaItemId: true,
            mediaItem: { select: { type: true, thumbnailKey: true } },
        },
    });

    return rows.map(({ status, mediaItem, ...row }) => ({
        ...row,
        state: reviewState({ status, mediaItemId: row.mediaItemId }),
        type: mediaItem?.type ?? null,
        thumbnailKey: mediaItem?.thumbnailKey ?? null,
    }));
}

/** Delete bytes nothing will ever read again, logging rather than failing on leftovers. */
async function discardObjects(keys: string[], reason: string) {
    if (keys.length === 0) return;
    const { failedKeys } = await s3Service.deleteObjects(keys);
    if (failedKeys.length > 0) {
        logger.error(
            { reason, failed: failedKeys.length, sample: failedKeys.slice(0, 5) },
            'contributions: could not delete upload bytes; leaving them orphaned'
        );
    }
}

interface ClaimedRow {
    id: string;
    collectionId: string;
    mediaItemId: string | null;
}

/**
 * Approve uploads into the library.
 *
 * They are already items in their album; approval clears `pendingReview`, which
 * puts them in the gallery, search and timeline. Claimed with one UPDATE …
 * RETURNING so a concurrent denial of the same row cannot also succeed.
 *
 * Face detection was skipped while they waited, so it runs now for the ones the
 * worker has finished with. One still queued or processing gets it from its own
 * run, which reads the flag when it starts.
 */
export async function approveContributions(ids: string[]) {
    const rows = await prisma.$queryRaw<ClaimedRow[]>`
        UPDATE "contributions"
        SET "status" = 'APPROVED', "reviewed_at" = ${new Date()}
        WHERE "id" = ANY(${ids}) AND "status" = 'PENDING' AND "media_item_id" IS NOT NULL
        RETURNING "id",
                  "collection_id" AS "collectionId",
                  "media_item_id" AS "mediaItemId"
    `;
    const mediaItemIds = rows.flatMap((r) => (r.mediaItemId ? [r.mediaItemId] : []));

    if (mediaItemIds.length > 0) {
        await prisma.mediaItem.updateMany({
            where: { id: { in: mediaItemIds } },
            data: { pendingReview: false },
        });
        await mediaService.queryAndEnqueue(
            { id: { in: mediaItemIds }, processingStatus: 'COMPLETED' },
            'faces',
            'face detection queued for approved guest uploads'
        );
        await mediaService.invalidateTimelineCache();
    }

    logger.info({ requested: ids.length, approved: rows.length }, 'contributions: approved');
    return { approved: rows.length, skipped: ids.length - rows.length };
}

/**
 * Deny uploads: their items, and the bytes behind them, are deleted.
 *
 * Claimed first so a concurrent approval cannot also succeed. If storage refuses
 * the delete, the claim is handed back and the error surfaces, leaving the
 * uploads as they were for another try.
 */
export async function rejectContributions(ids: string[]) {
    if (ids.length === 0) return { rejected: 0 };

    const rows = await prisma.$queryRaw<ClaimedRow[]>`
        UPDATE "contributions"
        SET "status" = 'REJECTED', "reviewed_at" = ${new Date()}
        WHERE "id" = ANY(${ids}) AND "status" = 'PENDING'
        RETURNING "id",
                  "collection_id" AS "collectionId",
                  "media_item_id" AS "mediaItemId"
    `;
    if (rows.length === 0) return { rejected: 0 };

    const mediaItemIds = rows.flatMap((r) => (r.mediaItemId ? [r.mediaItemId] : []));
    try {
        if (mediaItemIds.length > 0) await mediaService.batchDeleteMedia(mediaItemIds);
    }
    catch (err) {
        await prisma.contribution.updateMany({
            where: { id: { in: rows.map((r) => r.id) }, status: 'REJECTED' },
            data: { status: 'PENDING', reviewedAt: null },
        });
        throw err;
    }
    await Promise.all(
        [...new Set(rows.map((r) => r.collectionId))].map(invalidateCollectionTimelineCache)
    );

    logger.info({ requested: ids.length, rejected: rows.length }, 'contributions: rejected');
    return { rejected: rows.length };
}

/**
 * Delete approved guest uploads from the library entirely — the cleanup for spam
 * that was let through. Deleting the media item removes it from every album it
 * has since been added to, which is the point.
 */
export async function removeApprovedContributions(ids: string[]) {
    const rows = await prisma.contribution.findMany({
        where: { id: { in: ids }, status: 'APPROVED' },
        select: { id: true, collectionId: true, mediaItemId: true },
    });
    if (rows.length === 0) return { removed: 0 };

    const mediaItemIds = rows.flatMap((r) => (r.mediaItemId ? [r.mediaItemId] : []));
    // Throws without deleting anything if storage refuses, leaving the rows as
    // they were for a retry.
    if (mediaItemIds.length > 0) await mediaService.batchDeleteMedia(mediaItemIds);

    await prisma.contribution.updateMany({
        where: { id: { in: rows.map((r) => r.id) }, status: 'APPROVED' },
        data: { status: 'REMOVED' },
    });
    await Promise.all(
        [...new Set(rows.map((r) => r.collectionId))].map(invalidateCollectionTimelineCache)
    );

    logger.info({ removed: rows.length, deletedMedia: mediaItemIds.length }, 'contributions: removed');
    return { removed: rows.length };
}

/**
 * Deny the uploads among these items that are still awaiting review in this
 * album. For an owner taking one out of the album it was uploaded to: it is not
 * in the library, so leaving it would strand it where nothing shows it. Taking
 * it out of any other album (favourites, say) leaves it alone.
 */
export async function rejectPendingForItems(collectionId: string, mediaItemIds: string[]) {
    const pending = await prisma.contribution.findMany({
        where: { collectionId, mediaItemId: { in: mediaItemIds }, status: 'PENDING' },
        select: { id: true },
    });
    return rejectContributions(pending.map((r) => r.id));
}

/**
 * Everything that ever came through one link, gone: uploads still waiting are
 * denied and approved ones are deleted from the library. Revoking first, when
 * asked, stops anything new arriving while the rest is cleared.
 */
export async function removeEverythingFromLink(linkId: string, opts: { revoke: boolean }) {
    const link = await prisma.shareLink.findUnique({
        where: { id: linkId },
        select: { id: true, isActive: true },
    });
    if (!link) throw new AppError(404, 'Share link not found');

    if (opts.revoke && link.isActive) await shareService.revokeShareLink(linkId);

    const [pending, approved] = await Promise.all([
        prisma.contribution.findMany({
            where: { shareLinkId: linkId, status: 'PENDING' },
            select: { id: true },
        }),
        prisma.contribution.findMany({
            where: { shareLinkId: linkId, status: 'APPROVED' },
            select: { id: true },
        }),
    ]);

    const { rejected } = await rejectContributions(pending.map((r) => r.id));
    const { removed } = await removeApprovedContributions(approved.map((r) => r.id));
    return { rejected, removed, revoked: opts.revoke && link.isActive };
}

// ─── Upkeep ────────────────────────────────────────────────

/**
 * How long an UPLOADING row is kept: past the upload token's 24h life nothing
 * can confirm it, so it is abandoned and only holding quota.
 */
const ABANDONED_AFTER_MS = 25 * HOUR_MS;

/**
 * Drop reservations for uploads that were never finished, and their bytes. An
 * unfinished multipart upload is aborted by the bucket's own lifecycle rule, and
 * an unconfirmed object still carries the pending tag that rule expires; this
 * gives the quota back sooner than either.
 */
export async function purgeAbandonedUploads(now = new Date()) {
    const abandoned = await prisma.$queryRaw<Array<{ objectKey: string }>>`
        DELETE FROM "contributions"
        WHERE "status" = 'UPLOADING' AND "created_at" < ${new Date(now.getTime() - ABANDONED_AFTER_MS)}
        RETURNING "object_key" AS "objectKey"
    `;
    await discardObjects(abandoned.map((r) => r.objectKey), 'abandoned');

    if (abandoned.length > 0) {
        logger.info({ abandoned: abandoned.length }, 'contributions: purged abandoned uploads');
    }
    return { abandoned: abandoned.length };
}

const DIGEST_TICK_MS = 60 * 1000;
const PURGE_TICK_MS = HOUR_MS;

/**
 * The digest email and the purge, on in-process timers like the stalled
 * processing reaper. Neither goes through the worker's queue: both are a few
 * queries and an HTTP call, and the email should not depend on the worker being
 * up. Every instance runs them; each claims its rows atomically, so running
 * twice is harmless.
 */
export function startContributionTimers() {
    if (!isEmailConfigured()) {
        logger.warn('contributions: RESEND_API_KEY or NOTIFY_EMAIL_TO unset; upload emails are off');
    }

    const digest = setInterval(() => {
        fireAndForget(
            () => sendUploadDigestIfDue(),
            (err) => logger.error({ err }, 'upload digest: failed')
        );
    }, DIGEST_TICK_MS);

    const purge = setInterval(() => {
        fireAndForget(
            () => purgeAbandonedUploads(),
            (err) => logger.error({ err }, 'contributions: purge failed')
        );
    }, PURGE_TICK_MS);

    digest.unref();
    purge.unref();
    return () => {
        clearInterval(digest);
        clearInterval(purge);
    };
}
