import { Response } from 'express';

const CACHE_MAX_AGE = 3300; // 55 minutes

export function cachedRedirect(res: Response, url: string): void {
    res.set('Cache-Control', `private, max-age=${CACHE_MAX_AGE}`);
    res.redirect(url);
}
