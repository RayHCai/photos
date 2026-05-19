import { Request, Response } from 'express';
import * as facesService from '../services/faces.service.js';
import { asyncHandler } from '../utils/async.js';
import { logger } from '../utils/logger.js';

export const listUnassigned = asyncHandler(async (req: Request, res: Response) => {
    const limit = Number(req.query.limit) || 50;
    const cursor = req.query.cursor as string | undefined;
    const result = await facesService.listUnassignedFaces(limit, cursor);
    logger.debug({ count: result.items.length, hasMore: result.hasMore }, 'unassigned faces listed');
    res.json(result);
});

export const assign = asyncHandler(async (req: Request, res: Response) => {
    const faceId = req.params.id as string;
    const personId = req.body.personId;
    logger.info({ faceId, personId }, 'assigning face to person');
    const face = await facesService.assignFace(faceId, personId);
    logger.info({ faceId, personId }, 'face assigned to person');
    res.json(face);
});

export const unassign = asyncHandler(async (req: Request, res: Response) => {
    const faceId = req.params.id as string;
    logger.info({ faceId }, 'unassigning face from person');
    const face = await facesService.unassignFace(faceId);
    logger.info({ faceId }, 'face unassigned');
    res.json(face);
});

export const getCrop = asyncHandler(async (req: Request, res: Response) => {
    const url = await facesService.getFaceCropUrl(req.params.id as string);
    res.redirect(url);
});
