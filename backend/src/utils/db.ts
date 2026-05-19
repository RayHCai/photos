import { AppError } from '../middleware/errorHandler.js';

export async function findOrThrow<T>(
    queryFn: () => Promise<T | null>,
    label: string
): Promise<T> {
    const result = await queryFn();
    if (!result) throw new AppError(404, `${label} not found`);
    return result;
}

export function applyCursor(cursor?: string): { skip?: number; cursor?: { id: string } } {
    return cursor ? { skip: 1, cursor: { id: cursor } } : {};
}

export function paginateResults<T extends { id: string }>(
    items: T[],
    limit: number
): { items: T[]; nextCursor: string | null; hasMore: boolean } {
    const hasMore = items.length > limit;
    const results = hasMore ? items.slice(0, -1) : items;
    const nextCursor = hasMore ? results[results.length - 1]?.id ?? null : null;
    return { items: results, nextCursor, hasMore };
}
