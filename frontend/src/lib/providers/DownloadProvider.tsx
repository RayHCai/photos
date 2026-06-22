'use client';

import {
    createContext,
    useReducer,
    useCallback,
    useRef,
    type ReactNode,
} from 'react';
import { useIsMobile } from '@/lib/hooks/useIsMobile';

/** A single file to download. `url` is the fully-resolved endpoint to fetch bytes from. */
export interface DownloadRequest {
    /** Media id — used for fallback file naming when the server name is unavailable. */
    id: string;
    /** Fully-resolved URL to fetch the file from. */
    url: string;
    /** Optional known filename; otherwise derived from the response or falls back to the id. */
    fileName?: string;
}

interface DownloadItem {
    key: string;
    fileName: string;
    status: 'pending' | 'downloading' | 'completed' | 'failed';
    progress: number;
    error?: string;
}

interface DownloadState {
    items: DownloadItem[];
    isOpen: boolean;
}

type DownloadAction =
    | { type: 'ADD'; items: Array<{ key: string; fileName: string }> }
    | { type: 'SET_DOWNLOADING'; key: string }
    | { type: 'SET_PROGRESS'; key: string; progress: number }
    | { type: 'SET_NAME'; key: string; fileName: string }
    | { type: 'SET_COMPLETED'; key: string }
    | { type: 'SET_FAILED'; key: string; error: string }
    | { type: 'CLEAR_FINISHED' }
    | { type: 'TOGGLE_PANEL' };

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
            items: state.items.map((i) =>
                i.key === action.key ? { ...i, status: 'downloading' as const } : i
            ),
        };
    case 'SET_PROGRESS':
        return {
            ...state,
            items: state.items.map((i) =>
                i.key === action.key ? { ...i, progress: action.progress } : i
            ),
        };
    case 'SET_NAME':
        return {
            ...state,
            items: state.items.map((i) =>
                i.key === action.key ? { ...i, fileName: action.fileName } : i
            ),
        };
    case 'SET_COMPLETED':
        return {
            ...state,
            items: state.items.map((i) =>
                i.key === action.key
                    ? { ...i, status: 'completed' as const, progress: 100 }
                    : i
            ),
        };
    case 'SET_FAILED':
        return {
            ...state,
            items: state.items.map((i) =>
                i.key === action.key
                    ? { ...i, status: 'failed' as const, error: action.error }
                    : i
            ),
        };
    case 'CLEAR_FINISHED':
        return {
            ...state,
            items: state.items.filter(
                (i) => i.status !== 'completed' && i.status !== 'failed'
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
    isOpen: boolean;
    /** Queue one or more files for download, showing progress in the panel. */
    triggerDownload: (requests: DownloadRequest[]) => void;
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
 * `zip` fetches several files into one archive and saves that — used on mobile,
 * where browsers only allow one programmatic download per user gesture.
 */
type DownloadJob =
    | { kind: 'single'; entry: QueueEntry }
    | { kind: 'zip'; entries: QueueEntry[] };

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

/** Save a blob to disk via a temporary anchor click. */
function saveBlob(blob: Blob, fileName: string) {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
}

/**
 * Fetch a file into a Blob, reporting byte-level progress when the body can be
 * streamed (Content-Length is CORS-exposed by the bucket); otherwise falls back
 * to a plain blob. Returns the blob and the resolved file name.
 */
async function fetchFile(
    request: DownloadRequest,
    onProgress: (progress: number) => void
): Promise<{ blob: Blob; fileName: string }> {
    const res = await fetch(request.url);
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
    const queueRef = useRef<DownloadJob[]>([]);

    // Read inside the (stable) callbacks below without re-creating them per resize.
    const isMobile = useIsMobile();
    const isMobileRef = useRef(isMobile);
    isMobileRef.current = isMobile;

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
        catch (err: any) {
            dispatch({
                type: 'SET_FAILED',
                key,
                error: err?.message || 'Download failed',
            });
        }
    }, []);

    const processZip = useCallback(async (entries: QueueEntry[]) => {
        const { default: JSZip } = await import('jszip');
        const zip = new JSZip();
        const usedNames = new Set<string>();
        let added = 0;

        // Fetch sequentially to bound peak memory, accumulating into one archive.
        for (const { key, request } of entries) {
            dispatch({ type: 'SET_DOWNLOADING', key });
            try {
                const { blob, fileName } = await fetchFile(request, (progress) =>
                    dispatch({ type: 'SET_PROGRESS', key, progress })
                );
                const name = uniqueFileName(fileName, usedNames);
                usedNames.add(name);
                dispatch({ type: 'SET_NAME', key, fileName: name });
                zip.file(name, blob);
                added += 1;
                dispatch({ type: 'SET_COMPLETED', key });
            }
            catch (err: any) {
                dispatch({
                    type: 'SET_FAILED',
                    key,
                    error: err?.message || 'Download failed',
                });
            }
        }

        if (added === 0) return;

        // Photos are already compressed; STORE avoids wasted CPU for ~no size gain.
        const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
        saveBlob(zipBlob, 'photos.zip');
    }, []);

    const processQueue = useCallback(async () => {
        if (processingRef.current) return;
        processingRef.current = true;

        // Sequential: one file (and one save dialog / one in-memory blob) at a time.
        while (queueRef.current.length > 0) {
            const job = queueRef.current.shift()!;
            if (job.kind === 'zip') await processZip(job.entries);
            else await processOne(job.entry);
        }

        processingRef.current = false;
    }, [processOne, processZip]);

    const triggerDownload = useCallback(
        (requests: DownloadRequest[]) => {
            if (requests.length === 0) return;

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

            // Mobile browsers only fire one programmatic download per user gesture,
            // so a multi-file selection is bundled into a single .zip. Single files
            // (and all desktop downloads) save individually.
            if (isMobileRef.current && entries.length > 1) {
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

    const clearFinished = useCallback(() => {
        dispatch({ type: 'CLEAR_FINISHED' });
    }, []);

    const togglePanel = useCallback(() => {
        dispatch({ type: 'TOGGLE_PANEL' });
    }, []);

    return (
        <DownloadContext.Provider
            value={{
                items: state.items,
                isOpen: state.isOpen,
                triggerDownload,
                clearFinished,
                togglePanel,
            }}
        >
            {children}
        </DownloadContext.Provider>
    );
}
