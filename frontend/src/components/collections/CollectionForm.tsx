'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';

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
            <div>
                <label className="block text-sm text-stone-700 mb-1">
                    Name
                </label>
                <TextInput
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Collection name"
                    autoFocus
                    required
                />
            </div>

            <Button type="submit" loading={loading} className="w-full">
                {submitLabel}
            </Button>
        </form>
    );
}
