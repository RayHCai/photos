'use client';

import { useState } from 'react';
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
            /**
             * autoPlay only works when muted. iOS and Chrome both block unmuted
             * autoplay, so the previous `autoPlay` with sound silently did nothing and
             * the user pressed play manually every time.
             */
            autoPlay
            muted
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
