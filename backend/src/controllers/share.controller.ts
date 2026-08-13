import { Request, Response } from 'express';
import * as shareService from '../services/share.service.js';
import { asyncHandler } from '../utils/async.js';
import { cachedRedirect } from '../utils/response.js';
import { logger } from '../utils/logger.js';

export const createLink = asyncHandler(async (req: Request, res: Response) => {
    const collectionId = req.params.id as string;
    const link = await shareService.createShareLink(collectionId, {
        ...(req.body.slug ? { slug: req.body.slug } : {}),
        ...(req.body.expiresAt ? { expiresAt: new Date(req.body.expiresAt) } : {}),
    });
    logger.info({ collectionId, linkId: link.id }, 'share link created');
    res.status(201).json(link);
});

export const listLinks = asyncHandler(async (req: Request, res: Response) => {
    const links = await shareService.listShareLinks(req.params.id as string);
    res.json(links);
});

export const revokeLink = asyncHandler(async (req: Request, res: Response) => {
    const linkId = req.params.linkId as string;
    await shareService.revokeShareLink(linkId);
    logger.info({ linkId }, 'share link revoked');
    res.json({ message: 'Share link revoked' });
});

export const viewShared = asyncHandler(async (req: Request, res: Response) => {
    // The slug is a bearer secret, so it is deliberately not logged. See
    // middleware/httpLogger.ts, which also redacts it from the request path.
    const collection = await shareService.getSharedCollection(req.params.slug as string);
    res.json(collection);
});

/**
 * The URL's remaining lifetime is threaded into the redirect so the browser
 * cannot cache a 302 for longer than the presigned URL behind it stays valid.
 */
function redirectToVariant(variant: shareService.SharedVariant) {
    return asyncHandler(async (req: Request, res: Response) => {
        const { url, expiresInSeconds } = await shareService.getSharedMediaUrl(
            req.params.slug as string,
            req.params.mediaId as string,
            variant,
            req.query.download === '1'
        );
        cachedRedirect(res, url, expiresInSeconds);
    });
}

export const sharedThumbnail = redirectToVariant('thumbnail');
export const sharedWeb = redirectToVariant('web');
export const sharedOriginal = redirectToVariant('original');
