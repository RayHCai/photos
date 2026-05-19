'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { useRenamePerson } from '@/lib/hooks/usePersons';
import { toast } from 'sonner';

interface PersonRenameDialogProps {
    open: boolean;
    onClose: () => void;
    personId: string;
    currentName: string | null;
}

export function PersonRenameDialog({
    open,
    onClose,
    personId,
    currentName,
}: PersonRenameDialogProps) {
    const [name, setName] = useState(currentName || '');
    const rename = useRenamePerson();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        rename.mutate(
            { id: personId, name: name.trim() },
            {
                onSuccess: () => {
                    toast.success('Name updated');
                    onClose();
                },
            }
        );
    };

    return (
        <Dialog open={open} onClose={onClose} title="Rename person">
            <form onSubmit={handleSubmit} className="space-y-4">
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Name"
                    className="w-full px-3 py-2 border border-stone-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-stone-300"
                    autoFocus
                />
                <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={onClose} type="button">
                        Cancel
                    </Button>
                    <Button type="submit" loading={rename.isPending}>
                        Save
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}
