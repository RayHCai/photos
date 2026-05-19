from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from bullmq import Worker as BullWorker

from worker import backend_client as api
from worker.config import settings
from worker.log import get_logger
from worker.pipeline import process_media
from worker.recluster import run_recluster

logger = get_logger(__name__)


def _parse_redis_opts() -> dict[str, Any]:
    parsed = urlparse(settings.redis_url)
    opts: dict[str, Any] = {
        "host": parsed.hostname or "localhost",
        "port": parsed.port or 6379,
        "db": int(parsed.path.lstrip("/") or "0"),
    }
    if parsed.username:
        opts["username"] = parsed.username
    if parsed.password:
        opts["password"] = parsed.password
    return opts


def get_redis_opts() -> dict[str, Any]:
    return _parse_redis_opts()


async def _handle_process_media(job: Any, token: str | None = None) -> str:
    data = job.data
    task_id = data.get("taskId")
    media_item_id = data["mediaItemId"]
    start_stage = data.get("startStage", "full")

    logger.info(
        "job_started",
        job_id=job.id,
        job_name=job.name,
        media_item_id=media_item_id,
        task_id=task_id,
        start_stage=start_stage,
    )

    try:
        if task_id:
            claimed = await api.claim_task(media_item_id, task_id)
            if not claimed:
                logger.info("task_superseded", job_id=job.id, task_id=task_id, media_item_id=media_item_id)
                return "superseded"

        await process_media(
            media_item_id=media_item_id,
            original_key=data["originalKey"],
            mime_type=data["mimeType"],
            media_type=data["type"],
            start_stage=start_stage,
        )
    except Exception:
        logger.exception("job_failed", job_id=job.id, media_item_id=media_item_id, task_id=task_id)
        raise

    logger.info("job_completed", job_id=job.id)
    return "done"


async def _handle_maintenance(job: Any, token: str | None = None) -> str:
    logger.info("maintenance_job_started", job_id=job.id, job_name=job.name)

    if job.name == "recluster":
        stats = await run_recluster()
        logger.info("recluster_done", **stats)
        return "done"

    if job.name == "cleanup-sessions":
        deleted = await api.delete_expired_sessions()
        logger.info("sessions_cleaned", deleted=deleted)
        return "done"

    logger.warning("unknown_maintenance_job", job_name=job.name)
    return "skipped"


_workers: list[BullWorker] = []


async def start_consumers() -> None:
    redis_opts = _parse_redis_opts()

    media_worker = BullWorker(
        "process-media",
        _handle_process_media,
        {"connection": redis_opts, "concurrency": settings.media_concurrency},
    )
    _workers.append(media_worker)
    logger.info("media_consumer_started", queue="process-media")

    maintenance_worker = BullWorker(
        "maintenance",
        _handle_maintenance,
        {"connection": redis_opts, "concurrency": 1},
    )
    _workers.append(maintenance_worker)
    logger.info("maintenance_consumer_started", queue="maintenance")


async def stop_consumers() -> None:
    for w in _workers:
        await w.close()
    _workers.clear()
    logger.info("consumers_stopped")
