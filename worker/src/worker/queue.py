from __future__ import annotations

from typing import Any

from bullmq import Queue

from worker import backend_client as api
from worker.consumer import get_redis_opts
from worker.log import get_logger
from worker.pipeline import Stage

logger = get_logger(__name__)

_queue: Queue | None = None


def _get_queue() -> Queue:
    global _queue  # noqa: PLW0603
    if _queue is None:
        _queue = Queue("process-media", {"connection": get_redis_opts()})
    return _queue


async def enqueue_retry(
    *,
    media_item_id: str,
    original_key: str,
    mime_type: str,
    media_type: str,
    start_stage: Stage,
) -> str:
    """Enqueue a processing job starting from a specific stage."""
    task_id = await api.create_retry_task(media_item_id, start_stage)
    queue = _get_queue()
    job = await queue.add(
        "process",
        {
            "mediaItemId": media_item_id,
            "taskId": task_id,
            "originalKey": original_key,
            "mimeType": mime_type,
            "type": media_type,
            "startStage": start_stage,
        },
        {
            "priority": 1 if media_type == "PHOTO" else 2,
            "attempts": 3,
            "backoff": {"type": "exponential", "delay": 5000},
        },
    )
    logger.info(
        "retry_enqueued",
        job_id=job.id,
        task_id=task_id,
        media_item_id=media_item_id,
        start_stage=start_stage,
    )
    return str(job.id)


async def enqueue_batch_retry(
    items: list[dict[str, Any]],
    start_stage: Stage,
) -> int:
    """Enqueue multiple retry jobs. Returns count of enqueued jobs."""
    count = 0
    for item in items:
        await enqueue_retry(
            media_item_id=item["id"],
            original_key=item["original_key"],
            mime_type=item["mime_type"],
            media_type=item["type"],
            start_stage=start_stage,
        )
        count += 1
    return count
