from __future__ import annotations

import os
from typing import TYPE_CHECKING, Literal

import httpx

from worker import backend_client as api
from worker.log import get_logger

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

logger = get_logger(__name__)

StoragePrefix = Literal["thumbnails", "web", "streaming", "crops"]

_DOWNLOAD_TIMEOUT = httpx.Timeout(300.0, connect=10.0)
_UPLOAD_TIMEOUT = httpx.Timeout(600.0, connect=10.0)
_CHUNK_SIZE = 1024 * 1024


async def _presign_upload(prefix: StoragePrefix, content_type: str) -> tuple[str, str]:
    """Ask the backend for an upload URL. Returns (key, url).

    The prefix is passed through unchanged rather than silently coerced. The old
    code did `prefix if prefix in (...) else "thumbnails"`, so a typo'd prefix
    quietly mis-filed the object under thumbnails/ instead of failing — and since
    thumbnails/ is publicly readable through the CDN, that could have made a
    private variant world-readable.
    """
    result = await api.request(
        "POST",
        "/s3/upload-url",
        json={"prefix": prefix, "contentType": content_type},
    )
    return result["key"], result["url"]


async def _presign_download(key: str) -> str:
    data = await api.request("GET", f"/s3/download/{key}")
    url: str = data["url"]
    return url


async def download_to_bytes(key: str) -> bytes:
    """Download an object into memory.

    Only for objects known to be small (face crops, thumbnails). Use
    download_to_file for originals: a 4K video or 120 MP panorama read whole into
    memory, alongside the decoded image and its copies, is what OOM-killed the
    container.
    """
    url = await _presign_download(key)

    async with httpx.AsyncClient(timeout=_DOWNLOAD_TIMEOUT) as client:
        response = await client.get(url, follow_redirects=True)
        response.raise_for_status()
        content = response.content
        logger.info("s3_downloaded", key=key, size_bytes=len(content))
        return content


async def download_to_file(key: str, path: str) -> None:
    """Stream an object to disk."""
    url = await _presign_download(key)

    async with (
        httpx.AsyncClient(timeout=_DOWNLOAD_TIMEOUT) as client,
        client.stream("GET", url, follow_redirects=True) as response,
    ):
        response.raise_for_status()
        with open(path, "wb") as f:
            async for chunk in response.aiter_bytes(chunk_size=_CHUNK_SIZE):
                f.write(chunk)

    logger.info("s3_downloaded_to_file", key=key, path=path)


async def _put(
    url: str,
    content: bytes | AsyncIterator[bytes],
    content_type: str,
    content_length: int | None = None,
) -> None:
    headers = {"Content-Type": content_type}
    # For a streamed (async-iterator) body httpx otherwise falls back to
    # `Transfer-Encoding: chunked`, which S3's REST PUT rejects with 501 Not
    # Implemented. Supplying Content-Length makes httpx send a fixed-length body
    # while still streaming it from disk. `bytes` bodies get Content-Length from
    # httpx automatically, so callers only pass it for the streaming path.
    if content_length is not None:
        headers["Content-Length"] = str(content_length)
    async with httpx.AsyncClient(timeout=_UPLOAD_TIMEOUT) as client:
        response = await client.put(url, content=content, headers=headers)
        response.raise_for_status()


async def generate_key_and_upload(
    prefix: StoragePrefix, data: bytes, content_type: str
) -> str:
    """Upload in-memory bytes under a freshly generated key."""
    key, url = await _presign_upload(prefix, content_type)
    await _put(url, data, content_type)

    logger.info(
        "s3_uploaded", key=key, prefix=prefix, size_bytes=len(data), content_type=content_type
    )
    return key


async def upload_bytes_to_derived_key(base_key: str, suffix: str, data: bytes,
                                      content_type: str) -> str:
    """Upload bytes at a key derived from an existing one.

    Used for the responsive thumbnail ladder: `thumbnails/…/<uuid>.webp` gains
    siblings `…/<uuid>@200w.webp`. Deriving rather than generating a fresh UUID per
    width means the client can construct the whole srcset from the single stored
    thumbnailKey, with no extra columns and no extra round trips.
    """
    dot = base_key.rfind(".")
    if dot == -1:
        raise ValueError(f"base key has no extension: {base_key!r}")

    derived = f"{base_key[:dot]}{suffix}{base_key[dot:]}"
    url = await api.presign_upload_for_key(derived, content_type)
    await _put(url, data, content_type)
    logger.info("s3_derived_uploaded", key=derived, size_bytes=len(data))
    return derived


async def upload_file_to_key(
    prefix: StoragePrefix, file_path: str, content_type: str
) -> str:
    """Stream a file from disk to S3 under a freshly generated key.

    The body is streamed rather than `f.read()`-ed into memory: a transcoded 4K
    video is routinely over a gigabyte, and the previous version materialised the
    whole thing as one bytes object before sending it.
    """
    key, url = await _presign_upload(prefix, content_type)
    content_length = os.path.getsize(file_path)

    async def body() -> AsyncIterator[bytes]:
        with open(file_path, "rb") as f:
            while True:
                chunk = f.read(_CHUNK_SIZE)
                if not chunk:
                    return
                yield chunk

    await _put(url, body(), content_type, content_length=content_length)

    logger.info("s3_file_uploaded", key=key, prefix=prefix, content_type=content_type)
    return key
