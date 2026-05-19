import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

export function httpLogger(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        const requestId = req.headers['x-request-id'];
        const log = {
            requestId,
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            duration,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
        };

        if (res.statusCode >= 500) {
            logger.error(log, 'request failed');
        } else if (res.statusCode >= 400) {
            logger.warn(log, 'request client error');
        } else {
            logger.info(log, 'request completed');
        }
    });

    next();
}
