'use client';

import { useState } from 'react';
import { FormDialog } from '@/components/ui/FormDialog';
import { SelectInput } from '@/components/ui/SelectInput';
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
        <FormDialog
            open={open}
            onClose={onClose}
            title="Merge person"
            onSubmit={handleSubmit}
            submitLabel="Merge"
            loading={merge.isPending}
            disabled={!targetId}
        >
            <p className="text-sm text-stone-600">
                Merge &quot;{sourceName || 'Unknown'}&quot; into:
            </p>
            <SelectInput
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
            >
                <option value="">Select a person...</option>
                {otherPersons.map((p) => (
                    <option key={p.id} value={p.id}>
                        {p.name || `Unknown (${p._count.faces} faces)`}
                    </option>
                ))}
            </SelectInput>
        </FormDialog>
    );
}
