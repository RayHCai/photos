'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, ImageIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import { thumbnailUrl } from '@/lib/api/media';
import type { PendingDuplicate } from '@/lib/providers/UploadProvider';

interface DuplicateModalProps {
    duplicates: PendingDuplicate[];
    onResolve: (decisions: Map<string, 'skip' | 'keep_both'>) => void;
}

export function DuplicateModal({ duplicates, onResolve }: DuplicateModalProps) {
    const overlayRef = useRef<HTMLDivElement>(null);
    const [decisions, setDecisions] = useState<Map<string, 'skip' | 'keep_both'>>(new Map());

    const allDecided = decisions.size === duplicates.length;

    const previewUrls = useMemo(() => {
        const urls = new Map<string, string>();
        for (const dup of duplicates) {
            urls.set(dup.file.name, URL.createObjectURL(dup.file));
        }
        return urls;
    }, [duplicates]);

    useEffect(() => {
        return () => {
            for (const url of previewUrls.values()) {
                URL.revokeObjectURL(url);
            }
        };
    }, [previewUrls]);

    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                handleSkipAll();
            }
        };
        document.addEventListener('keydown', handleEsc);
        return () => document.removeEventListener('keydown', handleEsc);
    }, [duplicates]);

    function setDecision(fileName: string, decision: 'skip' | 'keep_both') {
        setDecisions((prev) => {
            const next = new Map(prev);
            next.set(fileName, decision);
            return next;
        });
    }

    function handleSkipAll() {
        const all = new Map<string, 'skip' | 'keep_both'>();
        for (const dup of duplicates) {
            all.set(dup.file.name, 'skip');
        }
        onResolve(all);
    }

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

    return (
        <div
            ref={overlayRef}
            className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40"
            onClick={(e) => {
                if (e.target === overlayRef.current) handleSkipAll();
            }}
        >
            <div className="bg-stone-50 rounded shadow-lg w-full max-w-lg mx-4 overflow-hidden max-h-[85vh] flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200">
                    <h2 className="text-lg font-serif text-stone-900">
                        {duplicates.length === 1
                            ? 'Duplicate file found'
                            : `${duplicates.length} duplicate files found`}
                    </h2>
                    <button
                        onClick={handleSkipAll}
                        className="p-1 rounded hover:bg-stone-200 text-stone-400 hover:text-stone-600 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
                    {duplicates.map((dup) => {
                        const decision = decisions.get(dup.file.name);
                        return (
                            <div key={dup.file.name} className="space-y-3">
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
                                            {dup.file.type.startsWith('image/') ? (
                                                <img
                                                    src={previewUrls.get(dup.file.name)}
                                                    alt="New file"
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center">
                                                    <ImageIcon className="w-8 h-8 text-stone-300" />
                                                </div>
                                            )}
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
                        );
                    })}
                </div>

                <div className="flex items-center justify-between px-6 py-4 border-t border-stone-200">
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
            </div>
        </div>
    );
}
