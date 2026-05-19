'use client';

import { useEffect, useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMediaById, originalUrl } from '@/lib/api/media';
import { VideoPlayer } from './VideoPlayer';
import { MediaDetail } from './MediaDetail';
import { MediaActions } from './MediaActions';
import { X, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';

interface MediaLightboxProps {
    mediaId: string;
    onClose: () => void;
    onPrev?: () => void;
    onNext?: () => void;
}

export function MediaLightbox({
    mediaId,
    onClose,
    onPrev,
    onNext,
}: MediaLightboxProps) {
    const [showInfo, setShowInfo] = useState(false);

    const { data: item } = useQuery({
        queryKey: ['media', mediaId],
        queryFn: () => getMediaById(mediaId),
    });

    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            switch (e.key) {
            case 'Escape':
                onClose();
                break;
            case 'ArrowLeft':
                onPrev?.();
                break;
            case 'ArrowRight':
                onNext?.();
                break;
            case 'i':
                setShowInfo((p) => !p);
                break;
            }
        },
        [onClose, onPrev, onNext]
    );

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [handleKeyDown]);

    return (
        <div className="fixed inset-0 z-50 bg-stone-950 flex select-none">
            <div className="flex-1 flex items-center justify-center relative">
                <IconButton
                    icon={X}
                    size="sm"
                    variant="overlay"
                    onClick={onClose}
                    className="absolute top-3 left-3 z-10"
                />

                <div className="absolute top-3 right-3 flex items-center gap-1 z-10">
                    <MediaActions mediaId={mediaId} onDelete={onClose} />
                    <IconButton
                        icon={Info}
                        size="sm"
                        variant="overlay"
                        active={showInfo}
                        onClick={() => setShowInfo((p) => !p)}
                    />
                </div>

                {onPrev && (
                    <IconButton
                        icon={ChevronLeft}
                        size="sm"
                        variant="overlay"
                        iconClassName="w-5 h-5"
                        onClick={onPrev}
                        className="absolute left-3 top-1/2 -translate-y-1/2"
                    />
                )}

                {onNext && (
                    <IconButton
                        icon={ChevronRight}
                        size="sm"
                        variant="overlay"
                        iconClassName="w-5 h-5"
                        onClick={onNext}
                        className="absolute right-3 top-1/2 -translate-y-1/2"
                    />
                )}

                {item && (
                    <div className="max-w-[90vw] max-h-[90vh]">
                        {item.type === 'VIDEO' ? (
                            <VideoPlayer src={originalUrl(item.id)} />
                        ) : (
                            <img
                                src={originalUrl(item.id)}
                                alt={item.fileName}
                                className="max-w-full max-h-[90vh] object-contain"
                                draggable={false}
                            />
                        )}
                    </div>
                )}
            </div>

            {showInfo && (
                <div className="w-80 bg-stone-50 p-6 overflow-y-auto border-l border-stone-200 relative">
                    <IconButton
                        icon={X}
                        size="xs"
                        variant="surface"
                        pill
                        onClick={() => setShowInfo(false)}
                        className="absolute top-3 right-3"
                    />
                    <MediaDetail mediaId={mediaId} />
                </div>
            )}
        </div>
    );
}
