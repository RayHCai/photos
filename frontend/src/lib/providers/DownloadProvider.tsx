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

export interface DownloadOptions {
    /**
     * Endpoint that streams a zip of the requested ids, used to turn a selection
     * into a single download on platforms that will not accept several. Omit it and
     * a selection is fetched file by file instead — correct on desktop, and the
     * only option in contexts with no archive endpoint (a public share link).
     */
    archiveUrl?: string;
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
    /**
     * Start downloading one or more files.
     *
     * MUST be called directly from a click or tap handler. Where the page cannot
     * save files itself, this hands the work to the browser's download manager, and
     * the activation the handler carries is what makes that allowed.
     */
    triggerDownload: (requests: DownloadRequest[], options?: DownloadOptions) => void;
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

/**
 * How long a handoff frame is left in the document.
 *
 * Until the response headers arrive the request belongs to the frame, and removing
 * it cancels the download — for an archive that window is however long the server
 * takes to open the first object, not milliseconds. Once the browser has decided
 * the response is a download it owns the transfer outright and the frame no longer
 * matters, so this only has to be longer than the slowest plausible first byte.
 */
const HANDOFF_FRAME_TTL_MS = 10 * 60_000;

function errorMessage(err: unknown, fallback: string): string {
    return (err instanceof Error && err.message) || fallback;
}

/** A cancelled fetch is a user action, not a failure worth an error message. */
function isAbort(err: unknown): boolean {
    return err instanceof DOMException && err.name === 'AbortError';
}

/** Cached: a page's UA does not change, and this is consulted per download. */
let gestureRequired: boolean | null = null;
function requiresBrowserHandoff(): boolean {
    if (gestureRequired === null) gestureRequired = blocksAutomaticDownloads();
    return gestureRequired;
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
 * Save a blob the page already holds.
 *
 * Works where the page is allowed to save files at all, which is not everywhere:
 * this is a save with no user activation behind it (the fetch that produced the
 * blob has long since resolved), and both mobile engines refuse those after the
 * first one per page load. Hence handOffToBrowser, and hence this being reached
 * only when requiresBrowserHandoff() is false.
 */
function saveBlob(blob: Blob, fileName: string) {
    const objectUrl = URL.createObjectURL(blob);
    clickDownloadAnchor(objectUrl, fileName, () => URL.revokeObjectURL(objectUrl));
}

/**
 * Point the whole window at the file and let the download manager take it.
 *
 * A response marked `attachment` never commits its navigation, so this does not
 * leave the page: the browser peels the download off and the app is still here.
 * The plainest download mechanism there is, which is the point — it is the one
 * every ordinary download link on the web uses.
 *
 * Not done in a hidden frame, which would otherwise be nicer (see
 * postArchiveInFrame): this endpoint redirects to a presigned S3 URL, and framed
 * navigation is checked against `frame-src`, which falls back to `default-src
 * 'self'` in the app's CSP. The redirect would be blocked at the second hop.
 *
 * The cost of the top level is that a response which *is* renderable replaces the
 * app with it — raw JSON from a 401 after the session expired, or a 404 for an item
 * deleted from another device. Recoverable with Back, and the alternative is a
 * download that silently does not happen, which is what got us here.
 */
function navigateToDownload(url: string) {
    window.location.href = url;
}

/**
 * Post the selection to the archive endpoint from a hidden frame.
 *
 * Same-origin with no redirect, so unlike navigateToDownload this can be framed —
 * and framing is worth it here, because it makes a failure both visible and
 * harmless. A download never commits a navigation, so on success the frame stays on
 * its empty document and no load event fires; if the server answers with something
 * renderable instead, the frame loads it out of sight and the text is read out and
 * reported. A selection is also the case where an error is most likely to be worth
 * explaining — too many items, none of them still existing.
 */
function postArchiveInFrame(action: string, ids: string[]) {
    const frame = document.createElement('iframe');
    frame.name = `download-${crypto.randomUUID()}`;
    frame.style.display = 'none';
    document.body.appendChild(frame);

    frame.addEventListener('load', () => {
        let text: string;
        try {
            const doc = frame.contentDocument;
            // The frame's own initial empty document, before any response.
            if (!doc || doc.URL === 'about:blank') return;
            text = doc.body?.textContent?.trim() ?? '';
        }
        catch {
            // Not readable, so not reportable. Should not happen same-origin.
            return;
        }

        let message = 'Download failed';
        try {
            message = (JSON.parse(text) as { error?: string }).error ?? message;
        }
        catch {
            // Not JSON — a proxy's HTML error page, or nothing at all.
        }
        toast.error(message);
        frame.remove();
    });

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = action;
    form.target = frame.name;
    form.style.display = 'none';

    // One field rather than one input per id: a selection of two thousand would
    // otherwise put two thousand nodes in the document while a tap is handled.
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'ids';
    input.value = ids.join(',');
    form.appendChild(input);

    document.body.appendChild(form);
    form.submit();
    form.remove();

    window.setTimeout(() => frame.remove(), HANDOFF_FRAME_TTL_MS);
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
            // blob at a time, however large the selection.
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

    /**
     * Give the whole job to the browser's download manager, in the tap.
     *
     * The page fetching bytes and then saving them cannot work here, and no amount
     * of restructuring on this side changes that: by the time a fetch resolves there
     * is no activation left, and a save without one is refused — silently, and
     * whether or not a tap is what asked for it. The way out is for the page not to
     * hold the bytes at all. A URL the server marks as an attachment is a download
     * the browser performs itself, which is the one path it treats as first-class:
     * it survives the app being backgrounded, reports progress and failure in the
     * system UI, costs no memory here, and can be done again without a reload.
     *
     * One activation authorizes one download, so a selection cannot be N of these.
     * It goes to the archive endpoint as a single zip instead. Returns false when
     * there is no archive endpoint to use, leaving the caller to fall back.
     */
    const handOffToBrowser = useCallback(
        (requests: DownloadRequest[], options: DownloadOptions): boolean => {
            if (requests.length === 1) {
                toast.success('Saving to your downloads');
                navigateToDownload(requests[0]!.url);
                return true;
            }
            if (options.archiveUrl) {
                postArchiveInFrame(options.archiveUrl, requests.map((r) => r.id));
                // The zip is built as it is sent, so the browser has nothing to show
                // until the first object is open. Without this the tap looks ignored.
                toast.success(`Preparing ${requests.length} files as a zip…`);
                return true;
            }

            /**
             * No archive endpoint in this context — a public share link, which has no
             * session to authenticate one with. The fetch-and-save path below is all
             * that is left and this platform will refuse most of those saves, so say
             * so rather than let the panel report a batch of downloads that did not
             * happen. The panel claiming success while nothing arrives is the exact
             * complaint that started this.
             */
            toast.warning(
                `Your browser will only save one of these at a time — open items individually to save all ${requests.length}.`
            );
            return false;
        },
        []
    );

    const triggerDownload = useCallback(
        (requests: DownloadRequest[], options: DownloadOptions = {}) => {
            if (requests.length === 0) return;

            if (requiresBrowserHandoff() && handOffToBrowser(requests, options)) return;

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
        [processQueue, handOffToBrowser]
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
