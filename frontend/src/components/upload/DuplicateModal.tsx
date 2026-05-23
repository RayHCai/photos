'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ImageIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { thumbnailUrl } from '@/lib/api/media';
import type { PendingDuplicate } from '@/lib/providers/UploadProvider';

interface DuplicateModalProps {
    duplicates: PendingDuplicate[];
    onResolve: (decisions: Map<string, 'skip' | 'keep_both'>) => void;
}

const ITEM_HEIGHT = 260; // estimated height per duplicate row

function LazyPreview({ file }: { file: File }) {
    const [url, setUrl] = useState<string | null>(null);

    useEffect(() => {
        if (!file.type.startsWith('image/')) return;
        const objectUrl = URL.createObjectURL(file);
        setUrl(objectUrl);
        return () => URL.revokeObjectURL(objectUrl);
    }, [file]);

    if (!file.type.startsWith('image/') || !url) {
        return (
            <div className="w-full h-full flex items-center justify-center">
                <ImageIcon className="w-8 h-8 text-stone-300" />
            </div>
        );
    }

    return (
        <img
            src={url}
            alt="New file"
            className="w-full h-full object-cover"
            loading="lazy"
        />
    );
}

export function DuplicateModal({ duplicates, onResolve }: DuplicateModalProps) {
    const [decisions, setDecisions] = useState<Map<string, 'skip' | 'keep_both'>>(new Map());
    const scrollRef = useRef<HTMLDivElement>(null);

    const allDecided = decisions.size === duplicates.length;

    const virtualizer = useVirtualizer({
        count: duplicates.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => ITEM_HEIGHT,
        overscan: 3,
    });

    function setDecision(fileName: string, decision: 'skip' | 'keep_both') {
        setDecisions((prev) => {
            const next = new Map(prev);
            next.set(fileName, decision);
            return next;
        });
    }

    const handleSkipAll = useCallback(() => {
        const all = new Map<string, 'skip' | 'keep_both'>();
        for (const dup of duplicates) {
            all.set(dup.file.name, 'skip');
        }
        onResolve(all);
    }, [duplicates, onResolve]);

    function handleKeepAll() {
        const all = new Map<string, 'skip' | 'keep_both'>();
        for (const dup of duplicates) {
            all.set(dup.file.name, 'keep_both');
        }
        onResolve(all);
    }

    function handleConfirm() {
        const final = new Map<string, 'skip' | 'keep_both'>();
        for (const dup of duplicates) {
            final.set(dup.file.name, decisions.get(dup.file.name) || 'skip');
        }
        onResolve(final);
    }

    if (duplicates.length === 0) return null;

    const dialogTitle = duplicates.length === 1
        ? 'Duplicate file found'
        : `${duplicates.length} duplicate files found`;

    const dialogFooter = (
        <div className="flex items-center justify-between">
            {duplicates.length > 1 ? (
                <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={handleSkipAll}>
                        Skip All
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleKeepAll}>
                        Keep All
                    </Button>
                </div>
            ) : (
                <div />
            )}
            <Button
                variant="primary"
                size="sm"
                onClick={handleConfirm}
                disabled={!allDecided}
            >
                Confirm
            </Button>
        </div>
    );

    return (
        <Dialog
            open
            onClose={handleSkipAll}
            title={dialogTitle}
            maxWidth="max-w-lg"
            scrollable
            footer={dialogFooter}
        >
            <div ref={scrollRef} className="overflow-y-auto -mx-6 -my-4 px-6">
                <div
                    style={{
                        height: virtualizer.getTotalSize(),
                        width: '100%',
                        position: 'relative',
                    }}
                >
                    {virtualizer.getVirtualItems().map((virtualItem) => {
                        const dup = duplicates[virtualItem.index];
                        const decision = decisions.get(dup.file.name);
                        return (
                            <div
                                key={dup.file.name}
                                ref={virtualizer.measureElement}
                                data-index={virtualItem.index}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    transform: `translateY(${virtualItem.start}px)`,
                                }}
                                className="py-2.5"
                            >
                                <div className="space-y-3">
                                    <p className="text-sm font-medium text-stone-900 truncate">
                                        {dup.file.name}
                                    </p>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1.5">
                                            <p className="text-xs text-stone-500">Existing</p>
                                            <div className="aspect-square rounded border border-stone-200 overflow-hidden bg-stone-100">
                                                {dup.existingThumbnailKey ? (
                                                    <img
                                                        src={thumbnailUrl(dup.existingId)}
                                                        alt="Existing file"
                                                        className="w-full h-full object-cover"
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center">
                                                        <ImageIcon className="w-8 h-8 text-stone-300" />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <p className="text-xs text-stone-500">New</p>
                                            <div className="aspect-square rounded border border-stone-200 overflow-hidden bg-stone-100">
                                                <LazyPreview file={dup.file} />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            variant={decision === 'skip' ? 'primary' : 'secondary'}
                                            size="sm"
                                            onClick={() => setDecision(dup.file.name, 'skip')}
                                            className="flex-1"
                                        >
                                            Skip
                                        </Button>
                                        <Button
                                            variant={decision === 'keep_both' ? 'primary' : 'secondary'}
                                            size="sm"
                                            onClick={() => setDecision(dup.file.name, 'keep_both')}
                                            className="flex-1"
                                        >
                                            Keep Both
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </Dialog>
    );
}
