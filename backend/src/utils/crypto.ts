import crypto from 'node:crypto';

/**
 * Constant-time comparison of two secrets of unknown length.
 *
 * `timingSafeEqual` throws on length mismatch, so callers normally guard with
 * `a.length !== b.length` first — which leaks the expected length. Hashing both
 * sides to a fixed 32 bytes removes the length signal and keeps the comparison
 * constant-time.
 */
export function secretEquals(provided: string | undefined, expected: string): boolean {
    if (typeof provided !== 'string') return false;
    const a = crypto.createHash('sha256').update(provided, 'utf-8').digest();
    const b = crypto.createHash('sha256').update(expected, 'utf-8').digest();
    return crypto.timingSafeEqual(a, b);
}

/**
 * HMAC over a session token, used to authenticate Redis cache entries.
 *
 * The cache is checked before Postgres, so without this an attacker with write
 * access to Redis could mint a valid session by writing a key directly. The
 * backend only trusts a cache entry whose signature it can reproduce.
 */
export function signSessionToken(token: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(token, 'utf-8').digest('base64url');
}

export function verifySessionSignature(
    token: string,
    signature: unknown,
    secret: string
): boolean {
    if (typeof signature !== 'string') return false;
    const expected = signSessionToken(token, secret);
    const a = Buffer.from(signature, 'utf-8');
    const b = Buffer.from(expected, 'utf-8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}
