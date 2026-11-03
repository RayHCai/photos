import { describe, expect, it } from 'vitest';
import {
    buildUploadDigest,
    describeContributors,
    describeCounts,
    escapeHtml,
    reviewUrl,
    summarizeUploads,
    type DigestUpload,
} from './uploadDigest.js';

const upload = (overrides: Partial<DigestUpload> = {}): DigestUpload => ({
    collectionId: 'c1',
    collectionName: 'Beach Trip',
    linkName: null,
    contributorName: 'Sam',
    mimeType: 'image/jpeg',
    status: 'PENDING',
    ...overrides,
});

describe('describeCounts', () => {
    it.each([
        [1, 0, '1 photo'],
        [3, 0, '3 photos'],
        [0, 1, '1 video'],
        [2, 1, '2 photos and 1 video'],
    ])('%i photos and %i videos reads "%s"', (photos, videos, expected) => {
        expect(describeCounts(photos, videos)).toBe(expected);
    });
});

describe('describeContributors', () => {
    it('falls back to "Someone" when nobody gave a name', () => {
        expect(describeContributors([], true)).toBe('Someone');
    });

    it('mentions an unnamed guest alongside named ones', () => {
        expect(describeContributors(['Sam'], true)).toBe('Sam and someone else');
    });

    it('lists up to three names', () => {
        expect(describeContributors(['Sam', 'Alex', 'Jo'], false)).toBe('Sam, Alex and Jo');
    });

    it('collapses the rest into a count', () => {
        expect(describeContributors(['A', 'B', 'C', 'D', 'E'], false)).toBe('A, B, C and 2 others');
    });
});

describe('summarizeUploads', () => {
    it('groups per album, busiest first, and counts what is still waiting', () => {
        const albums = summarizeUploads([
            upload({ collectionId: 'small', collectionName: 'Small' }),
            upload({ mimeType: 'video/mp4', status: 'APPROVED' }),
            upload({ contributorName: null, linkName: 'Family chat' }),
            upload({ contributorName: 'Alex' }),
        ]);

        expect(albums.map((a) => a.collectionId)).toEqual(['c1', 'small']);
        expect(albums[0]).toMatchObject({
            photos: 2,
            videos: 1,
            contributors: ['Sam', 'Alex'],
            hasAnonymous: true,
            links: ['Family chat'],
            waiting: 2,
        });
    });
});

describe('buildUploadDigest', () => {
    const opts = { appUrl: 'https://photos.example.com/' };

    it('names the album in the subject when there is only one', () => {
        const digest = buildUploadDigest([upload(), upload()], opts);
        expect(digest.subject).toBe('2 new uploads to Beach Trip');
    });

    it('counts albums in the subject when there are several', () => {
        const digest = buildUploadDigest(
            [upload(), upload({ collectionId: 'c2', collectionName: 'Wedding' })],
            opts
        );
        expect(digest.subject).toBe('2 new uploads across 2 albums');
    });

    it('links each album with its change log open', () => {
        const digest = buildUploadDigest([upload()], opts);
        expect(digest.text).toContain('Review: https://photos.example.com/collections/c1?activity=1');
        expect(digest.html).toContain('href="https://photos.example.com/collections/c1?activity=1"');
    });

    it('escapes guest-supplied names in the HTML part', () => {
        const digest = buildUploadDigest(
            [upload({ contributorName: '<a href="https://evil.example">click</a>' })],
            opts
        );
        expect(digest.html).not.toContain('<a href="https://evil.example">');
        expect(digest.html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;');
    });

    it('says when everything has already been reviewed', () => {
        const digest = buildUploadDigest([upload({ status: 'REJECTED' })], opts);
        expect(digest.text).toContain('All of them have been reviewed already.');
    });

    it('says the uploads are already in the album', () => {
        expect(buildUploadDigest([upload(), upload()], opts).text).toContain(
            'They are in the album now, waiting for you to approve them into your library.'
        );
    });
});

describe('reviewUrl', () => {
    it('encodes the album id and tolerates a trailing slash', () => {
        expect(reviewUrl('https://x.test//', 'a b')).toBe('https://x.test/collections/a%20b?activity=1');
    });
});

describe('escapeHtml', () => {
    it('escapes every character that can break out of text or an attribute', () => {
        expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    });
});
