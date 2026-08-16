import { randomUUID } from 'node:crypto';
import { Prisma, type ProcessingStatus } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import * as personsService from './persons.service.js';
import * as s3Service from './s3.service.js';
import { findOrThrow } from '../utils/db.js';
import { toVectorLiteral } from '../utils/embeddings.js';
import { logger } from '../utils/logger.js';
import { invalidateSearchFacets } from './search.service.js';
import { AppError } from '../middleware/errorHandler.js';
import {
    WORKER_WRITABLE_PREFIXES,
    isManagedVariantKey,
    keyPrefix,
    safeExtension,
    type WorkerWritablePrefix,
} from '../constants/storage.js';

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
    status: ProcessingStatus,
    error: string | null
) {
    await prisma.mediaItem.update({
        where: { id: mediaItemId },
        data: {
            processingStatus: status,
            processingError: error,
            // Cleared on any terminal status so the stalled-job reaper only ever
            // considers rows that are genuinely mid-flight.
            processingAt: status === 'PROCESSING' ? new Date() : null,
        },
    });
}

/** Records that face detection has run, whether or not it found anything. */
export async function markFacesScanned(mediaItemId: string) {
    await prisma.mediaItem.update({
        where: { id: mediaItemId },
        data: { facesScanned: true },
    });
}

export async function claimTask(mediaItemId: string, taskId: string): Promise<boolean> {
    const result = await prisma.$executeRaw`
        UPDATE media_items
        SET processing_status = 'PROCESSING',
            processing_error = NULL,
            processing_at = now(),
            updated_at = now()
        WHERE id = ${mediaItemId} AND current_task_id = ${taskId}
    `;
    return result > 0;
}

export async function createRetryTask(
    mediaItemId: string,
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
    takenAtLocal?: string | null;
    takenAtOffsetMin?: number | null;
    videoRotation?: number | null;
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
    webKey?: string | null;
}

export async function persistContent(mediaItemId: string, data: PersistContentData) {
    const embeddingStr = data.clipEmbedding
        ? toVectorLiteral(data.clipEmbedding)
        : null;

    const takenAt = data.takenAt ? new Date(data.takenAt) : null;
    const takenAtLocal = data.takenAtLocal ? new Date(data.takenAtLocal) : null;

    await prisma.$executeRaw`
        UPDATE media_items SET
            width = COALESCE(${data.width ?? null}::int, width),
            height = COALESCE(${data.height ?? null}::int, height),
            duration_seconds = COALESCE(${data.durationSeconds ?? null}::double precision, duration_seconds),
            taken_at = COALESCE(${takenAt}::timestamptz, taken_at),
            taken_at_local = COALESCE(${takenAtLocal}::timestamp, taken_at_local),
            taken_at_offset_min = COALESCE(${data.takenAtOffsetMin ?? null}::int, taken_at_offset_min),
            video_rotation = COALESCE(${data.videoRotation ?? null}::int, video_rotation),
            latitude = COALESCE(${data.latitude ?? null}::double precision, latitude),
            longitude = COALESCE(${data.longitude ?? null}::double precision, longitude),
            camera_make = COALESCE(${data.cameraMake ?? null}, camera_make),
            camera_model = COALESCE(${data.cameraModel ?? null}, camera_model),
            city = COALESCE(${data.city ?? null}, city),
            country = COALESCE(${data.country ?? null}, country),
            fts_document = ${data.ftsDocument},
            thumbnail_key = COALESCE(${data.thumbnailKey ?? null}, thumbnail_key),
            clip_embedding = CASE WHEN ${embeddingStr}::text IS NOT NULL
                THEN ${embeddingStr}::vector ELSE clip_embedding END,
            blur_hash = COALESCE(${data.blurHash ?? null}, blur_hash),
            web_key = COALESCE(${data.webKey ?? null}, web_key),
            processing_status = 'COMPLETED',
            processing_error = NULL,
            updated_at = now()
        WHERE id = ${mediaItemId}
    `;
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
    await prisma.$executeRaw`
        UPDATE media_items SET
            clip_embedding = ${embeddingStr}::vector,
            processing_status = 'COMPLETED',
            processing_error = NULL,
            updated_at = now()
        WHERE id = ${mediaItemId}
    `;
}

export async function persistStreamingKey(mediaItemId: string, streamingKey: string) {
    await prisma.mediaItem.update({
        where: { id: mediaItemId },
        data: { streamingKey },
    });
}

export async function persistWebKey(mediaItemId: string, webKey: string) {
    await prisma.mediaItem.update({
        where: { id: mediaItemId },
        data: { webKey },
    });
}

// ─── Faces ───────────────────────────────────────────────────

export async function clearFaces(mediaItemId: string): Promise<number> {
    const personIds = await personsService.getAffectedPersonIds(mediaItemId);

    const result = await prisma.face.deleteMany({
        where: { mediaItemId },
    });

    // Incremental: drop only this media item from each affected person's album,
    // instead of rebuilding every album from scratch.
    for (const pid of personIds) {
        await personsService.removeMediaFromPersonCollection(pid, [mediaItemId]);
    }

    await personsService.cleanupOrphanPersons(personIds, 'clearFaces');
    await personsService.invalidatePersonsCache();

    return result.count;
}

export async function findNearestExisting(
    mediaItemId: string,
    embedding: number[],
    threshold: number
): Promise<{ faceId: string | null }> {
    const embeddingStr = toVectorLiteral(embedding);
    const rows = await prisma.$queryRaw<Array<{ id: string; distance: number }>>`
        SELECT id, face_embedding <=> ${embeddingStr}::vector AS distance
        FROM faces
        WHERE media_item_id = ${mediaItemId}
          AND face_embedding IS NOT NULL
        ORDER BY face_embedding <=> ${embeddingStr}::vector
        LIMIT 1
    `;

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
    const rows = await prisma.$queryRaw<Array<{ person_id: string; distance: number }>>`
        SELECT f.person_id, f.face_embedding <=> ${embeddingStr}::vector AS distance
        FROM faces f
        WHERE f.person_id IS NOT NULL
          AND f.face_embedding IS NOT NULL
        ORDER BY f.face_embedding <=> ${embeddingStr}::vector
        LIMIT 1
    `;

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
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO faces (
            id, media_item_id, person_id,
            box_x, box_y, box_width, box_height,
            confidence, crop_key, face_embedding, created_at
        ) VALUES (
            gen_random_uuid(), ${data.mediaItemId}, ${data.personId},
            ${data.boxX}, ${data.boxY}, ${data.boxWidth}, ${data.boxHeight},
            ${data.confidence}, ${data.cropKey ?? null}, ${embeddingStr}::vector, now()
        ) RETURNING id
    `;

    // Auto-set person avatar if they don't have one yet
    if (data.cropKey && data.personId) {
        await prisma.person.updateMany({
            where: { id: data.personId, avatarKey: null },
            data: { avatarKey: data.cropKey },
        });
    }

    // Incremental rather than a full album resync. syncPersonCollection is
    // O(album size), and calling it once per inserted face made ingesting N faces
    // of one person O(N²) row writes inline in this request.
    if (data.personId) {
        await personsService.addMediaToPersonCollection(data.personId, data.mediaItemId);
    }

    await personsService.invalidatePersonsCache();

    return { id: rows[0]!.id };
}

/** Keyset page size for the embedding export. */
const EMBEDDING_PAGE_SIZE = 2000;

/**
 * Export face embeddings for clustering, one keyset page at a time.
 *
 * This used to select every embedding in one query with no LIMIT, cast each
 * 512-dim vector to text (~6-8 KB of JSON per row), and `res.json` the lot — so
 * past roughly 100k faces it exceeded V8's maximum string length and took the API
 * process down, and the worker's 30s HTTP timeout killed it well before that
 * anyway. `ORDER BY created_at` also had no supporting index, forcing an external
 * sort of the whole vector set.
 */
export async function getFaceEmbeddingsPage(
    cursor?: string,
    limit = EMBEDDING_PAGE_SIZE
): Promise<{
    faces: Array<{
        id: string;
        personId: string | null;
        embedding: number[];
        manuallyAssigned: boolean;
    }>;
    nextCursor: string | null;
}> {
    const take = Math.min(limit, EMBEDDING_PAGE_SIZE);

    const rows = cursor
        ? await prisma.$queryRaw<
            Array<{
                id: string;
                person_id: string | null;
                embedding: string;
                manually_assigned: boolean;
            }>
        >`
            SELECT id, person_id, face_embedding::text AS embedding, manually_assigned
            FROM faces
            WHERE face_embedding IS NOT NULL AND id > ${cursor}
            ORDER BY id
            LIMIT ${take}
        `
        : await prisma.$queryRaw<
            Array<{
                id: string;
                person_id: string | null;
                embedding: string;
                manually_assigned: boolean;
            }>
        >`
            SELECT id, person_id, face_embedding::text AS embedding, manually_assigned
            FROM faces
            WHERE face_embedding IS NOT NULL
            ORDER BY id
            LIMIT ${take}
        `;

    const faces = rows.map((row) => ({
        id: row.id,
        personId: row.person_id,
        manuallyAssigned: row.manually_assigned,
        embedding: row.embedding
            .replace(/[[\]]/g, '')
            .split(',')
            .map(Number),
    }));

    return {
        faces,
        nextCursor: rows.length === take ? rows[rows.length - 1]!.id : null,
    };
}

export async function batchReassignFaces(
    assignments: Array<{ faceId: string; personId: string }>
): Promise<number> {
    /**
     * Never move a face a human has assigned.
     *
     * The recluster job is the only caller, and it reassigns every non-majority
     * face in a cluster to the modal person before deleting the losers. Without
     * this guard a single cron run could silently redistribute a named person's
     * faces and then hard-delete the Person row carrying their name and avatar.
     * Enforced here rather than in the worker so the invariant holds regardless of
     * what the caller sends.
     */
    const protectedFaces = await prisma.face.findMany({
        where: {
            id: { in: assignments.map((a) => a.faceId) },
            manuallyAssigned: true,
        },
        select: { id: true },
    });
    const protectedIds = new Set(protectedFaces.map((f) => f.id));

    const allowed = assignments.filter((a) => !protectedIds.has(a.faceId));

    if (protectedIds.size > 0) {
        logger.info(
            { skipped: protectedIds.size, requested: assignments.length },
            'internal: skipped reassignment of manually assigned faces'
        );
    }

    const BATCH_SIZE = 100;
    let count = 0;

    for (let i = 0; i < allowed.length; i += BATCH_SIZE) {
        const batch = allowed.slice(i, i + BATCH_SIZE);
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

    // One resync per affected person, not one per face.
    const uniquePersonIds = [...new Set(allowed.map((a) => a.personId))];
    for (const pid of uniquePersonIds) {
        await personsService.syncPersonCollection(pid);
    }

    await personsService.invalidatePersonsCache();

    return count;
}

// ─── Persons ─────────────────────────────────────────────────

export async function listNamedPersons(): Promise<Array<{ id: string; name: string }>> {
    const rows = await prisma.person.findMany({
        where: { name: { not: null } },
        select: { id: true, name: true },
    });
    return rows.filter((p): p is { id: string; name: string } => p.name !== null);
}

export async function createPerson(): Promise<{ id: string }> {
    const person = await prisma.person.create({ data: {} });
    return { id: person.id };
}

export async function batchCreatePersons(count: number): Promise<{ ids: string[] }> {
    if (count === 0) return { ids: [] };

    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO persons (id, created_at, updated_at)
        SELECT gen_random_uuid(), now(), now()
        FROM generate_series(1, ${count})
        RETURNING id
    `;

    return { ids: rows.map((r) => r.id) };
}

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
        whereClause = 'processing_status = \'FAILED\'';
        break;
    case 'missing_clip':
        whereClause = 'clip_embedding IS NULL AND processing_status != \'PENDING\'';
        break;
    case 'missing_faces':
        // NOT EXISTS rather than `id NOT IN (SELECT DISTINCT ...)`, which
        // materialised a full DISTINCT over the faces table first. faces_scanned
        // excludes photos that genuinely contain no people, which the old
        // predicate re-processed on every run forever.
        whereClause =
                `processing_status = 'COMPLETED' AND clip_embedding IS NOT NULL AND faces_scanned = false ` +
                `AND NOT EXISTS (SELECT 1 FROM faces f WHERE f.media_item_id = media_items.id)`;
        break;
    case 'missing_blurhash':
        whereClause = 'blur_hash IS NULL AND processing_status = \'COMPLETED\'';
        break;
    }

    const rows = await prisma.$queryRaw<
        Array<{ id: string; original_key: string; mime_type: string; type: string }>
    >`
        SELECT id, original_key, mime_type, type FROM media_items
        WHERE ${Prisma.raw(whereClause)}
        ORDER BY id
        LIMIT 5000
    `;

    return rows.map((r) => ({
        id: r.id,
        originalKey: r.original_key,
        mimeType: r.mime_type,
        type: r.type,
    }));
}

// ─── Geocoding ──────────────────────────────────────────────

export async function queryMediaForGeocoding() {
    const items = await prisma.mediaItem.findMany({
        where: {
            latitude: { not: null },
            longitude: { not: null },
            city: null,
        },
        select: { id: true, latitude: true, longitude: true },
    });
    return items;
}

export async function persistGeocoding(
    mediaItemId: string,
    city: string | null,
    country: string | null,
) {
    // New place names must become searchable, so the facet cache is stale.
    await invalidateSearchFacets();

    await prisma.$executeRaw`
        UPDATE media_items SET
            city = COALESCE(${city}, city),
            country = COALESCE(${country}, country),
            fts_document = CASE
                WHEN fts_document IS NOT NULL THEN
                    TRIM(fts_document || ' ' || COALESCE(${city}, '') || ' ' || COALESCE(${country}, ''))
                ELSE
                    TRIM(COALESCE(${city}, '') || ' ' || COALESCE(${country}, ''))
            END,
            updated_at = NOW()
        WHERE id = ${mediaItemId}
    `;
}

// ─── S3 Operations ───────────────────────────────────────────

export async function generateUploadUrl(
    prefix: WorkerWritablePrefix,
    contentType: string
): Promise<{ key: string; url: string }> {
    const ext = safeExtension(`f.${contentType.split('/')[1] ?? 'webp'}`, 'webp');

    const key =
        prefix === 'thumbnails' ? s3Service.generateThumbnailKey(ext)
            : prefix === 'crops' ? s3Service.generateCropKey(ext)
                : prefix === 'web' ? s3Service.generateWebKey(ext)
                    : s3Service.generateStreamingKey('mp4');

    // The worker streams video to the 'streaming' URL as a chunked body; the
    // others receive fixed-length in-memory bytes. Only the streamed one must
    // drop the SDK's default integrity checksum (see getPresignedUploadUrl).
    const url = await s3Service.getPresignedUploadUrl(key, contentType, undefined, {
        streamedBody: prefix === 'streaming',
    });
    return { key, url };
}

/**
 * Presign an upload for a key derived from one this application already issued.
 *
 * Used for the responsive thumbnail ladder, where `thumbnails/…/<uuid>.webp` gains
 * siblings `…/<uuid>@200w.webp`. The key is validated against the managed-key shape
 * *plus* the width-variant suffix, so this cannot be used to write arbitrary
 * objects — including anything outside the worker-writable prefixes.
 */
export async function presignUploadForKey(
    key: string,
    contentType: string
): Promise<{ url: string }> {
    if (!isManagedVariantKey(key)) {
        throw new AppError(400, 'Invalid derived storage key');
    }

    const prefix = keyPrefix(key);
    if (!prefix || !(WORKER_WRITABLE_PREFIXES as readonly string[]).includes(prefix)) {
        throw new AppError(400, 'Prefix is not writable by the worker');
    }

    const url = await s3Service.getPresignedUploadUrl(key, contentType);
    return { url };
}

// ─── Sessions ────────────────────────────────────────────────

export async function deleteExpiredSessions(): Promise<number> {
    const result = await prisma.session.deleteMany({
        where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
}
