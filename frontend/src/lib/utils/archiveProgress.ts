import type { ArchiveProgress } from '@/lib/api/media';
import { formatFileSize } from './format';
import { pluralize } from './pluralize';

/**
 * How the server's archive readout is turned into what the download panel shows.
 *
 * Separate from DownloadProvider so it can be tested as the plain functions it is
 * — the provider around it is all timers, form navigations and browser handoff.
 */

/** Statuses an archive never moves on from. */
const TERMINAL_STATUSES: ReadonlyArray<ArchiveProgress['status']> = [
    'completed',
    'failed',
    'cancelled',
];

export function isArchiveFinished(status: ArchiveProgress['status']): boolean {
    return TERMINAL_STATUSES.includes(status);
}

/**
 * Percentage for an archive.
 *
 * Bytes when the server could size the selection, entries otherwise. Capped below
 * 100 while the download is live: the byte total is the sum of the originals and
 * the zip framing adds a little on top, so the last stretch would otherwise sit at
 * "100%" for as long as it takes to finish. Completion sets 100 on its own.
 */
export function archivePercent(progress: ArchiveProgress): number {
    const ratio = progress.totalBytes > 0
        ? progress.sentBytes / progress.totalBytes
        : progress.totalItems > 0
            ? progress.completedItems / progress.totalItems
            : 0;
    return Math.max(0, Math.min(99, Math.round(ratio * 100)));
}

/**
 * The line under the file name: how much of the selection has been packed, and
 * how many bytes of it have arrived.
 *
 * A zip is a single row covering a whole selection, so without this the panel can
 * only say that something is downloading — the counts are the part that tells a
 * user a 40-photo download is moving rather than stuck.
 */
export function archiveDetail(progress: ArchiveProgress): string {
    /**
     * Accepted, nothing written yet. Neither byte total nor entry count means
     * anything so early, but the size of the selection does — and it is what tells
     * the user the right photos are on their way.
     */
    if (progress.status === 'preparing') {
        return progress.totalItems > 0 ? pluralize(progress.totalItems, 'file') : 'Preparing…';
    }

    const size = progress.totalBytes > 0 ? formatFileSize(progress.totalBytes) : '';

    // A finished zip has no "of" left to report; it is simply what it is.
    if (progress.status === 'completed') {
        const files = pluralize(progress.totalItems, 'file');
        return size ? `${files} · ${size}` : files;
    }

    const files = `${progress.completedItems} of ${pluralize(progress.totalItems, 'file')}`;
    return size ? `${files} · ${formatFileSize(progress.sentBytes)} of ${size}` : files;
}
