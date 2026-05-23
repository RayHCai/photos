import { Request, Response } from 'express';
import * as internalService from '../services/internal.service.js';
import * as personsService from '../services/persons.service.js';
import * as s3Service from '../services/s3.service.js';
import { asyncHandler } from '../utils/async.js';
import { logger } from '../utils/logger.js';

export const getFileName = asyncHandler(async (req: Request, res: Response) => {
    const result = await internalService.getFileName(req.params.id as string);
    res.json(result);
});

export const setProcessingStatus = asyncHandler(async (req: Request, res: Response) => {
    const mediaId = req.params.id as string;
    const { status, error } = req.body;
    logger.info({ mediaId, status, hasError: !!error }, 'setting processing status');
    await internalService.setProcessingStatus(mediaId, status, error ?? null);
    res.status(204).send();
});

export const claimTask = asyncHandler(async (req: Request, res: Response) => {
    const mediaId = req.params.id as string;
    const claimed = await internalService.claimTask(mediaId, req.body.taskId);
    logger.info({ mediaId, taskId: req.body.taskId, claimed }, 'task claim attempt');
    res.json({ claimed });
});

export const createRetryTask = asyncHandler(async (req: Request, res: Response) => {
    const mediaId = req.params.id as string;
    logger.info({ mediaId }, 'creating retry task');
    const result = await internalService.createRetryTask(mediaId);
    logger.info({ mediaId, taskId: result.taskId }, 'retry task created');
    res.status(201).json(result);
});

export const persistContent = asyncHandler(async (req: Request, res: Response) => {
    const mediaId = req.params.id as string;
    logger.info(
        {
            mediaId,
            hasEmbedding: !!req.body.clipEmbedding,
            hasThumbnail: !!req.body.thumbnailKey,
            width: req.body.width,
            height: req.body.height,
        },
        'persisting processed content'
    );
    await internalService.persistContent(mediaId, req.body);
    logger.info({ mediaId }, 'content persisted successfully');
    res.status(204).send();
});

export const persistBlurHashOnly = asyncHandler(async (req: Request, res: Response) => {
    const mediaId = req.params.id as string;
    logger.info({ mediaId }, 'persisting blur hash');
    await internalService.persistBlurHashOnly(mediaId, req.body.blurHash);
    res.status(204).send();
});

export const persistStreamingKey = asyncHandler(async (req: Request, res: Response) => {
    const mediaId = req.params.id as string;
    logger.info({ mediaId }, 'persisting streaming key');
    await internalService.persistStreamingKey(mediaId, req.body.streamingKey);
    res.status(204).send();
});

export const getThumbnailKey = asyncHandler(async (req: Request, res: Response) => {
    const result = await internalService.getThumbnailKey(req.params.id as string);
    res.json(result);
});

export const persistClipOnly = asyncHandler(async (req: Request, res: Response) => {
    const mediaId = req.params.id as string;
    logger.info({ mediaId }, 'persisting CLIP embedding');
    await internalService.persistClipOnly(mediaId, req.body.embedding);
    res.status(204).send();
});

export const clearFaces = asyncHandler(async (req: Request, res: Response) => {
    const mediaId = req.params.id as string;
    logger.info({ mediaId }, 'clearing faces');
    const count = await internalService.clearFaces(mediaId);
    logger.info({ mediaId, deleted: count }, 'faces cleared');
    res.json({ deleted: count });
});

export const findNearestExisting = asyncHandler(async (req: Request, res: Response) => {
    const mediaId = req.params.id as string;
    const result = await internalService.findNearestExisting(
        mediaId,
        req.body.embedding,
        req.body.threshold
    );
    logger.debug({ mediaId, found: !!result.faceId }, 'nearest existing face search');
    res.json(result);
});

export const findNearestPerson = asyncHandler(async (req: Request, res: Response) => {
    const result = await internalService.findNearestPerson(req.body.embedding, req.body.threshold);
    logger.debug({ found: !!result.personId, distance: result.distance }, 'nearest person search');
    res.json(result);
});

export const insertFace = asyncHandler(async (req: Request, res: Response) => {
    logger.info({ mediaId: req.body.mediaItemId, personId: req.body.personId }, 'inserting face');
    const result = await internalService.insertFace(req.body);
    logger.info({ faceId: result.id, mediaId: req.body.mediaItemId }, 'face inserted');
    res.status(201).json(result);
});

export const getAllFaceEmbeddings = asyncHandler(async (_req: Request, res: Response) => {
    logger.info('fetching all face embeddings for recluster');
    const result = await internalService.getAllFaceEmbeddings();
    logger.info({ faceCount: result.faces.length }, 'face embeddings fetched');
    res.json(result);
});

export const batchReassignFaces = asyncHandler(async (req: Request, res: Response) => {
    const assignmentCount = req.body.assignments?.length ?? 0;
    logger.info({ assignmentCount }, 'batch reassigning faces');
    const count = await internalService.batchReassignFaces(req.body.assignments);
    logger.info({ reassigned: count }, 'batch face reassignment completed');
    res.json({ reassigned: count });
});

export const createPerson = asyncHandler(async (_req: Request, res: Response) => {
    const result = await internalService.createPerson();
    logger.info({ personId: result.id }, 'person created');
    res.status(201).json(result);
});

export const batchCreatePersons = asyncHandler(async (req: Request, res: Response) => {
    logger.info({ count: req.body.count }, 'batch creating persons');
    const result = await internalService.batchCreatePersons(req.body.count);
    logger.info({ created: result.ids.length }, 'batch persons created');
    res.status(201).json(result);
});

export const getMediaItemInfo = asyncHandler(async (req: Request, res: Response) => {
    const result = await internalService.getMediaItemInfo(req.params.id as string);
    res.json(result);
});

export const queryMediaItemsForRetry = asyncHandler(async (req: Request, res: Response) => {
    logger.info({ filter: req.body.filter }, 'querying media items for retry');
    const result = await internalService.queryMediaItemsForRetry(req.body.filter);
    logger.info({ filter: req.body.filter, count: result.length }, 'retry query completed');
    res.json({ items: result });
});

export const getDownloadUrl = asyncHandler(async (req: Request, res: Response) => {
    const url = await s3Service.getPresignedDownloadUrl(req.params.key as string);
    res.json({ url });
});

export const generateUploadUrl = asyncHandler(async (req: Request, res: Response) => {
    logger.debug({ prefix: req.body.prefix, contentType: req.body.contentType }, 'generating upload URL');
    const result = await internalService.generateUploadUrl(req.body.prefix, req.body.contentType);
    res.json(result);
});

export const deleteOrphanPersons = asyncHandler(async (_req: Request, res: Response) => {
    logger.info('cleaning up orphan persons');
    const count = await personsService.deleteOrphanPersons();
    logger.info({ deleted: count }, 'orphan persons cleaned up');
    res.json({ deleted: count });
});

export const deleteExpiredSessions = asyncHandler(async (_req: Request, res: Response) => {
    logger.info('cleaning up expired sessions');
    const count = await internalService.deleteExpiredSessions();
    logger.info({ deleted: count }, 'expired sessions cleaned up');
    res.json({ deleted: count });
});
