import { Response } from 'express';

/**
 * Redirect to a presigned URL with a browser cache lifetime that cannot outlive
 * the signature.
 *
 * This used to set a fixed `max-age=3300` regardless of how much validity the
 * signed URL actually had left. Combined with a Redis presign cache that could
 * hand out a URL with only minutes remaining, a browser could hold a cached
 * redirect pointing at an already-expired URL for up to ~49 minutes: the user saw
 * permanently broken thumbnails, or an S3 AccessDenied XML body instead of a
 * download, until the cache entry aged out on its own.
 *
 * The margin covers a browser reusing the cached redirect right at the end of the
 * window.
 */
const EXPIRY_SAFETY_MARGIN_SECONDS = 60;

export function cachedRedirect(res: Response, url: string, expiresInSeconds?: number): void {
    const maxAge = Math.max(0, (expiresInSeconds ?? 0) - EXPIRY_SAFETY_MARGIN_SECONDS);

    res.set('Cache-Control', maxAge > 0 ? `private, max-age=${maxAge}` : 'private, no-store');
    res.redirect(url);
}
