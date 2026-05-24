'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { ApiError } from '@/lib/api/client';

export function LoginForm() {
    const { login } = useAuth();
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await login(password);
        }
        catch (err) {
            if (err instanceof ApiError) {
                setError(err.message);
            }
            else {
                setError('Something went wrong');
            }
        }
        finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-stone-50">
            <div className="w-full max-w-xs mx-4">
                <form onSubmit={handleSubmit} className="space-y-3">
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Password"
                        className="w-full px-3 py-2 text-sm bg-stone-50 border border-stone-200 rounded text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400 focus:border-transparent transition-shadow"
                        autoFocus
                        disabled={loading}
                    />

                    {error && (
                        <p className="text-xs text-stone-700 font-medium">{error}</p>
                    )}
                </form>
            </div>
        </div>
    );
}
