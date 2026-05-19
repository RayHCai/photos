'use client';

import {
    createContext,
    useReducer,
    useCallback,
    useRef,
    type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { uploadFile } from '../api/upload';
import { addItems } from '../api/collections';

export interface UploadItem {
    id: string;
    fileName: string;
    status: 'pending' | 'uploading' | 'completed' | 'failed';
    progress: number;
    error?: string;
}

interface UploadState {
    items: UploadItem[];
    isOpen: boolean;
}

type UploadAction =
    | { type: 'ADD_FILES'; files: Array<{ id: string; fileName: string }> }
    | { type: 'SET_UPLOADING'; id: string }
    | { type: 'SET_PROGRESS'; id: string; progress: number }
    | { type: 'SET_COMPLETED'; id: string }
    | { type: 'SET_FAILED'; id: string; error: string }
    | { type: 'REMOVE'; id: string }
    | { type: 'CLEAR_COMPLETED' }
    | { type: 'TOGGLE_PANEL' };

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
    default:
        return state;
    }
}

interface UploadContextValue {
    items: UploadItem[];
    isOpen: boolean;
    addFiles: (files: FileList | File[], options?: { collectionId?: string }) => void;
    removeItem: (id: string) => void;
    clearCompleted: () => void;
    togglePanel: () => void;
}

export const UploadContext = createContext<UploadContextValue | null>(null);

export function UploadProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(uploadReducer, {
        items: [],
        isOpen: false,
    });

    const queryClient = useQueryClient();
    const processingRef = useRef(false);
    const queueRef = useRef<Array<{ id: string; file: File; collectionId?: string }>>([]);

    const processQueue = useCallback(async () => {
        if (processingRef.current) return;
        processingRef.current = true;

        while (queueRef.current.length > 0) {
            const item = queueRef.current.shift()!;
            dispatch({ type: 'SET_UPLOADING', id: item.id });

            try {
                const mediaItemId = await uploadFile(item.file, (progress) => {
                    dispatch({ type: 'SET_PROGRESS', id: item.id, progress });
                });
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
        }

        processingRef.current = false;
    }, [queryClient]);

    const addFiles = useCallback(
        (files: FileList | File[], options?: { collectionId?: string }) => {
            const fileArray = Array.from(files);
            const entries = fileArray.map((file) => ({
                id: crypto.randomUUID(),
                file,
                collectionId: options?.collectionId,
            }));

            dispatch({
                type: 'ADD_FILES',
                files: entries.map((e) => ({
                    id: e.id,
                    fileName: e.file.name,
                })),
            });

            queueRef.current.push(...entries);
            processQueue();
        },
        [processQueue]
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
                addFiles,
                removeItem,
                clearCompleted,
                togglePanel,
            }}
        >
            {children}
        </UploadContext.Provider>
    );
}
