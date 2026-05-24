import {
    PutObjectCommand,
    DeleteObjectsCommand,
    GetObjectCommand,
    HeadObjectCommand,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'node:crypto';
import { s3Client } from '../config/s3.js';
import { env } from '../config/env.js';
import { redisConnection } from '../config/redis.js';

const THUMBNAIL_CACHE_TTL = 55 * 60; // 55 minutes

export function buildKey(prefix: string, ext: string): string {
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
        ...(fileSize != null && { ContentLength: fileSize }),
    });

    return getSignedUrl(s3Client, command, {
        expiresIn: env.PRESIGNED_URL_EXPIRY_SECONDS,
    });
}

export function getCdnUrl(key: string): string {
    return `${env.CDN_BASE_URL}/${key}`;
}

export async function getPresignedDownloadUrl(key: string, fileName?: string) {
    const cacheKey = fileName ? `presigned:dl:${key}` : `presigned:${key}`;
    const cached = await redisConnection.get(cacheKey);
    if (cached) {
        return cached;
    }

    const command = new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        ...(fileName && {
            ResponseContentDisposition: `attachment; filename="${fileName}"`,
        }),
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    await redisConnection.setex(cacheKey, THUMBNAIL_CACHE_TTL, url);
    return url;
}

/**
 * Returns a CDN URL if CDN is configured, otherwise a presigned download URL.
 */
export async function getMediaUrl(key: string, preferCdn = true): Promise<string> {
    if (preferCdn && env.CDN_BASE_URL) {
        return getCdnUrl(key);
    }
    return getPresignedDownloadUrl(key);
}

export async function objectExists(key: string): Promise<boolean> {
    try {
        await s3Client.send(
            new HeadObjectCommand({
                Bucket: env.S3_BUCKET,
                Key: key,
            })
        );
        return true;
    } catch {
        return false;
    }
}

export async function deleteObjects(keys: string[]) {
    if (keys.length === 0) return;

    // S3 DeleteObjects supports up to 1000 keys per request
    const BATCH_SIZE = 1000;
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        const batch = keys.slice(i, i + BATCH_SIZE);
        await s3Client.send(
            new DeleteObjectsCommand({
                Bucket: env.S3_BUCKET,
                Delete: {
                    Objects: batch.map((Key) => ({ Key })),
                    Quiet: true,
                },
            })
        );

        // Invalidate presigned URL cache entries
        const pipeline = redisConnection.pipeline();
        for (const key of batch) {
            pipeline.del(`presigned:${key}`);
        }
        await pipeline.exec();
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
