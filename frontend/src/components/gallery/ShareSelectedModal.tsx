'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Loader2 } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { ModalOverlay } from '@/components/ui/ModalOverlay';
import { ShareLinkDisplay } from '@/components/ui/ShareLinkDisplay';
import { createCollection, addItems } from '@/lib/api/collections';
import { createShareLink, revokeShareLink } from '@/lib/api/share';
import { pluralize } from '@/lib/utils/pluralize';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface ShareSelectedModalProps {
    open: boolean;
    onClose: () => void;
    mediaItemIds: string[];
}

export function ShareSelectedModal({ open, onClose, mediaItemIds }: ShareSelectedModalProps) {
    const queryClient = useQueryClient();
    const [loading, setLoading] = useState(false);
    const [shareSlug, setShareSlug] = useState<string | null>(null);
    const [shareLinkId, setShareLinkId] = useState<string | null>(null);
    const [collectionId, setCollectionId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const createShareCollection = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const now = new Date();
            const name = `Shared ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            const collection = await createCollection({ name });
            await addItems(collection.id, mediaItemIds);
            const link = await createShareLink(collection.id, {});
            setCollectionId(collection.id);
            setShareSlug(link.slug);
            setShareLinkId(link.id);
            queryClient.invalidateQueries({ queryKey: ['collections'] });
        }
        catch {
            setError('Failed to create share link');
        }
        finally {
            setLoading(false);
        }
    }, [mediaItemIds, queryClient]);

    useEffect(() => {
        if (open && !shareSlug && !loading) {
            createShareCollection();
        }
    }, [open, shareSlug, loading, createShareCollection]);

    useEffect(() => {
        if (!open) {
            setShareSlug(null);
            setShareLinkId(null);
            setCollectionId(null);
            setError(null);
            setLoading(false);
        }
    }, [open]);

    const handleRevoke = async () => {
        if (!shareLinkId) return;
        try {
            await revokeShareLink(shareLinkId);
            toast.success('Share link revoked');
            if (collectionId) {
                queryClient.invalidateQueries({ queryKey: ['share-links', collectionId] });
            }
            onClose();
        }
        catch {
            toast.error('Failed to revoke link');
        }
    };

    if (!open) return null;

    return (
        <ModalOverlay onClose={onClose}>
            <div
                className="bg-white rounded-lg shadow-xl w-full max-w-xs mx-4 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
                    <h3 className="text-sm font-serif text-stone-900">
                        Share {pluralize(mediaItemIds.length, 'item')}
                    </h3>
                    <IconButton
                        icon={X}
                        size="xs"
                        onClick={onClose}
                        className="-mr-0.5"
                    />
                </div>

                {/* Content */}
                <div className="px-4 pb-4">
                    {loading && (
                        <div className="flex items-center justify-center py-6">
                            <Loader2 className="w-5 h-5 animate-spin text-stone-400" />
                        </div>
                    )}

                    {error && (
                        <p className="text-sm text-red-500 text-center py-4">{error}</p>
                    )}

                    {shareSlug && (
                        <div className="space-y-2">
                            <p className="text-xs text-stone-500">
                                Anyone with the link can view these items.
                            </p>
                            <ShareLinkDisplay
                                slug={shareSlug}
                                onRevoke={handleRevoke}
                            />
                        </div>
                    )}
                </div>
            </div>
        </ModalOverlay>
    );
}
