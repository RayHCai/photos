import {
    PutObjectCommand,
    DeleteObjectsCommand,
    GetObjectCommand,
    HeadObjectCommand,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    ListObjectsV2Command,
    type ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import crypto from 'node:crypto';
import { s3Client, cloudFrontClient } from '../config/s3.js';
import { env } from '../config/env.js';
import { redisConnection } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import { CDN_SERVED_PREFIXES, keyPrefix, type StoragePrefix } from '../constants/storage.js';

/**
 * How long a presigned GET is valid.
 *
 * Previously hard-coded to 3600 while env.PRESIGNED_URL_EXPIRY_SECONDS (default
 * 900) was only applied to uploads — so that knob silently did nothing on the
 * read path.
 */
const DOWNLOAD_URL_TTL = () => Math.max(env.PRESIGNED_URL_EXPIRY_SECONDS, 300);

/**
 * Cache a presigned URL for only half its lifetime.
 *
 * The old values were a 3300s Redis TTL against a 3600s signature, so a cached
 * URL could be handed out with 300s left — and `cachedRedirect` then told the
 * browser to cache the 302 for another 3300s, for a worst-case 6900s of exposure
 * against a 3600s signature. The visible symptom was thumbnails and downloads
 * failing with S3 AccessDenied for up to ~49 minutes.
 */
const presignCacheTtl = () => Math.floor(DOWNLOAD_URL_TTL() / 2);

// All object keys are random UUIDs, so the bytes behind a key never change —
// safe to cache forever. Applied as a GET-side response override so it also
// covers objects already in the bucket (no re-upload/backfill needed).
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export function buildKey(prefix: StoragePrefix, ext: string): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const id = crypto.randomUUID();
    return `${prefix}/${year}/${month}/${id}.${ext}`;
}

export function generateOriginalKey(ext: string): string {
    return buildKey('originals', ext);
}

export function generateThumbnailKey(ext: string): string {
    return buildKey('thumbnails', ext);
}

export function generateCropKey(ext: string): string {
    return buildKey('crops', ext);
}

export function generateStreamingKey(ext: string): string {
    return buildKey('streaming', ext);
}

export function generateWebKey(ext: string): string {
    return buildKey('web', ext);
}

export async function getPresignedUploadUrl(
    key: string,
    mimeType: string,
    fileSize?: number
) {
    const command = new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        ContentType: mimeType,
        ...(fileSize !== undefined && { ContentLength: fileSize }),
    });

    return getSignedUrl(s3Client, command, {
        expiresIn: env.PRESIGNED_URL_EXPIRY_SECONDS,
    });
}

export function getCdnUrl(key: string): string {
    return `${env.CDN_BASE_URL}/${key}`;
}

/**
 * Whether a key may be served from the public CDN.
 *
 * The CDN distribution has no signed URLs or cookies, so anything reachable
 * through it is world-readable to anyone who learns the URL, cached at edge, and
 * cannot be revoked. That is an acceptable trade for derived, downscaled
 * variants; it is not acceptable for originals, which must only ever be served
 * via short-lived presigned URLs. Mirrors CDN_SERVED_PREFIXES and the
 * aws_s3_bucket_policy in infra/main.tf.
 */
export function isCdnServable(key: string): boolean {
    const prefix = keyPrefix(key);
    return prefix !== null && (CDN_SERVED_PREFIXES as readonly string[]).includes(prefix);
}

/**
 * RFC 5987 / RFC 6266 encoding for a Content-Disposition filename.
 *
 * `fileName` is user-supplied at upload time. Interpolating it raw into
 * `attachment; filename="..."` lets a quote or newline in the name break out of
 * the quoted string, and non-ASCII names (accents, CJK, emoji) are not
 * representable in the plain parameter at all.
 */
function contentDisposition(fileName: string): string {
    const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    const encoded = encodeURIComponent(fileName);
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * Returns a presigned GET URL and the absolute time it stops working, so callers
 * can set cache headers that cannot outlive the signature.
 */
export async function getPresignedDownloadUrlWithExpiry(
    key: string,
    fileName?: string
): Promise<{ url: string; expiresInSeconds: number }> {
    const cacheKey = fileName ? `presigned:dl:${key}` : `presigned:${key}`;
    const cached = await redisConnection.get(cacheKey);
    if (cached) {
        const ttl = await redisConnection.ttl(cacheKey);
        // Remaining signature life is the cached TTL plus the half-life we did not
        // cache for, minus a safety margin.
        return { url: cached, expiresInSeconds: Math.max(ttl, 60) };
    }

    const ttl = DOWNLOAD_URL_TTL();
    const command = new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        ResponseCacheControl: IMMUTABLE_CACHE_CONTROL,
        ...(fileName && { ResponseContentDisposition: contentDisposition(fileName) }),
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: ttl });
    await redisConnection.setex(cacheKey, presignCacheTtl(), url);
    return { url, expiresInSeconds: presignCacheTtl() };
}

export async function getPresignedDownloadUrl(key: string, fileName?: string) {
    const { url } = await getPresignedDownloadUrlWithExpiry(key, fileName);
    return url;
}

/**
 * Returns a CDN URL when the CDN is configured *and* the key is one the CDN is
 * allowed to serve; otherwise a presigned download URL.
 *
 * The `preferCdn` flag used to be the only gate, and callers passed it
 * inconsistently — `getSharedMediaUrl` passed `variant === 'thumbnail'`, so an
 * original could reach getCdnUrl. The prefix check makes the guarantee
 * structural rather than dependent on every call site being correct.
 */
export async function getMediaUrl(key: string, preferCdn = true): Promise<string> {
    const { url } = await getMediaUrlWithExpiry(key, undefined, preferCdn);
    return url;
}

/**
 * Same as getMediaUrl but also reports how long the URL stays valid, so a caller
 * issuing a 302 can bound the browser's cache lifetime to the signature.
 *
 * A CDN URL never expires, so it reports the immutable window.
 */
export async function getMediaUrlWithExpiry(
    key: string,
    fileName?: string,
    preferCdn = true
): Promise<{ url: string; expiresInSeconds: number }> {
    if (!fileName && preferCdn && env.CDN_BASE_URL && isCdnServable(key)) {
        return { url: getCdnUrl(key), expiresInSeconds: 31536000 };
    }
    return getPresignedDownloadUrlWithExpiry(key, fileName);
}

export type ObjectState = 'exists' | 'missing' | 'error';

/**
 * Distinguishes "definitely not there" from "could not tell".
 *
 * The previous `objectExists` swallowed every exception and returned false, so a
 * transient error (expired credentials, throttling, DNS) was indistinguishable
 * from a 404. Its caller then hard-deleted the media row, cascading faces and
 * album membership — a transient S3 blip silently destroyed library metadata.
 */
export async function getObjectState(key: string): Promise<ObjectState> {
    try {
        await s3Client.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
        return 'exists';
    }
    catch (err) {
        const name = (err as { name?: string; $metadata?: { httpStatusCode?: number } })?.name;
        const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
            ?.httpStatusCode;

        if (name === 'NotFound' || name === 'NoSuchKey' || status === 404) {
            return 'missing';
        }

        logger.warn({ err, key }, 's3: HeadObject failed with a non-404 error');
        return 'error';
    }
}

/**
 * Streams every key under a prefix to a callback, one page at a time.
 *
 * A callback rather than a returned array because the thumbnail prefix holds one
 * object per item *per rung* — four keys per photo — and the only caller wants a
 * compact derived summary, not the strings themselves. Materialising the full
 * list first would hold hundreds of megabytes of key text for a large library to
 * build something a few bytes wide per item.
 *
 * HeadObject-per-key is the alternative and is far worse: one round trip per
 * object instead of per thousand.
 */
export async function forEachKey(
    prefix: string,
    onKey: (key: string) => void
): Promise<number> {
    let token: string | undefined;
    let seen = 0;

    do {
        const page: ListObjectsV2CommandOutput = await s3Client.send(
            new ListObjectsV2Command({
                Bucket: env.S3_BUCKET,
                Prefix: prefix,
                ContinuationToken: token,
                MaxKeys: 1000,
            })
        );

        for (const object of page.Contents ?? []) {
            if (object.Key) {
                onKey(object.Key);
                seen++;
            }
        }

        token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);

    logger.info({ prefix, count: seen }, 's3: listed prefix');
    return seen;
}

/**
 * Deletes objects and reports which keys failed.
 *
 * `Quiet: true` suppressed the per-key error list, so the caller had no way to
 * know a delete had partially failed — it just assumed success and dropped the
 * DB rows.
 */
export async function deleteObjects(
    keys: string[]
): Promise<{ deletedCount: number; failedKeys: string[] }> {
    if (keys.length === 0) return { deletedCount: 0, failedKeys: [] };

    const unique = [...new Set(keys)];
    const failedKeys: string[] = [];
    let deletedCount = 0;

    // S3 DeleteObjects supports up to 1000 keys per request.
    const BATCH_SIZE = 1000;
    for (let i = 0; i < unique.length; i += BATCH_SIZE) {
        const batch = unique.slice(i, i + BATCH_SIZE);

        try {
            const result = await s3Client.send(
                new DeleteObjectsCommand({
                    Bucket: env.S3_BUCKET,
                    Delete: {
                        Objects: batch.map((Key) => ({ Key })),
                        Quiet: false,
                    },
                })
            );

            deletedCount += result.Deleted?.length ?? 0;

            for (const error of result.Errors ?? []) {
                // A key that is already gone is a successful outcome for us.
                if (error.Code === 'NoSuchKey') continue;
                logger.error(
                    { key: error.Key, code: error.Code, message: error.Message },
                    's3: failed to delete object'
                );
                if (error.Key) failedKeys.push(error.Key);
            }
        }
        catch (err) {
            logger.error({ err, batchSize: batch.length }, 's3: DeleteObjects request failed');
            failedKeys.push(...batch);
            continue;
        }

        // Invalidate both presigned cache variants; only the plain one was cleared
        // before, so a download URL for a deleted object stayed cached.
        const pipeline = redisConnection.pipeline();
        for (const key of batch) {
            pipeline.del(`presigned:${key}`);
            pipeline.del(`presigned:dl:${key}`);
        }
        await pipeline.exec();

        await invalidateCdn(batch);
    }

    return { deletedCount, failedKeys };
}

/**
 * Purge deleted keys from the CDN edge.
 *
 * Without this, deleting a photo removed the S3 object but the edge kept serving the
 * cached bytes for up to the cache policy's TTL — and because responses are stamped
 * `max-age=31536000, immutable`, any browser or proxy that had already fetched the URL
 * kept its copy for a year with no way to revoke it. "The key is a random UUID" was
 * the only thing standing between a deleted photo and continued distribution.
 *
 * Best-effort: the DB rows are already gone by the time this runs, so a failure must
 * be logged rather than thrown.
 */
async function invalidateCdn(keys: string[]): Promise<void> {
    if (!env.CDN_DISTRIBUTION_ID) return;

    const servable = keys.filter(isCdnServable);
    if (servable.length === 0) return;

    try {
        await cloudFrontClient.send(
            new CreateInvalidationCommand({
                DistributionId: env.CDN_DISTRIBUTION_ID,
                InvalidationBatch: {
                    // CloudFront requires a caller-unique reference per request.
                    CallerReference: `delete-${Date.now()}-${crypto.randomUUID()}`,
                    Paths: {
                        Quantity: servable.length,
                        Items: servable.map((k) => `/${k}`),
                    },
                },
            })
        );
        logger.info({ count: servable.length }, 's3: CDN invalidation requested');
    }
    catch (err) {
        logger.error(
            { err, count: servable.length },
            's3: CDN invalidation failed; edge may serve deleted objects until TTL expiry'
        );
    }
}

// S3 Multipart Upload orchestration
export async function initMultipartUpload(key: string, mimeType: string) {
    const result = await s3Client.send(
        new CreateMultipartUploadCommand({
            Bucket: env.S3_BUCKET,
            Key: key,
            ContentType: mimeType,
        })
    );
    return result.UploadId!;
}

export async function getPresignedPartUrl(
    key: string,
    uploadId: string,
    partNumber: number
) {
    const command = new UploadPartCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
    });

    return getSignedUrl(s3Client, command, {
        expiresIn: env.PRESIGNED_URL_EXPIRY_SECONDS,
    });
}

export async function completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: Array<{ PartNumber: number; ETag: string }>
) {
    await s3Client.send(
        new CompleteMultipartUploadCommand({
            Bucket: env.S3_BUCKET,
            Key: key,
            UploadId: uploadId,
            MultipartUpload: { Parts: parts },
        })
    );
}
