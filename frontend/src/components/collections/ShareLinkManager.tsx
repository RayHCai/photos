'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listShareLinks, createShareLink, revokeShareLink } from '@/lib/api/share';
import { Button } from '@/components/ui/Button';
import { IconButton, getIconButtonStyles } from '@/components/ui/IconButton';
import { TextInput } from '@/components/ui/TextInput';
import { pluralize } from '@/lib/utils/pluralize';
import { Link2, Trash2, Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface ShareLinkManagerProps {
    collectionId: string;
}

const linkStyles = getIconButtonStyles({ size: 'sm', variant: 'ghost' });

export function ShareLinkManager({ collectionId }: ShareLinkManagerProps) {
    const [slug, setSlug] = useState('');
    const queryClient = useQueryClient();

    const { data: links = [] } = useQuery({
        queryKey: ['share-links', collectionId],
        queryFn: () => listShareLinks(collectionId),
    });

    const createMutation = useMutation({
        mutationFn: () =>
            createShareLink(collectionId, {
                slug: slug.trim() || undefined,
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: ['share-links', collectionId],
            });
            setSlug('');
            toast.success('Share link created');
        },
        onError: (err: any) => {
            toast.error(err.message || 'Failed to create link');
        },
    });

    const revokeMutation = useMutation({
        mutationFn: revokeShareLink,
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: ['share-links', collectionId],
            });
            toast.success('Link revoked');
        },
    });

    const copyLink = (linkSlug: string) => {
        const url = `${window.location.origin}/s/${linkSlug}`;
        navigator.clipboard.writeText(url);
        toast.success('Link copied');
    };

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
                    className="flex-1 px-3 py-2 border border-stone-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-stone-300"
                />
                <Button
                    onClick={() => createMutation.mutate()}
                    loading={createMutation.isPending}
                    size="sm"
                >
                    <Link2 className="w-4 h-4" />
                </Button>
            </div>

            {links.length > 0 && (
                <div className="space-y-2">
                    {links.map((link) => (
                        <div
                            key={link.id}
                            className="flex items-center justify-between px-3 py-2 bg-stone-100 rounded"
                        >
                            <div className="flex-1 min-w-0">
                                <p className="text-sm text-stone-700 font-mono truncate">
                                    /s/{link.slug}
                                </p>
                                <p className="text-xs text-stone-400">
                                    {pluralize(link.viewCount, 'view')}
                                </p>
                            </div>
                            <div className="flex items-center gap-1">
                                <IconButton
                                    icon={Copy}
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => copyLink(link.slug)}
                                    title="Copy"
                                />
                                <a
                                    href={`/s/${link.slug}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={linkStyles.button}
                                    title="Open"
                                >
                                    <ExternalLink className={linkStyles.icon} />
                                </a>
                                <IconButton
                                    icon={Trash2}
                                    size="sm"
                                    variant="ghost"
                                    danger
                                    onClick={() => revokeMutation.mutate(link.id)}
                                    title="Revoke"
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
