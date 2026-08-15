'use client';

import { useDownload } from '@/lib/hooks/useDownload';
import { pluralize } from '@/lib/utils/pluralize';
import {
    ChevronDown,
    ChevronUp,
    Check,
    AlertCircle,
    Loader2,
    Download,
    ArrowDownToLine,
} from 'lucide-react';

export function DownloadProgress() {
    const { items, isOpen, saveMode, togglePanel, clearFinished, cancelAll, saveReady, saveOneReady }
        = useDownload();

    if (items.length === 0) return null;

    const completed = items.filter((i) => i.status === 'completed').length;
    const failed = items.filter((i) => i.status === 'failed').length;
    const ready = items.filter((i) => i.status === 'ready');
    const total = items.length;

    // `ready` counts as progressed — the bytes are here — but not as finished, and
    // it is not in flight either, so the panel can still be dismissed.
    const inFlight = total - completed - failed - ready.length;
    const finished = completed + failed + ready.length;
    const inProgressIndex = Math.min(finished + 1, total);

    let headline: string;
    if (ready.length > 0) {
        // Takes precedence over any download still running: a tap is the only
        // thing that finishes these, so it is what the panel should be asking for.
        headline = `${pluralize(ready.length, 'file')} ready to save`;
    }
    else if (inFlight > 0) {
        headline = `Downloading ${inProgressIndex} of ${total}`;
    }
    else {
        headline = `${pluralize(completed, 'download')} complete${failed > 0 ? `, ${failed} failed` : ''}`;
    }

    // Sharing takes the whole set under one tap; saving to disk is one file per tap,
    // because one activation authorizes one download.
    const shareAll = saveMode === 'share' && ready.length > 1;
    const saveLabel = shareAll
        ? `Save ${pluralize(ready.length, 'file')}`
        : `Save ${ready[0]?.fileName ?? ''}`;

    return (
        <div className="w-80 rounded-lg bg-white/80 backdrop-blur-xl shadow-2xl shadow-black/8 border border-stone-200/60 overflow-hidden transition-all duration-300">
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
                            if (inFlight > 0) cancelAll();
                            else clearFinished();
                        }}
                        className="text-[11px] font-medium text-stone-400 hover:text-stone-700 px-2 py-1 rounded-md hover:bg-stone-100 transition-colors duration-150"
                    >
                        {inFlight > 0 ? 'Cancel' : 'Dismiss'}
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

            {/* Ready files. Kept outside the collapsible list because this tap is
                what lets the browser write the file at all — a save made after the
                fetch, with no activation behind it, is refused without a word. */}
            {ready.length > 0 && (
                <div className="px-4 pb-3 space-y-1.5">
                    <button
                        type="button"
                        onClick={saveReady}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-stone-900 px-3 py-2 text-[13px] font-medium text-stone-50 transition-colors duration-150 hover:bg-stone-800"
                    >
                        <Download className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{saveLabel}</span>
                    </button>
                    {shareAll && (
                        // The share sheet's targets are the OS's business, and not
                        // every one of them offers somewhere in the file system. This
                        // is the way around it that does.
                        <button
                            type="button"
                            onClick={saveOneReady}
                            className="w-full text-[11px] font-medium text-stone-400 hover:text-stone-700 px-2 py-1 rounded-md hover:bg-stone-100 transition-colors duration-150"
                        >
                            Save to downloads instead, one at a time
                        </button>
                    )}
                </div>
            )}

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
                                {item.status === 'ready' && (
                                    <div className="w-5 h-5 rounded-full bg-stone-100 flex items-center justify-center">
                                        <ArrowDownToLine className="w-3 h-3 text-stone-500" />
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
                                <p className="text-[13px] text-stone-700 truncate leading-tight">
                                    {item.fileName}
                                </p>
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
                                {item.status === 'ready' && (
                                    <p className="text-[11px] text-stone-400 mt-0.5 truncate">
                                        Downloaded — tap Save to finish
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
