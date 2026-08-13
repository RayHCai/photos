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
 * Used only to purge deleted objects from the edge. CloudFront is a global service,
 * so its control plane always lives in us-east-1 regardless of the bucket's region.
 */
export const cloudFrontClient = new CloudFrontClient({
    region: 'us-east-1',
    credentials,
});
