import { apiFetch } from './client';

const MULTIPART_THRESHOLD = 50 * 1024 * 1024;
const PART_SIZE = 10 * 1024 * 1024;
const CONCURRENCY = 6;

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

function uploadToS3WithProgress(
    url: string,
    body: Blob,
    onProgress: (pct: number) => void
): Promise<void> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                onProgress(Math.round((e.loaded / e.total) * 100));
            }
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
            }
            else {
                reject(new Error(`S3 upload failed: ${xhr.status}`));
            }
        };
        xhr.onerror = () => reject(new Error('S3 upload failed'));
        xhr.send(body);
    });
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
    fileName?: string
): Promise<string> {
    const { id, presignedUrl } = await apiFetch<PresignResponse>(
        '/media/upload/presign',
        {
            method: 'POST',
            body: JSON.stringify({
                fileName: fileName || file.name,
                mimeType: file.type,
                fileSize: file.size,
            }),
        }
    );

    await uploadToS3WithProgress(presignedUrl, file, onProgress);

    await apiFetch('/media/upload/confirm', {
        method: 'POST',
        body: JSON.stringify({ id }),
    });

    return id;
}

async function multipartUpload(
    file: File,
    onProgress: (pct: number) => void,
    fileName?: string
): Promise<string> {
    const totalParts = Math.ceil(file.size / PART_SIZE);

    const { id, uploadId, s3Key } = await apiFetch<MultipartInitResponse>(
        '/media/upload/multipart/init',
        {
            method: 'POST',
            body: JSON.stringify({
                fileName: fileName || file.name,
                mimeType: file.type,
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

        const { presignedUrl } = await apiFetch<{ presignedUrl: string }>(
            '/media/upload/multipart/presign',
            {
                method: 'POST',
                body: JSON.stringify({ s3Key, uploadId, partNumber }),
            }
        );

        const response = await fetch(presignedUrl, {
            method: 'PUT',
            body: blob,
        });

        const etag = response.headers.get('ETag') || '';
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
    fileName?: string
): Promise<string> {
    if (file.size > MULTIPART_THRESHOLD) {
        return multipartUpload(file, onProgress, fileName);
    }
    return singleUpload(file, onProgress, fileName);
}
