'use client';

import { useState, type ReactNode } from 'react';
import { IconButton, getIconButtonStyles } from './IconButton';
import { Copy, ExternalLink, Check, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface ShareLinkDisplayProps {
    slug: string;
    /** The owner's name for the link, shown above the slug. */
    label?: string | null;
    /** Extra info line below the slug (e.g. view count) */
    subtitle?: string;
    /** Buttons shown ahead of revoke. */
    actions?: ReactNode;
    onRevoke?: () => void;
}

const linkStyles = getIconButtonStyles({ size: 'sm', variant: 'ghost' });

export function ShareLinkDisplay({ slug, label, subtitle, actions, onRevoke }: ShareLinkDisplayProps) {
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
                {label && (
                    <p className="text-sm text-stone-800 truncate">{label}</p>
                )}
                <p className={`font-mono truncate ${label ? 'text-xs text-stone-500' : 'text-sm text-stone-700'}`}>
                    /s/{slug}
                </p>
                {subtitle && (
                    <p className="text-xs text-stone-400">{subtitle}</p>
                )}
            </div>
            <div className="flex items-center gap-1">
                {actions}
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
