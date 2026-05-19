'use client';

import { useRouter } from 'next/navigation';
import { useCreateCollection } from '@/lib/hooks/useCollections';
import { CollectionForm } from '@/components/collections/CollectionForm';
import { toast } from 'sonner';

export default function NewCollectionPage() {
    const router = useRouter();
    const createCollection = useCreateCollection();

    return (
        <div className="max-w-md mx-auto p-6">
            <h1 className="text-xl font-serif text-stone-900 mb-6">
                New Collection
            </h1>
            <CollectionForm
                onSubmit={(data) => {
                    createCollection.mutate(data, {
                        onSuccess: (collection) => {
                            toast.success('Collection created');
                            router.push(`/collections/${collection.id}`);
                        },
                        onError: () => {
                            toast.error('Failed to create collection');
                        },
                    });
                }}
                loading={createCollection.isPending}
            />
        </div>
    );
}
