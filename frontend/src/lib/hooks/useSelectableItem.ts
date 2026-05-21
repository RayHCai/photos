'use client';

import { useCallback } from 'react';

interface UseSelectableItemOptions {
    isSelecting?: boolean;
    onSelect?: (e: React.MouseEvent) => void;
    onClick?: () => void;
}

export function useSelectableItem({ isSelecting, onSelect, onClick }: UseSelectableItemOptions) {
    const handleClick = useCallback(
        (e: React.MouseEvent) => {
            if (isSelecting && onSelect) {
                e.preventDefault();
                onSelect(e);
            }
            else {
                onClick?.();
            }
        },
        [isSelecting, onSelect, onClick]
    );

    const handleContextMenu = useCallback(
        (e: React.MouseEvent) => {
            if (onSelect) {
                e.preventDefault();
                onSelect(e);
            }
        },
        [onSelect]
    );

    return { handleClick, handleContextMenu };
}
