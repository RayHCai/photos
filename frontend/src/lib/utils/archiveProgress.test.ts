import { describe, expect, it } from 'vitest';
import { archiveDetail, archivePercent, isArchiveFinished } from './archiveProgress';
import type { ArchiveProgress } from '@/lib/api/media';

function progress(overrides: Partial<ArchiveProgress> = {}): ArchiveProgress {
    return {
        status: 'streaming',
        totalItems: 40,
        completedItems: 12,
        totalBytes: 1_000_000,
        sentBytes: 250_000,
        fileName: 'photos-2026-09-08-40-items.zip',
        ...overrides,
    };
}

describe('archivePercent', () => {
    it('counts bytes when the selection could be sized', () => {
        expect(archivePercent(progress())).toBe(25);
    });

    it('falls back to entries when no byte total is known', () => {
        // Every original missing a recorded size; the row still has to move.
        expect(archivePercent(progress({ totalBytes: 0, sentBytes: 0 }))).toBe(30);
    });

    it('stays under 100 while the download is live', () => {
        // The byte total is the sum of the originals, and the zip framing adds a
        // little on top — so a live download can genuinely exceed it, and would
        // otherwise sit at "100%" for however long the finish takes.
        expect(archivePercent(progress({ sentBytes: 1_050_000 }))).toBe(99);
    });

    it('is zero for a selection with nothing to count either way', () => {
        expect(
            archivePercent(progress({ totalBytes: 0, sentBytes: 0, totalItems: 0 }))
        ).toBe(0);
    });
});

describe('archiveDetail', () => {
    it('says how much of the selection is packed and how much has arrived', () => {
        expect(archiveDetail(progress())).toBe('12 of 40 files · 244.1 KB of 976.6 KB');
    });

    it('sizes a request that has been accepted but not started', () => {
        // The server has the request and has not opened its first object, so
        // neither counter means anything yet — but the size of the selection tells
        // the user the right photos are on their way.
        expect(archiveDetail(progress({ status: 'preparing' }))).toBe('40 files');
    });

    it('says something even before the selection size is known', () => {
        expect(archiveDetail(progress({ status: 'preparing', totalItems: 0 }))).toBe('Preparing…');
    });

    it('drops the byte half when there is no total to compare against', () => {
        expect(archiveDetail(progress({ totalBytes: 0, sentBytes: 0 }))).toBe('12 of 40 files');
    });

    it('states a finished zip rather than counting towards it', () => {
        expect(archiveDetail(progress({ status: 'completed' }))).toBe('40 files · 976.6 KB');
    });

    it('keeps a one-item selection grammatical', () => {
        expect(
            archiveDetail(progress({ status: 'completed', totalItems: 1, totalBytes: 0 }))
        ).toBe('1 file');
    });
});

describe('isArchiveFinished', () => {
    it('stops the poll on every status the server will not move on from', () => {
        expect(isArchiveFinished('completed')).toBe(true);
        expect(isArchiveFinished('failed')).toBe(true);
        expect(isArchiveFinished('cancelled')).toBe(true);
    });

    it('keeps polling while the archive is still being written', () => {
        expect(isArchiveFinished('preparing')).toBe(false);
        expect(isArchiveFinished('streaming')).toBe(false);
    });
});
