import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
    const id = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    req.headers['x-request-id'] = id;
    res.setHeader('x-request-id', id);
    next();
}
