'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Check, FileImage, PlayCircle, Trash2, X } from 'lucide-react';
import { thumbnailUrlFromKey } from '@/lib/api/media';
import {
    useApproveContributions,
    useEventUploads,
    useRejectContributions,
} from '@/lib/hooks/useContributions';
import { formatFileSize } from '@/lib/utils/format';
import { pluralize } from '@/lib/utils/pluralize';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Spinner } from '@/components/ui/Spinner';
import { EventTime } from './ActivityDrawer';
import type { CollectionEvent, EventUpload, ReviewState } from '@/lib/types/contributions';

interface EventUploadsModalProps {
    collectionId: string;
    /** The upload entry to review; null keeps the modal closed. */
    event: CollectionEvent | null;
    onClose: () => void;
}

const STATE_LABELS: Record<ReviewState, string> = {
    pending: 'Waiting for review',
    approved: 'Approved',
    denied: 'Denied',
    removed: 'Deleted',
};

const STATE_BADGES: Record<Exclude<ReviewState, 'pending'>, string> = {
    approved: 'bg-emerald-600 text-white',
    denied: 'bg-stone-700 text-white',
    removed: 'bg-stone-700 text-white',
};

/**
 * Every file in one guest upload, each with its own approve and deny. Approving
 * adds a file to the library (it is in the album already); denying deletes it.
 */
export function EventUploadsModal({ collectionId, event, onClose }: EventUploadsModalProps) {
    const { data: uploads, isLoading } = useEventUploads(collectionId, event?.id ?? null);
    const approve = useApproveContributions();
    const reject = useRejectContributions();

    /** Files with a decision in flight, so each tile can wait on its own. */
    const [deciding, setDeciding] = useState<Set<string>>(new Set());
    const decide = useCallback(
        (ids: string[], verdict: 'approve' | 'deny', onSuccess?: () => void) => {
            setDeciding((prev) => new Set([...prev, ...ids]));
            const settle = () =>
                setDeciding((prev) => {
                    const next = new Set(prev);
                    for (const id of ids) next.delete(id);
                    return next;
                });
            const mutation = verdict === 'approve' ? approve : reject;
            mutation.mutate(ids, { onSuccess, onSettled: settle });
        },
        [approve, reject]
    );

    const pending = uploads?.filter((u) => u.state === 'pending') ?? [];

    return (
        <Dialog
            open={event !== null}
            onClose={onClose}
            maxWidth="max-w-3xl"
            scrollable
            header={
                event && (
                    <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-stone-200">
                        <div className="min-w-0">
                            <h2 className="text-lg font-serif text-stone-900">
                                {pluralize(event.itemCount, 'file')} uploaded
                            </h2>
                            <p className="text-xs text-stone-400 mt-0.5">
                                {event.shareLink && <>via {event.shareLink.label || `/s/${event.shareLink.slug}`} · </>}
                                <EventTime at={event.createdAt} />
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-1 rounded hover:bg-stone-200 text-stone-400 hover:text-stone-600 transition-colors"
                            aria-label="Close"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                )
            }
            footer={
                pending.length > 0 && (
                    <div className="flex items-center justify-end gap-3">
                        {(
                            <Button
                                size="sm"
                                disabled={pending.some((u) => deciding.has(u.id))}
                                onClick={() =>
                                    decide(
                                        pending.map((u) => u.id),
                                        'approve',
                                        () => toast.success(`Added ${pluralize(pending.length, 'file')} to your library`)
                                    )
                                }
                            >
                                <Check className="w-4 h-4" />
                                {pending.length === 1 ? 'Approve' : `Approve all ${pending.length}`}
                            </Button>
                        )}
                    </div>
                )
            }
        >
            {isLoading || !uploads ? (
                <div className="flex justify-center py-10">
                    <Spinner className="w-6 h-6" />
                </div>
            ) : (
                <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {uploads.map((upload) => (
                        <UploadTile
                            key={upload.id}
                            upload={upload}
                            busy={deciding.has(upload.id)}
                            onApprove={() => decide([upload.id], 'approve')}
                            onDeny={() => decide([upload.id], 'deny')}
                        />
                    ))}
                </ul>
            )}
        </Dialog>
    );
}

function UploadTile({
    upload,
    busy,
    onApprove,
    onDeny,
}: {
    upload: EventUpload;
    busy: boolean;
    onApprove: () => void;
    onDeny: () => void;
}) {
    return (
        <li className="flex flex-col gap-1.5 min-w-0">
            <div className="relative aspect-square bg-stone-200 rounded-sm overflow-hidden">
                <UploadPreview upload={upload} />
                {upload.state !== 'pending' && (
                    <span
                        className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${STATE_BADGES[upload.state]}`}
                    >
                        {STATE_LABELS[upload.state]}
                    </span>
                )}
            </div>
            <p className="text-xs text-stone-600 truncate" title={upload.fileName}>
                {upload.fileName}
                <span className="text-stone-400"> · {formatFileSize(upload.fileSize)}</span>
            </p>
            {upload.state === 'pending' && (
                <div className="flex gap-1.5">
                    <Button
                        variant="secondary"
                        size="sm"
                        className="flex-1"
                        disabled={busy}
                        onClick={onDeny}
                        title="Deny: delete it from the album"
                    >
                        <X className="w-3.5 h-3.5" />
                        Deny
                    </Button>
                    <Button
                        size="sm"
                        className="flex-1"
                        disabled={busy}
                        onClick={onApprove}
                        title="Approve: add it to your library"
                    >
                        <Check className="w-3.5 h-3.5" />
                        Approve
                    </Button>
                </div>
            )}
        </li>
    );
}

/**
 * The file's thumbnail, or its original while the worker has not made one (the
 * thumbnail endpoint serves that for a guest's photo). A video without its
 * poster yet, a format the browser cannot decode, or a deleted file gets a
 * placeholder.
 */
function UploadPreview({ upload }: { upload: EventUpload }) {
    const [failed, setFailed] = useState(false);
    const showable =
        upload.mediaItemId && !failed && (upload.thumbnailKey || upload.type === 'PHOTO');

    if (showable) {
        return (
            <img
                src={thumbnailUrlFromKey(upload.thumbnailKey, upload.mediaItemId!)}
                alt={upload.fileName}
                loading="lazy"
                decoding="async"
                draggable={false}
                onError={() => setFailed(true)}
                className={`w-full h-full object-cover ${upload.state === 'pending' || upload.state === 'approved' ? '' : 'opacity-40'}`}
            />
        );
    }

    const Icon = !upload.mediaItemId ? Trash2 : upload.type === 'VIDEO' ? PlayCircle : FileImage;
    return (
        <div className="w-full h-full flex items-center justify-center text-stone-400">
            <Icon className="w-7 h-7" aria-hidden="true" />
        </div>
    );
}
