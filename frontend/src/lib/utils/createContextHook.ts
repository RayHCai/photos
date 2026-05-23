'use client';

import { useContext, type Context } from 'react';

export function createContextHook<T>(ctx: Context<T | null>, name: string): () => T {
    return function useContextHook() {
        const value = useContext(ctx);
        if (!value) {
            throw new Error(`${name} must be used within its provider`);
        }
        return value;
    };
}
