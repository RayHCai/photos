'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, Loader2, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { guestUploadEndpoints, uploadFile } from '@/lib/api/upload';
import { ApiError } from '@/lib/api/client';
import { FILE_INPUT_ACCEPT } from '@/lib/constants/mediaFormats';
import { filterMediaFiles } from '@/lib/utils/mediaFiles';
import { pluralize } from '@/lib/utils/pluralize';
import { IconButton } from '@/components/ui/IconButton';
import { UploadMenu } from '@/components/upload/UploadMenu';
import { PROGRESS_DOCK_SLOT_ID } from '@/components/layout/ProgressDock';
import type { SharedCollection } from '@/lib/types/share';

/** Fewer than the library's uploader: a guest is often on a phone, on someone else's Wi-Fi. */
const CONCURRENCY = 3;

const UPLOADS_PAUSED = 'Uploads are paused right now. Try again later.';

/** How often a running batch refreshes the album, so files appear as they finish. */
const REFRESH_EVERY_MS = 4000;

type Status = 'queued' | 'uploading' | 'retrying' | 'done' | 'failed';

interface GuestUploadItem {
    id: string;
    fileName: string;
    size: number;
    status: Status;
    progress: number;
    error?: string;
}

interface QueuedFile {
    id: string;
    file: File;
}

function errorMessage(err: unknown): string {
    if (err instanceof ApiError || err instanceof Error) return err.message;
    return 'Upload failed';
}

/**
 * The upload queue for one share link. Kept local to the page rather than in the
 * app's UploadProvider: a guest has no library, and nothing here should
 * invalidate or mention one.
 */
function useGuestUploadQueue(slug: string) {
    const queryClient = useQueryClient();
    const [items, setItems] = useState<GuestUploadItem[]>([]);
    const waiting = useRef<QueuedFile[]>([]);
    const controllers = useRef(new Map<string, AbortController>());
    const active = useRef(0);

    /**
     * Each finished file is already in the album, so the album, its count, the
     * space left and the change log are refetched as a batch goes — but at most
     * every few seconds, not once per file of a 500-photo folder.
     */
    const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const refreshAlbum = useCallback(() => {
        if (refreshTimer.current) return;
        refreshTimer.current = setTimeout(() => {
            refreshTimer.current = null;
            queryClient.invalidateQueries({ queryKey: ['share', slug] }).catch(() => undefined);
        }, REFRESH_EVERY_MS);
    }, [queryClient, slug]);
    useEffect(() => () => {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
    }, []);

    const update = useCallback((id: string, patch: Partial<GuestUploadItem>) => {
        setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    }, []);

    const run = useCallback(
        async ({ id, file }: QueuedFile) => {
            const controller = new AbortController();
            controllers.current.set(id, controller);
            update(id, { status: 'uploading' });
            try {
                await uploadFile(
                    file,
                    (progress) => update(id, { progress, status: 'uploading' }),
                    undefined,
                    () => update(id, { status: 'retrying' }),
                    controller.signal,
                    guestUploadEndpoints(slug)
                );
                update(id, { status: 'done', progress: 100 });
                refreshAlbum();
            }
            catch (err) {
                if (controller.signal.aborted) return;
                const message = errorMessage(err);
                update(id, { status: 'failed', error: message });

                // Out of space, too many waiting, or the worker went away:
                // everything still queued would be refused the same way, so say
                // so once instead of N times.
                if (err instanceof ApiError && (err.status === 413 || err.status === 429 || err.status === 503)) {
                    const refused = waiting.current.splice(0);
                    if (refused.length > 0) {
                        const ids = new Set(refused.map((q) => q.id));
                        setItems((prev) =>
                            prev.map((item) =>
                                ids.has(item.id) ? { ...item, status: 'failed', error: message } : item
                            )
                        );
                    }
                    toast.error(message);
                    // Refetch the link so the button greys out until uploads reopen.
                    if (err.status === 503) {
                        queryClient.invalidateQueries({ queryKey: ['share', slug, 'meta'] }).catch(() => undefined);
                    }
                }
            }
            finally {
                controllers.current.delete(id);
            }
        },
        [queryClient, refreshAlbum, slug, update]
    );

    const pump = useCallback(() => {
        while (active.current < CONCURRENCY && waiting.current.length > 0) {
            const next = waiting.current.shift()!;
            active.current++;
            // run() settles every outcome itself, so nothing reaches this catch.
            run(next)
                .catch(() => undefined)
                .finally(() => {
                    active.current--;
                    if (active.current === 0 && waiting.current.length === 0) {
                        // The batch settled: show the last of it now, and the
                        // space left after any failures gave theirs back.
                        if (refreshTimer.current) clearTimeout(refreshTimer.current);
                        refreshTimer.current = null;
                        queryClient
                            .invalidateQueries({ queryKey: ['share', slug] })
                            .catch(() => undefined);
                    }
                    pump();
                });
        }
    }, [queryClient, run, slug]);

    const enqueue = useCallback(
        (files: File[]) => {
            const queued = files.map((file) => ({ id: crypto.randomUUID(), file }));
            setItems((prev) => [
                ...prev,
                ...queued.map(({ id, file }) => ({
                    id,
                    fileName: file.name,
                    size: file.size,
                    status: 'queued' as const,
                    progress: 0,
                })),
            ]);
            waiting.current.push(...queued);
            pump();
        },
        [pump]
    );

    const remove = useCallback((id: string) => {
        controllers.current.get(id)?.abort();
        waiting.current = waiting.current.filter((q) => q.id !== id);
        setItems((prev) => prev.filter((item) => item.id !== id));
    }, []);

    const clearFinished = useCallback(() => {
        setItems((prev) => prev.filter((item) => item.status !== 'done' && item.status !== 'failed'));
    }, []);

    return { items, enqueue, remove, clearFinished };
}

interface GuestUploadProps {
    slug: string;
    limits: NonNullable<SharedCollection['upload']>;
}

/**
 * The library's upload menu on a shared album. Each file joins the album as soon
 * as it finishes; the owner later decides whether it also joins their library.
 */
export function GuestUpload({ slug, limits }: GuestUploadProps) {
    const { items, enqueue, remove, clearFinished } = useGuestUploadQueue(slug);

    const pick = useCallback(
        (directory: boolean) => {
            if (!limits.workerOnline) {
                toast.error(UPLOADS_PAUSED);
                return;
            }

            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = FILE_INPUT_ACCEPT;
            if (directory) input.setAttribute('webkitdirectory', '');
            input.onchange = () => {
                const chosen = Array.from(input.files ?? []);
                if (chosen.length === 0) return;

                const media = filterMediaFiles(chosen);
                const skippedType = chosen.length - media.length;

                if (media.length === 0) {
                    toast.info(
                        directory
                            ? 'No supported photos or videos found in folder'
                            : 'No supported photos or videos selected'
                    );
                    return;
                }
                if (skippedType > 0) toast.info(`Skipped ${pluralize(skippedType, 'unsupported file')}`);

                enqueue(media);
            };
            input.click();
        },
        [enqueue, limits.workerOnline]
    );

    return (
        <>
            <UploadMenu
                onUploadFiles={() => pick(false)}
                onUploadFolder={() => pick(true)}
                disabled={!limits.workerOnline}
                disabledReason={UPLOADS_PAUSED}
            />
            <GuestUploadPanel items={items} onRemove={remove} onDismiss={clearFinished} />
        </>
    );
}

function GuestUploadPanel({
    items,
    onRemove,
    onDismiss,
}: {
    items: GuestUploadItem[];
    onRemove: (id: string) => void;
    onDismiss: () => void;
}) {
    const [open, setOpen] = useState(true);
    // Rendered into the global progress dock, so it sits where the library's
    // upload panel does instead of inside the header that holds the button.
    const [slot, setSlot] = useState<HTMLElement | null>(null);
    useEffect(() => setSlot(document.getElementById(PROGRESS_DOCK_SLOT_ID)), []);
    if (items.length === 0 || !slot) return null;

    const done = items.filter((i) => i.status === 'done').length;
    const failed = items.filter((i) => i.status === 'failed').length;
    const settled = done + failed === items.length;

    return createPortal(
        <div className="w-80 rounded-lg bg-white/80 backdrop-blur-xl shadow-2xl shadow-black/8 border border-stone-200/60 overflow-hidden transition-all duration-300">
            <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-stone-50/80"
                onClick={() => setOpen((o) => !o)}
            >
                <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-stone-900 leading-tight">
                        {settled
                            ? `${pluralize(done, 'file')} added to the album`
                            : `Uploading ${Math.min(done + failed + 1, items.length)} of ${items.length}`}
                    </p>
                </div>
                {settled && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onDismiss();
                        }}
                        className="text-[11px] font-medium text-stone-400 hover:text-stone-700 px-2 py-1 rounded-md hover:bg-stone-100"
                    >
                        Dismiss
                    </button>
                )}
            </div>

            {open && (
                <div className="max-h-56 overflow-y-auto border-t border-stone-100">
                    {items.map((item) => (
                        <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                            <div className="flex-shrink-0 w-5 flex justify-center">
                                {item.status === 'done' && <Check className="w-4 h-4 text-emerald-600" />}
                                {item.status === 'failed' && <AlertCircle className="w-4 h-4 text-red-500" />}
                                {item.status === 'uploading' && (
                                    <Loader2 className="w-4 h-4 text-stone-400 animate-spin" />
                                )}
                                {item.status === 'retrying' && <RefreshCw className="w-4 h-4 text-stone-400" />}
                                {item.status === 'queued' && (
                                    <div className="w-4 h-4 rounded-full border-2 border-stone-200" />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-[13px] text-stone-700 truncate leading-tight">{item.fileName}</p>
                                {item.status === 'uploading' && (
                                    <div className="mt-1.5 h-0.5 w-full bg-stone-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-stone-400 rounded-full transition-all duration-300"
                                            style={{ width: `${item.progress}%` }}
                                        />
                                    </div>
                                )}
                                {item.error && (
                                    <p className="text-[11px] text-red-500 mt-0.5 truncate">{item.error}</p>
                                )}
                            </div>
                            <IconButton
                                icon={X}
                                size="xs"
                                variant="surface"
                                onClick={() => onRemove(item.id)}
                                title={item.status === 'uploading' ? 'Cancel' : 'Remove'}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>,
        slot
    );
}
