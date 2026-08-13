import { apiFetch, ApiError } from './client';
import { EXT_TO_MIME } from '../constants/mediaFormats';

const MULTIPART_THRESHOLD = 50 * 1024 * 1024;
const PART_SIZE = 10 * 1024 * 1024;
const CONCURRENCY = 6;

/** Retries *after* the first attempt, so 4 tries in the worst case. */
const S3_MAX_RETRIES = 3;
const S3_RETRY_BASE_DELAY_MS = 1000;

/** Notified when an S3 request failed and is about to be retried. */
export type UploadRetryHandler = (attempt: number, maxAttempts: number) => void;

/** An S3 request that failed. `status` is absent for transport-level failures. */
class S3UploadError extends Error {
    constructor(
        message: string,
        public status?: number
    ) {
        super(message);
        this.name = 'S3UploadError';
    }
}

function resolveMimeType(file: File): string {
    if (file.type) return file.type;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

interface DuplicateEntry {
    id: string;
    fileName: string;
    thumbnailKey: string | null;
}

interface CheckDuplicatesResponse {
    duplicates: DuplicateEntry[];
}

export async function checkDuplicates(fileNames: string[]): Promise<DuplicateEntry[]> {
    const { duplicates } = await apiFetch<CheckDuplicatesResponse>(
        '/media/upload/check-duplicates',
        {
            method: 'POST',
            body: JSON.stringify({ fileNames }),
        }
    );
    return duplicates;
}

interface PresignResponse {
    id: string;
    presignedUrl: string;
    s3Key: string;
}

interface MultipartInitResponse {
    id: string;
    uploadId: string;
    s3Key: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Is another attempt worth making? Transport failures (no status) and 5xx or
 * throttling responses are transient, and a 403 is usually nothing worse than an
 * expired signature, which re-signing fixes. A hard 4xx — bad request, length
 * mismatch — would fail identically every time.
 */
function isRetryable(err: unknown): boolean {
    const status =
        err instanceof S3UploadError || err instanceof ApiError ? err.status : undefined;
    if (status === undefined) return true;
    if (status === 403 || status === 408 || status === 429) return true;
    return status >= 500;
}

/** PUT a body to S3, resolving with the object's ETag. */
function uploadToS3WithProgress(
    url: string,
    body: Blob,
    onProgress: (pct: number) => void,
    signal?: AbortSignal
): Promise<string> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new S3UploadError('Cancelled'));
            return;
        }

        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);

        // XHR predates AbortSignal, so the bridge is manual. Without it there was no
        // way to stop an in-flight PUT of a multi-gigabyte original.
        const onAbort = () => xhr.abort();
        signal?.addEventListener('abort', onAbort, { once: true });
        const cleanup = () => signal?.removeEventListener('abort', onAbort);
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                onProgress(Math.round((e.loaded / e.total) * 100));
            }
        };
        xhr.onload = () => {
            cleanup();
            if (xhr.status >= 200 && xhr.status < 300) {
                // Readable because the bucket CORS config exposes ETag; multipart
                // completion needs it to reference the part.
                resolve(xhr.getResponseHeader('ETag') ?? '');
            }
            else {
                reject(new S3UploadError(`S3 upload failed: ${xhr.status}`, xhr.status));
            }
        };
        xhr.onerror = () => {
            cleanup();
            reject(new S3UploadError('S3 upload failed'));
        };
        xhr.ontimeout = () => {
            cleanup();
            reject(new S3UploadError('S3 upload timed out'));
        };
        xhr.onabort = () => {
            cleanup();
            reject(new S3UploadError('Cancelled'));
        };
        xhr.send(body);
    });
}

/**
 * PUT a body to S3, retrying a transient failure up to `S3_MAX_RETRIES` times
 * with exponential backoff (1s, 2s, 4s). `getUrl` runs before every attempt so a
 * retry can pick up a freshly signed URL instead of replaying an expired one.
 */
async function putToS3WithRetry(
    getUrl: () => Promise<string>,
    body: Blob,
    onProgress: (pct: number) => void,
    onRetry?: UploadRetryHandler,
    signal?: AbortSignal
): Promise<string> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await uploadToS3WithProgress(await getUrl(), body, onProgress, signal);
        }
        catch (err) {
            // A cancellation is not a transient failure; retrying it would restart the
            // upload the user just stopped.
            if (signal?.aborted) throw err;
            if (attempt >= S3_MAX_RETRIES || !isRetryable(err)) throw err;
            onRetry?.(attempt + 1, S3_MAX_RETRIES);
            await sleep(S3_RETRY_BASE_DELAY_MS * 2 ** attempt);
            // Rewind: the failed attempt may have reported partial progress.
            onProgress(0);
        }
    }
}

async function runWithConcurrency(
    tasks: Array<() => Promise<void>>,
    concurrency: number
) {
    const queue = [...tasks];
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length > 0) {
            const task = queue.shift();
            if (task) await task();
        }
    });
    await Promise.all(workers);
}

async function singleUpload(
    file: File,
    onProgress: (pct: number) => void,
    fileName?: string,
    onRetry?: UploadRetryHandler,
    signal?: AbortSignal
): Promise<string> {
    const { id, presignedUrl } = await apiFetch<PresignResponse>(
        '/media/upload/presign',
        {
            method: 'POST',
            body: JSON.stringify({
                fileName: fileName || file.name,
                mimeType: resolveMimeType(file),
                fileSize: file.size,
            }),
        }
    );

    // Every attempt reuses this URL: /upload/presign also creates the media-item
    // row, so re-signing per attempt would orphan a record each time. The
    // signature outlives the retry window by a wide margin.
    await putToS3WithRetry(async () => presignedUrl, file, onProgress, onRetry, signal);

    await apiFetch('/media/upload/confirm', {
        method: 'POST',
        body: JSON.stringify({ id }),
    });

    return id;
}

async function multipartUpload(
    file: File,
    onProgress: (pct: number) => void,
    fileName?: string,
    onRetry?: UploadRetryHandler,
    signal?: AbortSignal
): Promise<string> {
    const totalParts = Math.ceil(file.size / PART_SIZE);

    const { id, uploadId, s3Key } = await apiFetch<MultipartInitResponse>(
        '/media/upload/multipart/init',
        {
            method: 'POST',
            body: JSON.stringify({
                fileName: fileName || file.name,
                mimeType: resolveMimeType(file),
                fileSize: file.size,
            }),
        }
    );

    const parts: Array<{ PartNumber: number; ETag: string }> = [];
    let completedParts = 0;

    const uploadPart = async (partNumber: number) => {
        const start = (partNumber - 1) * PART_SIZE;
        const end = Math.min(start + PART_SIZE, file.size);
        const blob = file.slice(start, end);

        // Part URLs are pure signatures (no DB write), so each attempt gets a
        // fresh one — worth it here, where a large file can outlive a signature.
        const etag = await putToS3WithRetry(
            async () => {
                const { presignedUrl } = await apiFetch<{ presignedUrl: string }>(
                    '/media/upload/multipart/presign',
                    {
                        method: 'POST',
                        body: JSON.stringify({ s3Key, uploadId, partNumber }),
                    }
                );
                return presignedUrl;
            },
            blob,
            // Progress is reported per completed part, so byte updates are noise.
            () => {},
            onRetry,
            signal
        );

        if (!etag) {
            // Completion can't reference a part without its ETag. Fail here,
            // next to the cause, rather than as an opaque error from /complete.
            throw new S3UploadError(`S3 upload failed: no ETag for part ${partNumber}`);
        }

        parts.push({ PartNumber: partNumber, ETag: etag });
        completedParts++;
        onProgress(Math.round((completedParts / totalParts) * 100));
    };

    await runWithConcurrency(
        Array.from({ length: totalParts }, (_, i) => () => uploadPart(i + 1)),
        CONCURRENCY
    );

    parts.sort((a, b) => a.PartNumber - b.PartNumber);
    await apiFetch('/media/upload/multipart/complete', {
        method: 'POST',
        body: JSON.stringify({ mediaItemId: id, s3Key, uploadId, parts }),
    });

    return id;
}

export async function uploadFile(
    file: File,
    onProgress: (pct: number) => void,
    fileName?: string,
    onRetry?: UploadRetryHandler,
    /**
     * Aborts the upload. There was no way to cancel at all: the panel's remove button
     * hid the row while the request kept running to completion.
     */
    signal?: AbortSignal
): Promise<string> {
    if (signal?.aborted) throw new Error('Cancelled');

    if (file.size > MULTIPART_THRESHOLD) {
        return multipartUpload(file, onProgress, fileName, onRetry, signal);
    }
    return singleUpload(file, onProgress, fileName, onRetry, signal);
}
