import { Request, Response } from 'express';
import * as authService from '../services/auth.service.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../utils/async.js';
import { logger } from '../utils/logger.js';

export const login = asyncHandler(async (req: Request, res: Response) => {
    logger.info({ ip: req.ip }, 'login attempt');

    const { token, expiresAt } = await authService.login(
        req.body.password,
        req.headers['user-agent'],
        req.ip
    );

    res.cookie('session_token', token, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    });

    logger.info({ ip: req.ip, expiresAt }, 'login successful');
    res.json({ token, expiresAt });
});

export const status = asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.getSessionStatus(req.sessionId!);
    res.json(result);
});
