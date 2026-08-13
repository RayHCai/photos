const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

/**
 * Default request deadline.
 *
 * apiFetch previously had no timeout and no way to pass a signal, so a request that
 * stalled after headers — a mobile radio hand-off, a dead backend socket — hung
 * until the browser gave up minutes later, leaving the view stuck in its loading
 * state, and navigating away did not cancel it.
 */
const DEFAULT_TIMEOUT_MS = 30_000;
/** Uploads and archive downloads move real bytes and need longer. */
export const LONG_TIMEOUT_MS = 10 * 60_000;

export class ApiError extends Error {
    constructor(
        public status: number,
        message: string
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

/** Raised when a request exceeds its deadline or is aborted by the caller. */
export class ApiAbortError extends Error {
    constructor(message = 'Request timed out') {
        super(message);
        this.name = 'ApiAbortError';
    }
}

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/**
 * Registered once by AuthProvider.
 *
 * There was no 401 handling anywhere: apiFetch turned a 401 into an ApiError and
 * handed it to the caller, and no caller did anything with it. Past the 30-day
 * session TTL (or after a Redis restart) the gallery simply said "No photos",
 * Collections said "No collections", and nothing ever routed to /login.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
    onUnauthorized = handler;
}

export interface ApiFetchOptions extends RequestInit {
    /** Overrides the default deadline. */
    timeoutMs?: number;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...init } = options;

    const headers: Record<string, string> = {
        ...(init.headers as Record<string, string>),
    };

    if (!(init.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }

    // Combine the caller's signal (React Query supplies one per query) with our
    // deadline, so either can cancel the request.
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    let res: Response;
    try {
        res = await fetch(`${API_BASE}${path}`, {
            ...init,
            credentials: 'include',
            headers,
            signal: combined,
        });
    }
    catch (err) {
        if (
            err instanceof DOMException &&
            (err.name === 'AbortError' || err.name === 'TimeoutError')
        ) {
            throw new ApiAbortError(
                signal?.aborted ? 'Request cancelled' : 'Request timed out'
            );
        }
        throw err;
    }

    if (!res.ok) {
        if (res.status === 401) {
            onUnauthorized?.();
        }
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, body.error || res.statusText);
    }

    if (res.status === 204) {
        return undefined as T;
    }

    return res.json();
}

export function apiUrl(path: string): string {
    return `${API_BASE}${path}`;
}

export function buildQueryString(
    params: Record<string, string | number | boolean | undefined | null>
): string {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') sp.set(key, String(value));
    }
    return sp.toString();
}
