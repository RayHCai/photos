'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getMediaById, originalUrl } from '@/lib/api/media';
import { MediaDetail } from '@/components/media/MediaDetail';
import { MediaActions } from '@/components/media/MediaActions';
import { VideoPlayer } from '@/components/media/VideoPlayer';
import { Spinner } from '@/components/ui/Spinner';
import { ArrowLeft } from 'lucide-react';

export default function MediaDetailPage() {
    const params = useParams();
    const router = useRouter();
    const id = params.id as string;

    const { data: item, isLoading } = useQuery({
        queryKey: ['media', id],
        queryFn: () => getMediaById(id),
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <Spinner className="w-8 h-8" />
            </div>
        );
    }

    if (!item) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <p className="text-stone-500">Item not found</p>
            </div>
        );
    }

    return (
        <div className="flex h-screen">
            <div className="flex-1 bg-stone-950 flex items-center justify-center relative">
                <button
                    onClick={() => router.back()}
                    className="absolute top-4 left-4 p-2 rounded bg-black/40 text-white hover:bg-black/60 transition-colors"
                >
                    <ArrowLeft className="w-5 h-5" />
                </button>

                {item.type === 'VIDEO' ? (
                    <VideoPlayer src={originalUrl(item.id)} />
                ) : (
                    <img
                        src={originalUrl(item.id)}
                        alt={item.fileName}
                        className="max-w-full max-h-full object-contain"
                    />
                )}
            </div>

            <div className="w-80 bg-stone-50 border-l border-stone-200 p-6 overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-serif text-stone-500">
                        Details
                    </h2>
                    <MediaActions
                        mediaId={item.id}
                        onDelete={() => router.push('/')}
                    />
                </div>
                <MediaDetail mediaId={item.id} />
            </div>
        </div>
    );
}
