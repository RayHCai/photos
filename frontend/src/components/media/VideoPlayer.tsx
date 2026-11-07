'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

interface VideoPlayerProps {
    src: string;
    /** Shown until the first frame buffers — pass the grid thumbnail. */
    poster?: string;
    preload?: 'none' | 'metadata' | 'auto';
    /** Display rotation in degrees from the container matrix, if any. */
    rotation?: number | null;
}

export function VideoPlayer({ src, poster, preload = 'metadata', rotation }: VideoPlayerProps) {
    const [failed, setFailed] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);

    /**
     * Start with sound, and fall back to muted only if the browser refuses.
     *
     * A static `autoPlay muted` left every video silent: on phones the volume
     * buttons don't lift `muted`, only the small speaker icon does, so videos
     * looked like they had no audio. Opening the lightbox is a click, which
     * usually grants unmuted playback; when it doesn't, muted autoplay is still
     * better than a frozen first frame.
     */
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        video.muted = false;
        video.play().catch((err: DOMException) => {
            if (err.name !== 'NotAllowedError') return;
            video.muted = true;
            video.play().catch(() => {});
        });
    }, [src]);

    if (failed) {
        return (
            <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-stone-300">
                <AlertTriangle className="w-8 h-8 text-amber-400" aria-hidden="true" />
                <p className="text-sm">This video can&apos;t be played in your browser.</p>
                <p className="text-xs text-stone-500">Download it to play in another app.</p>
            </div>
        );
    }

    return (
        <video
            src={src}
            poster={poster}
            preload={preload}
            controls
            /**
             * Required on iOS: without it, tapping play hands the video to the native
             * fullscreen player and takes over the whole screen, losing the lightbox
             * and its navigation entirely.
             */
            playsInline
            ref={videoRef}
            /**
             * A container the browser cannot decode (HEVC outside Safari, some
             * QuickTime) previously rendered as a permanently black rectangle with no
             * explanation and no route to the file.
             */
            onError={() => setFailed(true)}
            className="max-w-full max-h-[90dvh] object-contain"
            style={
                // Only rotate when the container asked for it and the browser has not
                // already applied it. 0 must not create a transform, which would
                // promote a compositor layer for nothing.
                rotation ? { transform: `rotate(${rotation}deg)` } : undefined
            }
        />
    );
}
