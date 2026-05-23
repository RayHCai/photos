'use client';

import { useState } from 'react';
import { IconButton, getIconButtonStyles } from './IconButton';
import { Copy, ExternalLink, Check, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface ShareLinkDisplayProps {
    slug: string;
    /** Extra info line below the slug (e.g. view count) */
    subtitle?: string;
    onRevoke?: () => void;
}

const linkStyles = getIconButtonStyles({ size: 'sm', variant: 'ghost' });

export function ShareLinkDisplay({ slug, subtitle, onRevoke }: ShareLinkDisplayProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        const url = `${window.location.origin}/s/${slug}`;
        navigator.clipboard.writeText(url);
        setCopied(true);
        toast.success('Link copied');
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="flex items-center justify-between px-3 py-2 bg-stone-100 rounded">
            <div className="flex-1 min-w-0">
                <p className="text-sm text-stone-700 font-mono truncate">
                    /s/{slug}
                </p>
                {subtitle && (
                    <p className="text-xs text-stone-400">{subtitle}</p>
                )}
            </div>
            <div className="flex items-center gap-1">
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
                    className={linkStyles.button}
                    title="Open"
                >
                    <ExternalLink className={linkStyles.icon} />
                </a>
                {onRevoke && (
                    <IconButton
                        icon={Trash2}
                        size="sm"
                        variant="ghost"
                        danger
                        onClick={onRevoke}
                        title="Revoke"
                    />
                )}
            </div>
        </div>
    );
}
