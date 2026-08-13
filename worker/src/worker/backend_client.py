from __future__ import annotations

import asyncio
import random
import re
from typing import TYPE_CHECKING, Any

import httpx

from worker.config import settings
from worker.log import get_logger

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

logger = get_logger(__name__)

_client: httpx.AsyncClient | None = None


def _get_headers() -> dict[str, str]:
    # service_secret is required by config.Settings, so there is no
    # "secret missing -> send no header" path any more.
    return {
        "Content-Type": "application/json",
        "X-Service-Secret": settings.service_secret,
    }


async def get_client() -> httpx.AsyncClient:
    global _client  # noqa: PLW0603
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=settings.backend_url + "/internal",
            headers=_get_headers(),
            timeout=httpx.Timeout(30.0, connect=5.0),
        )
        logger.info("backend_client_created", base_url=settings.backend_url)
    return _client


async def close_client() -> None:
    global _client  # noqa: PLW0603
    if _client is not None:
        await _client.aclose()
        _client = None
        logger.info("backend_client_closed")


class BackendError(Exception):
    """Raised when backend returns a non-success status."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"Backend error {status_code}: {detail}")


_MAX_ATTEMPTS = 4
_RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
_AMZ_PARAM = re.compile(r"([?&])(X-Amz-[^=]+)=[^&\s]*")


def redact_presigned(text: str) -> str:
    """Strip AWS signature parameters from a string before it is logged or stored.

    httpx embeds the full request URL in HTTPStatusError messages, and those
    messages were written verbatim into media_items.processing_error — which is
    returned to clients — so presigned URLs including X-Amz-Signature were being
    durably persisted.
    """
    return _AMZ_PARAM.sub(r"\1\2=REDACTED", text)


def _error_detail(response: httpx.Response) -> str:
    detail = response.text
    try:
        body = response.json()
        detail = body.get("error", detail)
        if "details" in body:
            detail = f"{detail}: {body['details']}"
    except Exception:
        pass
    return redact_presigned(str(detail))[:2000]


async def request(
    method: str,
    path: str,
    *,
    request_id: str | None = None,
    **kwargs: Any,
) -> Any:
    """Call the backend internal API, retrying transient failures.

    The previous implementation issued exactly one request with no retry and no
    backoff, treating every >=400 as fatal. Since one media item makes 5-40 of
    these calls, a single connection reset anywhere in the sequence failed the
    whole job — and BullMQ then re-ran it from scratch, re-downloading and
    re-encoding everything.

    4xx responses (other than 429) are not retried: they are deterministic and
    retrying only delays the real error.
    """
    client = await get_client()
    headers = {"X-Request-Id": request_id} if request_id else None

    last_error: Exception | None = None

    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            response = await client.request(method, path, headers=headers, **kwargs)
        except (httpx.TransportError, httpx.TimeoutException) as exc:
            last_error = exc
            if attempt == _MAX_ATTEMPTS:
                break
            await _sleep_backoff(attempt, method, path, reason=type(exc).__name__)
            continue

        if response.status_code in _RETRY_STATUSES and attempt < _MAX_ATTEMPTS:
            await _sleep_backoff(attempt, method, path, reason=str(response.status_code))
            continue

        if response.status_code >= 400:
            raise BackendError(response.status_code, _error_detail(response))

        if response.status_code == 204:
            return None

        return response.json()

    raise BackendError(0, f"Backend unreachable after {_MAX_ATTEMPTS} attempts: {last_error}")


async def _sleep_backoff(attempt: int, method: str, path: str, reason: str) -> None:
    # Exponential with jitter, so N workers retrying after an outage do not
    # synchronise into a thundering herd.
    delay = min(2 ** (attempt - 1), 8) * (0.5 + random.random())
    logger.warning(
        "backend_request_retry",
        method=method,
        path=path,
        attempt=attempt,
        reason=reason,
        delay_seconds=round(delay, 2),
    )
    await asyncio.sleep(delay)


# Retained for internal callers that predate the rename.
_request = request


# ─── Media Items ─────────────────────────────────────────────


async def get_file_name(media_item_id: str) -> str:
    data = await _request("GET", f"/media/{media_item_id}/file-name")
    return data["fileName"]


async def set_processing_status(
    media_item_id: str,
    status: str,
    error: str | None = None,
) -> None:
    await _request("PATCH", f"/media/{media_item_id}/status", json={
        "status": status,
        "error": error,
    })


async def claim_task(media_item_id: str, task_id: str) -> bool:
    data = await _request("POST", f"/media/{media_item_id}/claim-task", json={"taskId": task_id})
    return data["claimed"]


async def create_retry_task(media_item_id: str, start_stage: str = "full") -> str:
    data = await _request(
        "POST",
        f"/media/{media_item_id}/retry-task",
        json={"startStage": start_stage},
    )
    return data["taskId"]


async def persist_content(
    media_item_id: str,
    *,
    width: int | None = None,
    height: int | None = None,
    duration_seconds: float | None = None,
    taken_at: str | None = None,
    taken_at_local: str | None = None,
    taken_at_offset_min: int | None = None,
    video_rotation: int | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
    camera_make: str | None = None,
    camera_model: str | None = None,
    city: str | None = None,
    country: str | None = None,
    fts_document: str,
    thumbnail_key: str | None = None,
    clip_embedding: list[float] | None = None,
    blur_hash: str | None = None,
    web_key: str | None = None,
) -> None:
    await request("PUT", f"/media/{media_item_id}/content", json={
        "width": width,
        "height": height,
        "durationSeconds": duration_seconds,
        "takenAt": taken_at,
        "takenAtLocal": taken_at_local,
        "takenAtOffsetMin": taken_at_offset_min,
        "videoRotation": video_rotation,
        "latitude": latitude,
        "longitude": longitude,
        "cameraMake": camera_make,
        "cameraModel": camera_model,
        "city": city,
        "country": country,
        "ftsDocument": fts_document,
        "thumbnailKey": thumbnail_key,
        "clipEmbedding": clip_embedding,
        "blurHash": blur_hash,
        "webKey": web_key,
    })


async def persist_blurhash_only(media_item_id: str, blur_hash: str) -> None:
    await _request("PUT", f"/media/{media_item_id}/blur-hash", json={
        "blurHash": blur_hash,
    })


async def persist_streaming_key(media_item_id: str, streaming_key: str) -> None:
    await _request("PUT", f"/media/{media_item_id}/streaming-key", json={
        "streamingKey": streaming_key,
    })


async def persist_web_key(media_item_id: str, web_key: str) -> None:
    await _request("PUT", f"/media/{media_item_id}/web-key", json={
        "webKey": web_key,
    })


async def get_thumbnail_key(media_item_id: str) -> str | None:
    data = await _request("GET", f"/media/{media_item_id}/thumbnail-key")
    return data["thumbnailKey"]


async def persist_clip_only(media_item_id: str, embedding: list[float]) -> None:
    await _request("PUT", f"/media/{media_item_id}/clip-embedding", json={
        "embedding": embedding,
    })


# ─── Faces ───────────────────────────────────────────────────


async def clear_faces(media_item_id: str) -> int:
    data = await _request("DELETE", f"/media/{media_item_id}/faces")
    return data["deleted"]


async def find_nearest_existing(
    media_item_id: str,
    embedding: list[float],
    threshold: float = 0.3,
) -> str | None:
    data = await _request("POST", f"/media/{media_item_id}/faces/nearest", json={
        "embedding": embedding,
        "threshold": threshold,
    })
    return data["faceId"]


async def find_nearest_person(
    embedding: list[float],
    threshold: float,
) -> str | None:
    data = await _request("POST", "/faces/nearest-person", json={
        "embedding": embedding,
        "threshold": threshold,
    })
    return data["personId"]


async def insert_face(
    *,
    media_item_id: str,
    person_id: str,
    box_x: float,
    box_y: float,
    box_width: float,
    box_height: float,
    confidence: float,
    crop_key: str | None,
    embedding: list[float],
) -> str:
    data = await _request("POST", "/faces", json={
        "mediaItemId": media_item_id,
        "personId": person_id,
        "boxX": box_x,
        "boxY": box_y,
        "boxWidth": box_width,
        "boxHeight": box_height,
        "confidence": confidence,
        "cropKey": crop_key,
        "embedding": embedding,
    })
    return data["id"]


async def iter_face_embeddings() -> AsyncIterator[list[dict[str, Any]]]:
    """Yield pages of {id, personId, embedding, manuallyAssigned}.

    Paginated because the endpoint used to return every 512-dim vector in one
    response: past roughly 100k faces that exceeded V8's max string length and
    took the API process down, and the 30s client timeout killed it well before.
    """
    cursor: str | None = None
    while True:
        params = {"cursor": cursor} if cursor else None
        data = await request("GET", "/faces/embeddings", params=params)
        faces: list[dict[str, Any]] = data["faces"]
        if faces:
            yield faces
        cursor = data.get("nextCursor")
        if not cursor:
            return


async def batch_reassign_faces(
    assignments: list[dict[str, str]],
) -> int:
    """Reassign faces in batches. assignments = [{faceId, personId}, ...]

    The backend independently refuses to move any face flagged manuallyAssigned,
    so a bug here cannot destroy a human's labelling.
    """
    total = 0
    batch_size = 500
    for i in range(0, len(assignments), batch_size):
        batch = assignments[i:i + batch_size]
        data = await request("POST", "/faces/batch-reassign", json={
            "assignments": batch,
        })
        total += data["reassigned"]
    return total


async def mark_faces_scanned(media_item_id: str) -> None:
    """Record that detection ran, so items with genuinely no faces are not retried."""
    await request("POST", f"/media/{media_item_id}/faces-scanned")


async def presign_upload_for_key(key: str, content_type: str) -> str:
    """Presign an upload at a key derived from one the backend already issued."""
    data = await request(
        "POST",
        "/s3/upload-url-for-key",
        json={"key": key, "contentType": content_type},
    )
    url: str = data["url"]
    return url


async def list_named_persons() -> list[dict[str, Any]]:
    """Persons carrying a user-entered name, for recluster's name-preservation."""
    data = await request("GET", "/persons/named")
    return list(data["persons"])


# ─── Persons ─────────────────────────────────────────────────


async def create_person() -> str:
    data = await _request("POST", "/persons")
    return data["id"]


async def batch_create_persons(count: int) -> list[str]:
    data = await _request("POST", "/persons/batch", json={"count": count})
    return data["ids"]


async def delete_orphan_persons() -> int:
    data = await _request("DELETE", "/persons/orphans")
    return data["deleted"]


# ─── Media Queries ────────────────────────────────────────────


async def get_media_item_info(media_item_id: str) -> dict[str, str]:
    """Returns {id, originalKey, mimeType, type}."""
    return await _request("GET", f"/media/{media_item_id}/info")


async def query_media_items_for_retry(filter_type: str) -> list[dict[str, str]]:
    """Returns list of {id, originalKey, mimeType, type}."""
    data = await _request("POST", "/media/query-for-retry", json={
        "filter": filter_type,
    })
    return data["items"]


# ─── Geocoding ───────────────────────────────────────────────


async def query_media_for_geocoding() -> list[dict[str, Any]]:
    """Returns list of {id, latitude, longitude} for items needing geocoding."""
    data = await _request("GET", "/media/needs-geocoding")
    return data["items"]


async def persist_geocoding(
    media_item_id: str,
    city: str | None,
    country: str | None,
) -> None:
    await _request("PUT", f"/media/{media_item_id}/geocoding", json={
        "city": city,
        "country": country,
    })


# ─── Sessions ────────────────────────────────────────────────


async def delete_expired_sessions() -> int:
    data = await _request("DELETE", "/sessions/expired")
    return data["deleted"]
