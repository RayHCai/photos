'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getSharedCollection } from '@/lib/api/share';
import { SharedCollectionView } from '@/components/shared/SharedCollectionView';
import { Spinner } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api/client';

export default function SharedCollectionPage() {
    const params = useParams();
    const slug = params.slug as string;

    // Metadata only (name + total). The items and timeline load inside the view,
    // paginated and windowed like the authenticated gallery.
    const { data: collection, isLoading, error } = useQuery({
        queryKey: ['share', slug, 'meta'],
        queryFn: () => getSharedCollection(slug),
        // A missing or expired link is a permanent state, not a transient failure.
        retry: false,
    });

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Spinner className="w-8 h-8" />
            </div>
        );
    }

    if (error) {
        const message =
            error instanceof ApiError && error.status === 410
                ? 'This link has expired'
                : 'Collection not found';
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p className="text-stone-500">{message}</p>
            </div>
        );
    }

    if (!collection) return null;

    return <SharedCollectionView collection={collection} slug={slug} />;
}
