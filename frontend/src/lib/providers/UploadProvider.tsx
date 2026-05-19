'use client';

import {
    createContext,
    useReducer,
    useCallback,
    useRef,
    type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { uploadFile, checkDuplicates } from '../api/upload';
import { addItems } from '../api/collections';

export interface UploadItem {
    id: string;
    fileName: string;
    status: 'pending' | 'uploading' | 'completed' | 'failed';
    progress: number;
    error?: string;
}

export interface PendingDuplicate {
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
    case 'SET_PROGRESS':
        return {
            ...state,
            items: state.items.map((i) =>
                i.id === action.id ? { ...i, progress: action.progress } : i
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

export interface UploadContextValue {
    items: UploadItem[];
    isOpen: boolean;
    pendingDuplicates: PendingDuplicate[];
    addFiles: (files: FileList | File[], options?: { collectionId?: string }) => void;
    resolveDuplicates: (decisions: Map<string, 'skip' | 'keep_both'>) => void;
    removeItem: (id: string) => void;
    clearCompleted: () => void;
    togglePanel: () => void;
}

export const UploadContext = createContext<UploadContextValue | null>(null);

export function UploadProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(uploadReducer, {
        items: [],
        isOpen: false,
        pendingDuplicates: [],
    });

    const queryClient = useQueryClient();
    const processingRef = useRef(false);
    const queueRef = useRef<Array<{ id: string; file: File; collectionId?: string; fileName?: string }>>([]);
    const heldFilesRef = useRef<Array<{ file: File; collectionId?: string }>>([]);
    const duplicateNamesRef = useRef<string[]>([]);

    const processQueue = useCallback(async () => {
        if (processingRef.current) return;
        processingRef.current = true;

        const FILE_CONCURRENCY = 8;

        const processItem = async (item: typeof queueRef.current[0]) => {
            dispatch({ type: 'SET_UPLOADING', id: item.id });
            try {
                const mediaItemId = await uploadFile(
                    item.file,
                    (progress) => {
                        dispatch({ type: 'SET_PROGRESS', id: item.id, progress });
                    },
                    item.fileName
                );
                if (item.collectionId) {
                    await addItems(item.collectionId, [mediaItemId]);
                    queryClient.invalidateQueries({ queryKey: ['collections', item.collectionId] });
                }
                dispatch({ type: 'SET_COMPLETED', id: item.id });
                queryClient.invalidateQueries({ queryKey: ['media'] });
            }
            catch (err: any) {
                dispatch({
                    type: 'SET_FAILED',
                    id: item.id,
                    error: err.message || 'Upload failed',
                });
            }
        };

        const workers = Array.from(
            { length: Math.min(FILE_CONCURRENCY, queueRef.current.length) },
            async () => {
                while (queueRef.current.length > 0) {
                    const item = queueRef.current.shift()!;
                    await processItem(item);
                }
            }
        );

        await Promise.all(workers);
        processingRef.current = false;
    }, [queryClient]);

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

            for (const dup of state.pendingDuplicates) {
                const decision = decisions.get(dup.file.name);
                if (decision === 'keep_both') {
                    const renamedName = getNextFileName(dup.file.name, duplicateNamesRef.current);
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

    return (
        <UploadContext.Provider
            value={{
                items: state.items,
                isOpen: state.isOpen,
                pendingDuplicates: state.pendingDuplicates,
                addFiles,
                resolveDuplicates,
                removeItem,
                clearCompleted,
                togglePanel,
            }}
        >
            {children}
        </UploadContext.Provider>
    );
}
