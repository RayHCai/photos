import { describe, expect, it } from 'vitest';
import { secretEquals, signSessionToken, verifySessionSignature } from './crypto.js';

/**
 * `secretEquals` replaced a `a.length !== b.length || !timingSafeEqual(a, b)` guard,
 * which short-circuits on length and therefore leaks the expected secret's length.
 */
describe('secretEquals', () => {
    it('accepts an exact match', () => {
        expect(secretEquals('correct-horse-battery-staple', 'correct-horse-battery-staple')).toBe(
            true
        );
    });

    it('rejects a different value of the same length', () => {
        expect(secretEquals('aaaaaaaa', 'bbbbbbbb')).toBe(false);
    });

    it('rejects values of different lengths without throwing', () => {
        // timingSafeEqual throws on a length mismatch, which is why the old code needed
        // the leaky guard. Hashing both sides to 32 bytes removes the problem.
        expect(secretEquals('short', 'a-much-longer-secret-value')).toBe(false);
    });

    it('rejects a prefix of the expected secret', () => {
        expect(secretEquals('correct-horse', 'correct-horse-battery-staple')).toBe(false);
    });

    it('rejects a non-string provided value', () => {
        expect(secretEquals(undefined, 'expected')).toBe(false);
    });

    it('rejects the empty string against a real secret', () => {
        expect(secretEquals('', 'expected')).toBe(false);
    });

    it('handles non-ASCII without throwing', () => {
        expect(secretEquals('sécret-🔑', 'sécret-🔑')).toBe(true);
        expect(secretEquals('sécret-🔑', 'secret-key')).toBe(false);
    });
});

/**
 * Session cache entries are HMAC-signed because `validateSessionToken` consults Redis
 * *before* Postgres — so without a signature, anyone able to write to Redis (which the
 * shipped compose exposed on 0.0.0.0 with no password) could mint a valid session with
 * a single SET.
 */
describe('session signatures', () => {
    const secret = 'a'.repeat(32);
    const payload = 'token123:session456:2030-01-01T00:00:00.000Z';

    it('verifies a signature it produced', () => {
        const sig = signSessionToken(payload, secret);
        expect(verifySessionSignature(payload, sig, secret)).toBe(true);
    });

    it('rejects a signature made with a different secret', () => {
        const sig = signSessionToken(payload, 'b'.repeat(32));
        expect(verifySessionSignature(payload, sig, secret)).toBe(false);
    });

    it('rejects a signature for a different payload', () => {
        // The forgery that matters: reusing a captured signature for another session id
        // or a later expiry.
        const sig = signSessionToken(payload, secret);
        const tampered = 'token123:session456:2099-01-01T00:00:00.000Z';
        expect(verifySessionSignature(tampered, sig, secret)).toBe(false);
    });

    it.each([
        [undefined],
        [null],
        [''],
        ['not-a-signature'],
        [12345],
        [{}],
    ])('rejects a malformed signature %j', (sig) => {
        expect(verifySessionSignature(payload, sig, secret)).toBe(false);
    });

    it('produces a url-safe signature', () => {
        // base64url, so the value survives being embedded in JSON and in a key.
        expect(signSessionToken(payload, secret)).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('is deterministic', () => {
        expect(signSessionToken(payload, secret)).toBe(signSessionToken(payload, secret));
    });
});
