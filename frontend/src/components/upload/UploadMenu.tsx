'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, File, Folder, FolderOpen, Images } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { isAndroid } from '@/lib/utils/platform';

interface UploadMenuProps {
    onUploadFiles: () => void;
    onUploadFolder: () => void;
    /**
     * Opens the uncapped document picker. Offered on Android phones only, where the
     * default picker is the system Photo Picker and stops at 100 items.
     */
    onBrowseFiles?: () => void;
    className?: string;
    /** Greys the button out; `disabledReason` becomes its tooltip. */
    disabled?: boolean;
    disabledReason?: string;
}

export function UploadMenu({
    onUploadFiles,
    onUploadFolder,
    onBrowseFiles,
    className,
    disabled = false,
    disabledReason,
}: UploadMenuProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const isMobile = useIsMobile();
    // Read after mount: there is no user agent during SSR, and guessing would
    // render a different button on Android than the server sent.
    const [android, setAndroid] = useState(false);
    useEffect(() => setAndroid(isAndroid()), []);
    const offerBrowse = isMobile && android && !!onBrowseFiles;

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

    const handleBrowse = useCallback(() => {
        setOpen(false);
        onBrowseFiles?.();
    }, [onBrowseFiles]);

    const itemClass =
        'flex w-full items-center gap-2 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 transition-colors';

    return (
        <div ref={ref} className={`relative ${className ?? ''}`}>
            <IconButton
                icon={Plus}
                onClick={isMobile && !offerBrowse ? onUploadFiles : () => setOpen((o) => !o)}
                title={disabled ? disabledReason : 'Upload'}
                aria-label="Upload"
                disabled={disabled}
                className="flex-shrink-0 disabled:opacity-40 disabled:pointer-events-none"
            />
            {open && offerBrowse && !disabled && (
                <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
                    <button className={itemClass} onClick={handleFiles}>
                        <Images className="w-4 h-4 text-stone-400" />
                        Photos &amp; videos
                    </button>
                    <button className={`${itemClass} text-left`} onClick={handleBrowse}>
                        <FolderOpen className="w-4 h-4 flex-shrink-0 text-stone-400" />
                        <span>
                            Browse files
                            <span className="block text-xs text-stone-400">No 100-item limit</span>
                        </span>
                    </button>
                </div>
            )}
            {open && !isMobile && !disabled && (
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
