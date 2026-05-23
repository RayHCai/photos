import { Request, Response } from 'express';
import * as shareService from '../services/share.service.js';
import { asyncHandler } from '../utils/async.js';
import { logger } from '../utils/logger.js';

export const createLink = asyncHandler(async (req: Request, res: Response) => {
    const collectionId = req.params.id as string;
    logger.info({ collectionId, slug: req.body.slug }, 'creating share link');
    const link = await shareService.createShareLink(collectionId, {
        slug: req.body.slug,
        expiresAt: req.body.expiresAt
            ? new Date(req.body.expiresAt)
            : undefined,
    });
    logger.info({ collectionId, linkId: link.id, slug: link.slug }, 'share link created');
    res.status(201).json(link);
});

export const listLinks = asyncHandler(async (req: Request, res: Response) => {
    const links = await shareService.listShareLinks(req.params.id as string);
    res.json(links);
});

export const revokeLink = asyncHandler(async (req: Request, res: Response) => {
    const linkId = req.params.linkId as string;
    logger.info({ linkId }, 'revoking share link');
    await shareService.revokeShareLink(linkId);
    logger.info({ linkId }, 'share link revoked');
    res.json({ message: 'Share link revoked' });
});

export const viewShared = asyncHandler(async (req: Request, res: Response) => {
    const slug = req.params.slug as string;
    logger.info({ slug, ip: req.ip }, 'shared collection viewed');
    const collection = await shareService.getSharedCollection(slug);
    res.json(collection);
});

export const sharedThumbnail = asyncHandler(async (req: Request, res: Response) => {
    const url = await shareService.getSharedMediaUrl(
        req.params.slug as string,
        req.params.mediaId as string,
        'thumbnail'
    );
    res.set('Cache-Control', 'private, max-age=3300');
    res.redirect(url);
});

export const sharedOriginal = asyncHandler(async (req: Request, res: Response) => {
    const url = await shareService.getSharedMediaUrl(
        req.params.slug as string,
        req.params.mediaId as string,
        'original'
    );
    res.set('Cache-Control', 'private, max-age=3300');
    res.redirect(url);
});
