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

export function formatFileSize(bytes: number | string): string {
    const b = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(seconds: number | null): string {
    if (seconds === null || seconds === undefined) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}
