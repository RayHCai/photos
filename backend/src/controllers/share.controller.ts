import { Request, Response } from 'express';
import * as shareService from '../services/share.service.js';
import * as contributionsService from '../services/contributions.service.js';
import * as archiveService from '../services/archive.service.js';
import * as archiveProgress from '../services/archiveProgress.service.js';
import { AppError } from '../middleware/errorHandler.js';
import { asyncHandler } from '../utils/async.js';
import { cachedRedirect } from '../utils/response.js';
import { logger } from '../utils/logger.js';

export const createLink = asyncHandler(async (req: Request, res: Response) => {
    const collectionId = req.params.id as string;
    const link = await shareService.createShareLink(collectionId, {
        ...(req.body.slug ? { slug: req.body.slug } : {}),
        ...(req.body.expiresAt ? { expiresAt: new Date(req.body.expiresAt) } : {}),
        ...(req.body.label ? { label: req.body.label } : {}),
    });
    logger.info({ collectionId, linkId: link.id }, 'share link created');
    res.status(201).json(link);
});

export const listLinks = asyncHandler(async (req: Request, res: Response) => {
    const links = await shareService.listShareLinks(req.params.id as string);
    res.json(links);
});

/** Remove-by-link: reject what is waiting and delete what was approved. */
export const purgeLink = asyncHandler(async (req: Request, res: Response) => {
    const linkId = req.params.linkId as string;
    logger.info({ linkId, revoke: req.body.revoke }, 'removing everything from share link');
    const result = await contributionsService.removeEverythingFromLink(linkId, {
        revoke: req.body.revoke === true,
    });
    res.json(result);
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

export const sharedItems = asyncHandler(async (req: Request, res: Response) => {
    const result = await shareService.getSharedItems(req.params.slug as string, {
        ...(req.query.cursor ? { cursor: req.query.cursor as string } : {}),
        ...(req.query.offset !== undefined ? { offset: Number(req.query.offset) } : {}),
        ...(req.query.limit ? { limit: Number(req.query.limit) } : {}),
    });
    res.json(result);
});

export const sharedTimeline = asyncHandler(async (req: Request, res: Response) => {
    const result = await shareService.getSharedTimeline(req.params.slug as string);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(result);
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

export const sharedEvents = asyncHandler(async (req: Request, res: Response) => {
    const result = await shareService.getSharedEvents(req.params.slug as string, {
        ...(req.query.cursor ? { cursor: req.query.cursor as string } : {}),
    });
    res.set('Cache-Control', 'no-store');
    res.json(result);
});

export const sharedThumbnail = redirectToVariant('thumbnail');
export const sharedWeb = redirectToVariant('web');
export const sharedOriginal = redirectToVariant('original');

/**
 * Stream a zip of everything a guest can see in the shared collection.
 *
 * A form POST navigation like the library's archive endpoint (see
 * mediaController.archive), so the browser's download manager owns the transfer.
 * No ids in the body: the link itself says what is in it.
 */
export const sharedArchive = asyncHandler(async (req: Request, res: Response) => {
    const progressToken = (req.body.progressToken as string | undefined) ?? null;
    await archiveService.serveArchive(
        res,
        progressToken,
        () => ({ expectedItems: 0, request: req.params.slug as string }),
        (slug) => shareService.getSharedArchive(slug)
    );
});

export const sharedArchiveProgress = asyncHandler(async (req: Request, res: Response) => {
    await shareService.assertShareLinkActive(req.params.slug as string);
    const progress = await archiveProgress.readProgress(req.params.token as string);
    if (!progress) throw new AppError(404, 'No such download');
    res.set('Cache-Control', 'no-store');
    res.json(progress);
});

export const cancelSharedArchive = asyncHandler(async (req: Request, res: Response) => {
    await shareService.assertShareLinkActive(req.params.slug as string);
    const found = await archiveProgress.requestCancel(req.params.token as string);
    res.json({ cancelled: found });
});

// Guest uploads. The response shapes match the library's own upload routes, so
// the client's uploader drives both.

export const guestPresign = asyncHandler(async (req: Request, res: Response) => {
    const result = await contributionsService.presignGuestUpload(req.params.slug as string, req.body);
    res.json(result);
});

export const guestConfirm = asyncHandler(async (req: Request, res: Response) => {
    const result = await contributionsService.confirmGuestUpload(
        req.params.slug as string,
        req.body.uploadToken
    );
    res.status(201).json(result);
});

export const guestMultipartInit = asyncHandler(async (req: Request, res: Response) => {
    const result = await contributionsService.initGuestMultipart(req.params.slug as string, req.body);
    res.json(result);
});

export const guestMultipartPresign = asyncHandler(async (req: Request, res: Response) => {
    const result = await contributionsService.getGuestPartUrl(
        req.params.slug as string,
        req.body.uploadToken,
        req.body.partNumber
    );
    res.json(result);
});

export const guestMultipartComplete = asyncHandler(async (req: Request, res: Response) => {
    const result = await contributionsService.completeGuestMultipart(
        req.params.slug as string,
        req.body.uploadToken,
        req.body.parts
    );
    res.status(201).json(result);
});
