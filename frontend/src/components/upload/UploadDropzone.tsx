'use client';

import { useState, useEffect, useCallback } from 'react';
import { Upload } from 'lucide-react';
import { useUpload } from '@/lib/hooks/useUpload';

export function UploadDropzone() {
    const [dragging, setDragging] = useState(false);
    const { addFiles } = useUpload();

    const handleDragEnter = useCallback((e: DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer?.types.includes('Files')) {
            setDragging(true);
        }
    }, []);

    const handleDragLeave = useCallback((e: DragEvent) => {
        e.preventDefault();
        if (e.relatedTarget === null) {
            setDragging(false);
        }
    }, []);

    const handleDragOver = useCallback((e: DragEvent) => {
        e.preventDefault();
    }, []);

    const handleDrop = useCallback(
        (e: DragEvent) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer?.files.length) {
                addFiles(e.dataTransfer.files);
            }
        },
        [addFiles]
    );

    useEffect(() => {
        window.addEventListener('dragenter', handleDragEnter);
        window.addEventListener('dragleave', handleDragLeave);
        window.addEventListener('dragover', handleDragOver);
        window.addEventListener('drop', handleDrop);
        return () => {
            window.removeEventListener('dragenter', handleDragEnter);
            window.removeEventListener('dragleave', handleDragLeave);
            window.removeEventListener('dragover', handleDragOver);
            window.removeEventListener('drop', handleDrop);
        };
    }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

    if (!dragging) return null;

    return (
        <div className="fixed inset-0 z-50 bg-stone-900/80 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center gap-4 text-stone-50">
                <Upload className="w-12 h-12" />
                <p className="text-lg font-serif">Drop to upload</p>
            </div>
        </div>
    );
}
