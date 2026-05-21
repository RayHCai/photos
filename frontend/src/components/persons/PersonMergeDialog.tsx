'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { DialogFooter } from '@/components/ui/DialogFooter';
import { usePersons, useMergePersons } from '@/lib/hooks/usePersons';
import { toast } from 'sonner';

interface PersonMergeDialogProps {
    open: boolean;
    onClose: () => void;
    sourceId: string;
    sourceName: string | null;
}

export function PersonMergeDialog({
    open,
    onClose,
    sourceId,
    sourceName,
}: PersonMergeDialogProps) {
    const [targetId, setTargetId] = useState('');
    const { data: persons = [] } = usePersons();
    const merge = useMergePersons();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!targetId) return;
        merge.mutate(
            { sourceId, targetId },
            {
                onSuccess: () => {
                    toast.success('Persons merged');
                    onClose();
                },
            }
        );
    };

    const otherPersons = persons.filter((p) => p.id !== sourceId);

    return (
        <Dialog open={open} onClose={onClose} title="Merge person">
            <form onSubmit={handleSubmit} className="space-y-4">
                <p className="text-sm text-stone-600">
                    Merge &quot;{sourceName || 'Unknown'}&quot; into:
                </p>
                <select
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    className="w-full px-3 py-2 border border-stone-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-stone-300"
                >
                    <option value="">Select a person...</option>
                    {otherPersons.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.name || `Unknown (${p._count.faces} faces)`}
                        </option>
                    ))}
                </select>
                <DialogFooter onCancel={onClose} submitLabel="Merge" loading={merge.isPending} disabled={!targetId} />
            </form>
        </Dialog>
    );
}
