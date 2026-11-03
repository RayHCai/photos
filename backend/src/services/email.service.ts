import { env } from '../config/env.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 15_000;

export interface OutgoingEmail {
    to: string;
    subject: string;
    html: string;
    text: string;
}

/** Whether outgoing email has both a key to send with and somewhere to send to. */
export function isEmailConfigured(): boolean {
    return Boolean(env.RESEND_API_KEY && env.NOTIFY_EMAIL_TO);
}

/**
 * Send one email through Resend's REST API. A plain fetch rather than the SDK:
 * this is the only call made, and it needs nothing the SDK adds.
 */
export async function sendEmail(email: OutgoingEmail): Promise<void> {
    if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');

    const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from: env.NOTIFY_EMAIL_FROM,
            to: [email.to],
            subject: email.subject,
            html: email.html,
            text: email.text,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        throw new Error(`Resend rejected the email (${res.status}): ${detail}`);
    }
}
