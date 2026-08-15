import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

export class AppError extends Error {
    constructor(
        public statusCode: number,
        message: string,
        public isOperational = true
    ) {
        super(message);
        this.name = 'AppError';
    }
}

export function errorHandler(
    err: Error,
    req: Request,
    res: Response,
    _next: NextFunction
) {
    const requestId = req.headers['x-request-id'];

    /**
     * A streamed response (see archive.service) has already sent its status and
     * headers, so there is no error response left to write — attempting one throws
     * ERR_HTTP_HEADERS_SENT from inside the error handler itself, replacing the real
     * error in the logs with a second one about failing to report it. Ending the
     * response is all that is left; the client sees a truncated body, which is the
     * only signal the protocol has at that point.
     */
    if (res.headersSent) {
        logger.error({ err, requestId }, 'Error after response started; ending stream');
        return res.end();
    }

    if (err instanceof AppError) {
        logger.warn({ err, requestId }, `Operational error: ${err.message}`);
        return res.status(err.statusCode).json({
            error: err.message,
            requestId,
        });
    }

    logger.error({ err, requestId }, 'Unexpected error');
    return res.status(500).json({
        error: 'Internal server error',
        requestId,
    });
}
