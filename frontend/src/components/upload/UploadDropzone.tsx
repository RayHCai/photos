'use client';

import { useState, useRef, useCallback, type ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { useUpload } from '@/lib/hooks/useUpload';
import { filterMediaFiles, readEntriesRecursive } from '@/lib/utils/mediaFiles';
import { toast } from 'sonner';

interface FileDropZoneProps {
    children: ReactNode;
    className?: string;
}

export function FileDropZone({ children, className = '' }: FileDropZoneProps) {
    const [dragging, setDragging] = useState(false);
    const dragCounter = useRef(0);
    const { addFiles } = useUpload();

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current++;
        if (e.dataTransfer?.types.includes('Files')) {
            setDragging(true);
        }
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current--;
        if (dragCounter.current === 0) {
            setDragging(false);
        }
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleDrop = useCallback(
        async (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            dragCounter.current = 0;
            setDragging(false);

            const items = e.dataTransfer?.items;
            if (!items || items.length === 0) return;

            // Check if any dropped items are directories
            const entries: FileSystemEntry[] = [];
            const plainFiles: File[] = [];
            let hasDirectories = false;

            for (let i = 0; i < items.length; i++) {
                const entry = items[i].webkitGetAsEntry?.();
                if (entry) {
                    if (entry.isDirectory) {
                        hasDirectories = true;
                    }
                    entries.push(entry);
                }
                else {
                    // Fallback for browsers without webkitGetAsEntry
                    const file = items[i].getAsFile();
                    if (file) plainFiles.push(file);
                }
            }

            if (hasDirectories || entries.length > 0) {
                try {
                    const nested = await Promise.all(entries.map(readEntriesRecursive));
                    const allMedia = nested.flat();

                    // Also include any plain files that are media
                    allMedia.push(...filterMediaFiles(plainFiles));

                    if (allMedia.length === 0) {
                        toast.info('No supported photos or videos found');
                        return;
                    }

                    addFiles(allMedia);
                }
                catch {
                    toast.error('Failed to read dropped files');
                }
            }
            else if (e.dataTransfer?.files.length) {
                addFiles(e.dataTransfer.files);
            }
        },
        [addFiles]
    );

    return (
        <div
            className={`relative ${className}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            {children}

            {dragging && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-stone-50/80 backdrop-blur-sm transition-opacity">
                    <div className="absolute inset-4 rounded-xl border-2 border-dashed border-stone-400 pointer-events-none" />
                    <div className="flex flex-col items-center gap-3 pointer-events-none">
                        <div className="w-14 h-14 rounded-full bg-stone-200 flex items-center justify-center">
                            <Upload className="w-7 h-7 text-stone-600" />
                        </div>
                        <p className="text-base font-serif text-stone-700">
                            Drop files or folders to upload
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
