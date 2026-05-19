import { useEffect } from 'react';

export function useEscapeKey(callback: () => void, enabled: boolean = true) {
    useEffect(() => {
        if (!enabled) return;
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') callback();
        };
        document.addEventListener('keydown', handleEsc);
        return () => document.removeEventListener('keydown', handleEsc);
    }, [callback, enabled]);
}
