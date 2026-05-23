'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { FormField } from '@/components/ui/FormField';

interface CollectionFormProps {
    initialName?: string;
    onSubmit: (data: { name: string }) => void;
    loading?: boolean;
    submitLabel?: string;
}

export function CollectionForm({
    initialName = '',
    onSubmit,
    loading,
    submitLabel = 'Create',
}: CollectionFormProps) {
    const [name, setName] = useState(initialName);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSubmit({ name: name.trim() });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <FormField label="Name">
                <TextInput
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Collection name"
                    autoFocus
                    required
                />
            </FormField>

            <Button type="submit" loading={loading} className="w-full">
                {submitLabel}
            </Button>
        </form>
    );
}
