'use client';

import { useState } from 'react';
import { purgeShareLink } from '@/lib/api/share';
import { useAppMutation } from '@/lib/hooks/useAppMutation';
import { pluralize } from '@/lib/utils/pluralize';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';

interface RemoveByLinkDialogProps {
    linkId: string | null;
    /** How the link is named to the owner: its label, or its slug. */
    linkName: string;
    /** Whether the link is still live, so revoking it is on offer. */
    linkActive: boolean;
    onClose: () => void;
}

/**
 * Remove everything that came through one share link — the spam cleanup. What
 * is waiting is denied; what was approved is deleted from the library, which
 * takes it out of every album it has been added to since.
 */
export function RemoveByLinkDialog({ linkId, linkName, linkActive, onClose }: RemoveByLinkDialogProps) {
    const [revoke, setRevoke] = useState(true);

    const purge = useAppMutation({
        mutationFn: () => purgeShareLink(linkId!, revoke && linkActive),
        effects: ['contributions', 'media-set', 'share-links'],
        successMessage: (result) => {
            const parts = [
                result.rejected > 0 && `denied ${pluralize(result.rejected, 'unreviewed upload')}`,
                result.removed > 0 && `deleted ${pluralize(result.removed, 'approved item')}`,
                result.revoked && 'revoked the link',
            ].filter(Boolean);
            return parts.length > 0 ? `Done: ${parts.join(', ')}` : 'Nothing to remove';
        },
        onSuccess: onClose,
    });

    return (
        <Dialog open={linkId !== null} onClose={onClose} maxWidth="max-w-sm">
            <div className="space-y-4">
                <h2 className="text-lg font-serif text-stone-900">Remove everything from {linkName}?</h2>
                <p className="text-sm text-stone-600">
                    Everything uploaded through this link will be permanently deleted: from the album
                    if you haven&apos;t reviewed it yet, and from your library if you approved it. This
                    can&apos;t be undone.
                </p>
                {linkActive && (
                    <label className="flex items-center gap-2 text-sm text-stone-700">
                        <input
                            type="checkbox"
                            checked={revoke}
                            onChange={(e) => setRevoke(e.target.checked)}
                            className="rounded border-stone-300"
                        />
                        Also revoke the link
                    </label>
                )}
                <div className="flex justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={onClose} disabled={purge.isPending}>
                        Cancel
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => purge.mutate()} loading={purge.isPending}>
                        Remove everything
                    </Button>
                </div>
            </div>
        </Dialog>
    );
}
