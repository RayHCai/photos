'use client';

import { useUpload } from '@/lib/hooks/useUpload';
import { pluralize } from '@/lib/utils/pluralize';
import {
    ChevronDown,
    ChevronUp,
    X,
    Check,
    AlertCircle,
    Loader2,
} from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';

export function UploadProgress() {
    const { items, isOpen, togglePanel, removeItem, clearCompleted } =
        useUpload();

    if (items.length === 0) return null;

    const completed = items.filter((i) => i.status === 'completed').length;
    const failed = items.filter((i) => i.status === 'failed').length;
    const total = items.length;
    const hasCompleted = completed > 0;
    const allDone = completed + failed === total;
    return (
        <div className="fixed bottom-5 right-5 z-40 w-80 rounded-lg bg-white/80 backdrop-blur-xl shadow-2xl shadow-black/8 border border-stone-200/60 overflow-hidden transition-all duration-300">
            {/* Header */}
            <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors duration-150 hover:bg-stone-50/80"
                onClick={togglePanel}
            >
                <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-stone-900 leading-tight">
                        {allDone
                            ? `${pluralize(completed, 'upload')} complete`
                            : `Uploading ${completed + 1} of ${total}`}
                    </p>
                </div>
                <div className="flex items-center gap-1.5">
                    {hasCompleted && allDone && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                clearCompleted();
                            }}
                            className="text-[11px] font-medium text-stone-400 hover:text-stone-700 px-2 py-1 rounded-md hover:bg-stone-100 transition-colors duration-150"
                        >
                            Dismiss
                        </button>
                    )}
                    <div className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-stone-100 transition-colors duration-150">
                        {isOpen ? (
                            <ChevronDown className="w-4 h-4 text-stone-400" />
                        ) : (
                            <ChevronUp className="w-4 h-4 text-stone-400" />
                        )}
                    </div>
                </div>
            </div>

            {/* File list */}
            {isOpen && (
                <div className="max-h-56 overflow-y-auto border-t border-stone-100">
                    {items.map((item) => (
                        <div
                            key={item.id}
                            className="flex items-center gap-3 px-4 py-2.5 transition-colors duration-100 hover:bg-stone-50/60"
                        >
                            {/* Status indicator */}
                            <div className="flex-shrink-0">
                                {item.status === 'completed' && (
                                    <div className="w-5 h-5 rounded-full bg-emerald-50 flex items-center justify-center">
                                        <Check className="w-3 h-3 text-emerald-600" />
                                    </div>
                                )}
                                {item.status === 'failed' && (
                                    <div className="w-5 h-5 rounded-full bg-red-50 flex items-center justify-center">
                                        <AlertCircle className="w-3 h-3 text-red-500" />
                                    </div>
                                )}
                                {item.status === 'uploading' && (
                                    <Loader2 className="w-4 h-4 text-stone-400 animate-spin" />
                                )}
                                {item.status === 'pending' && (
                                    <div className="w-4 h-4 rounded-full border-2 border-stone-200" />
                                )}
                            </div>

                            {/* File info */}
                            <div className="flex-1 min-w-0">
                                <p className="text-[13px] text-stone-700 truncate leading-tight">
                                    {item.fileName}
                                </p>
                                {item.status === 'uploading' && (
                                    <div className="mt-1.5 h-0.5 w-full bg-stone-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-stone-400 rounded-full transition-all duration-300"
                                            style={{ width: `${item.progress ?? 0}%` }}
                                        />
                                    </div>
                                )}
                                {item.status === 'pending' && (
                                    <div className="mt-1.5 h-0.5 w-full bg-stone-100 rounded-full" />
                                )}
                                {item.error && (
                                    <p className="text-[11px] text-red-500 mt-0.5 truncate">
                                        {item.error}
                                    </p>
                                )}
                            </div>

                            {/* Remove button for pending items */}
                            {item.status === 'pending' && (
                                <IconButton
                                    icon={X}
                                    size="xs"
                                    onClick={() => removeItem(item.id)}
                                    className="flex-shrink-0"
                                />
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
