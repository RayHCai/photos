import { format, isToday, isYesterday, isThisYear } from 'date-fns';

export function formatDate(dateStr: string): string {
    // Accept date-only keys like "2024-05-12" by appending a time component
    const normalized = dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00';
    const date = new Date(normalized);
    if (isToday(date)) return 'Today';
    if (isYesterday(date)) return 'Yesterday';
    if (isThisYear(date)) return format(date, 'MMMM d');
    return format(date, 'MMMM d, yyyy');
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/**
 * Human-readable byte count.
 *
 * The settings page shipped a second, log-based implementation with different decimal
 * places and a TB unit this one lacked — so a library over 1 TB was reported as
 * "1024.00 GB" in one place and "1.0 TB" in another. Accepts a string because the API
 * serialises file_size as a decimal string (Prisma BigInt).
 */
export function formatFileSize(bytes: number | string): string {
    const b = typeof bytes === 'string' ? Number(bytes) : bytes;
    if (!Number.isFinite(b) || b <= 0) return '0 B';

    const exponent = Math.min(
        Math.floor(Math.log(b) / Math.log(1024)),
        SIZE_UNITS.length - 1
    );
    const value = b / 1024 ** exponent;
    // Whole bytes need no decimal; everything else gets one.
    return `${value.toFixed(exponent === 0 ? 0 : 1)} ${SIZE_UNITS[exponent]}`;
}

export function formatDuration(seconds: number | null): string {
    if (seconds === null || seconds === undefined) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}
