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
