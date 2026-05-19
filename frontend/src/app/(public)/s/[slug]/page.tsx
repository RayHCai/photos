'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getSharedCollection } from '@/lib/api/share';
import { SharedCollectionView } from '@/components/shared/SharedCollectionView';
import { Spinner } from '@/components/ui/Spinner';
import type { SharedCollection } from '@/lib/types/share';

export default function SharedCollectionPage() {
    const params = useParams();
    const slug = params.slug as string;
    const [collection, setCollection] = useState<SharedCollection | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getSharedCollection(slug)
            .then(setCollection)
            .catch((err) => {
                setError(err.status === 410 ? 'This link has expired' : 'Collection not found');
            })
            .finally(() => setLoading(false));
    }, [slug]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Spinner className="w-8 h-8" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p className="text-stone-500">{error}</p>
            </div>
        );
    }

    if (!collection) return null;

    return <SharedCollectionView collection={collection} slug={slug} />;
}
