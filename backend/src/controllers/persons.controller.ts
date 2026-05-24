import { Request, Response } from 'express';
import * as personsService from '../services/persons.service.js';
import { asyncHandler } from '../utils/async.js';
import { extractPagination } from '../utils/db.js';
import { cachedRedirect } from '../utils/response.js';
import { logger } from '../utils/logger.js';

export const list = asyncHandler(async (_req: Request, res: Response) => {
    const persons = await personsService.listPersons();
    logger.debug({ count: persons.length }, 'persons listed');
    res.json(persons);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
    const person = await personsService.getPerson(req.params.id as string);
    res.json(person);
});

export const rename = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    logger.info({ personId: id, name: req.body.name }, 'renaming person');
    const person = await personsService.renamePerson(id, req.body.name);
    logger.info({ personId: id, name: person.name }, 'person renamed');
    res.json(person);
});

export const merge = asyncHandler(async (req: Request, res: Response) => {
    logger.info({ targetId: req.body.targetId, sourceId: req.body.sourceId }, 'merging persons');
    const person = await personsService.mergePersons(
        req.body.targetId,
        req.body.sourceId
    );
    logger.info({ personId: person?.id }, 'persons merged');
    res.json(person);
});

export const deleteOne = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    logger.info({ personId: id }, 'deleting person');
    await personsService.deletePerson(id);
    logger.info({ personId: id }, 'person deleted');
    res.status(204).send();
});

export const getMedia = asyncHandler(async (req: Request, res: Response) => {
    const { limit, cursor } = extractPagination(req);
    const result = await personsService.getPersonMedia(
        req.params.id as string,
        limit,
        cursor
    );
    res.json(result);
});

export const getAvatar = asyncHandler(async (req: Request, res: Response) => {
    const url = await personsService.getPersonAvatarUrl(req.params.id as string);
    cachedRedirect(res, url);
});

export const share = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    logger.info({ personId: id }, 'sharing person');
    const result = await personsService.sharePerson(id);
    logger.info({ personId: id, slug: result.shareLink.slug, created: result.created }, 'person shared');
    res.status(result.created ? 201 : 200).json(result);
});
