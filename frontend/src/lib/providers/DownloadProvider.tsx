'use client';

import {
    createContext,
    useReducer,
    useCallback,
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

export function DownloadProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(downloadReducer, {
        items: [],
        isOpen: false,
    });

    const processingRef = useRef(false);
    const queueRef = useRef<QueueEntry[]>([]);

    const processOne = useCallback(async (entry: QueueEntry) => {
        const { key, request } = entry;
        dispatch({ type: 'SET_DOWNLOADING', key });

        try {
            const res = await fetch(request.url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const contentType = res.headers.get('Content-Type') ?? '';
            const totalStr = res.headers.get('Content-Length');
            const total = totalStr ? parseInt(totalStr, 10) : 0;

            let blob: Blob;
            // Stream the body so we can report byte-level progress (Content-Length is
            // CORS-exposed by the bucket). Fall back to a plain blob otherwise.
            if (res.body && total > 0) {
                const reader = res.body.getReader();
                const chunks: BlobPart[] = [];
                let received = 0;
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value as BlobPart);
                    received += value.length;
                    dispatch({
                        type: 'SET_PROGRESS',
                        key,
                        progress: Math.round((received / total) * 100),
                    });
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
            dispatch({ type: 'SET_NAME', key, fileName });

            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(objectUrl);

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

    const processQueue = useCallback(async () => {
        if (processingRef.current) return;
        processingRef.current = true;

        // Sequential: one file (and one save dialog / one in-memory blob) at a time.
        while (queueRef.current.length > 0) {
            const entry = queueRef.current.shift()!;
            await processOne(entry);
        }

        processingRef.current = false;
    }, [processOne]);

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
