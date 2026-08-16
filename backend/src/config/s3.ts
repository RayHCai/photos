import { S3Client } from '@aws-sdk/client-s3';
import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { env } from './env.js';

const credentials = {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
};

export const s3Client = new S3Client({
    region: env.AWS_REGION,
    credentials,
});

/**
 * A second client that presigns uploads WITHOUT the SDK's default integrity
 * checksum, for callers that stream a chunked body to the presigned URL.
 *
 * Since aws-sdk-js v3.729 the default is requestChecksumCalculation:
 * 'WHEN_SUPPORTED', which adds a CRC32 to every upload. At presign time the body
 * isn't known, so the SDK bakes a placeholder checksum (CRC32 of an empty body)
 * into the signature and expects the client to send the real one via aws-chunked
 * trailer framing. The worker streams transcoded video from disk as a plain
 * chunked PUT (no Content-Length, no aws-chunked framing), which S3 rejects with
 * 501 Not Implemented. Fixed-length uploads (browser originals, in-memory
 * thumbnails/crops/web) satisfy the baked-in checksum and are unaffected, so
 * this client is used only for the worker's streaming video upload.
 */
export const s3StreamingUploadClient = new S3Client({
    region: env.AWS_REGION,
    credentials,
    requestChecksumCalculation: 'WHEN_REQUIRED',
});

/**
 * Used only to purge deleted objects from the edge. CloudFront is a global service,
 * so its control plane always lives in us-east-1 regardless of the bucket's region.
 */
export const cloudFrontClient = new CloudFrontClient({
    region: 'us-east-1',
    credentials,
});
