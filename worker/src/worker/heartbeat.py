from __future__ import annotations

import asyncio
import os
import socket
from datetime import UTC, datetime

import redis.asyncio as redis

from worker.backend_client import send_heartbeat
from worker.config import settings
from worker.consumer import get_redis_opts
from worker.log import get_logger

logger = get_logger(__name__)

_WORKER_ID = f"{socket.gethostname()}:{os.getpid()}"
_task: asyncio.Task[None] | None = None
_probe: redis.Redis | None = None

# Redis must answer a PING within this long or we treat the worker as unable to
# reach the queue. Kept well under heartbeat_interval so one probe can never
# delay the following beat.
_PROBE_TIMEOUT_SECONDS = 5.0


def _get_probe() -> redis.Redis:
    # A dedicated, short-timeout connection used only to answer "can this host
    # reach Redis right now?". Deliberately separate from the BullMQ consumer
    # connections (so nothing can block on a shared in-flight command) and
    # short-timeout (so a dead network path fails fast instead of stalling the
    # beat).
    global _probe  # noqa: PLW0603
    if _probe is None:
        opts = get_redis_opts()
        opts["socket_timeout"] = _PROBE_TIMEOUT_SECONDS
        opts["socket_connect_timeout"] = _PROBE_TIMEOUT_SECONDS
        _probe = redis.Redis(**opts)
    return _probe


async def _redis_reachable() -> bool:
    try:
        await asyncio.wait_for(_get_probe().ping(), timeout=_PROBE_TIMEOUT_SECONDS)
    except Exception as exc:  # noqa: BLE001 - any failure means "not reachable"
        logger.warning("heartbeat_redis_unreachable", error=str(exc))
        return False
    return True


async def _loop() -> None:
    # Runs on its own timer rather than from the job loop, so a long transcode
    # does not make a busy worker look dead. The backend marks the worker
    # offline after three missed beats.
    #
    # The beat is gated on Redis reachability. The recurring failure mode is a
    # network change leaving the BullMQ consumer wedged on a half-open socket
    # while the process stays alive, so a beat that only proves "the process is
    # running" reported the worker online with a dead queue. Skipping the beat
    # while Redis is unreachable turns those into missed beats, so the status
    # flips to offline instead of lying green.
    started_at = datetime.now(UTC).isoformat()
    while True:
        try:
            if await _redis_reachable():
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
    global _task, _probe  # noqa: PLW0603
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None
    if _probe is not None:
        await _probe.aclose()
        _probe = None
