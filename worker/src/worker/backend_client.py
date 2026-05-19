from __future__ import annotations

from typing import Any

import httpx

from worker.config import settings
from worker.log import get_logger

logger = get_logger(__name__)

_client: httpx.AsyncClient | None = None


def _get_headers() -> dict[str, str]:
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if settings.service_secret:
        headers["X-Service-Secret"] = settings.service_secret
    return headers


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


async def _request(method: str, path: str, **kwargs: Any) -> Any:
    """Make an HTTP request to the backend internal API."""
    client = await get_client()
    response = await client.request(method, path, **kwargs)

    if response.status_code >= 400:
        detail = response.text
        try:
            detail = response.json().get("error", detail)
        except Exception:
            pass
        raise BackendError(response.status_code, detail)

    if response.status_code == 204:
        return None

    return response.json()


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
    data = await _request("POST", f"/media/{media_item_id}/retry-task", json={"startStage": start_stage})
    return data["taskId"]


async def persist_content(
    media_item_id: str,
    *,
    width: int | None = None,
    height: int | None = None,
    duration_seconds: float | None = None,
    taken_at: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
    camera_make: str | None = None,
    camera_model: str | None = None,
    city: str | None = None,
    country: str | None = None,
    fts_document: str,
    thumbnail_key: str | None = None,
    clip_embedding: list[float] | None = None,
) -> None:
    await _request("PUT", f"/media/{media_item_id}/content", json={
        "width": width,
        "height": height,
        "durationSeconds": duration_seconds,
        "takenAt": taken_at,
        "latitude": latitude,
        "longitude": longitude,
        "cameraMake": camera_make,
        "cameraModel": camera_model,
        "city": city,
        "country": country,
        "ftsDocument": fts_document,
        "thumbnailKey": thumbnail_key,
        "clipEmbedding": clip_embedding,
    })


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


async def get_all_face_embeddings() -> list[dict[str, Any]]:
    """Returns list of {id, personId, embedding}."""
    data = await _request("GET", "/faces/embeddings")
    return data["faces"]


async def batch_reassign_faces(
    assignments: list[dict[str, str]],
) -> int:
    """Reassign faces in batches. assignments = [{faceId, personId}, ...]"""
    total = 0
    batch_size = 500
    for i in range(0, len(assignments), batch_size):
        batch = assignments[i:i + batch_size]
        data = await _request("POST", "/faces/batch-reassign", json={
            "assignments": batch,
        })
        total += data["reassigned"]
    return total


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


# ─── Sessions ────────────────────────────────────────────────


async def delete_expired_sessions() -> int:
    data = await _request("DELETE", "/sessions/expired")
    return data["deleted"]
