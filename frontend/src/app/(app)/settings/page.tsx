'use client';

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    getStorageStats,
    getProcessingStats,
    enqueuePending,
    retryFailed,
    backfillBlurHashes,
    backfillAllBlurHashes,
    fixOrphanedProcessing,
    triggerRecluster,
    rerunMissingFaces,
    backfillTranscoding,
    backfillWebOptimized,
    backfillThumbnailLadder,
    backfillThumbnailLadderVideos,
    backfillMissingThumbnailLadders,
    auditThumbnailLadders,
    backfillGeocoding,
    backfillMetadata,
    backfillTakenAt,
} from '@/lib/api/jobs';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from 'sonner';
import { formatFileSize } from '@/lib/utils/format';
import { pluralize } from '@/lib/utils/pluralize';
import { invalidationsFor } from '@/lib/queries/keys';

interface ActionButtonProps {
    label: string;
    description: string;
    onClick: () => Promise<void>;
}

function ActionButton({ label, description, onClick }: ActionButtonProps) {
    const [loading, setLoading] = useState(false);

    const handleClick = useCallback(async () => {
        setLoading(true);
        try {
            await onClick();
        }
        finally {
            setLoading(false);
        }
    }, [onClick]);

    return (
        <button
            onClick={handleClick}
            disabled={loading}
            className="text-left p-4 rounded-xl border border-stone-200 hover:border-stone-300 hover:bg-stone-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
            <div className="flex items-center justify-between gap-3">
                <div>
                    <p className="text-sm font-medium text-stone-800">{label}</p>
                    <p className="text-xs text-stone-400 mt-0.5">{description}</p>
                </div>
                {loading && <Spinner className="w-4 h-4 flex-shrink-0" />}
            </div>
        </button>
    );
}

export default function SettingsPage() {
    const queryClient = useQueryClient();

    const { data: storageStats, isLoading: storageLoading } = useQuery({
        queryKey: ['storage-stats'],
        queryFn: getStorageStats,
    });

    const { data: processingStats } = useQuery({
        queryKey: ['processing-stats'],
        queryFn: getProcessingStats,
        refetchInterval: 10_000,
    });

    const actions: ActionButtonProps[] = [
        {
            label: 'Enqueue Pending',
            description: 'Queue all pending media items for processing',
            onClick: async () => {
                const { count } = await enqueuePending();
                toast.success(`Enqueued ${count} items`);
            },
        },
        {
            label: 'Retry Failed',
            description: 'Re-queue all failed media items for reprocessing',
            onClick: async () => {
                const { count } = await retryFailed();
                toast.success(`Retrying ${pluralize(count, 'item')}`);
            },
        },
        {
            label: 'Fix Orphaned Processing',
            description:
                'Reconcile items stuck in PROCESSING: complete the ones that actually finished, fail the rest so they can be retried',
            onClick: async () => {
                const { count } = await fixOrphanedProcessing();
                toast.success(`Reconciled ${pluralize(count, 'item')}`);
            },
        },
        {
            label: 'Backfill Capture Dates',
            description:
                'Set the capture date to the upload date for any item that has none. Without one, a photo sorts behind the entire library and never reaches the gallery, even though it still shows up under People.',
            onClick: async () => {
                const { count } = await backfillTakenAt();
                if (count === 0) {
                    toast.success('No items were missing a capture date');
                    return;
                }
                // Unlike the enqueue-style actions, this one has already changed the
                // rows by the time it answers — so the cached gallery pages and
                // timeline are stale right now, not eventually.
                for (const key of invalidationsFor(['media-content'])) {
                    queryClient.invalidateQueries({ queryKey: key }).catch(() => undefined);
                }
                toast.success(`Dated ${pluralize(count, 'item')}`);
            },
        },
        {
            label: 'Backfill Blur Hashes',
            description: 'Generate blur hashes for completed items missing them',
            onClick: async () => {
                const { count } = await backfillBlurHashes();
                toast.success(`Enqueued ${count} items for blur hash`);
            },
        },
        {
            label: 'Backfill All Blur Hashes',
            description: 'Regenerate blur hashes for all items missing them',
            onClick: async () => {
                const { count } = await backfillAllBlurHashes();
                toast.success(`Enqueued ${count} items for blur hash`);
            },
        },
        {
            label: 'Re-run Missing Faces',
            description: 'Detect faces on all completed items that have no faces',
            onClick: async () => {
                const { count } = await rerunMissingFaces();
                toast.success(`Enqueued ${count} items for face detection`);
            },
        },
        {
            label: 'Generate Web Images',
            description: 'Create web-optimized versions of all photos for faster lightbox viewing',
            onClick: async () => {
                const { count } = await backfillWebOptimized();
                toast.success(`Enqueued ${count} photos for web optimization`);
            },
        },
        {
            label: 'Check Thumbnail Coverage',
            description:
                'Report how many items are missing responsive thumbnail sizes, without changing anything. Lists the bucket and compares it against the library, which takes a few seconds.',
            onClick: async () => {
                const audit = await auditThumbnailLadders();
                if (audit.incomplete === 0) {
                    toast.success(
                        `All ${pluralize(audit.total, 'item')} have a complete thumbnail ladder`
                    );
                    return;
                }
                toast.warning(
                    `${pluralize(audit.incomplete, 'item')} incomplete of ${audit.total}` +
                        ` — ${audit.missingSome} partial, ${audit.missingAll} with no sizes at all`
                );
            },
        },
        {
            label: 'Repair Missing Thumbnail Sizes',
            description:
                'Regenerate responsive sizes for only the items that are actually missing them. Prefer this over the two below: it re-encodes a handful of items instead of the whole library.',
            onClick: async () => {
                const audit = await backfillMissingThumbnailLadders();
                if (audit.enqueued === 0) {
                    toast.success(
                        `Nothing to repair — all ${pluralize(audit.total, 'item')} are complete`
                    );
                    return;
                }
                toast.success(
                    `Repairing ${pluralize(audit.enqueued, 'item')}` +
                        ` (${audit.missingSome} partial, ${audit.missingAll} with no sizes at all)`
                );
            },
        },
        {
            label: 'Backfill Thumbnail Ladder',
            description:
                'Regenerate responsive thumbnail sizes (200/400/800px) for all photos and videos. Re-enqueues every completed item — use the targeted repair above unless you want to force a full rebuild.',
            onClick: async () => {
                const { count } = await backfillThumbnailLadder();
                toast.success(`Enqueued ${pluralize(count, 'item')} for thumbnail ladder`);
            },
        },
        {
            label: 'Backfill Thumbnail Ladder (Videos)',
            description:
                'The same job scoped to videos, which are the only items that ever shipped without a ladder. Slower per item than photos — each one is downloaded and a poster frame pulled with ffmpeg.',
            onClick: async () => {
                // No count in the toast: the bulk endpoints answer 202 the moment the
                // job is accepted and page over the library afterwards, so there is no
                // total to report yet. Watch the pending counter for progress.
                await backfillThumbnailLadderVideos();
                toast.success('Video thumbnail ladder backfill started');
            },
        },
        {
            label: 'Transcode Videos',
            description: 'Convert all videos to web-optimized MP4 for faster streaming',
            onClick: async () => {
                const { count } = await backfillTranscoding();
                toast.success(`Enqueued ${count} videos for transcoding`);
            },
        },
        {
            label: 'Re-extract Metadata',
            description: 'Re-extract EXIF metadata (GPS, camera, dates) from originals for items missing location data',
            onClick: async () => {
                const { count } = await backfillMetadata();
                toast.success(`Enqueued ${count} items for metadata extraction`);
            },
        },
        {
            label: 'Backfill Location Data',
            description: 'Reverse geocode all media with GPS coordinates but no city/country',
            onClick: async () => {
                await backfillGeocoding();
                toast.success('Geocoding backfill job enqueued');
            },
        },
        {
            label: 'Recluster Faces',
            description: 'Run HDBSCAN clustering to merge and reassign face groups',
            onClick: async () => {
                await triggerRecluster();
                toast.success('Face recluster job enqueued');
            },
        },
    ];

    const totalBytes = storageStats ? Number(storageStats.totalBytes) : 0;
    const totalItems = storageStats?.totalItems ?? 0;

    return (
        <div className="h-[100dvh] flex flex-col">
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-lg mx-auto px-6 py-16 space-y-10">
                    {/* Storage Stats */}
                    <section>
                        <h2 className="font-serif text-sm text-stone-400 mb-4">Storage</h2>
                        {storageLoading ? (
                            <div className="flex justify-center py-8">
                                <Spinner className="w-5 h-5" />
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 rounded-xl bg-stone-50 border border-stone-100">
                                    <p className="text-2xl font-light text-stone-800 tracking-tight">
                                        {formatFileSize(totalBytes)}
                                    </p>
                                    <p className="text-xs text-stone-400 mt-1">Total stored</p>
                                </div>
                                <div className="p-4 rounded-xl bg-stone-50 border border-stone-100">
                                    <p className="text-2xl font-light text-stone-800 tracking-tight">
                                        {totalItems.toLocaleString()}
                                    </p>
                                    <p className="text-xs text-stone-400 mt-1">Total items</p>
                                </div>
                                {!!processingStats?.pending && (
                                    <div className="p-4 rounded-xl bg-blue-50 border border-blue-200">
                                        <p className="text-2xl font-light text-blue-700 tracking-tight">
                                            {processingStats.pending.toLocaleString()}
                                        </p>
                                        <p className="text-xs text-blue-500 mt-1">Pending</p>
                                    </div>
                                )}
                                {!!processingStats?.processing && (
                                    <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
                                        <p className="text-2xl font-light text-amber-700 tracking-tight">
                                            {processingStats.processing.toLocaleString()}
                                        </p>
                                        <p className="text-xs text-amber-500 mt-1">Processing</p>
                                    </div>
                                )}
                                {!!processingStats?.failed && (
                                    <div className="p-4 rounded-xl bg-red-50 border border-red-200">
                                        <p className="text-2xl font-light text-red-700 tracking-tight">
                                            {processingStats.failed.toLocaleString()}
                                        </p>
                                        <p className="text-xs text-red-500 mt-1">Failed</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </section>

                    {/* Admin Actions */}
                    <section>
                        <h2 className="font-serif text-sm text-stone-400 mb-4">Service Actions</h2>
                        <div className="grid grid-cols-1 gap-2">
                            {actions.map((action) => (
                                <ActionButton key={action.label} {...action} />
                            ))}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
