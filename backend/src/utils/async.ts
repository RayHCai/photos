import { Request, Response, NextFunction } from 'express';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<any>;

export function asyncHandler(fn: AsyncRequestHandler) {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Start a promise that is deliberately not awaited, routing any rejection to a
 * handler so it can never surface as an unhandled rejection.
 *
 * Named rather than a bare `void promise` so the intent is explicit at the call
 * site and the linter's no-void rule stays on.
 */
export function fireAndForget(
    work: () => Promise<unknown>,
    onError: (err: unknown) => void
): void {
    work().then(
        () => undefined,
        (err: unknown) => onError(err)
    );
}

/**
 * Run an async mapper over items with a bounded number in flight.
 *
 * Several call sites used an unbounded `Promise.all` over a user-supplied array —
 * e.g. one S3 HeadObject per filename in an upload batch, which a 500-file drop
 * turned into 500 concurrent S3 requests.
 */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    if (items.length === 0) return [];

    const results = new Array<R>(items.length);
    let cursor = 0;

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        for (;;) {
            const index = cursor++;
            if (index >= items.length) return;
            results[index] = await mapper(items[index]!, index);
        }
    });

    await Promise.all(workers);
    return results;
}
