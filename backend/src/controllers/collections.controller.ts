import { Request, Response } from 'express';
import * as collectionsService from '../services/collections.service.js';
import { asyncHandler } from '../utils/async.js';
import { logger } from '../utils/logger.js';

export const list = asyncHandler(async (_req: Request, res: Response) => {
    const collections = await collectionsService.listCollections();
    logger.debug({ count: collections.length }, 'collections listed');
    res.json(collections);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
    logger.info({ name: req.body.name }, 'creating collection');
    const collection = await collectionsService.createCollection(req.body);
    logger.info({ collectionId: collection.id, name: collection.name }, 'collection created');
    res.status(201).json(collection);
});

function paginationFrom(req: Request) {
    return {
        ...(req.query.cursor ? { cursor: req.query.cursor as string } : {}),
        ...(req.query.limit ? { limit: Number(req.query.limit) } : {}),
    };
}

export const getHidden = asyncHandler(async (req: Request, res: Response) => {
    const collection = await collectionsService.getOrCreateSystemCollection(
        'HIDDEN',
        'Hidden',
        paginationFrom(req)
    );
    res.json(collection);
});

export const getFavorites = asyncHandler(async (req: Request, res: Response) => {
    const collection = await collectionsService.getOrCreateSystemCollection(
        'FAVORITES',
        'Favorites',
        paginationFrom(req)
    );
    res.json(collection);
});

/**
 * Just the member ids. The favorites/hidden hooks only ever built a Set of ids
 * from these, but fetched the full item payload — complete media rows — on every
 * home-page mount and on every ['collections'] invalidation.
 */
export const getSystemCollectionIds = (systemType: 'FAVORITES' | 'HIDDEN') =>
    asyncHandler(async (_req: Request, res: Response) => {
        const ids = await collectionsService.getSystemCollectionIds(systemType);
        res.json({ ids });
    });

export const getFavoriteIds = getSystemCollectionIds('FAVORITES');
export const getHiddenIds = getSystemCollectionIds('HIDDEN');

export const getById = asyncHandler(async (req: Request, res: Response) => {
    const collection = await collectionsService.getCollection(
        req.params.id as string,
        paginationFrom(req)
    );
    res.json(collection);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    logger.info({ collectionId: id, fields: Object.keys(req.body) }, 'updating collection');
    const collection = await collectionsService.updateCollection(id, req.body);
    logger.info({ collectionId: id }, 'collection updated');
    res.json(collection);
});

export const deleteOne = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    logger.info({ collectionId: id }, 'deleting collection');
    await collectionsService.deleteCollection(id);
    logger.info({ collectionId: id }, 'collection deleted');
    res.status(204).send();
});

export const addItems = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const itemCount = req.body.mediaItemIds?.length ?? 0;
    logger.info({ collectionId: id, itemCount }, 'adding items to collection');
    await collectionsService.addItems(id, req.body.mediaItemIds);
    logger.info({ collectionId: id, itemCount }, 'items added to collection');
    res.status(201).json({ message: 'Items added' });
});

export const removeItems = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const itemCount = req.body.mediaItemIds?.length ?? 0;
    logger.info({ collectionId: id, itemCount }, 'removing items from collection');
    await collectionsService.removeItems(id, req.body.mediaItemIds);
    logger.info({ collectionId: id, itemCount }, 'items removed from collection');
    res.json({ message: 'Items removed' });
});

export const membership = asyncHandler(async (req: Request, res: Response) => {
    const collectionIds = await collectionsService.getCollectionMembership(req.body.mediaItemIds);
    res.json({ collectionIds });
});
