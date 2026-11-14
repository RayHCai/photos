'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listShareLinks, createShareLink, revokeShareLink } from '@/lib/api/share';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { IconButton } from '@/components/ui/IconButton';
import { ShareLinkDisplay } from '@/components/ui/ShareLinkDisplay';
import { RemoveByLinkDialog } from './RemoveByLinkDialog';
import { formatFileSize } from '@/lib/utils/format';
import { pluralize } from '@/lib/utils/pluralize';
import { Eraser, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ShareLink } from '@/lib/types/share';

interface ShareLinkManagerProps {
    collectionId: string;
}

function describeLink(link: ShareLink): string {
    const parts = [pluralize(link.viewCount, 'view')];
    if (link.usedBytes > 0) {
        parts.push(`${formatFileSize(link.usedBytes)} uploaded`);
    }
    if (link.pendingCount > 0) parts.push(`${link.pendingCount} waiting`);
    return parts.join(' · ');
}

export function ShareLinkManager({ collectionId }: ShareLinkManagerProps) {
    const [slug, setSlug] = useState('');
    const [purging, setPurging] = useState<ShareLink | null>(null);
    const queryClient = useQueryClient();

    const { data: links = [] } = useQuery({
        queryKey: ['share-links', collectionId],
        queryFn: () => listShareLinks(collectionId),
    });

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['share-links', collectionId] }).catch(() => undefined);
        // The change log records link changes.
        queryClient
            .invalidateQueries({ queryKey: ['collections', collectionId, 'events'] })
            .catch(() => undefined);
    };

    const createMutation = useMutation({
        mutationFn: () =>
            createShareLink(collectionId, { slug: slug.trim() || undefined }),
        onSuccess: () => {
            invalidate();
            setSlug('');
            toast.success('Share link created');
        },
        onError: (err: Error) => {
            toast.error(err.message || 'Failed to create link');
        },
    });

    const revokeMutation = useMutation({
        mutationFn: revokeShareLink,
        onSuccess: () => {
            invalidate();
            toast.success('Link revoked');
        },
    });

    return (
        <div className="space-y-4">
            <h3 className="text-sm font-serif text-stone-900">
                Share Links
            </h3>

            <div className="flex gap-2">
                <TextInput
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="Custom slug (optional)"
                    className="flex-1"
                />
                <Button
                    onClick={() => createMutation.mutate()}
                    loading={createMutation.isPending}
                    size="sm"
                    title="Create link"
                >
                    <Link2 className="w-4 h-4" />
                </Button>
            </div>

            {links.length > 0 && (
                <div className="space-y-2">
                    {links.map((link) => (
                        <ShareLinkDisplay
                            key={link.id}
                            slug={link.slug}
                            label={link.label}
                            subtitle={describeLink(link)}
                            actions={
                                (link.usedBytes > 0 || link.pendingCount > 0) && (
                                    <IconButton
                                        icon={Eraser}
                                        size="sm"
                                        variant="ghost"
                                        danger
                                        onClick={() => setPurging(link)}
                                        title="Remove everything uploaded through this link"
                                    />
                                )
                            }
                            onRevoke={() => revokeMutation.mutate(link.id)}
                        />
                    ))}
                </div>
            )}

            <RemoveByLinkDialog
                linkId={purging?.id ?? null}
                linkName={purging?.label || (purging ? `/s/${purging.slug}` : '')}
                linkActive
                onClose={() => setPurging(null)}
            />
        </div>
    );
}
