'use client';

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    getStorageStats,
    enqueuePending,
    retryFailed,
    backfillBlurHashes,
    backfillAllBlurHashes,
    fixOrphanedProcessing,
    triggerRecluster,
    rerunMissingFaces,
    backfillTranscoding,
} from '@/lib/api/jobs';
import { Spinner } from '@/components/ui/Spinner';
import { toast } from 'sonner';

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

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
    const { data: storageStats, isLoading: storageLoading } = useQuery({
        queryKey: ['storage-stats'],
        queryFn: getStorageStats,
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
                toast.success(`Retrying ${count} items`);
            },
        },
        {
            label: 'Fix Orphaned Processing',
            description: 'Reset items stuck in PROCESSING status back to PENDING',
            onClick: async () => {
                const { count } = await fixOrphanedProcessing();
                toast.success(`Fixed ${count} items`);
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
            label: 'Transcode Videos',
            description: 'Convert all videos to web-optimized MP4 for faster streaming',
            onClick: async () => {
                const { count } = await backfillTranscoding();
                toast.success(`Enqueued ${count} videos for transcoding`);
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
        <div className="h-screen flex flex-col">
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
                                        {formatBytes(totalBytes)}
                                    </p>
                                    <p className="text-xs text-stone-400 mt-1">Total stored</p>
                                </div>
                                <div className="p-4 rounded-xl bg-stone-50 border border-stone-100">
                                    <p className="text-2xl font-light text-stone-800 tracking-tight">
                                        {totalItems.toLocaleString()}
                                    </p>
                                    <p className="text-xs text-stone-400 mt-1">Total items</p>
                                </div>
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
