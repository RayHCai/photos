'use client';

import {
    createContext,
    useReducer,
    useCallback,
    useMemo,
    useRef,
    type ReactNode,
} from 'react';
import { blocksAutomaticDownloads } from '@/lib/utils/platform';

/** A single file to download. `url` is the fully-resolved endpoint to fetch bytes from. */
export interface DownloadRequest {
    /** Media id — used for fallback file naming when the server name is unavailable. */
    id: string;
    /** Fully-resolved URL to fetch the file from. */
    url: string;
    /** Optional known filename; otherwise derived from the response or falls back to the id. */
    fileName?: string;
}

/**
 * Beyond the obvious states, `ready` means the bytes are in memory and correct,
 * and the only thing left is a save the browser will accept — which on the
 * platforms that need it is a tap. See blocksAutomaticDownloads.
 */
type DownloadStatus = 'pending' | 'downloading' | 'ready' | 'completed' | 'failed';

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
    /**
     * Set once a share has been refused for a reason that is not the user
     * dismissing the sheet, after which saves go one file per tap. There is no way
     * to ask whether sharing *works* — canShare only reports whether the payload is
     * shareable in principle — so the only signal is a failure.
     */
    shareBlocked: boolean;
}

/** Statuses the queue will never move on from, so they can be dismissed. */
const FINISHED_STATUSES: readonly DownloadStatus[] = ['completed', 'failed'];

type DownloadAction =
    | { type: 'ADD'; items: Array<{ key: string; fileName: string }> }
    | { type: 'SET_DOWNLOADING'; key: string }
    | { type: 'SET_PROGRESS'; key: string; progress: number }
    | { type: 'SET_NAME'; key: string; fileName: string }
    | { type: 'SET_READY'; key: string }
    | { type: 'SET_COMPLETED'; keys: string[] }
    | { type: 'SET_FAILED'; keys: string[]; error: string }
    | { type: 'SHARE_BLOCKED' }
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
    case 'SET_READY':
        return {
            ...state,
            items: patchItems(state.items, [action.key], { status: 'ready', progress: 100 }),
        };
    case 'SET_COMPLETED':
        return {
            ...state,
            items: patchItems(state.items, action.keys, {
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
    case 'SHARE_BLOCKED':
        return { ...state, shareBlocked: true };
    case 'CLEAR_FINISHED':
        // Drops files the user chose not to save along with the finished ones,
        // which is what releases their blobs — a declined save would otherwise
        // hold its bytes and pin the panel open indefinitely.
        return {
            ...state,
            items: state.items.filter(
                (i) => !FINISHED_STATUSES.includes(i.status) && i.status !== 'ready'
            ),
        };
    case 'TOGGLE_PANEL':
        return { ...state, isOpen: !state.isOpen };
    default:
        return state;
    }
}

/** How the next tap on Save will hand files to the OS. */
export type SaveMode = 'share' | 'file';

interface DownloadContextValue {
    items: DownloadItem[];
    isOpen: boolean;
    /**
     * Whether a Save tap opens the share sheet with every ready file at once, or
     * saves a single file. Drives the button's label, since the two do visibly
     * different amounts of work.
     */
    saveMode: SaveMode;
    /** Queue one or more files for download, showing progress in the panel. */
    triggerDownload: (requests: DownloadRequest[]) => void;
    /**
     * Save the files waiting in `ready`. MUST be called directly from a click or
     * tap handler: the activation that handler carries is the entire reason the
     * save is allowed to happen.
     */
    saveReady: () => void;
    /** Save the oldest ready file straight to disk, bypassing the share sheet. */
    saveOneReady: () => void;
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

/** Bytes in hand, waiting for the tap that saves them. */
interface ReadyFile {
    key: string;
    fileName: string;
    blob: Blob;
}

/** How long a save's anchor and blob URL are kept alive after the click. */
const SAVE_CLEANUP_DELAY_MS = 10_000;

/**
 * Ceiling on files parked in `ready`, and on their combined size.
 *
 * Waiting for a tap means holding bytes, and a selection is unbounded, so the
 * queue stops fetching once either limit is hit and resumes when a save frees
 * room. Without this a 150-photo selection would sit in memory in full — the
 * failure that killed the mobile zip path this replaces, where a batch peaked
 * near 1.5 GB and WebKit killed the tab.
 *
 * The byte limit is the one that binds: twelve photos is tens of MB, twelve
 * videos is not.
 */
const MAX_READY_FILES = 12;
const MAX_READY_BYTES = 128 * 1024 * 1024;

function errorMessage(err: unknown, fallback: string): string {
    return (err instanceof Error && err.message) || fallback;
}

/** A cancelled fetch, or a dismissed share sheet, is a user action — not a failure. */
function isAbort(err: unknown): boolean {
    return err instanceof DOMException && err.name === 'AbortError';
}

/** Cached: a page's UA does not change, and this is consulted per file. */
let gestureRequired: boolean | null = null;
function requiresSaveGesture(): boolean {
    if (gestureRequired === null) gestureRequired = blocksAutomaticDownloads();
    return gestureRequired;
}

function shareApiAvailable(): boolean {
    return (
        typeof navigator !== 'undefined' &&
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function'
    );
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
 * A blob is local bytes with a known name, so `download` is honoured, and success
 * or failure is something we can actually observe and report.
 *
 * What that theory got right, and this function cannot fix on its own, is *when*
 * the click may happen: see blocksAutomaticDownloads and saveReady.
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
        shareBlocked: false,
    });

    const processingRef = useRef(false);
    // Replaced after every cancellation so a new batch is not born aborted.
    const abortRef = useRef<AbortController | null>(null);
    const queueRef = useRef<QueueEntry[]>([]);
    // Insertion-ordered, so "the next file to save" is well defined and a batch
    // reaches the share sheet in the order it was selected.
    const readyRef = useRef<Map<string, ReadyFile>>(new Map());

    const readyBytes = useCallback(() => {
        let total = 0;
        for (const file of readyRef.current.values()) total += file.blob.size;
        return total;
    }, []);

    /** Room to park another file, or does the queue need to wait for a save? */
    const readyIsFull = useCallback(
        () => readyRef.current.size >= MAX_READY_FILES || readyBytes() >= MAX_READY_BYTES,
        [readyBytes]
    );

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

            if (requiresSaveGesture()) {
                // Deliberately not saved here. This is a promise continuation, so
                // the tap behind it has expired and the browser would refuse the
                // save without saying so.
                readyRef.current.set(key, { key, fileName, blob });
                dispatch({ type: 'SET_READY', key });
            }
            else {
                saveBlob(blob, fileName);
                dispatch({ type: 'SET_COMPLETED', keys: [key] });
            }
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
     *
     * Leaves files already in `ready` alone: their bytes are on the device and paid
     * for, and cancelling what has not been fetched is no reason to throw them away.
     * Dismissing the panel is what discards them.
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
                // Files waiting to be saved are also held bytes, so fetching stops
                // once enough have piled up. saveReady restarts this loop.
                if (requiresSaveGesture() && readyIsFull()) break;

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
    }, [processOne, readyIsFull]);

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

    /** Release saved files and let the queue fetch into the room they freed. */
    const finishSaved = useCallback(
        (keys: string[]) => {
            for (const key of keys) readyRef.current.delete(key);
            dispatch({ type: 'SET_COMPLETED', keys });
            processQueue();
        },
        [processQueue]
    );

    const saveOneReady = useCallback(() => {
        const next = readyRef.current.values().next();
        if (next.done) return;
        saveBlob(next.value.blob, next.value.fileName);
        finishSaved([next.value.key]);
    }, [finishSaved]);

    /**
     * Hand every ready file to the OS in one go via the share sheet, falling back
     * to a single file saved to disk.
     *
     * One activation authorizes one download, so a loop of anchor clicks here would
     * save the first file and quietly drop the rest — the batch half of the bug this
     * exists to fix. `navigator.share` is the one call that takes a whole set of
     * files under a single tap.
     *
     * Nothing may be awaited before `navigator.share`: an await hands control back
     * to the event loop, the activation goes with it, and the sheet never opens.
     * Building the File wrappers is synchronous for that reason.
     *
     * A lone file goes straight to disk. Sharing it would cost the same one tap and
     * then ask the user to choose a destination, and the share sheet's targets are
     * the OS's to decide — the file system is not guaranteed to be among them.
     * Sharing earns its keep only by collapsing several taps into one.
     */
    const saveReady = useCallback(() => {
        const entries = [...readyRef.current.values()];
        if (entries.length === 0) return;

        if (entries.length > 1 && !state.shareBlocked && shareApiAvailable()) {
            const files = entries.map(
                (e) =>
                    new File([e.blob], e.fileName, {
                        type: e.blob.type || 'application/octet-stream',
                    })
            );

            if (navigator.canShare({ files })) {
                navigator
                    .share({ files })
                    .then(() => finishSaved(entries.map((e) => e.key)))
                    .catch((err: unknown) => {
                        // Dismissing the sheet is a decision, not a failure: the
                        // files stay ready so the next tap can try again.
                        if (isAbort(err)) return;
                        dispatch({ type: 'SHARE_BLOCKED' });
                    });
                return;
            }

            // canShare said no — a payload this platform will not take (too large,
            // or a type it refuses). Saving is still possible one file at a time.
            dispatch({ type: 'SHARE_BLOCKED' });
        }

        saveOneReady();
    }, [state.shareBlocked, finishSaved, saveOneReady]);

    const clearFinished = useCallback(() => {
        readyRef.current.clear();
        dispatch({ type: 'CLEAR_FINISHED' });
        // Dropping unsaved files frees the room the queue was waiting on.
        processQueue();
    }, [processQueue]);

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
            saveMode: (!state.shareBlocked && shareApiAvailable()
                ? 'share'
                : 'file') as SaveMode,
            triggerDownload,
            saveReady,
            saveOneReady,
            cancelAll,
            clearFinished,
            togglePanel,
        }),
        [
            state.items,
            state.isOpen,
            state.shareBlocked,
            triggerDownload,
            saveReady,
            saveOneReady,
            cancelAll,
            clearFinished,
            togglePanel,
        ]
    );

    return <DownloadContext.Provider value={value}>{children}</DownloadContext.Provider>;
}
