import { Request, Response } from 'express';
import * as mediaService from '../services/media.service.js';
import { asyncHandler } from '../utils/async.js';
import { logger } from '../utils/logger.js';

export const list = asyncHandler(async (req: Request, res: Response) => {
    const params = {
        cursor: req.query.cursor as string | undefined,
        limit: Number(req.query.limit) || 50,
        type: req.query.type as 'PHOTO' | 'VIDEO' | undefined,
        sort: req.query.sort as 'date_asc' | 'date_desc' | undefined,
    };
    logger.debug({ ...params }, 'media list requested');
    const result = await mediaService.listMedia(params);
    logger.debug({ count: result.items.length, hasMore: result.hasMore }, 'media list returned');
    res.json(result);
});

export const shell = asyncHandler(async (_req: Request, res: Response) => {
    const items = await mediaService.getShellData();
    res.json(items);
});

export const timeline = asyncHandler(async (_req: Request, res: Response) => {
    const result = await mediaService.getTimeline();
    res.json(result);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
    const item = await mediaService.getMediaById(req.params.id as string);
    res.json(item);
});

export const presign = asyncHandler(async (req: Request, res: Response) => {
    logger.info({ fileName: req.body.fileName, mimeType: req.body.mimeType, fileSize: req.body.fileSize }, 'presigned upload requested');
    const result = await mediaService.createPresignedUpload(
        req.body.fileName,
        req.body.mimeType,
        req.body.fileSize
    );
    logger.info({ mediaId: result.id }, 'presigned upload created');
    res.json(result);
});

export const confirmUpload = asyncHandler(async (req: Request, res: Response) => {
    logger.info({ mediaId: req.body.id }, 'confirming presigned upload');
    const item = await mediaService.confirmPresignedUpload(req.body.id);
    logger.info({ mediaId: item.id }, 'presigned upload confirmed, processing enqueued');
    res.json(item);
});

export const multipartInit = asyncHandler(async (req: Request, res: Response) => {
    logger.info({ fileName: req.body.fileName, mimeType: req.body.mimeType, fileSize: req.body.fileSize }, 'multipart upload init');
    const result = await mediaService.initMultipartUpload(
        req.body.fileName,
        req.body.mimeType,
        req.body.fileSize
    );
    logger.info({ mediaId: result.id }, 'multipart upload initiated');
    res.json(result);
});

export const multipartPresign = asyncHandler(async (req: Request, res: Response) => {
    const result = await mediaService.getMultipartPartUrl(
        req.body.s3Key,
        req.body.uploadId,
        req.body.partNumber
    );
    res.json(result);
});

export const multipartComplete = asyncHandler(async (req: Request, res: Response) => {
    const partCount = req.body.parts?.length ?? 0;
    logger.info({ mediaId: req.body.mediaItemId, partCount }, 'multipart upload completing');
    const item = await mediaService.completeMultipartUpload(
        req.body.mediaItemId,
        req.body.s3Key,
        req.body.uploadId,
        req.body.parts
    );
    logger.info({ mediaId: item.id }, 'multipart upload completed, processing enqueued');
    res.json(item);
});

export const deleteOne = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    logger.info({ mediaId: id }, 'deleting media item');
    await mediaService.deleteMedia(id);
    logger.info({ mediaId: id }, 'media item deleted');
    res.status(204).send();
});

export const batchDelete = asyncHandler(async (req: Request, res: Response) => {
    const ids = req.body.ids as string[];
    logger.info({ count: ids?.length }, 'batch delete requested');
    const count = await mediaService.batchDeleteMedia(ids);
    logger.info({ deleted: count }, 'batch delete completed');
    res.json({ deleted: count });
});

export const batchThumbnails = asyncHandler(async (req: Request, res: Response) => {
    const ids = req.body.ids as string[];
    const urls = await mediaService.getBatchThumbnailUrls(ids);
    res.json(urls);
});

export const getThumbnail = asyncHandler(async (req: Request, res: Response) => {
    const url = await mediaService.getThumbnailUrl(req.params.id as string);
    res.redirect(url);
});

export const getOriginal = asyncHandler(async (req: Request, res: Response) => {
    const url = await mediaService.getOriginalUrl(req.params.id as string);
    res.redirect(url);
});

export const checkDuplicates = asyncHandler(async (req: Request, res: Response) => {
    const fileNames = req.body.fileNames as string[];
    logger.info({ count: fileNames.length }, 'checking for duplicate file names');
    const duplicates = await mediaService.checkDuplicateFileNames(fileNames);
    res.json({ duplicates });
});
