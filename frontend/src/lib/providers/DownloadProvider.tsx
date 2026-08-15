'use client';

import {
    createContext,
    useReducer,
    useCallback,
    useMemo,
    useRef,
    type ReactNode,
} from 'react';

/** A single file to download. `url` is the fully-resolved endpoint to fetch bytes from. */
export interface DownloadRequest {
    /** Media id — used for fallback file naming when the server name is unavailable. */
    id: string;
    /** Fully-resolved URL to fetch the file from. */
    url: string;
    /** Optional known filename; otherwise derived from the response or falls back to the id. */
    fileName?: string;
}

type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'failed';

interface DownloadItem {
    key: string;
    fileName: string;
    status: DownloadStatus;
    progress: number;
    error?: string;
}

interface DownloadState {
    items: DownloadItem[];
    isOpen: boolean;
}

/** Statuses the queue will never move on from, so they can be dismissed. */
const FINISHED_STATUSES: readonly DownloadStatus[] = ['completed', 'failed'];

type DownloadAction =
    | { type: 'ADD'; items: Array<{ key: string; fileName: string }> }
    | { type: 'SET_DOWNLOADING'; key: string }
    | { type: 'SET_PROGRESS'; key: string; progress: number }
    | { type: 'SET_NAME'; key: string; fileName: string }
    | { type: 'SET_COMPLETED'; key: string }
    | { type: 'SET_FAILED'; keys: string[]; error: string }
    | { type: 'CLEAR_FINISHED' }
    | { type: 'TOGGLE_PANEL' };

/** Apply `changes` to every item in `keys`, leaving the rest untouched. */
function patchItems(
    items: DownloadItem[],
    keys: readonly string[],
    changes: Partial<DownloadItem>
): DownloadItem[] {
    const targets = new Set(keys);
    return items.map((i) => (targets.has(i.key) ? { ...i, ...changes } : i));
}

function downloadReducer(state: DownloadState, action: DownloadAction): DownloadState {
    switch (action.type) {
    case 'ADD':
        return {
            ...state,
            isOpen: true,
            items: [
                ...state.items,
                ...action.items.map((i) => ({
                    key: i.key,
                    fileName: i.fileName,
                    status: 'pending' as const,
                    progress: 0,
                })),
            ],
        };
    case 'SET_DOWNLOADING':
        return {
            ...state,
            items: patchItems(state.items, [action.key], { status: 'downloading' }),
        };
    case 'SET_PROGRESS':
        return {
            ...state,
            items: patchItems(state.items, [action.key], { progress: action.progress }),
        };
    case 'SET_NAME':
        return {
            ...state,
            items: patchItems(state.items, [action.key], { fileName: action.fileName }),
        };
    case 'SET_COMPLETED':
        return {
            ...state,
            items: patchItems(state.items, [action.key], {
                status: 'completed',
                progress: 100,
            }),
        };
    case 'SET_FAILED':
        return {
            ...state,
            items: patchItems(state.items, action.keys, {
                status: 'failed',
                error: action.error,
            }),
        };
    case 'CLEAR_FINISHED':
        return {
            ...state,
            items: state.items.filter((i) => !FINISHED_STATUSES.includes(i.status)),
        };
    case 'TOGGLE_PANEL':
        return { ...state, isOpen: !state.isOpen };
    default:
        return state;
    }
}

interface DownloadContextValue {
    items: DownloadItem[];
    isOpen: boolean;
    /** Queue one or more files for download, showing progress in the panel. */
    triggerDownload: (requests: DownloadRequest[]) => void;
    /** Abort every in-flight and queued download. */
    cancelAll: () => void;
    clearFinished: () => void;
    togglePanel: () => void;
}

export const DownloadContext = createContext<DownloadContextValue | null>(null);

interface QueueEntry {
    key: string;
    request: DownloadRequest;
}

/** How long a save's anchor and blob URL are kept alive after the click. */
const SAVE_CLEANUP_DELAY_MS = 10_000;

function errorMessage(err: unknown, fallback: string): string {
    return (err instanceof Error && err.message) || fallback;
}

/** A cancelled fetch is a user action, not a failure worth an error message. */
function isAbort(err: unknown): boolean {
    return err instanceof DOMException && err.name === 'AbortError';
}

function deriveFileName(
    request: DownloadRequest,
    disposition: string | null,
    blobType: string,
    contentType: string
): string {
    const fromHeader = disposition?.match(/filename="?([^"]+)"?/)?.[1];
    if (fromHeader) return fromHeader;
    if (request.fileName) return request.fileName;
    const ext = (blobType.split('/')[1] || contentType.split('/')[1] || 'jpg').split(';')[0];
    return `photo-${request.id}.${ext}`;
}

/** Click a hidden anchor, then tear it down on a later task (see below). */
function clickDownloadAnchor(href: string, fileName: string, onCleanup?: () => void) {
    const a = document.createElement('a');
    a.href = href;
    a.download = fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // Removing the anchor — or revoking its blob URL — in the same task can
    // abort a save that hasn't started reading the source yet (Safari most
    // often). Defer both until the browser has had time to take over.
    window.setTimeout(() => {
        a.remove();
        onCleanup?.();
    }, SAVE_CLEANUP_DELAY_MS);
}

/**
 * Save a blob to disk.
 *
 * This is the whole save path, on every platform. Mobile used to be special-cased
 * into two other paths — an anchor pointed straight at the API endpoint for a
 * single file, and an in-memory zip for a selection — on the theory that mobile
 * browsers permit only one un-gestured download per page load. The single-file
 * variant was unobservable by construction: it handed the URL to the browser and
 * marked the item done, so a save the browser silently declined looked exactly
 * like one that worked, and the panel sat at "Saving with your browser" forever.
 * It also could not survive its own redirect — the endpoint 302s to a presigned
 * S3 URL, and the `download` hint does not cross an origin boundary, leaving the
 * outcome entirely up to whether the browser had somewhere to put an attachment
 * (an iOS home-screen web app does not).
 *
 * A blob is local bytes with a known name, so `download` is honoured, the click
 * needs no live user gesture behind it, and success or failure is something we
 * can actually observe and report.
 */
function saveBlob(blob: Blob, fileName: string) {
    const objectUrl = URL.createObjectURL(blob);
    clickDownloadAnchor(objectUrl, fileName, () => URL.revokeObjectURL(objectUrl));
}

/**
 * Fetch a file into a Blob, reporting byte-level progress when the body can be
 * streamed (Content-Length is CORS-exposed by the bucket); otherwise falls back
 * to a plain blob. Returns the blob and the resolved file name.
 */
async function fetchFile(
    request: DownloadRequest,
    onProgress: (progress: number) => void,
    signal?: AbortSignal
): Promise<{ blob: Blob; fileName: string }> {
    const res = await fetch(request.url, signal ? { signal } : undefined);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const contentType = res.headers.get('Content-Type') ?? '';
    const totalStr = res.headers.get('Content-Length');
    const total = totalStr ? parseInt(totalStr, 10) : 0;

    let blob: Blob;
    if (res.body && total > 0) {
        const reader = res.body.getReader();
        const chunks: BlobPart[] = [];
        let received = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value as BlobPart);
            received += value.length;
            onProgress(Math.round((received / total) * 100));
        }
        blob = new Blob(chunks, contentType ? { type: contentType } : undefined);
    }
    else {
        blob = await res.blob();
    }

    const fileName = deriveFileName(
        request,
        res.headers.get('Content-Disposition'),
        blob.type,
        contentType
    );
    return { blob, fileName };
}

export function DownloadProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(downloadReducer, {
        items: [],
        isOpen: false,
    });

    const processingRef = useRef(false);
    // Replaced after every cancellation so a new batch is not born aborted.
    const abortRef = useRef<AbortController | null>(null);
    const queueRef = useRef<QueueEntry[]>([]);

    const processOne = useCallback(async (entry: QueueEntry) => {
        const { key, request } = entry;
        dispatch({ type: 'SET_DOWNLOADING', key });

        try {
            const { blob, fileName } = await fetchFile(
                request,
                (progress) => dispatch({ type: 'SET_PROGRESS', key, progress }),
                // Without this the fetch ran to completion no matter what: Cancel
                // emptied the queue but the file already in flight kept streaming.
                abortRef.current?.signal
            );
            dispatch({ type: 'SET_NAME', key, fileName });
            saveBlob(blob, fileName);
            dispatch({ type: 'SET_COMPLETED', key });
        }
        catch (err: unknown) {
            dispatch({
                type: 'SET_FAILED',
                keys: [key],
                error: isAbort(err) ? 'Cancelled' : errorMessage(err, 'Download failed'),
            });
        }
    }, []);

    /**
     * Cancel every in-flight and queued download.
     *
     * There was no cancellation anywhere in this provider: `DownloadRequest` had no
     * signal, `processQueue` could not be interrupted, and the panel's only control
     * removed a row from the list while its fetch kept running. A user who started a
     * 150-file batch had to kill the tab.
     */
    const cancelAll = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = new AbortController();
        const queued = queueRef.current.map((e) => e.key);
        queueRef.current = [];
        if (queued.length > 0) {
            dispatch({ type: 'SET_FAILED', keys: queued, error: 'Cancelled' });
        }
    }, []);

    const processQueue = useCallback(async () => {
        if (processingRef.current) return;
        processingRef.current = true;

        // try/finally: a throw that escaped here would leave the queue latched
        // shut for the lifetime of the page (only a reload would clear it).
        try {
            // Sequential, which is what bounds peak memory: one file is held as a
            // blob at a time, however large the selection. The mobile zip path it
            // replaces accumulated every original in memory and then materialised a
            // second copy of the whole archive, so a 150-photo selection peaked
            // near 1.5 GB and WebKit killed the tab mid-build.
            while (queueRef.current.length > 0) {
                const entry = queueRef.current.shift()!;
                try {
                    await processOne(entry);
                }
                catch (err: unknown) {
                    dispatch({
                        type: 'SET_FAILED',
                        keys: [entry.key],
                        error: errorMessage(err, 'Download failed'),
                    });
                }
            }
        }
        finally {
            processingRef.current = false;
        }
    }, [processOne]);

    const triggerDownload = useCallback(
        (requests: DownloadRequest[]) => {
            if (requests.length === 0) return;

            if (!abortRef.current) abortRef.current = new AbortController();

            const entries: QueueEntry[] = requests.map((request) => ({
                key: crypto.randomUUID(),
                request,
            }));

            dispatch({
                type: 'ADD',
                items: entries.map((e) => ({
                    key: e.key,
                    fileName: e.request.fileName || 'Preparing…',
                })),
            });

            queueRef.current.push(...entries);
            processQueue();
        },
        [processQueue]
    );

    const clearFinished = useCallback(() => {
        dispatch({ type: 'CLEAR_FINISHED' });
    }, []);

    const togglePanel = useCallback(() => {
        dispatch({ type: 'TOGGLE_PANEL' });
    }, []);

    /**
     * Memoized. The context value was a fresh object literal on every render, and
     * progress dispatches fire per network chunk — so DownloadProgress,
     * SelectionToolbar and MediaLightbox all re-rendered thousands of times during a
     * single large download.
     */
    const value = useMemo(
        () => ({
            items: state.items,
            isOpen: state.isOpen,
            triggerDownload,
            cancelAll,
            clearFinished,
            togglePanel,
        }),
        [state.items, state.isOpen, triggerDownload, cancelAll, clearFinished, togglePanel]
    );

    return <DownloadContext.Provider value={value}>{children}</DownloadContext.Provider>;
}
