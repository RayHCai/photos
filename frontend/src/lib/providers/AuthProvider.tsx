'use client';

import {
    createContext,
    useState,
    useEffect,
    useCallback,
    useMemo,
    type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import * as authApi from '../api/auth';
import { setUnauthorizedHandler } from '../api/client';

interface AuthContextValue {
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (password: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const router = useRouter();
    const queryClient = useQueryClient();

    useEffect(() => {
        let cancelled = false;

        authApi
            .getStatus()
            .then((status) => {
                if (!cancelled) setIsAuthenticated(status.valid);
            })
            .catch(() => {
                if (!cancelled) setIsAuthenticated(false);
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    /**
     * Global 401 handling.
     *
     * Any request failing with 401 means the session is gone, so the cache is
     * dropped — it holds the previous session's photos, and in a shared-password app
     * the next person to sign in must not see them — and the user is routed to
     * /login. Without this, an expired session presented as a permanently empty
     * library with no path to recovery: the gallery said "No photos", uploads failed
     * with a generic toast, and nothing ever redirected.
     */
    useEffect(() => {
        setUnauthorizedHandler(() => {
            setIsAuthenticated(false);

            // Public, unauthenticated routes — the shared /s/[slug] page and /login
            // itself — must never be bounced to login on a 401. A logged-out visitor
            // is the expected state there: the shared page is world-viewable, and
            // AuthProvider's own /auth/status probe 401s for every guest. Without this
            // guard that probe redirected anyone opening a share link to /login,
            // making public links effectively require authentication.
            const path = window.location.pathname;
            if (path === '/login' || path.startsWith('/s/')) return;

            queryClient.clear();
            router.replace('/login');
        });
        return () => setUnauthorizedHandler(null);
    }, [queryClient, router]);

    const login = useCallback(
        async (password: string) => {
            await authApi.login(password);
            setIsAuthenticated(true);
            // The previous session's cache must not leak into this one.
            queryClient.clear();
        },
        [queryClient]
    );

    // Memoized: an object literal here changes identity on every render, so every
    // consumer re-rendered whenever anything above this provider did.
    const value = useMemo(
        () => ({ isAuthenticated, isLoading, login }),
        [isAuthenticated, isLoading, login]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
