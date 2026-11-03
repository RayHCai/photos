import { describe, expect, it, vi } from 'vitest';

// The real env refuses to load without a database URL and AWS credentials, and
// the logger (reached through AppError's module) reads its level from it.
vi.mock('../config/env.js', () => ({
    env: { SESSION_SIGNING_SECRET: 'test-secret-that-is-at-least-32-characters-long' },
}));
vi.mock('./logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
    signUploadToken,
    verifyUploadToken,
    signContributionToken,
    verifyContributionToken,
} = await import('./uploadToken.js');

const claims = {
    key: 'originals/2026/11/0189cf9e-4d3a-7c11-9a5e-2b1f6c8d4e70.jpg',
    fileName: 'beach.jpg',
    mimeType: 'image/jpeg',
    fileSize: 1234,
};

describe('upload tokens', () => {
    it('round-trips a library upload token', () => {
        expect(verifyUploadToken(signUploadToken(claims))).toEqual(claims);
    });

    it('round-trips a guest upload token', () => {
        const guest = { ...claims, contributionId: 'c1' };
        expect(verifyContributionToken(signContributionToken(guest))).toEqual(guest);
    });

    /**
     * The point of the separate domains: the owner's confirm route turns whatever
     * key it is handed into a library item, so a guest's token reaching it would
     * skip review entirely.
     */
    it('refuses a guest token on the library route', () => {
        const guest = signContributionToken({ ...claims, contributionId: 'c1' });
        expect(() => verifyUploadToken(guest)).toThrow('Invalid upload token');
    });

    it('refuses a library token on the guest route', () => {
        expect(() => verifyContributionToken(signUploadToken(claims))).toThrow('Invalid upload token');
    });

    it('refuses a token whose claims were edited', () => {
        const [, signature] = signUploadToken(claims).split('.');
        const forged = Buffer.from(JSON.stringify({ ...claims, key: 'originals/x.jpg', exp: 9e9 }))
            .toString('base64url');
        expect(() => verifyUploadToken(`${forged}.${signature}`)).toThrow('Invalid upload token');
    });
});
