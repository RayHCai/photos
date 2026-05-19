'use client';

interface VideoPlayerProps {
    src: string;
}

export function VideoPlayer({ src }: VideoPlayerProps) {
    return (
        <video
            src={src}
            controls
            autoPlay
            className="max-w-full max-h-full object-contain"
        />
    );
}
