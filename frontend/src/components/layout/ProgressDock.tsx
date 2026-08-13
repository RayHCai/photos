'use client';

import { UploadProgress } from '@/components/upload/UploadProgress';
import { DownloadProgress } from '@/components/download/DownloadProgress';

/**
 * Stacks the transfer panels in one container.
 *
 * Both panels were mounted independently at `fixed bottom-5 right-5`, differing only in
 * z-index (`z-50` vs `z-40`) and neither offsetting for the other — so in a perfectly
 * ordinary session (download some photos, then drag in new ones) the download panel sat
 * exactly on top of the upload panel, hiding its per-file errors and retry indicator
 * completely.
 *
 * A flex column means each panel only has to size itself, and adding a third kind of
 * transfer later needs no coordinate arithmetic.
 */
export function ProgressDock() {
    return (
        <div className="fixed bottom-5 right-5 z-50 flex flex-col-reverse gap-3 items-end pointer-events-none">
            {/* Children re-enable pointer events; the container must not swallow clicks
                on the page behind it when both panels are empty. */}
            <div className="pointer-events-auto">
                <UploadProgress />
            </div>
            <div className="pointer-events-auto">
                <DownloadProgress />
            </div>
        </div>
    );
}
