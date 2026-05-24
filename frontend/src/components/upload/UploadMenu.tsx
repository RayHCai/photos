'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, File, Folder } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { useIsMobile } from '@/lib/hooks/useIsMobile';

interface UploadMenuProps {
    onUploadFiles: () => void;
    onUploadFolder: () => void;
    className?: string;
}

export function UploadMenu({ onUploadFiles, onUploadFolder, className }: UploadMenuProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const isMobile = useIsMobile();

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const handleFiles = useCallback(() => {
        setOpen(false);
        onUploadFiles();
    }, [onUploadFiles]);

    const handleFolder = useCallback(() => {
        setOpen(false);
        onUploadFolder();
    }, [onUploadFolder]);

    return (
        <div ref={ref} className={`relative ${className ?? ''}`}>
            <IconButton
                icon={Plus}
                onClick={isMobile ? onUploadFiles : () => setOpen((o) => !o)}
                title="Upload"
                className="flex-shrink-0"
            />
            {open && !isMobile && (
                <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
                    <button
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 transition-colors"
                        onClick={handleFiles}
                    >
                        <File className="w-4 h-4 text-stone-400" />
                        Upload Files
                    </button>
                    <button
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 transition-colors"
                        onClick={handleFolder}
                    >
                        <Folder className="w-4 h-4 text-stone-400" />
                        Upload Folder
                    </button>
                </div>
            )}
        </div>
    );
}
