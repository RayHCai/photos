'use client';

import { useEffect, useCallback, useState, useRef, useLayoutEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMediaById, originalUrl, thumbnailUrl, webUrl } from '@/lib/api/media';
import { VideoPlayer } from './VideoPlayer';
import { MediaDetail } from './MediaDetail';
import { MediaActions } from './MediaActions';
import { X, ChevronLeft, ChevronRight, Info, Loader2 } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { useSwipeNavigation } from '@/lib/hooks/useSwipeNavigation';

interface MediaLightboxProps {
    mediaId: string;
    onClose: () => void;
    onPrev?: () => void;
    onNext?: () => void;
    prevMediaId?: string;
    nextMediaId?: string;
}

export function MediaLightbox({
    mediaId,
    onClose,
    onPrev,
    onNext,
    prevMediaId,
    nextMediaId,
}: MediaLightboxProps) {
    const [showInfo, setShowInfo] = useState(false);
    const [originalLoaded, setOriginalLoaded] = useState(false);
    const loadedWebRef = useRef(new Set<string>());
    const preloadedRef = useRef(new Set<string>());
    const trackRef = useRef<HTMLDivElement>(null);

    useSwipeNavigation(trackRef, {
        onSwipeLeft: onNext,
        onSwipeRight: onPrev,
    });

    // Reset track transform after navigation (before paint) to avoid flash
    useLayoutEffect(() => {
        if (trackRef.current) {
            trackRef.current.style.transition = 'none';
            trackRef.current.style.transform = 'translateX(-33.333%)';
        }
    }, [mediaId]);

    const { data: item } = useQuery({
        queryKey: ['media', mediaId],
        queryFn: () => getMediaById(mediaId),
    });

    // Reset loaded state when mediaId changes, unless already loaded before
    useEffect(() => {
        setOriginalLoaded(loadedWebRef.current.has(mediaId));
    }, [mediaId]);

    // Preload adjacent images
    useEffect(() => {
        const idsToPreload = [prevMediaId, nextMediaId].filter(
            (id): id is string => !!id && !preloadedRef.current.has(id)
        );
        for (const id of idsToPreload) {
            preloadedRef.current.add(id);
            const img = new Image();
            img.src = webUrl(id);
        }
    }, [prevMediaId, nextMediaId]);

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
            {/* Main media area */}
            <div className="flex-1 relative overflow-hidden">
                {/* Controls overlay */}
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
                        className="absolute left-3 top-1/2 -translate-y-1/2 z-10"
                    />
                )}

                {onNext && (
                    <IconButton
                        icon={ChevronRight}
                        size="sm"
                        variant="overlay"
                        iconClassName="w-5 h-5"
                        onClick={onNext}
                        className="absolute right-3 top-1/2 -translate-y-1/2 z-10"
                    />
                )}

                {/* 3-slide carousel track */}
                <div
                    ref={trackRef}
                    className="flex h-full will-change-transform"
                    style={{
                        width: '300%',
                        transform: 'translateX(-33.333%)',
                    }}
                >
                    {/* Previous slide */}
                    <div className="h-full flex items-center justify-center" style={{ width: '33.333%' }}>
                        {prevMediaId && (
                            <img
                                src={webUrl(prevMediaId)}
                                alt=""
                                className="max-w-[90%] max-h-[90vh] object-contain"
                                draggable={false}
                            />
                        )}
                    </div>

                    {/* Current slide */}
                    <div className="h-full flex items-center justify-center" style={{ width: '33.333%' }}>
                        {item && (
                            <div className="max-w-[90%] max-h-[90vh] relative">
                                {item.type === 'VIDEO' ? (
                                    <VideoPlayer src={originalUrl(item.id)} />
                                ) : (
                                    <>
                                        {/* Thumbnail placeholder — shown instantly */}
                                        <img
                                            src={thumbnailUrl(item.id)}
                                            alt=""
                                            className={`max-w-full max-h-[90vh] object-contain transition-opacity duration-200 ${
                                                originalLoaded ? 'opacity-0 absolute inset-0' : 'opacity-100'
                                            }`}
                                            draggable={false}
                                        />
                                        {/* Web-optimized image — fades in on top */}
                                        <img
                                            src={webUrl(item.id)}
                                            alt={item.fileName}
                                            className={`max-w-full max-h-[90vh] object-contain transition-opacity duration-200 ${
                                                originalLoaded ? 'opacity-100' : 'opacity-0 absolute inset-0'
                                            }`}
                                            draggable={false}
                                            onLoad={() => {
                                                loadedWebRef.current.add(item.id);
                                                setOriginalLoaded(true);
                                            }}
                                        />
                                        {/* Loading spinner */}
                                        {!originalLoaded && (
                                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                <Loader2 className="w-8 h-8 text-white/50 animate-spin" />
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Next slide */}
                    <div className="h-full flex items-center justify-center" style={{ width: '33.333%' }}>
                        {nextMediaId && (
                            <img
                                src={webUrl(nextMediaId)}
                                alt=""
                                className="max-w-[90%] max-h-[90vh] object-contain"
                                draggable={false}
                            />
                        )}
                    </div>
                </div>
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
