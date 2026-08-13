from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel

from worker import backend_client as api
from worker.auth import verify_service_secret
from worker.clip_encoder import encode_text
from worker.clip_encoder import is_loaded as clip_is_loaded
from worker.face_detect import is_loaded as face_is_loaded
from worker.log import get_logger
from worker.queue import enqueue_batch_retry, enqueue_retry

if TYPE_CHECKING:
    from worker.stages import Stage

logger = get_logger(__name__)

app = FastAPI(title="Photos Worker", docs_url=None, redoc_url=None)


# ─── Health ──────────────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict[str, str]:
    """Liveness only: the process is up and the event loop is turning."""
    return {"status": "ok"}


@app.get("/readyz")
async def readyz() -> dict[str, object]:
    """Readiness: models are resident, so the first real job will not stall.

    /health used to return 200 unconditionally, including during the several
    minutes of first-job model download and load — so an orchestrator would route
    work to an instance that could not yet process anything.
    """
    ready = clip_is_loaded() and face_is_loaded()
    return {"status": "ready" if ready else "loading", "modelsLoaded": ready}


# ─── CLIP Text Embedding ─────────────────────────────────────────────────────


class EmbedTextRequest(BaseModel):
    text: str


class EmbedTextResponse(BaseModel):
    embedding: list[float]


@app.post(
    "/embed/text",
    response_model=EmbedTextResponse,
    dependencies=[Depends(verify_service_secret)],
)
async def embed_text(req: EmbedTextRequest) -> EmbedTextResponse:
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text must not be empty")

    logger.info("embed_text_request", text_length=len(req.text))
    embedding = encode_text(req.text)
    return EmbedTextResponse(embedding=embedding.tolist())


# ─── Retry Routes ────────────────────────────────────────────────────────────


BatchFilter = Literal["all", "failed", "missing_clip", "missing_faces", "missing_blurhash"]


class BatchRetryRequest(BaseModel):
    stage: Stage = "full"
    filter: BatchFilter = "failed"


class BatchRetryResponse(BaseModel):
    enqueued: int
    stage: Stage
    filter: BatchFilter


# NB: registered BEFORE /retry/{media_id}. FastAPI matches in declaration order, so
# with the previous ordering every POST /retry/batch was dispatched to retry_single
# with media_id="batch" and answered "Media item not found" — the batch endpoint had
# never once been reachable.
@app.post(
    "/retry/batch",
    response_model=BatchRetryResponse,
    dependencies=[Depends(verify_service_secret)],
)
async def retry_batch(req: BatchRetryRequest) -> BatchRetryResponse:
    """Retry processing for multiple media items based on a filter."""
    rows = await api.query_media_items_for_retry(req.filter)

    if not rows:
        return BatchRetryResponse(enqueued=0, stage=req.stage, filter=req.filter)

    items = [
        {
            "id": r["id"],
            "original_key": r["originalKey"],
            "mime_type": r["mimeType"],
            "type": r["type"],
        }
        for r in rows
    ]

    count = await enqueue_batch_retry(items, req.stage)
    logger.info("batch_retry_enqueued", count=count, stage=req.stage, filter=req.filter)
    return BatchRetryResponse(enqueued=count, stage=req.stage, filter=req.filter)


class RetryRequest(BaseModel):
    stage: Stage = "full"


class RetryResponse(BaseModel):
    job_id: str
    media_item_id: str
    stage: Stage


@app.post(
    "/retry/{media_id}",
    response_model=RetryResponse,
    dependencies=[Depends(verify_service_secret)],
)
async def retry_single(media_id: str, req: RetryRequest) -> RetryResponse:
    """Retry processing for a single media item from a specific stage."""
    try:
        item = await api.get_media_item_info(media_id)
    except api.BackendError as e:
        if e.status_code == 404:
            raise HTTPException(status_code=404, detail="Media item not found") from e
        raise

    job_id = await enqueue_retry(
        media_item_id=item["id"],
        original_key=item["originalKey"],
        mime_type=item["mimeType"],
        media_type=item["type"],
        start_stage=req.stage,
    )
    return RetryResponse(job_id=job_id, media_item_id=media_id, stage=req.stage)
