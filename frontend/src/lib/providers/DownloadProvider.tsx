'use client';

import {
    createContext,
    useReducer,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { blocksAutomaticDownloads } from '@/lib/utils/platform';
import {
    archiveDetail,
    archivePercent,
    isArchiveFinished,
} from '@/lib/utils/archiveProgress';
import {
    cancelArchive,
    fetchArchiveProgress,
    type ArchiveProgress,
} from '@/lib/api/media';

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
     * Endpoint that streams a zip of the requested ids, which is how a selection of
     * more than one is downloaded wherever there is one to call. Omit it and a
     * selection is fetched file by file instead — the only option in contexts with
     * no archive endpoint, such as a public share link, and poor everywhere else.
     */
    archiveUrl?: string;
}

type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'failed';

/**
 * `archive` rows are one zip the server builds from a whole selection. The bytes
 * never pass through the page, so unlike a `file` row their progress is reported
 * by the server rather than measured here — see startArchive.
 */
type DownloadKind = 'file' | 'archive';

interface DownloadItem {
    key: string;
    fileName: string;
    kind: DownloadKind;
    status: DownloadStatus;
    progress: number;
    /** Second line under the name, e.g. "12 of 40 files · 340 MB of 1.2 GB". */
    detail?: string;
    error?: string;
}

interface DownloadState {
    items: DownloadItem[];
    isOpen: boolean;
}

/** Statuses the queue will never move on from, so they can be dismissed. */
const FINISHED_STATUSES: readonly DownloadStatus[] = ['completed', 'failed'];

type DownloadAction =
    | { type: 'ADD'; kind: DownloadKind; items: Array<{ key: string; fileName: string }> }
    | { type: 'SET_DOWNLOADING'; key: string }
    | { type: 'SET_PROGRESS'; key: string; progress: number }
    | {
        type: 'SET_ARCHIVE_PROGRESS';
        key: string;
        fileName: string;
        progress: number;
        detail: string;
    }
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
                    kind: action.kind,
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
    case 'SET_ARCHIVE_PROGRESS':
        return {
            ...state,
            items: patchItems(state.items, [action.key], {
                status: 'downloading',
                fileName: action.fileName,
                progress: action.progress,
                detail: action.detail,
            }),
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
 * How long a submitted form is left in the document.
 *
 * Until the response headers arrive the request belongs to the form's target, and
 * tearing the form out early can cancel it — for an archive that window is however
 * long the server takes to open the first object, not milliseconds.
 */
const HANDOFF_CLEANUP_DELAY_MS = 60_000;

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
 * Every download gets its own tab.
 *
 * Chrome's download limiter keeps its state per *tab*: a tab starts at
 * ALLOW_ONE_DOWNLOAD, and once it has spent that, every later download needs the
 * user to allow multiple downloads for the site. An installed PWA has nowhere to
 * show that request, so the download manager takes the download, posts its
 * notification, and then waits on a decision that can never arrive — the download
 * hangs. Modern Chromium only resets the state on a user-initiated *navigation*,
 * which is why a reload buys exactly one more download and a tap does not.
 *
 * Nothing inside this tab escapes that: a gestured save, a hidden frame, and a
 * top-level navigation are all one tab's single allowance (frames do not get their
 * own state — they share the tab's). A tab that does not exist yet, however, has
 * its full allowance, and Chrome closes a tab whose only navigation turned into a
 * download. So each download opens one, spends its allowance, and disappears.
 *
 * The visible cost is a tab that flickers open and shut. The alternative is
 * granting the site's "Automatic downloads" permission, which makes the limiter
 * stop asking — but that is a setting on each device, not something the page can
 * ask for or detect.
 */
function openDownloadTab(url: string) {
    const tab = window.open(url, '_blank');
    // Popup blocked despite the gesture. Downloading in place spends this tab's
    // allowance, which at least works once, and is better than doing nothing.
    if (!tab) window.location.href = url;
}

/**
 * Post a selection to the archive endpoint as a navigation, so the response — a
 * zip streamed as it is built — belongs to the browser's download manager rather
 * than to this page. That costs no memory here, survives the app being
 * backgrounded, and is the only shape of download a phone reliably accepts.
 *
 * Where it navigates differs by platform, and only by platform:
 *
 * - Handoff platforms get a new tab, because Chrome's download limiter counts per
 *   tab and a fresh tab has its full allowance (see openDownloadTab). `_blank`
 *   every time rather than a fixed name, since a reused tab brings its spent
 *   allowance with it.
 * - Everywhere else a hidden iframe, which downloads just as well without a tab
 *   flickering open and shut on every selection.
 *
 * The response is never read either way: an error arrives as a JSON body nobody
 * sees, which is why the same failure is also recorded against `progressToken` and
 * surfaced by the panel.
 */
function submitArchiveRequest(action: string, ids: string[], progressToken: string) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = action;
    form.style.display = 'none';

    let frame: HTMLIFrameElement | null = null;
    if (requiresBrowserHandoff()) {
        form.target = '_blank';
    }
    else {
        frame = document.createElement('iframe');
        // Unique per download: two selections started seconds apart must not
        // navigate the same frame, which would cancel the first.
        frame.name = `archive-${progressToken}`;
        frame.style.display = 'none';
        document.body.appendChild(frame);
        form.target = frame.name;
    }

    // One field rather than one input per id: a selection of two thousand would
    // otherwise put two thousand nodes in the document while a tap is handled.
    const idsField = document.createElement('input');
    idsField.type = 'hidden';
    idsField.name = 'ids';
    idsField.value = ids.join(',');
    form.appendChild(idsField);

    const tokenField = document.createElement('input');
    tokenField.type = 'hidden';
    tokenField.name = 'progressToken';
    tokenField.value = progressToken;
    form.appendChild(tokenField);

    document.body.appendChild(form);
    form.submit();

    window.setTimeout(() => {
        form.remove();
        // Safe by now: once the attachment headers have arrived the browser has
        // taken the transfer over, and it no longer belongs to this frame.
        frame?.remove();
    }, HANDOFF_CLEANUP_DELAY_MS);
}

/** How often the panel asks the server how far along an archive is. */
const ARCHIVE_POLL_INTERVAL_MS = 700;

/**
 * How long to keep polling for an archive the server has no record of before
 * calling it a failure. Generous: this covers the request being in flight, the
 * server opening its first object, and a phone on a slow connection — and a
 * request that really was rejected is normally reported through the record rather
 * than through this timeout.
 */
const ARCHIVE_START_GRACE_MS = 30_000;

/**
 * How long the poll keeps trying an API that is not answering at all. Past this
 * the panel stops describing the download rather than keep a timer running against
 * a backend that may be down for the rest of the session.
 */
const ARCHIVE_UNREACHABLE_LIMIT_MS = 60_000;

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
    /** Live archive downloads, keyed by progress token, each holding its poll. */
    const archivePollsRef = useRef(new Map<string, () => void>());

    /**
     * Stop polling on unmount.
     *
     * The download itself is unaffected — it belongs to the browser by then — but a
     * timer that outlives the tree dispatches into a dead reducer once a second for
     * as long as the archive runs.
     */
    useEffect(() => {
        const polls = archivePollsRef.current;
        return () => {
            for (const stop of polls.values()) stop();
            polls.clear();
        };
    }, []);

    /**
     * Follow one archive to its end, reporting it into the panel.
     *
     * Polled, because there is nothing local to observe: the zip is a navigation
     * whose response the browser owns, and the server is the only party that knows
     * how much of it has been written (see archiveProgress.service on the backend).
     */
    const pollArchive = useCallback((token: string) => {
        let timer = 0;
        let stopped = false;
        let everSeen = false;
        /** When the polls started failing outright, or 0 while they are landing. */
        let unreachableSince = 0;
        const startedAt = Date.now();

        const stop = () => {
            stopped = true;
            window.clearTimeout(timer);
            archivePollsRef.current.delete(token);
        };

        const finish = (progress: ArchiveProgress) => {
            stop();
            if (progress.status !== 'completed') {
                dispatch({
                    type: 'SET_FAILED',
                    keys: [token],
                    error: progress.status === 'cancelled'
                        ? 'Cancelled'
                        : progress.error || 'Download failed',
                });
                return;
            }
            dispatch({
                type: 'SET_ARCHIVE_PROGRESS',
                key: token,
                fileName: progress.fileName,
                progress: 100,
                detail: archiveDetail(progress),
            });
            dispatch({ type: 'SET_COMPLETED', key: token });
        };

        /**
         * Give up on reporting, without claiming the download failed.
         *
         * Reached when the transfer has outlived anything that can describe it — the
         * record expired, or the API stopped answering. The zip may well still be
         * arriving; it belongs to the browser and nothing here can end it. Saying
         * "failed" would be a guess, and a wrong one most of the time.
         */
        const stopTracking = () => {
            stop();
            dispatch({ type: 'SET_NAME', key: token, fileName: 'Download in progress' });
            dispatch({ type: 'SET_COMPLETED', key: token });
        };

        const tick = async () => {
            let progress: ArchiveProgress | null = null;
            try {
                progress = await fetchArchiveProgress(token);
                unreachableSince = 0;
            }
            catch {
                // A poll that fails is not a download that failed — the transfer is
                // the browser's and is unaffected. Keep asking, for a while.
                unreachableSince = unreachableSince || Date.now();
            }
            if (stopped) return;

            if (progress) {
                everSeen = true;
                if (isArchiveFinished(progress.status)) {
                    finish(progress);
                    return;
                }
                dispatch({
                    type: 'SET_ARCHIVE_PROGRESS',
                    key: token,
                    fileName: progress.fileName || 'Preparing zip…',
                    progress: archivePercent(progress),
                    detail: archiveDetail(progress),
                });
            }
            else if (unreachableSince) {
                // Bounded, or a backend that stays down leaves a timer polling it
                // every second for the rest of the session.
                if (Date.now() - unreachableSince > ARCHIVE_UNREACHABLE_LIMIT_MS) {
                    if (everSeen) stopTracking();
                    else {
                        stop();
                        dispatch({
                            type: 'SET_FAILED',
                            keys: [token],
                            error: 'Download did not start',
                        });
                    }
                    return;
                }
            }
            else if (everSeen) {
                // The record was there and is gone: its TTL outlives any gap between
                // polls, so in practice this is a backend that restarted mid-download.
                stopTracking();
                return;
            }
            else if (Date.now() - startedAt > ARCHIVE_START_GRACE_MS) {
                // The server is answering and has never heard of this token, so the
                // request did not reach the endpoint — the panel must not sit at
                // "Preparing…" forever for a download that is not happening.
                stop();
                dispatch({
                    type: 'SET_FAILED',
                    keys: [token],
                    error: 'Download did not start',
                });
                return;
            }

            timer = window.setTimeout(tick, ARCHIVE_POLL_INTERVAL_MS);
        };

        archivePollsRef.current.set(token, stop);
        tick();
    }, []);

    /**
     * Download a selection as one zip built by the server.
     *
     * Used on every platform, not only the ones that need the handoff: one archive
     * is one download, where a selection fetched file by file is a download per
     * file — which a desktop browser prompts about and a phone refuses outright.
     */
    const startArchive = useCallback(
        (requests: DownloadRequest[], archiveEndpoint: string) => {
            const token = crypto.randomUUID();
            dispatch({
                type: 'ADD',
                kind: 'archive',
                items: [{ key: token, fileName: 'Preparing zip…' }],
            });
            dispatch({ type: 'SET_DOWNLOADING', key: token });
            // Synchronous, and before the poll: this is what spends the tap's user
            // activation, and awaiting anything first would lose it.
            submitArchiveRequest(archiveEndpoint, requests.map((r) => r.id), token);
            pollArchive(token);
        },
        [pollArchive]
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

        /**
         * An archive cannot be aborted from here — the transfer belongs to the
         * browser's download manager, and this page has no handle on it. The server
         * does: ending the response is what interrupts the download, so the cancel
         * goes there. Reported as cancelled immediately rather than waiting for the
         * poll to confirm, so the button does something the moment it is pressed.
         */
        const archives = [...archivePollsRef.current.keys()];
        for (const token of archives) {
            archivePollsRef.current.get(token)?.();
            cancelArchive(token).catch(() => {
                // Best effort. The panel has stopped tracking it either way, and a
                // zip that keeps arriving is a far smaller surprise than an error.
            });
        }

        const cancelled = [...queued, ...archives];
        if (cancelled.length > 0) {
            dispatch({ type: 'SET_FAILED', keys: cancelled, error: 'Cancelled' });
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
     * Give the whole job to the browser's download manager, in a tab of its own.
     *
     * Two separate limits are being worked around here, and missing either one looks
     * the same to a user — a download that never arrives, with nothing said about it.
     *
     * The page must not be what saves the file. A save performed after `await
     * fetch(...)` has no live activation behind it, and beyond that a page-held blob
     * is simply not a first-class download on Android Chrome as a PWA: it produced a
     * notification and no file even when a tap was what asked for it. A URL the
     * server marks as an attachment is a download the browser performs itself, which
     * costs no memory here, survives the app being backgrounded, and reports progress
     * and failure in the system UI.
     *
     * And each download needs a tab of its own, because the limiter's allowance is
     * per tab — see openDownloadTab.
     *
     * A selection is a zip before it ever reaches here (see triggerDownload), so
     * what is left is a single file, or a selection in a context with no archive
     * endpoint. Returns false for the latter, leaving the caller to fall back.
     */
    const handOffToBrowser = useCallback((requests: DownloadRequest[]): boolean => {
        if (requests.length === 1) {
            toast.success('Saving to your downloads');
            openDownloadTab(requests[0]!.url);
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
    }, []);

    const triggerDownload = useCallback(
        (requests: DownloadRequest[], options: DownloadOptions = {}) => {
            if (requests.length === 0) return;

            /**
             * Any selection with somewhere to build a zip becomes one, on every
             * platform. Downloading file by file means a download per file, which a
             * phone refuses outright and a desktop browser interrupts with a
             * permission prompt — and it is also N round trips where this is one.
             */
            if (requests.length > 1 && options.archiveUrl) {
                startArchive(requests, options.archiveUrl);
                return;
            }

            if (requiresBrowserHandoff() && handOffToBrowser(requests)) return;

            if (!abortRef.current) abortRef.current = new AbortController();

            const entries: QueueEntry[] = requests.map((request) => ({
                key: crypto.randomUUID(),
                request,
            }));

            dispatch({
                type: 'ADD',
                kind: 'file',
                items: entries.map((e) => ({
                    key: e.key,
                    fileName: e.request.fileName || 'Preparing…',
                })),
            });

            queueRef.current.push(...entries);
            processQueue();
        },
        [processQueue, handOffToBrowser, startArchive]
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
