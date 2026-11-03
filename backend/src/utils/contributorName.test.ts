import { describe, expect, it } from 'vitest';
import { cleanContributorName } from './contributorName.js';

describe('cleanContributorName', () => {
    it.each([undefined, null, '', '   ', '\n\t'])('treats %j as no name', (raw) => {
        expect(cleanContributorName(raw)).toBeNull();
    });

    it('trims and collapses whitespace', () => {
        expect(cleanContributorName('  Sam   Lee ')).toBe('Sam Lee');
    });

    it('drops control characters that would split a log line or a header', () => {
        expect(cleanContributorName('Sam\r\nBcc: someone@example.com')).toBe(
            'Sam Bcc: someone@example.com'
        );
    });

    it('caps the length', () => {
        expect(cleanContributorName('x'.repeat(500))).toHaveLength(60);
    });
});
