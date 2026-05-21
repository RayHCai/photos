'use client';

import { memo, useMemo } from 'react';
import { decode } from 'blurhash';
import { PlayCircle } from 'lucide-react';
import { thumbnailUrl } from '@/lib/api/media';
import { formatDuration } from '@/lib/utils/format';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { useSelectableItem } from '@/lib/hooks/useSelectableItem';
import type { MediaShellItem } from '@/lib/types/media';

function blurhashToDataUrl(hash: string, width = 32, height = 32): string | null {
    if (typeof document === 'undefined') return null;
    const pixels = decode(hash, width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL();
}

interface GalleryItemProps {
    item: MediaShellItem;
    width: number;
    height: number;
    onClick: () => void;
    isSelected?: boolean;
    isSelecting?: boolean;
    onSelect?: (e: React.MouseEvent) => void;
    thumbnailSrc?: string;
}

export const GalleryItem = memo(function GalleryItem({
    item,
    width,
    height,
    onClick,
    isSelected,
    isSelecting,
    onSelect,
    thumbnailSrc,
}: GalleryItemProps) {
    const { handleClick, handleContextMenu } = useSelectableItem({
        isSelecting,
        onSelect,
        onClick: item.processingStatus === 'COMPLETED' ? onClick : undefined,
    });

    const blurDataUrl = useMemo(() => {
        if (!item.blurHash) return null;
        try {
            return blurhashToDataUrl(item.blurHash);
        }
        catch {
            return null;
        }
    }, [item.blurHash]);

    return (
        <div
            className={`relative overflow-hidden bg-stone-100 flex-shrink-0 group select-none ${
                item.processingStatus === 'COMPLETED' || isSelecting ? 'cursor-pointer' : 'cursor-default'
            }`}
            style={{
                width,
                height,
                ...(blurDataUrl && {
                    backgroundImage: `url(${blurDataUrl})`,
                    backgroundSize: 'cover',
                }),
            }}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
        >
            {item.processingStatus === 'COMPLETED' && item.thumbnailKey ? (
                <img
                    src={thumbnailSrc ?? thumbnailUrl(item.id)}
                    alt="Photo"
                    loading="lazy"
                    className="w-full h-full object-cover"
                    draggable={false}
                />
            ) : (
                <div className="w-full h-full flex items-center justify-center text-stone-400 text-xs">
                    {item.processingStatus === 'FAILED'
                        ? 'Failed'
                        : 'Processing...'}
                </div>
            )}

            {item.type === 'VIDEO' && (
                <div className="absolute bottom-1 right-1 flex items-center gap-1 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                    {item.durationSeconds !== null && (
                        <span className="text-[11px] font-medium">{formatDuration(item.durationSeconds)}</span>
                    )}
                    <PlayCircle className="w-4 h-4" />
                </div>
            )}

            {onSelect && (
                <SelectionCheckbox isSelected={isSelected} isSelecting={isSelecting} onSelect={onSelect} />
            )}

            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors pointer-events-none" />
        </div>
    );
});
