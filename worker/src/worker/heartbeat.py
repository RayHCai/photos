from __future__ import annotations

import asyncio
import os
import socket
from datetime import UTC, datetime

from worker.backend_client import send_heartbeat
from worker.config import settings
from worker.log import get_logger

logger = get_logger(__name__)

_WORKER_ID = f"{socket.gethostname()}:{os.getpid()}"
_task: asyncio.Task[None] | None = None


async def _loop() -> None:
    # Runs on its own timer rather than from the job loop, so a long transcode
    # does not make a busy worker look dead. The backend marks the worker
    # offline after three missed beats.
    started_at = datetime.now(UTC).isoformat()
    while True:
        try:
            await send_heartbeat(_WORKER_ID, started_at)
        except Exception as exc:  # noqa: BLE001 - a failed beat must never kill the loop
            logger.warning("heartbeat_failed", error=str(exc))
        await asyncio.sleep(settings.heartbeat_interval_seconds)


def start_heartbeat() -> None:
    global _task  # noqa: PLW0603
    if _task is None:
        _task = asyncio.create_task(_loop())
        logger.info("heartbeat_started", worker_id=_WORKER_ID)


async def stop_heartbeat() -> None:
    global _task  # noqa: PLW0603
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None
