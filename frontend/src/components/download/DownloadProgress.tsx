'use client';

import { useDownload } from '@/lib/hooks/useDownload';
import { pluralize } from '@/lib/utils/pluralize';
import {
    ChevronDown,
    ChevronUp,
    Check,
    AlertCircle,
    Loader2,
    Archive,
    ArrowDownToLine,
    Download,
} from 'lucide-react';

export function DownloadProgress() {
    const { items, archives, isOpen, togglePanel, clearFinished, saveArchive } =
        useDownload();

    if (items.length === 0) return null;

    const completed = items.filter((i) => i.status === 'completed').length;
    const failed = items.filter((i) => i.status === 'failed').length;
    const handedOff = items.filter((i) => i.status === 'handoff').length;
    const archived = items.filter((i) => i.status === 'archived').length;
    const total = items.length;

    // An archive still needs a tap to land on disk, so it is not "done" yet — but
    // nothing is in flight either, so the panel can still be dismissed.
    const finished = completed + failed + handedOff;
    const idle = finished + archived === total;
    const inProgressIndex = Math.min(finished + archived + 1, total);

    let headline: string;
    if (!idle) {
        headline = `Downloading ${inProgressIndex} of ${total}`;
    }
    else if (archives.length > 0) {
        headline = `${pluralize(archived, 'file')} ready to save`;
    }
    else if (completed === 0 && handedOff > 0) {
        headline = `${pluralize(handedOff, 'download')} started${failed > 0 ? `, ${failed} failed` : ''}`;
    }
    else {
        headline = `${pluralize(completed, 'download')} complete${failed > 0 ? `, ${failed} failed` : ''}`;
    }

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
                    {idle && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                clearFinished();
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

            {/* Ready archives. Kept outside the collapsible list because the tap
                itself is what lets the browser write the file — mobile drops a
                save the user didn't ask for. */}
            {archives.map((archive) => (
                <div key={archive.id} className="px-4 pb-3">
                    <button
                        type="button"
                        onClick={() => saveArchive(archive)}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-stone-900 px-3 py-2 text-[13px] font-medium text-stone-50 transition-colors duration-150 hover:bg-stone-800"
                    >
                        <Download className="w-3.5 h-3.5" />
                        Save {archive.fileName}
                    </button>
                </div>
            ))}

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
                                {item.status === 'handoff' && (
                                    <div className="w-5 h-5 rounded-full bg-stone-100 flex items-center justify-center">
                                        <ArrowDownToLine className="w-3 h-3 text-stone-500" />
                                    </div>
                                )}
                                {item.status === 'archived' && (
                                    <div className="w-5 h-5 rounded-full bg-stone-100 flex items-center justify-center">
                                        <Archive className="w-3 h-3 text-stone-500" />
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
                                {item.status === 'archived' && (
                                    <p className="text-[11px] text-stone-400 mt-0.5 truncate">
                                        In archive — tap Save to finish
                                    </p>
                                )}
                                {item.status === 'handoff' && (
                                    <p className="text-[11px] text-stone-400 mt-0.5 truncate">
                                        Saving with your browser
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
