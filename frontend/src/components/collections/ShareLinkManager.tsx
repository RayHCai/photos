'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listShareLinks, createShareLink, revokeShareLink } from '@/lib/api/share';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { ShareLinkDisplay } from '@/components/ui/ShareLinkDisplay';
import { pluralize } from '@/lib/utils/pluralize';
import { Link2 } from 'lucide-react';
import { toast } from 'sonner';

interface ShareLinkManagerProps {
    collectionId: string;
}

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
                        <ShareLinkDisplay
                            key={link.id}
                            slug={link.slug}
                            subtitle={pluralize(link.viewCount, 'view')}
                            onRevoke={() => revokeMutation.mutate(link.id)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
