'use client';

import {
    createContext,
    useReducer,
    useCallback,
    useMemo,
    useRef,
    type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidationsFor } from '../queries/keys';
import { uploadFile, checkDuplicates } from '../api/upload';
import { addItems } from '../api/collections';

interface UploadItem {
    id: string;
    fileName: string;
    /** `retrying` — an S3 request failed and is waiting out its backoff. */
    status: 'pending' | 'uploading' | 'retrying' | 'completed' | 'failed';
    progress: number;
    error?: string;
    /** Which retry is pending, and of how many, while `status` is `retrying`. */
    retryAttempt?: number;
    retryMax?: number;
}

export interface PendingDuplicate {
    /**
     * Stable identity for this decision.
     *
     * Decisions used to be keyed by `file.name`, so two files with the same name from
     * different folders — the normal case for a phone export, where every folder has an
     * IMG_0001.JPG — collided: deciding one decided the other, and Confirm could never
     * be enabled because the decision count never reached the duplicate count.
     */
    key: string;
    file: File;
    collectionId?: string;
    existingId: string;
    existingThumbnailKey: string | null;
}

interface UploadState {
    items: UploadItem[];
    isOpen: boolean;
    pendingDuplicates: PendingDuplicate[];
}

type UploadAction =
    | { type: 'ADD_FILES'; files: Array<{ id: string; fileName: string }> }
    | { type: 'SET_UPLOADING'; id: string }
    | { type: 'SET_RETRYING'; id: string; attempt: number; maxAttempts: number }
    | { type: 'SET_PROGRESS'; id: string; progress: number }
    | { type: 'SET_COMPLETED'; id: string }
    | { type: 'SET_FAILED'; id: string; error: string }
    | { type: 'REMOVE'; id: string }
    | { type: 'CLEAR_COMPLETED' }
    | { type: 'TOGGLE_PANEL' }
    | { type: 'SET_PENDING_DUPLICATES'; duplicates: PendingDuplicate[] }
    | { type: 'CLEAR_PENDING_DUPLICATES' };

function uploadReducer(state: UploadState, action: UploadAction): UploadState {
    switch (action.type) {
    case 'ADD_FILES':
        return {
            ...state,
            isOpen: true,
            items: [
                ...state.items,
                ...action.files.map((f) => ({
                    id: f.id,
                    fileName: f.fileName,
                    status: 'pending' as const,
                    progress: 0,
                })),
            ],
        };
    case 'SET_UPLOADING':
        return {
            ...state,
            items: state.items.map((i) =>
                i.id === action.id ? { ...i, status: 'uploading' as const } : i
            ),
        };
    case 'SET_RETRYING':
        return {
            ...state,
            items: state.items.map((i) =>
                i.id === action.id
                    ? {
                        ...i,
                        status: 'retrying' as const,
                        retryAttempt: action.attempt,
                        retryMax: action.maxAttempts,
                    }
                    : i
            ),
        };
    case 'SET_PROGRESS':
        // Progress resuming is the signal that a retry got underway.
        return {
            ...state,
            items: state.items.map((i) =>
                i.id === action.id
                    ? {
                        ...i,
                        progress: action.progress,
                        status: i.status === 'retrying' ? ('uploading' as const) : i.status,
                    }
                    : i
            ),
        };
    case 'SET_COMPLETED':
        return {
            ...state,
            items: state.items.map((i) =>
                i.id === action.id
                    ? { ...i, status: 'completed' as const, progress: 100 }
                    : i
            ),
        };
    case 'SET_FAILED':
        return {
            ...state,
            items: state.items.map((i) =>
                i.id === action.id
                    ? { ...i, status: 'failed' as const, error: action.error }
                    : i
            ),
        };
    case 'REMOVE':
        return {
            ...state,
            items: state.items.filter((i) => i.id !== action.id),
        };
    case 'CLEAR_COMPLETED':
        return {
            ...state,
            items: state.items.filter((i) => i.status !== 'completed'),
        };
    case 'TOGGLE_PANEL':
        return { ...state, isOpen: !state.isOpen };
    case 'SET_PENDING_DUPLICATES':
        return { ...state, pendingDuplicates: action.duplicates };
    case 'CLEAR_PENDING_DUPLICATES':
        return { ...state, pendingDuplicates: [] };
    default:
        return state;
    }
}

function getNextFileName(originalName: string, existingNames: string[]): string {
    const dotIdx = originalName.lastIndexOf('.');
    const stem = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
    const ext = dotIdx > 0 ? originalName.slice(dotIdx) : '';

    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const extEscaped = ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escaped} \\((\\d+)\\)${extEscaped}$`);

    let maxN = 0;
    for (const name of existingNames) {
        const match = name.match(pattern);
        if (match) {
            maxN = Math.max(maxN, parseInt(match[1], 10));
        }
    }

    return `${stem} (${maxN + 1})${ext}`;
}

interface UploadContextValue {
    items: UploadItem[];
    isOpen: boolean;
    pendingDuplicates: PendingDuplicate[];
    addFiles: (files: FileList | File[], options?: { collectionId?: string }) => void;
    resolveDuplicates: (decisions: Map<string, 'skip' | 'keep_both'>) => void;
    removeItem: (id: string) => void;
    clearCompleted: () => void;
    /** Abort every in-flight and queued upload. */
    cancelAll: () => void;
    togglePanel: () => void;
}

export const UploadContext = createContext<UploadContextValue | null>(null);

interface QueueItem {
    id: string;
    file: File;
    collectionId?: string;
    /** Overridden name when the user chose "keep both". */
    fileName?: string;
}

export function UploadProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(uploadReducer, {
        items: [],
        isOpen: false,
        pendingDuplicates: [],
    });

    const queryClient = useQueryClient();
    const processingRef = useRef(false);
    const queueRef = useRef<QueueItem[]>([]);
    const heldFilesRef = useRef<Array<{ file: File; collectionId?: string }>>([]);
    const duplicateNamesRef = useRef<string[]>([]);
    /** Replaced after each cancellation so a new batch is not born aborted. */
    const abortRef = useRef<AbortController | null>(null);
    /** Last dispatched whole-percent value per item, for progress throttling. */
    const lastProgressRef = useRef(new Map<string, number>());
    const completedSinceFlushRef = useRef(0);

    /**
     * Invalidate once per drained queue rather than once per file.
     *
     * Each completed upload used to call `invalidateQueries(['media'])`, and `['media']`
     * prefix-matches `['media','shell']` — so a 500-file batch queued ~500 full
     * re-fetches of the library payload.
     */
    const flushInvalidations = useCallback(() => {
        if (completedSinceFlushRef.current === 0) return;
        completedSinceFlushRef.current = 0;
        for (const key of invalidationsFor(['media-set'])) {
            queryClient.invalidateQueries({ queryKey: key }).catch(() => undefined);
        }
    }, [queryClient]);

    /**
     * Abort every in-flight and queued upload.
     *
     * There was no cancellation: the panel's remove button only hid a row while its
     * request kept running, and `processQueue` could not be interrupted at all.
     */
    const cancelAll = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = new AbortController();
        const queued = queueRef.current.map((item) => item.id);
        queueRef.current = [];
        for (const id of queued) {
            dispatch({ type: 'SET_FAILED', id, error: 'Cancelled' });
        }
    }, []);

    const processQueue = useCallback(async () => {
        if (processingRef.current) return;
        processingRef.current = true;

        const FILE_CONCURRENCY = 8;

        const processItem = async (item: QueueItem) => {
            if (abortRef.current?.signal.aborted) {
                dispatch({ type: 'SET_FAILED', id: item.id, error: 'Cancelled' });
                return;
            }

            dispatch({ type: 'SET_UPLOADING', id: item.id });
            try {
                const mediaItemId = await uploadFile(
                    item.file,
                    (progress) => {
                        /**
                         * Throttled to whole percent changes. `onProgress` fires per XHR
                         * tick, and each dispatch ran a full `items.map` and produced a
                         * new un-memoized context value — so a large upload re-rendered
                         * the panel, the selection toolbar and the lightbox thousands of
                         * times for at most 100 visually distinct states.
                         */
                        const last = lastProgressRef.current.get(item.id);
                        const rounded = Math.round(progress);
                        if (last === rounded) return;
                        lastProgressRef.current.set(item.id, rounded);
                        dispatch({ type: 'SET_PROGRESS', id: item.id, progress: rounded });
                    },
                    item.fileName,
                    (attempt, maxAttempts) => {
                        dispatch({ type: 'SET_RETRYING', id: item.id, attempt, maxAttempts });
                    },
                    abortRef.current?.signal
                );

                if (item.collectionId) {
                    await addItems(item.collectionId, [mediaItemId]);
                }

                dispatch({ type: 'SET_COMPLETED', id: item.id });
                completedSinceFlushRef.current += 1;
            }
            catch (err: unknown) {
                dispatch({
                    type: 'SET_FAILED',
                    id: item.id,
                    error: err instanceof Error ? err.message : 'Upload failed',
                });
            }
            finally {
                lastProgressRef.current.delete(item.id);
            }
        };

        /**
         * try/finally, and a re-check after clearing the flag.
         *
         * The flag used to be cleared *after* `await Promise.all(workers)` with no
         * finally, so a throw latched the queue shut for the lifetime of the page — and
         * anything pushed between the workers exiting their loops and Promise.all
         * settling was never picked up: the reducer showed those files as pending at 0%
         * and the header read "Uploading N of M" indefinitely.
         */
        try {
            for (;;) {
                const workers = Array.from(
                    { length: Math.min(FILE_CONCURRENCY, queueRef.current.length) },
                    async () => {
                        while (queueRef.current.length > 0) {
                            if (abortRef.current?.signal.aborted) return;
                            const item = queueRef.current.shift()!;
                            await processItem(item);
                        }
                    }
                );

                await Promise.all(workers);

                // Files added while the previous batch was draining.
                if (queueRef.current.length === 0) break;
            }
        }
        finally {
            processingRef.current = false;
            flushInvalidations();
            // Anything enqueued during the finally window still gets picked up.
            if (queueRef.current.length > 0) {
                processQueue().catch(() => undefined);
            }
        }
    }, [flushInvalidations]);

    const enqueueFiles = useCallback(
        (files: Array<{ file: File; collectionId?: string; fileName?: string }>) => {
            const entries = files.map((f) => ({
                id: crypto.randomUUID(),
                file: f.file,
                collectionId: f.collectionId,
                fileName: f.fileName,
            }));

            dispatch({
                type: 'ADD_FILES',
                files: entries.map((e) => ({
                    id: e.id,
                    fileName: e.fileName || e.file.name,
                })),
            });

            queueRef.current.push(...entries);
            processQueue();
        },
        [processQueue]
    );

    const addFiles = useCallback(
        async (files: FileList | File[], options?: { collectionId?: string }) => {
            const fileArray = Array.from(files);
            if (fileArray.length === 0) return;

            const fileNames = fileArray.map((f) => f.name);

            try {
                const duplicates = await checkDuplicates(fileNames);

                if (duplicates.length === 0) {
                    enqueueFiles(
                        fileArray.map((file) => ({
                            file,
                            collectionId: options?.collectionId,
                        }))
                    );
                    return;
                }

                const duplicateNameSet = new Set(duplicates.map((d) => d.fileName));
                const nonDuplicateFiles = fileArray.filter((f) => !duplicateNameSet.has(f.name));

                heldFilesRef.current = nonDuplicateFiles.map((file) => ({
                    file,
                    collectionId: options?.collectionId,
                }));

                duplicateNamesRef.current = duplicates.map((d) => d.fileName);

                const pendingDups: PendingDuplicate[] = [];
                for (const file of fileArray) {
                    const existing = duplicates.find((d) => d.fileName === file.name);
                    if (existing) {
                        pendingDups.push({
                            key: crypto.randomUUID(),
                            file,
                            collectionId: options?.collectionId,
                            existingId: existing.id,
                            existingThumbnailKey: existing.thumbnailKey,
                        });
                    }
                }

                dispatch({ type: 'SET_PENDING_DUPLICATES', duplicates: pendingDups });
            }
            catch {
                // If duplicate check fails, upload anyway
                enqueueFiles(
                    fileArray.map((file) => ({
                        file,
                        collectionId: options?.collectionId,
                    }))
                );
            }
        },
        [enqueueFiles]
    );

    const resolveDuplicates = useCallback(
        (decisions: Map<string, 'skip' | 'keep_both'>) => {
            const filesToQueue: Array<{ file: File; collectionId?: string; fileName?: string }> = [];

            /**
             * `takenNames` accumulates as we go.
             *
             * getNextFileName picks max(n)+1 from the names it is shown, but it used to be
             * shown only the *server-side* duplicate list — which never grew. So keeping
             * both of two same-named files in one batch produced " (1)" for both, and the
             * second upload collided with the first.
             */
            const takenNames = [...duplicateNamesRef.current];

            for (const dup of state.pendingDuplicates) {
                const decision = decisions.get(dup.key);
                if (decision === 'keep_both') {
                    const renamedName = getNextFileName(dup.file.name, takenNames);
                    takenNames.push(renamedName);
                    filesToQueue.push({
                        file: dup.file,
                        collectionId: dup.collectionId,
                        fileName: renamedName,
                    });
                }
            }

            for (const held of heldFilesRef.current) {
                filesToQueue.push(held);
            }

            heldFilesRef.current = [];
            duplicateNamesRef.current = [];
            dispatch({ type: 'CLEAR_PENDING_DUPLICATES' });

            if (filesToQueue.length > 0) {
                enqueueFiles(filesToQueue);
            }
        },
        [state.pendingDuplicates, enqueueFiles]
    );

    const removeItem = useCallback((id: string) => {
        dispatch({ type: 'REMOVE', id });
    }, []);

    const clearCompleted = useCallback(() => {
        dispatch({ type: 'CLEAR_COMPLETED' });
    }, []);

    const togglePanel = useCallback(() => {
        dispatch({ type: 'TOGGLE_PANEL' });
    }, []);

    /**
     * Memoized. The value was a fresh object literal every render, and progress
     * dispatches fire per XHR tick — so every consumer re-rendered thousands of times
     * during a large upload.
     */
    const value = useMemo(
        () => ({
            items: state.items,
            isOpen: state.isOpen,
            pendingDuplicates: state.pendingDuplicates,
            addFiles,
            resolveDuplicates,
            removeItem,
            clearCompleted,
            cancelAll,
            togglePanel,
        }),
        [
            state.items,
            state.isOpen,
            state.pendingDuplicates,
            addFiles,
            resolveDuplicates,
            removeItem,
            clearCompleted,
            cancelAll,
            togglePanel,
        ]
    );

    return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
}
