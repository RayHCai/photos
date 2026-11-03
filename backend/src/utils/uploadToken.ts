import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * What the server promised at presign/init time, carried by the client until it
 * confirms. No row exists before confirm, so this is the only record of which
 * key was issued and for what file; without the signature a client could
 * confirm any key — including another item's original, leaving two rows on one
 * object so that deleting either destroys the other's bytes.
 */
export interface UploadClaims {
    key: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    /** Multipart uploads only. */
    uploadId?: string;
}

/** A guest's upload through a share link, which also names its contribution row. */
export interface ContributionClaims extends UploadClaims {
    contributionId: string;
}

/**
 * Matches the bucket's abort-incomplete-multipart window and sits well inside
 * the pending-tag expiry, so a token can never confirm an object the lifecycle
 * rule is about to delete.
 */
const UPLOAD_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/**
 * Each kind of token is signed under its own domain, so one can never be
 * replayed as the other: a guest's token must not confirm through the owner's
 * route, which would put a guest's upload straight into the library unreviewed.
 * The domain also separates both from session signatures made with this secret.
 */
type TokenDomain = 'upload-token' | 'contribution-token';

const hmac = (domain: TokenDomain, payload: string) =>
    crypto
        .createHmac('sha256', env.SESSION_SIGNING_SECRET)
        .update(`${domain}:${payload}`, 'utf-8')
        .digest('base64url');

function sign(domain: TokenDomain, claims: UploadClaims): string {
    const exp = Math.floor(Date.now() / 1000) + UPLOAD_TOKEN_TTL_SECONDS;
    const payload = Buffer.from(JSON.stringify({ ...claims, exp })).toString('base64url');
    return `${payload}.${hmac(domain, payload)}`;
}

function verify<T extends UploadClaims>(domain: TokenDomain, token: string): T {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) throw new AppError(400, 'Malformed upload token');

    const a = Buffer.from(signature, 'utf-8');
    const b = Buffer.from(hmac(domain, payload), 'utf-8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        throw new AppError(400, 'Invalid upload token');
    }

    const { exp, ...claims } = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf-8')
    ) as T & { exp: number };
    if (exp < Date.now() / 1000) throw new AppError(400, 'Upload token expired');
    return claims as unknown as T;
}

export function signUploadToken(claims: UploadClaims): string {
    return sign('upload-token', claims);
}

export function verifyUploadToken(token: string): UploadClaims {
    return verify('upload-token', token);
}

export function signContributionToken(claims: ContributionClaims): string {
    return sign('contribution-token', claims);
}

export function verifyContributionToken(token: string): ContributionClaims {
    return verify<ContributionClaims>('contribution-token', token);
}
