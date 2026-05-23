'use client';

import { useState } from 'react';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextInput } from '@/components/ui/TextInput';
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
        <FormDialog
            open={open}
            onClose={onClose}
            title="Rename person"
            onSubmit={handleSubmit}
            loading={rename.isPending}
        >
            <TextInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
                autoFocus
            />
        </FormDialog>
    );
}
