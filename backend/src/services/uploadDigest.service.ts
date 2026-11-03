import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { buildUploadDigest, type DigestUpload } from '../utils/uploadDigest.js';
import { isEmailConfigured, sendEmail } from './email.service.js';

/** After a failed send, how long to leave Resend alone before trying again. */
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;
let suppressedUntil = 0;

interface ClaimedUpload {
    id: string;
    collectionId: string;
    shareLinkId: string;
    contributorName: string | null;
    mimeType: string;
    status: string;
}

function appUrl(): string {
    return env.APP_URL ?? env.CORS_ORIGIN[0] ?? 'http://localhost:3000';
}

/**
 * Email the owner about guest uploads, at most once per window.
 *
 * The window opens with the oldest upload nobody has been told about: once it is
 * CONTRIBUTION_DIGEST_MINUTES old, everything un-notified goes out in one email,
 * so a guest dropping 200 photos over twenty minutes is one message rather than
 * 200. Called on a timer; a no-op until something is due.
 *
 * The claim is a single UPDATE … RETURNING, so two backend instances ticking at
 * once cannot both send: whichever claims the rows owns the email. A failed send
 * hands the rows back so the next attempt includes them.
 */
export async function sendUploadDigestIfDue(now = new Date()): Promise<number> {
    if (!isEmailConfigured() || now.getTime() < suppressedUntil) return 0;

    const windowMs = env.CONTRIBUTION_DIGEST_MINUTES * 60 * 1000;
    const oldest = await prisma.contribution.findFirst({
        where: { notifiedAt: null, uploadedAt: { not: null } },
        orderBy: { uploadedAt: 'asc' },
        select: { uploadedAt: true },
    });
    if (!oldest?.uploadedAt || now.getTime() - oldest.uploadedAt.getTime() < windowMs) return 0;

    const claimed = await prisma.$queryRaw<ClaimedUpload[]>`
        UPDATE "contributions"
        SET "notified_at" = ${now}
        WHERE "notified_at" IS NULL AND "uploaded_at" IS NOT NULL
        RETURNING "id",
                  "collection_id" AS "collectionId",
                  "share_link_id" AS "shareLinkId",
                  "contributor_name" AS "contributorName",
                  "mime_type" AS "mimeType",
                  "status"::text AS "status"
    `;
    if (claimed.length === 0) return 0;

    const ids = claimed.map((c) => c.id);
    try {
        const [collections, links] = await Promise.all([
            prisma.collection.findMany({
                where: { id: { in: [...new Set(claimed.map((c) => c.collectionId))] } },
                select: { id: true, name: true },
            }),
            prisma.shareLink.findMany({
                where: { id: { in: [...new Set(claimed.map((c) => c.shareLinkId))] } },
                select: { id: true, label: true },
            }),
        ]);
        const albumName = new Map(collections.map((c) => [c.id, c.name]));
        const linkName = new Map(links.map((l) => [l.id, l.label]));

        const uploads: DigestUpload[] = claimed.map((c) => ({
            collectionId: c.collectionId,
            collectionName: albumName.get(c.collectionId) ?? 'an album',
            linkName: linkName.get(c.shareLinkId) ?? null,
            contributorName: c.contributorName,
            mimeType: c.mimeType,
            status: c.status,
        }));

        const digest = buildUploadDigest(uploads, { appUrl: appUrl() });
        await sendEmail({ to: env.NOTIFY_EMAIL_TO!, ...digest });
        logger.info({ count: ids.length, albums: collections.length }, 'upload digest: sent');
        return ids.length;
    }
    catch (err) {
        await prisma.contribution.updateMany({
            where: { id: { in: ids } },
            data: { notifiedAt: null },
        });
        suppressedUntil = now.getTime() + RETRY_AFTER_FAILURE_MS;
        throw err;
    }
}
