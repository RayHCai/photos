'use client';

import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { IconButton } from '@/components/ui/IconButton';
import { Spinner } from '@/components/ui/Spinner';
import { useSharePerson } from '@/lib/hooks/usePersons';
import { Copy, ExternalLink, Check } from 'lucide-react';
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
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (open) {
            setSlug(null);
            setCopied(false);
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

    const shareUrl = slug ? `${window.location.origin}/s/${slug}` : '';

    const handleCopy = () => {
        navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        toast.success('Link copied');
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Dialog open={open} onClose={onClose} title={`Share ${personName}`}>
            {!slug ? (
                <div className="flex justify-center py-6">
                    <Spinner className="w-5 h-5" />
                </div>
            ) : (
                <div className="space-y-3">
                    <div className="flex items-center gap-2 px-3 py-2 bg-stone-100 rounded">
                        <p className="flex-1 text-sm text-stone-700 font-mono truncate">
                            /s/{slug}
                        </p>
                        <IconButton
                            icon={copied ? Check : Copy}
                            size="sm"
                            variant="ghost"
                            onClick={handleCopy}
                            title="Copy link"
                        />
                        <a
                            href={`/s/${slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded hover:bg-stone-200 text-stone-500 hover:text-stone-700 transition-colors"
                            title="Open"
                        >
                            <ExternalLink className="w-4 h-4" />
                        </a>
                    </div>
                    <p className="text-xs text-stone-400">
                        This collection updates automatically when new photos are added.
                    </p>
                </div>
            )}
        </Dialog>
    );
}
