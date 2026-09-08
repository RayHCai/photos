'use client';

import { useDownload } from '@/lib/hooks/useDownload';
import { pluralize } from '@/lib/utils/pluralize';
import { ChevronDown, ChevronUp, Check, AlertCircle, Loader2 } from 'lucide-react';

export function DownloadProgress() {
    const { items, isOpen, togglePanel, clearFinished, cancelAll } = useDownload();

    if (items.length === 0) return null;

    const completed = items.filter((i) => i.status === 'completed').length;
    const failed = items.filter((i) => i.status === 'failed').length;
    const total = items.length;

    const finished = completed + failed;
    const idle = finished === total;
    const inProgressIndex = Math.min(finished + 1, total);

    /**
     * A zip is a single row covering a whole selection, so "Downloading 1 of 1"
     * would be an odd way to describe forty photos in flight. Its own row carries
     * the counts.
     */
    const archiveOnly = items.every((i) => i.kind === 'archive');

    const headline = idle
        ? `${pluralize(completed, 'download')} complete${failed > 0 ? `, ${failed} failed` : ''}`
        : archiveOnly
            ? 'Preparing your download'
            : `Downloading ${inProgressIndex} of ${total}`;

    return (
        // Width is capped against the viewport as well: at a fixed 20rem the panel
        // ran under the edge of a small phone screen, hiding the cancel control.
        <div className="w-[min(20rem,calc(100vw-2.5rem))] rounded-lg bg-white/80 backdrop-blur-xl shadow-2xl shadow-black/8 border border-stone-200/60 overflow-hidden transition-all duration-300">
            {/* Header */}
            <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors duration-150 hover:bg-stone-50/80"
                onClick={togglePanel}
            >
                <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-stone-900 leading-tight">
                        {headline}
                    </p>
                </div>
                <div className="flex items-center gap-1.5">
                    {/* Cancel was unreachable: the provider exposed it and nothing
                        rendered it, so a large selection could not be stopped. */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (idle) clearFinished();
                            else cancelAll();
                        }}
                        className="text-[11px] font-medium text-stone-400 hover:text-stone-700 px-2 py-1 rounded-md hover:bg-stone-100 transition-colors duration-150"
                    >
                        {idle ? 'Dismiss' : 'Cancel'}
                    </button>
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
                            key={item.key}
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
                                {item.status === 'downloading' && (
                                    <Loader2 className="w-4 h-4 text-stone-400 animate-spin" />
                                )}
                                {item.status === 'pending' && (
                                    <div className="w-4 h-4 rounded-full border-2 border-stone-200" />
                                )}
                            </div>

                            {/* File info */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-2">
                                    <p className="flex-1 text-[13px] text-stone-700 truncate leading-tight">
                                        {item.fileName}
                                    </p>
                                    {item.status === 'downloading' && (
                                        <span className="text-[11px] text-stone-400 tabular-nums flex-shrink-0">
                                            {item.progress}%
                                        </span>
                                    )}
                                </div>
                                {item.status === 'downloading' && (
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
                                {/* A zip is one row for a whole selection, so how far
                                    through that selection it is only shows here. */}
                                {item.detail && item.status !== 'failed' && (
                                    <p className="text-[11px] text-stone-400 mt-1 truncate">
                                        {item.detail}
                                    </p>
                                )}
                                {item.error && (
                                    <p className="text-[11px] text-red-500 mt-0.5 truncate">
                                        {item.error}
                                    </p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
