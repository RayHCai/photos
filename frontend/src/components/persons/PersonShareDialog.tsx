'use client';

import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { ShareLinkDisplay } from '@/components/ui/ShareLinkDisplay';
import { Spinner } from '@/components/ui/Spinner';
import { useSharePerson } from '@/lib/hooks/usePersons';
import { toast } from 'sonner';

interface PersonShareDialogProps {
    open: boolean;
    onClose: () => void;
    personId: string;
    personName: string;
}

export function PersonShareDialog({
    open,
    onClose,
    personId,
    personName,
}: PersonShareDialogProps) {
    const sharePerson = useSharePerson();
    const [slug, setSlug] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setSlug(null);
            sharePerson.mutate(personId, {
                onSuccess: (result) => {
                    setSlug(result.shareLink.slug);
                    if (result.created) {
                        toast.success('Share link created');
                    }
                },
                onError: (err: any) => {
                    toast.error(err.message || 'Failed to create share link');
                    onClose();
                },
            });
        }
    }, [open, personId]);

    return (
        <Dialog open={open} onClose={onClose} title={`Share ${personName}`}>
            {!slug ? (
                <div className="flex justify-center py-6">
                    <Spinner className="w-5 h-5" />
                </div>
            ) : (
                <div className="space-y-3">
                    <ShareLinkDisplay slug={slug} />
                    <p className="text-xs text-stone-400">
                        This collection updates automatically when new photos are added.
                    </p>
                </div>
            )}
        </Dialog>
    );
}
