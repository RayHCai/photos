from __future__ import annotations

from typing import Literal

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel

from worker import backend_client as api
from worker.auth import verify_service_secret
from worker.clip_encoder import encode_text
from worker.log import get_logger
from worker.pipeline import Stage
from worker.queue import enqueue_batch_retry, enqueue_retry

logger = get_logger(__name__)

app = FastAPI(title="Photos Worker", docs_url=None, redoc_url=None)


# ─── Health ──────────────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


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
            raise HTTPException(status_code=404, detail="Media item not found")
        raise

    job_id = await enqueue_retry(
        media_item_id=item["id"],
        original_key=item["originalKey"],
        mime_type=item["mimeType"],
        media_type=item["type"],
        start_stage=req.stage,
    )
    return RetryResponse(job_id=job_id, media_item_id=media_id, stage=req.stage)


BatchFilter = Literal["all", "failed", "missing_clip", "missing_faces"]


class BatchRetryRequest(BaseModel):
    stage: Stage = "full"
    filter: BatchFilter = "failed"


class BatchRetryResponse(BaseModel):
    enqueued: int
    stage: Stage
    filter: BatchFilter


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
