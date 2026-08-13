/**
 * Pipeline stages, shared by the queue, the media service, and the /internal
 * route validation.
 *
 * This list previously existed in four hand-maintained copies (queue.service,
 * media.service, internal.routes, and worker/pipeline.py) and had already
 * drifted: the internal-route copy omitted 'metadata', so a retry requesting
 * that stage was rejected by zod and surfaced to the operator as an opaque 500.
 *
 * The Python worker has its own literal in pipeline.py; PIPELINE_STAGES is
 * asserted against it by a test so the two cannot silently diverge again.
 */
export const PIPELINE_STAGES = [
    'full',
    'clip',
    'faces',
    'blurhash',
    'transcode',
    'web',
    'thumbnail-ladder',
    'metadata',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/**
 * Longest a single stage may hold its BullMQ lock.
 *
 * The default is 30s, which a 4K transcode blows through — the lock lapsed, the
 * stalled-job checker re-delivered the job, and the same item was transcoded
 * twice, producing duplicate face rows and "Missing lock for job" failures.
 */
export const JOB_LOCK_DURATION_MS = 15 * 60 * 1000;
