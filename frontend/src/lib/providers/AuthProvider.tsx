'use client';

import { createContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import * as authApi from '../api/auth';

interface AuthContextValue {
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (password: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        authApi
            .getStatus()
            .then((status) => {
                setIsAuthenticated(status.valid);
            })
            .catch(() => {
                setIsAuthenticated(false);
            })
            .finally(() => {
                setIsLoading(false);
            });
    }, []);

    const login = useCallback(async (password: string) => {
        await authApi.login(password);
        setIsAuthenticated(true);
    }, []);

    return (
        <AuthContext.Provider
            value={{ isAuthenticated, isLoading, login }}
        >
            {children}
        </AuthContext.Provider>
    );
}
