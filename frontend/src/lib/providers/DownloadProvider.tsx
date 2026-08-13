'use client';

import {
    createContext,
    useReducer,
    useCallback,
    useMemo,
    useRef,
    type ReactNode,
} from 'react';
import { toast } from 'sonner';
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
 * Beyond the obvious states:
 * - `handoff` — the URL was passed straight to the browser's own download
 *   manager (mobile single file), which owns progress and completion from there.
 * - `archived` — the bytes are inside a generated .zip that is waiting for the
 *   user to tap Save. Only `completed` once that archive is really on the device.
 */
type DownloadStatus =
    | 'pending'
    | 'downloading'
    | 'archived'
    | 'handoff'
    | 'completed'
    | 'failed';

interface DownloadItem {
    key: string;
    fileName: string;
    status: DownloadStatus;
    progress: number;
    error?: string;
}

/**
 * A generated archive held in memory until a user gesture can save it. Mobile
 * browsers drop programmatic downloads that aren't initiated from a tap, so the
 * panel exposes this as a Save button rather than clicking on the user's behalf.
 */
export interface PendingArchive {
    id: string;
    fileName: string;
    blob: Blob;
    /** Items rolled into this archive; they complete when it is saved. */
    itemKeys: string[];
}

interface DownloadState {
    items: DownloadItem[];
    archives: PendingArchive[];
    isOpen: boolean;
}

/** Statuses the queue will never move on from, so they can be dismissed. */
const FINISHED_STATUSES: readonly DownloadStatus[] = [
    'completed',
    'failed',
    'handoff',
];

type DownloadAction =
    | { type: 'ADD'; items: Array<{ key: string; fileName: string }> }
    | { type: 'SET_DOWNLOADING'; key: string }
    | { type: 'SET_PROGRESS'; key: string; progress: number }
    | { type: 'SET_NAME'; key: string; fileName: string }
    | { type: 'SET_ARCHIVED'; key: string }
    | { type: 'SET_HANDOFF'; key: string }
    | { type: 'SET_COMPLETED'; key: string }
    | { type: 'SET_FAILED'; keys: string[]; error: string }
    | { type: 'ARCHIVE_READY'; archive: PendingArchive }
    | { type: 'ARCHIVE_SAVED'; id: string }
    | { type: 'ARCHIVE_FAILED'; id: string; error: string }
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
    case 'SET_ARCHIVED':
        return {
            ...state,
            items: patchItems(state.items, [action.key], {
                status: 'archived',
                progress: 100,
            }),
        };
    case 'SET_HANDOFF':
        return {
            ...state,
            items: patchItems(state.items, [action.key], {
                status: 'handoff',
                progress: 100,
            }),
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
    case 'ARCHIVE_READY':
        // Re-open the panel: the Save button is the only way this finishes.
        return {
            ...state,
            isOpen: true,
            archives: [...state.archives, action.archive],
        };
    case 'ARCHIVE_SAVED': {
        const archive = state.archives.find((a) => a.id === action.id);
        if (!archive) return state;
        return {
            ...state,
            archives: state.archives.filter((a) => a.id !== action.id),
            items: patchItems(state.items, archive.itemKeys, {
                status: 'completed',
                progress: 100,
            }),
        };
    }
    case 'ARCHIVE_FAILED': {
        const archive = state.archives.find((a) => a.id === action.id);
        if (!archive) return state;
        return {
            ...state,
            archives: state.archives.filter((a) => a.id !== action.id),
            items: patchItems(state.items, archive.itemKeys, {
                status: 'failed',
                error: action.error,
            }),
        };
    }
    case 'CLEAR_FINISHED':
        // Also drops archives the user chose not to save, releasing their blobs —
        // otherwise a declined archive would pin the panel open indefinitely.
        return {
            ...state,
            archives: [],
            items: state.items.filter(
                (i) => !FINISHED_STATUSES.includes(i.status) && i.status !== 'archived'
            ),
        };
    case 'TOGGLE_PANEL':
        return { ...state, isOpen: !state.isOpen };
    default:
        return state;
    }
}

interface DownloadContextValue {
    items: DownloadItem[];
    /** Archives waiting on a user gesture to be written to disk. */
    archives: PendingArchive[];
    isOpen: boolean;
    /**
     * Queue one or more files for download, showing progress in the panel.
     * Must be called directly from a user gesture (click/tap handler): on mobile
     * a single file is handed to the browser synchronously, which only works
     * while the gesture is still active.
     */
    triggerDownload: (requests: DownloadRequest[]) => void;
    /** Abort every in-flight and queued download. */
    cancelAll: () => void;
    /** Write a ready archive to disk. Must be called from a user gesture. */
    saveArchive: (archive: PendingArchive) => void;
    clearFinished: () => void;
    togglePanel: () => void;
}

export const DownloadContext = createContext<DownloadContextValue | null>(null);

interface QueueEntry {
    key: string;
    request: DownloadRequest;
}

/**
 * A unit of work for the download queue. `single` saves one file directly;
 * `zip` fetches several files into one archive the user then saves — used on
 * mobile, where browsers only allow one programmatic download per gesture.
 */
type DownloadJob =
    | { kind: 'single'; entry: QueueEntry }
    | { kind: 'zip'; entries: QueueEntry[] };

/** How long a save's anchor and blob URL are kept alive after the click. */
const SAVE_CLEANUP_DELAY_MS = 10_000;

/**
 * Hard caps on the in-memory archive path.
 *
 * On mobile every multi-file download routes through processZip, which accumulated
 * each original into a Blob, kept all of them alive inside the JSZip instance, and
 * then materialised a second blob of the same total size. 150 photos at ~5 MB each
 * meant a ~1.5 GB in-memory peak with no disk spill — WebKit killed the tab
 * mid-archive with the panel frozen and nothing saved, and there was no cap, no size
 * preview and no way to cancel.
 */
const MAX_ARCHIVE_FILES = 100;
const MAX_ARCHIVE_BYTES = 400 * 1024 * 1024;

function errorMessage(err: unknown, fallback: string): string {
    return (err instanceof Error && err.message) || fallback;
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

/** Append " (n)" before the extension until the name is unique within the archive. */
function uniqueFileName(name: string, used: Set<string>): string {
    if (!used.has(name)) return name;
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let i = 1;
    let candidate = `${base} (${i})${ext}`;
    while (used.has(candidate)) {
        i += 1;
        candidate = `${base} (${i})${ext}`;
    }
    return candidate;
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

/** Save a blob to disk. Must run inside a user gesture on mobile. */
function saveBlob(blob: Blob, fileName: string) {
    const objectUrl = URL.createObjectURL(blob);
    clickDownloadAnchor(objectUrl, fileName, () => URL.revokeObjectURL(objectUrl));
}

/**
 * Hand a URL to the browser's own download manager without reading it in JS.
 * Because no `await` happens first, the click still carries the user activation
 * from the originating tap — the only way mobile browsers reliably allow more
 * than one download per page load. The server responds with
 * `Content-Disposition: attachment`, so the file saves rather than opening.
 */
function handOffToBrowser(request: DownloadRequest) {
    clickDownloadAnchor(request.url, request.fileName ?? '');
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
        archives: [],
        isOpen: false,
    });

    const processingRef = useRef(false);
    // Replaced after every cancellation so a new batch is not born aborted.
    const abortRef = useRef<AbortController | null>(null);
    const queueRef = useRef<DownloadJob[]>([]);
    // Archive ids already handed to the browser, so a double-tap on Save (easy to
    // do on a touch screen) can't save the same file twice.
    const savedArchivesRef = useRef(new Set<string>());

    const processOne = useCallback(async (entry: QueueEntry) => {
        const { key, request } = entry;
        dispatch({ type: 'SET_DOWNLOADING', key });

        try {
            const { blob, fileName } = await fetchFile(request, (progress) =>
                dispatch({ type: 'SET_PROGRESS', key, progress })
            );
            dispatch({ type: 'SET_NAME', key, fileName });
            saveBlob(blob, fileName);
            dispatch({ type: 'SET_COMPLETED', key });
        }
        catch (err: unknown) {
            dispatch({
                type: 'SET_FAILED',
                keys: [key],
                error: errorMessage(err, 'Download failed'),
            });
        }
    }, []);

    const processZip = useCallback(async (entries: QueueEntry[]) => {
        const allKeys = entries.map((e) => e.key);

        let JSZip;
        try {
            JSZip = (await import('jszip')).default;
        }
        catch (err: unknown) {
            dispatch({
                type: 'SET_FAILED',
                keys: allKeys,
                error: errorMessage(err, 'Could not load the archiver'),
            });
            return;
        }

        const zip = new JSZip();
        const usedNames = new Set<string>();
        const archivedKeys: string[] = [];
        let archivedBytes = 0;

        // Fetch sequentially to bound peak memory, accumulating into one archive.
        for (const { key, request } of entries) {
            if (abortRef.current?.signal.aborted) {
                dispatch({ type: 'SET_FAILED', keys: [key], error: 'Cancelled' });
                continue;
            }

            if (archivedBytes >= MAX_ARCHIVE_BYTES) {
                dispatch({
                    type: 'SET_FAILED',
                    keys: [key],
                    error: 'Archive size limit reached',
                });
                continue;
            }

            dispatch({ type: 'SET_DOWNLOADING', key });
            try {
                const { blob, fileName } = await fetchFile(
                    request,
                    (progress) => dispatch({ type: 'SET_PROGRESS', key, progress }),
                    abortRef.current?.signal
                );
                archivedBytes += blob.size;
                const name = uniqueFileName(fileName, usedNames);
                usedNames.add(name);
                dispatch({ type: 'SET_NAME', key, fileName: name });
                zip.file(name, blob);
                archivedKeys.push(key);
                // Not `completed`: these bytes are only in memory until the
                // user saves the archive.
                dispatch({ type: 'SET_ARCHIVED', key });
            }
            catch (err: unknown) {
                dispatch({
                    type: 'SET_FAILED',
                    keys: [key],
                    error: errorMessage(err, 'Download failed'),
                });
            }
        }

        if (archivedKeys.length === 0) return;

        try {
            // Photos are already compressed; STORE avoids wasted CPU for ~no size gain.
            const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
            dispatch({
                type: 'ARCHIVE_READY',
                archive: {
                    id: crypto.randomUUID(),
                    fileName: 'photos.zip',
                    blob,
                    itemKeys: archivedKeys,
                },
            });
        }
        catch (err: unknown) {
            dispatch({
                type: 'SET_FAILED',
                keys: archivedKeys,
                error: errorMessage(err, 'Could not build the archive'),
            });
        }
    }, []);

    /**
     * Cancel every in-flight and queued download.
     *
     * There was no cancellation anywhere in this provider: `DownloadRequest` had no
     * signal, `processQueue` could not be interrupted, and the panel's only control
     * removed a row from the list while its fetch kept running. A user who started a
     * 150-file archive had to kill the tab.
     */
    const cancelAll = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = new AbortController();
        const queued = queueRef.current.flatMap((job) =>
            job.kind === 'zip' ? job.entries.map((e) => e.key) : [job.entry.key]
        );
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
            // Sequential: one file (and one save dialog / one in-memory blob) at a time.
            while (queueRef.current.length > 0) {
                const job = queueRef.current.shift()!;
                try {
                    if (job.kind === 'zip') await processZip(job.entries);
                    else await processOne(job.entry);
                }
                catch (err: unknown) {
                    dispatch({
                        type: 'SET_FAILED',
                        keys: job.kind === 'zip'
                            ? job.entries.map((e) => e.key)
                            : [job.entry.key],
                        error: errorMessage(err, 'Download failed'),
                    });
                }
            }
        }
        finally {
            processingRef.current = false;
        }
    }, [processOne, processZip]);

    const triggerDownload = useCallback(
        (requests: DownloadRequest[]) => {
            if (requests.length === 0) return;

            if (!abortRef.current) abortRef.current = new AbortController();

            // Cap the archive path rather than letting the tab be killed. Told to the
            // user up front instead of failing silently two minutes in.
            let accepted = requests;
            if (requests.length > 1 && requests.length > MAX_ARCHIVE_FILES) {
                accepted = requests.slice(0, MAX_ARCHIVE_FILES);
                toast.warning(
                    `Downloading the first ${MAX_ARCHIVE_FILES} of ${requests.length} items. `
                    + 'Select fewer to download the rest.'
                );
            }

            const entries: QueueEntry[] = accepted.map((request) => ({
                key: crypto.randomUUID(),
                request,
            }));

            // Where the browser only tolerates one unprompted download per page
            // load, a single file goes straight to it inside this gesture, and a
            // multi-file selection becomes one archive the user saves with a
            // second, explicit tap.
            const restricted = blocksAutomaticDownloads();
            const handOff = restricted && entries.length === 1;

            dispatch({
                type: 'ADD',
                items: entries.map((e) => ({
                    key: e.key,
                    fileName:
                        e.request.fileName || (handOff ? 'Download started' : 'Preparing…'),
                })),
            });

            if (handOff) {
                // Stays synchronous — an await here would burn the user gesture.
                const entry = entries[0]!;
                try {
                    handOffToBrowser(entry.request);
                    dispatch({ type: 'SET_HANDOFF', key: entry.key });
                }
                catch (err: unknown) {
                    dispatch({
                        type: 'SET_FAILED',
                        keys: [entry.key],
                        error: errorMessage(err, 'Download failed'),
                    });
                }
                return;
            }

            if (restricted) {
                queueRef.current.push({ kind: 'zip', entries });
            }
            else {
                for (const entry of entries) {
                    queueRef.current.push({ kind: 'single', entry });
                }
            }

            processQueue();
        },
        [processQueue]
    );

    const saveArchive = useCallback((archive: PendingArchive) => {
        if (savedArchivesRef.current.has(archive.id)) return;
        savedArchivesRef.current.add(archive.id);
        try {
            saveBlob(archive.blob, archive.fileName);
            dispatch({ type: 'ARCHIVE_SAVED', id: archive.id });
        }
        catch (err: unknown) {
            dispatch({
                type: 'ARCHIVE_FAILED',
                id: archive.id,
                error: errorMessage(err, 'Could not save the archive'),
            });
        }
    }, []);

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
            archives: state.archives,
            isOpen: state.isOpen,
            triggerDownload,
            cancelAll,
            saveArchive,
            clearFinished,
            togglePanel,
        }),
        [
            state.items,
            state.archives,
            state.isOpen,
            triggerDownload,
            cancelAll,
            saveArchive,
            clearFinished,
            togglePanel,
        ]
    );

    return <DownloadContext.Provider value={value}>{children}</DownloadContext.Provider>;
}
