from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

import uvicorn

from worker.api import app as api_app
from worker.backend_client import close_client, get_client
from worker.clip_encoder import warm_up as clip_warm_up
from worker.config import settings
from worker.consumer import start_consumers, stop_consumers
from worker.face_detect import warm_up as face_warm_up
from worker.log import get_logger

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from fastapi import FastAPI

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Log the resolved settings, minus the secret. Config drift between
    # .env.example and the code defaults used to be completely invisible.
    logger.info(
        "worker_starting",
        port=settings.worker_port,
        clip_model=settings.clip_model,
        media_concurrency=settings.media_concurrency,
        max_image_pixels=settings.max_image_pixels,
        face_det_thresh=settings.face_det_thresh,
        face_confidence_thresh=settings.face_confidence_thresh,
        face_new_person_thresh=settings.face_new_person_thresh,
        face_match_thresh=settings.face_match_thresh,
        face_min_size=settings.face_min_size,
        geocoding_enabled=settings.geocoding_enabled,
    )
    await get_client()

    # Load the ML models before accepting queue work. They were previously loaded
    # lazily on the first job, synchronously on the event loop, so the first upload
    # after every restart stalled for minutes while /health happily reported 200.
    logger.info("warming_up_models")
    await asyncio.gather(
        asyncio.to_thread(clip_warm_up),
        asyncio.to_thread(face_warm_up),
    )
    logger.info("models_warm")

    await start_consumers()
    logger.info("worker_ready")

    yield

    logger.info("worker_shutting_down")
    await stop_consumers()
    await close_client()
    logger.info("worker_stopped")


api_app.router.lifespan_context = lifespan


def run() -> None:
    uvicorn.run(
        "worker.api:app",
        host="0.0.0.0",
        port=settings.worker_port,
        log_level=settings.log_level,
    )


if __name__ == "__main__":
    run()
