import { apiFetch } from './client';
import type { LoginResponse, SessionStatus } from '../types/auth';

export function login(password: string): Promise<LoginResponse> {
    return apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
    });
}

export function setup(password: string): Promise<{ message: string }> {
    return apiFetch('/auth/setup', {
        method: 'POST',
        body: JSON.stringify({ password }),
    });
}

export function getStatus(): Promise<SessionStatus> {
    return apiFetch('/auth/status');
}
