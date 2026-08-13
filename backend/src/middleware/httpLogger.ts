import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

/**
 * A share slug is a bearer secret: anyone holding it can open the album. Logging
 * request paths verbatim therefore wrote credentials into log storage, where
 * anyone with log access — or a log-shipping vendor — could read them and open
 * any private shared album.
 */
function redactPath(path: string): string {
    return path.replace(/(\/public\/s\/)[^/?]+/g, '$1[redacted]');
}

export function httpLogger(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        const log = {
            requestId: req.headers['x-request-id'],
            method: req.method,
            path: redactPath(req.originalUrl),
            status: res.statusCode,
            duration,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
        };

        if (res.statusCode >= 500) {
            logger.error(log, 'request failed');
        }
        else if (res.statusCode >= 400) {
            logger.warn(log, 'request client error');
        }
        else {
            logger.info(log, 'request completed');
        }
    });

    next();
}
