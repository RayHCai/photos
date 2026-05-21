import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import * as personsService from './persons.service.js';
import * as s3Service from './s3.service.js';
import { logger } from '../utils/logger.js';
import { findOrThrow } from '../utils/db.js';
import { toVectorLiteral } from '../utils/embeddings.js';

// ─── Media Items ─────────────────────────────────────────────

export async function getFileName(mediaItemId: string) {
    const item = await findOrThrow(
        () => prisma.mediaItem.findUnique({
            where: { id: mediaItemId },
            select: { fileName: true },
        }),
        'Media item'
    );
    return { fileName: item.fileName };
}

export async function setProcessingStatus(
    mediaItemId: string,
    status: string,
    error: string | null
) {
    await prisma.mediaItem.update({
        where: { id: mediaItemId },
        data: {
            processingStatus: status as any,
            processingError: error,
        },
    });
}

export async function claimTask(mediaItemId: string, taskId: string): Promise<boolean> {
    const result = await prisma.$executeRawUnsafe(
        `UPDATE media_items
         SET processing_status = 'PROCESSING', processing_error = NULL, updated_at = now()
         WHERE id = $1 AND current_task_id = $2`,
        mediaItemId,
        taskId,
    );
    return result > 0;
}

export async function createRetryTask(
    mediaItemId: string,
    _startStage: string = 'full',
): Promise<{ taskId: string }> {
    const taskId = randomUUID();
    await prisma.mediaItem.update({
        where: { id: mediaItemId },
        data: { currentTaskId: taskId, processingStatus: 'PENDING', processingError: null },
    });
    return { taskId };
}

interface PersistContentData {
    width?: number | null;
    height?: number | null;
    durationSeconds?: number | null;
    takenAt?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    cameraMake?: string | null;
    cameraModel?: string | null;
    city?: string | null;
    country?: string | null;
    ftsDocument: string;
    thumbnailKey?: string | null;
    clipEmbedding?: number[] | null;
    blurHash?: string | null;
}

export async function persistContent(mediaItemId: string, data: PersistContentData) {
    const embeddingStr = data.clipEmbedding
        ? toVectorLiteral(data.clipEmbedding)
        : null;

    const takenAt = data.takenAt ? new Date(data.takenAt) : null;

    await prisma.$executeRawUnsafe(
        `UPDATE media_items SET
            width = COALESCE($2::int, width),
            height = COALESCE($3::int, height),
            duration_seconds = COALESCE($4::double precision, duration_seconds),
            taken_at = COALESCE($5::timestamptz, taken_at),
            latitude = COALESCE($6::double precision, latitude),
            longitude = COALESCE($7::double precision, longitude),
            camera_make = COALESCE($8, camera_make),
            camera_model = COALESCE($9, camera_model),
            city = COALESCE($10, city),
            country = COALESCE($11, country),
            fts_document = $12,
            thumbnail_key = COALESCE($13, thumbnail_key),
            clip_embedding = CASE WHEN $14::text IS NOT NULL
                THEN $14::vector ELSE clip_embedding END,
            blur_hash = COALESCE($15, blur_hash),
            processing_status = 'COMPLETED',
            processing_error = NULL,
            updated_at = now()
        WHERE id = $1`,
        mediaItemId,
        data.width ?? null,
        data.height ?? null,
        data.durationSeconds ?? null,
        takenAt,
        data.latitude ?? null,
        data.longitude ?? null,
        data.cameraMake ?? null,
        data.cameraModel ?? null,
        data.city ?? null,
        data.country ?? null,
        data.ftsDocument,
        data.thumbnailKey ?? null,
        embeddingStr,
        data.blurHash ?? null,
    );
}

export async function persistBlurHashOnly(mediaItemId: string, blurHash: string) {
    await prisma.mediaItem.update({
        where: { id: mediaItemId },
        data: { blurHash },
    });
}

export async function getThumbnailKey(mediaItemId: string) {
    const item = await findOrThrow(
        () => prisma.mediaItem.findUnique({
            where: { id: mediaItemId },
            select: { thumbnailKey: true },
        }),
        'Media item'
    );
    return { thumbnailKey: item.thumbnailKey };
}

export async function persistClipOnly(mediaItemId: string, embedding: number[]) {
    const embeddingStr = toVectorLiteral(embedding);
    await prisma.$executeRawUnsafe(
        `UPDATE media_items SET
            clip_embedding = $2::vector,
            processing_status = 'COMPLETED',
            processing_error = NULL,
            updated_at = now()
        WHERE id = $1`,
        mediaItemId,
        embeddingStr,
    );
}

// ─── Faces ───────────────────────────────────────────────────

export async function clearFaces(mediaItemId: string): Promise<number> {
    const personIds = await personsService.getAffectedPersonIds(mediaItemId);

    const result = await prisma.face.deleteMany({
        where: { mediaItemId },
    });

    if (personIds.length > 0) {
        const orphansDeleted = await personsService.deleteOrphanPersons(personIds);
        if (orphansDeleted > 0) {
            logger.info({ orphansDeleted, mediaItemId }, 'orphan persons cleaned up after clearFaces');
        }

        // Sync shared collections for affected persons
        for (const pid of personIds) {
            await personsService.syncPersonCollection(pid);
        }
    }

    return result.count;
}

export async function findNearestExisting(
    mediaItemId: string,
    embedding: number[],
    threshold: number
): Promise<{ faceId: string | null }> {
    const embeddingStr = toVectorLiteral(embedding);
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; distance: number }>>(
        `SELECT id, face_embedding <=> $1::vector AS distance
         FROM faces
         WHERE media_item_id = $2
           AND face_embedding IS NOT NULL
         ORDER BY face_embedding <=> $1::vector
         LIMIT 1`,
        embeddingStr,
        mediaItemId
    );

    if (rows.length > 0 && rows[0].distance < threshold) {
        return { faceId: rows[0].id };
    }
    return { faceId: null };
}

export async function findNearestPerson(
    embedding: number[],
    threshold: number
): Promise<{ personId: string | null; distance: number | null }> {
    const embeddingStr = toVectorLiteral(embedding);
    const rows = await prisma.$queryRawUnsafe<Array<{ person_id: string; distance: number }>>(
        `SELECT f.person_id, f.face_embedding <=> $1::vector AS distance
         FROM faces f
         WHERE f.person_id IS NOT NULL
           AND f.face_embedding IS NOT NULL
         ORDER BY f.face_embedding <=> $1::vector
         LIMIT 1`,
        embeddingStr
    );

    if (rows.length > 0 && rows[0].distance < threshold) {
        return { personId: rows[0].person_id, distance: rows[0].distance };
    }
    return { personId: null, distance: rows.length > 0 ? rows[0].distance : null };
}

interface InsertFaceData {
    mediaItemId: string;
    personId: string;
    boxX: number;
    boxY: number;
    boxWidth: number;
    boxHeight: number;
    confidence: number;
    cropKey?: string | null;
    embedding: number[];
}

export async function insertFace(data: InsertFaceData): Promise<{ id: string }> {
    const embeddingStr = toVectorLiteral(data.embedding);
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO faces (
            id, media_item_id, person_id,
            box_x, box_y, box_width, box_height,
            confidence, crop_key, face_embedding, created_at
        ) VALUES (
            gen_random_uuid(), $1, $2,
            $3, $4, $5, $6,
            $7, $8, $9::vector, now()
        ) RETURNING id`,
        data.mediaItemId,
        data.personId,
        data.boxX,
        data.boxY,
        data.boxWidth,
        data.boxHeight,
        data.confidence,
        data.cropKey ?? null,
        embeddingStr
    );

    // Auto-set person avatar if they don't have one yet
    if (data.cropKey && data.personId) {
        await prisma.person.updateMany({
            where: { id: data.personId, avatarKey: null },
            data: { avatarKey: data.cropKey },
        });
    }

    // Sync person's shared collection if one exists
    if (data.personId) {
        await personsService.syncPersonCollection(data.personId);
    }

    return { id: rows[0].id };
}

export async function getAllFaceEmbeddings(): Promise<{
    faces: Array<{ id: string; personId: string | null; embedding: number[] }>;
}> {
    const rows = await prisma.$queryRawUnsafe<
        Array<{ id: string; person_id: string | null; embedding: string }>
    >(
        `SELECT id, person_id, face_embedding::text AS embedding
         FROM faces
         WHERE face_embedding IS NOT NULL
         ORDER BY created_at`
    );

    const faces = rows.map((row) => ({
        id: row.id,
        personId: row.person_id,
        embedding: row.embedding
            .replace(/[\[\]]/g, '')
            .split(',')
            .map(Number),
    }));

    return { faces };
}

export async function batchReassignFaces(
    assignments: Array<{ faceId: string; personId: string }>
): Promise<number> {
    const BATCH_SIZE = 100;
    let count = 0;

    for (let i = 0; i < assignments.length; i += BATCH_SIZE) {
        const batch = assignments.slice(i, i + BATCH_SIZE);
        await prisma.$transaction(
            batch.map((a) =>
                prisma.face.update({
                    where: { id: a.faceId },
                    data: { personId: a.personId },
                })
            )
        );
        count += batch.length;
    }

    // Sync shared collections for all affected persons
    const uniquePersonIds = [...new Set(assignments.map(a => a.personId))];
    for (const pid of uniquePersonIds) {
        await personsService.syncPersonCollection(pid);
    }

    return count;
}

// ─── Persons ─────────────────────────────────────────────────

export async function createPerson(): Promise<{ id: string }> {
    const person = await prisma.person.create({ data: {} });
    return { id: person.id };
}

export async function deleteAllOrphanPersons(): Promise<number> {
    return personsService.deleteOrphanPersons();
}

export async function batchCreatePersons(count: number): Promise<{ ids: string[] }> {
    if (count === 0) return { ids: [] };

    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO persons (id, created_at, updated_at)
         SELECT gen_random_uuid(), now(), now()
         FROM generate_series(1, $1)
         RETURNING id`,
        count,
    );

    return { ids: rows.map((r) => r.id) };
}

// ─── Media Queries (for retry routes) ────────────────────────

export async function getMediaItemInfo(mediaItemId: string) {
    return findOrThrow(
        () => prisma.mediaItem.findUnique({
            where: { id: mediaItemId },
            select: { id: true, originalKey: true, mimeType: true, type: true },
        }),
        'Media item'
    );
}

type RetryFilter = 'all' | 'failed' | 'missing_clip' | 'missing_faces' | 'missing_blurhash';

export async function queryMediaItemsForRetry(filter: RetryFilter) {
    let whereClause: string;
    switch (filter) {
        case 'all':
            whereClause = '1=1';
            break;
        case 'failed':
            whereClause = "processing_status = 'FAILED'";
            break;
        case 'missing_clip':
            whereClause = "clip_embedding IS NULL AND processing_status != 'PENDING'";
            break;
        case 'missing_faces':
            whereClause = `processing_status = 'COMPLETED' AND clip_embedding IS NOT NULL AND id NOT IN (SELECT DISTINCT media_item_id FROM faces)`;
            break;
        case 'missing_blurhash':
            whereClause = "blur_hash IS NULL AND processing_status = 'COMPLETED'";
            break;
    }

    const rows = await prisma.$queryRawUnsafe<
        Array<{ id: string; original_key: string; mime_type: string; type: string }>
    >(
        `SELECT id, original_key, mime_type, type FROM media_items WHERE ${whereClause}`
    );

    return rows.map((r) => ({
        id: r.id,
        originalKey: r.original_key,
        mimeType: r.mime_type,
        type: r.type,
    }));
}

// ─── S3 Operations ───────────────────────────────────────────

export async function getDownloadUrl(key: string): Promise<{ url: string }> {
    const url = await s3Service.getPresignedDownloadUrl(key);
    return { url };
}

export async function generateUploadUrl(
    prefix: 'thumbnails' | 'crops',
    contentType: string
): Promise<{ key: string; url: string }> {
    const ext = contentType.split('/')[1] || 'webp';
    const key = prefix === 'thumbnails'
        ? s3Service.generateThumbnailKey(ext)
        : s3Service.generateCropKey(ext);
    const url = await s3Service.getPresignedUploadUrl(key, contentType);
    return { key, url };
}

// ─── Sessions ────────────────────────────────────────────────

export async function deleteExpiredSessions(): Promise<number> {
    const result = await prisma.session.deleteMany({
        where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
}
