'use client';

import { useEffect, useCallback, useState, useRef, useLayoutEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMediaById, downloadUrl, originalUrl, thumbnailUrl, webUrl } from '@/lib/api/media';
import { VideoPlayer } from './VideoPlayer';
import { MediaDetail } from './MediaDetail';
import { MediaActions } from './MediaActions';
import { X, ChevronLeft, ChevronRight, Info, Download, Loader2, Copy, Check, Share2 } from 'lucide-react';
import { IconButton, getIconButtonStyles } from '@/components/ui/IconButton';
import { useSwipeNavigation } from '@/lib/hooks/useSwipeNavigation';
import { useImageZoom } from '@/lib/hooks/useImageZoom';
import { useDownload } from '@/lib/hooks/useDownload';
import type { MediaType } from '@/lib/types/media';

export interface UrlFns {
    thumbnail: (id: string) => string;
    web: (id: string) => string;
    original: (id: string) => string;
    download: (id: string) => string;
}

export interface MediaLightboxProps {
    mediaId: string;
    onClose: () => void;
    onPrev?: () => void;
    onNext?: () => void;
    prevMediaId?: string;
    nextMediaId?: string;
    /** Hide delete button (e.g. for shared links). Default true. */
    showDelete?: boolean;
    /** Hide the info panel toggle. Default true. */
    showInfoPanel?: boolean;
    /** Media type hint — avoids needing the API call when urlFns is set. */
    mediaType?: MediaType;
    /** Custom URL functions (e.g. for shared/public links). */
    urlFns?: UrlFns;
}

const dlStyles = getIconButtonStyles({ size: 'sm', variant: 'overlay' });

/** Formats the browser can decode in an <img>. HEIC/HEIF/TIFF/RAW originals
 *  cannot, so for those we keep the web variant rather than the raw original. */
const BROWSER_SAFE_IMAGE = /^image\/(jpeg|png|webp|gif|avif)$/i;

export function MediaLightbox({
    mediaId,
    onClose,
    onPrev,
    onNext,
    prevMediaId,
    nextMediaId,
    showDelete = true,
    showInfoPanel = true,
    mediaType,
    urlFns,
}: MediaLightboxProps) {
    const { triggerDownload } = useDownload();
    const [showInfo, setShowInfo] = useState(false);
    // Tracks the WEB (2000px) image load — the first sharp paint.
    const [webLoaded, setWebLoaded] = useState(false);
    // Tracks the full-resolution ORIGINAL load (Layer 3, lazy on zoom).
    const [fullResLoaded, setFullResLoaded] = useState(false);
    // True once the user has zoomed on this item — gates the detail fetch
    // (we need mimeType for the original layer) and the original layer itself.
    const [zoomActivated, setZoomActivated] = useState(false);
    const [copied, setCopied] = useState(false);
    const loadedWebRef = useRef(new Set<string>());
    const preloadedRef = useRef(new Set<string>());
    const trackRef = useRef<HTMLDivElement>(null);
    const zoomContainerRef = useRef<HTMLDivElement>(null);

    // Resolve URL helpers — custom or default
    const urls = urlFns ?? { thumbnail: thumbnailUrl, web: webUrl, original: originalUrl, download: downloadUrl };

    // Skip the API call when custom urlFns are provided (e.g. shared links).
    // Otherwise defer it: the lightbox render only needs the media type, which
    // the `mediaType` prop already supplies for the main gallery. Fetch the full
    // record (EXIF + faces join) lazily — only when the info panel opens, the
    // user zooms (we need mimeType for the original layer), or no type hint was
    // given. The info panel's MediaDetail shares this query key, so opening it
    // reuses the same fetch.
    const useApi = !urlFns;
    const { data: item } = useQuery({
        queryKey: ['media', mediaId],
        queryFn: () => getMediaById(mediaId),
        enabled: useApi && (showInfo || zoomActivated || !mediaType),
    });

    // Resolved media type: API data > prop hint > fallback
    const resolvedType = item?.type ?? mediaType ?? 'PHOTO';

    const { containerStyle: zoomStyle, isZoomed, reset: resetZoom } = useImageZoom(
        zoomContainerRef,
        resolvedType !== 'VIDEO'
    );

    // Resolution ladder (Layer 3): show the full-res original only when zoomed,
    // and only for formats the browser can decode in an <img>.
    const canShowOriginal =
        resolvedType !== 'VIDEO' && !!item && BROWSER_SAFE_IMAGE.test(item.mimeType);
    const showOriginal = isZoomed && canShowOriginal;
    const originalVisible = showOriginal && fullResLoaded;

    // Activate the detail fetch + original layer the first time the user zooms.
    useEffect(() => {
        if (isZoomed) setZoomActivated(true);
    }, [isZoomed]);

    // Drop the full-res layer when zooming back out so the web variant shows.
    useEffect(() => {
        if (!isZoomed) setFullResLoaded(false);
    }, [isZoomed]);

    const copyToClipboard = useCallback(() => {
        if (copied) return;
        try {
            // Pass a lazy promise to ClipboardItem so the browser can
            // fetch + convert in the background without blocking the UI.
            const pngPromise = fetch(urls.original(mediaId))
                .then((res) => res.blob())
                .then((blob) => {
                    if (blob.type === 'image/png') return blob;
                    return new Promise<Blob>((resolve) => {
                        const img = new window.Image();
                        img.onload = () => {
                            const canvas = document.createElement('canvas');
                            canvas.width = img.naturalWidth;
                            canvas.height = img.naturalHeight;
                            canvas.getContext('2d')!.drawImage(img, 0, 0);
                            canvas.toBlob((b) => resolve(b!), 'image/png');
                            URL.revokeObjectURL(img.src);
                        };
                        img.src = URL.createObjectURL(blob);
                    });
                });
            navigator.clipboard.write([
                new ClipboardItem({ 'image/png': pngPromise }),
            ]);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
        catch {
            // Clipboard API may not be available
        }
    }, [mediaId, urls, copied]);

    const shareFile = useCallback(async () => {
        try {
            const res = await fetch(urls.original(mediaId));
            const blob = await res.blob();
            const ext = blob.type.split('/')[1] || 'jpg';
            const file = new File([blob], `photo.${ext}`, { type: blob.type });
            await navigator.share({ files: [file] });
        }
        catch {
            // Share cancelled or not supported
        }
    }, [mediaId, urls]);

    useSwipeNavigation(trackRef, {
        onSwipeLeft: onNext,
        onSwipeRight: onPrev,
        onSwipeUp: onClose,
        disabled: isZoomed,
    });

    // Reset track transform and zoom after navigation (before paint)
    useLayoutEffect(() => {
        if (trackRef.current) {
            trackRef.current.style.transition = 'none';
            trackRef.current.style.transform = 'translateX(-33.333%)';
        }
        resetZoom();
    }, [mediaId, resetZoom]);

    // Reset loaded state when mediaId changes, unless the web image was already
    // loaded before. The original layer always re-arms (loads again on zoom).
    useEffect(() => {
        setWebLoaded(loadedWebRef.current.has(mediaId));
        setFullResLoaded(false);
        setZoomActivated(false);
    }, [mediaId]);

    // Preload adjacent images at low priority so they don't compete with the
    // current slide's web image.
    useEffect(() => {
        const idsToPreload = [prevMediaId, nextMediaId].filter(
            (id): id is string => !!id && !preloadedRef.current.has(id)
        );
        for (const id of idsToPreload) {
            preloadedRef.current.add(id);
            const img = new Image();
            img.setAttribute('fetchpriority', 'low');
            img.src = urls.web(id);
        }
    }, [prevMediaId, nextMediaId, urls]);

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
                    {showDelete ? (
                        <MediaActions mediaId={mediaId} onDelete={onClose} />
                    ) : (
                        <button
                            className={dlStyles.button}
                            title="Download"
                            onClick={() => triggerDownload([{ id: mediaId, url: urls.download(mediaId) }])}
                        >
                            <Download className={dlStyles.icon} />
                        </button>
                    )}
                    <IconButton
                        icon={Share2}
                        size="sm"
                        variant="overlay"
                        onClick={shareFile}
                        title="Share"
                    />
                    {resolvedType !== 'VIDEO' && (
                        <IconButton
                            icon={copied ? Check : Copy}
                            size="sm"
                            variant="overlay"
                            onClick={copyToClipboard}
                            title="Copy image to clipboard"
                        />
                    )}
                    {showInfoPanel && (
                        <IconButton
                            icon={Info}
                            size="sm"
                            variant="overlay"
                            active={showInfo}
                            onClick={() => setShowInfo((p) => !p)}
                        />
                    )}
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
                                src={urls.web(prevMediaId)}
                                alt=""
                                fetchPriority="low"
                                decoding="async"
                                className="max-w-[90%] max-h-[90vh] object-contain"
                                draggable={false}
                            />
                        )}
                    </div>

                    {/* Current slide */}
                    <div className="h-full flex items-center justify-center" style={{ width: '33.333%' }}>
                        <div
                            ref={zoomContainerRef}
                            className="max-w-[90%] max-h-[90vh] relative"
                            style={resolvedType !== 'VIDEO' ? zoomStyle : undefined}
                        >
                            {resolvedType === 'VIDEO' ? (
                                <VideoPlayer src={urls.original(mediaId)} poster={urls.thumbnail(mediaId)} />
                            ) : (
                                <>
                                    {/* Layer 1 — thumbnail placeholder, shown instantly */}
                                    <img
                                        src={urls.thumbnail(mediaId)}
                                        alt=""
                                        decoding="async"
                                        className={`max-w-full max-h-[90vh] object-contain transition-opacity duration-200 ${
                                            webLoaded || originalVisible ? 'opacity-0 absolute inset-0' : 'opacity-100'
                                        }`}
                                        draggable={false}
                                    />
                                    {/* Layer 2 — web-optimized image, first sharp paint */}
                                    <img
                                        src={urls.web(mediaId)}
                                        alt={item?.fileName ?? 'Photo'}
                                        fetchPriority="high"
                                        decoding="async"
                                        className={`max-w-full max-h-[90vh] object-contain transition-opacity duration-200 ${
                                            webLoaded && !originalVisible ? 'opacity-100' : 'opacity-0 absolute inset-0'
                                        }`}
                                        draggable={false}
                                        onLoad={() => {
                                            loadedWebRef.current.add(mediaId);
                                            setWebLoaded(true);
                                        }}
                                    />
                                    {/* Layer 3 — full-resolution original, loaded lazily on zoom */}
                                    {showOriginal && (
                                        <img
                                            src={urls.original(mediaId)}
                                            alt=""
                                            fetchPriority="high"
                                            decoding="async"
                                            className={`max-w-full max-h-[90vh] object-contain transition-opacity duration-200 ${
                                                fullResLoaded ? 'opacity-100' : 'opacity-0 absolute inset-0'
                                            }`}
                                            draggable={false}
                                            onLoad={() => setFullResLoaded(true)}
                                        />
                                    )}
                                    {/* Loading spinner until the first sharp paint */}
                                    {!webLoaded && (
                                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                            <Loader2 className="w-8 h-8 text-white/50 animate-spin" />
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>

                    {/* Next slide */}
                    <div className="h-full flex items-center justify-center" style={{ width: '33.333%' }}>
                        {nextMediaId && (
                            <img
                                src={urls.web(nextMediaId)}
                                alt=""
                                fetchPriority="low"
                                decoding="async"
                                className="max-w-[90%] max-h-[90vh] object-contain"
                                draggable={false}
                            />
                        )}
                    </div>
                </div>
            </div>

            {showInfoPanel && showInfo && (
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
