'use client';

import { useCallback } from 'react';

export function useLightboxNavigation(
    items: Array<{ id: string }>,
    lightboxId: string | null,
    setLightboxId: (id: string | null) => void,
) {
    const lightboxIndex = lightboxId
        ? items.findIndex((i) => i.id === lightboxId)
        : -1;

    const handlePrev = useCallback(() => {
        if (lightboxIndex > 0) {
            setLightboxId(items[lightboxIndex - 1].id);
        }
    }, [lightboxIndex, items, setLightboxId]);

    const handleNext = useCallback(() => {
        if (lightboxIndex < items.length - 1) {
            setLightboxId(items[lightboxIndex + 1].id);
        }
    }, [lightboxIndex, items, setLightboxId]);

    return {
        lightboxIndex,
        onPrev: lightboxIndex > 0 ? handlePrev : undefined,
        onNext: lightboxIndex < items.length - 1 ? handleNext : undefined,
    };
}
