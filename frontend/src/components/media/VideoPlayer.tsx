'use client';

interface VideoPlayerProps {
    src: string;
    /** Shown until the first frame buffers — pass the grid thumbnail. */
    poster?: string;
    preload?: 'none' | 'metadata' | 'auto';
}

export function VideoPlayer({ src, poster, preload = 'metadata' }: VideoPlayerProps) {
    return (
        <video
            src={src}
            poster={poster}
            preload={preload}
            controls
            autoPlay
            className="max-w-full max-h-[90vh] object-contain"
        />
    );
}
