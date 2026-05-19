export interface LoginResponse {
    token: string;
    expiresAt: string;
}

export interface SessionStatus {
    valid: boolean;
    expiresAt?: string;
}
