from __future__ import annotations

import asyncio
import signal
from contextlib import asynccontextmanager
from typing import AsyncIterator

import uvicorn
from fastapi import FastAPI

from worker.api import app as api_app
from worker.backend_client import close_client, get_client
from worker.config import settings
from worker.consumer import start_consumers, stop_consumers
from worker.log import get_logger

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Startup
    logger.info("worker_starting", port=settings.worker_port)
    await get_client()
    await start_consumers()
    logger.info("worker_ready")

    yield

    # Shutdown
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
