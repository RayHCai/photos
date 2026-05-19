export interface CursorPaginatedResponse<T> {
    items: T[];
    nextCursor: string | null;
    hasMore: boolean;
}
