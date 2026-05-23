from __future__ import annotations

import httpx

from worker import backend_client as api
from worker.log import get_logger

logger = get_logger(__name__)


async def download_to_bytes(key: str) -> bytes:
    """Download a file from S3 via backend presigned URL."""
    data = await api._request("GET", f"/s3/download/{key}")
    url = data["url"]

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
        response = await client.get(url, follow_redirects=True)
        response.raise_for_status()
        content = response.content
        logger.info("s3_downloaded", key=key, size_bytes=len(content))
        return content


async def download_to_file(key: str, path: str) -> None:
    """Download a file from S3 via backend presigned URL and save to disk."""
    data = await api._request("GET", f"/s3/download/{key}")
    url = data["url"]

    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
        async with client.stream("GET", url, follow_redirects=True) as response:
            response.raise_for_status()
            with open(path, "wb") as f:
                async for chunk in response.aiter_bytes(chunk_size=65536):
                    f.write(chunk)


async def generate_key_and_upload(
    prefix: str, data: bytes, content_type: str
) -> str:
    """Generate a key and upload bytes to S3 via backend presigned URL."""
    p = prefix if prefix in ("crops", "thumbnails", "streaming", "web") else "thumbnails"
    result = await api._request("POST", "/s3/upload-url", json={
        "prefix": p,
        "contentType": content_type,
    })
    key = result["key"]
    url = result["url"]

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        response = await client.put(url, content=data, headers={"Content-Type": content_type})
        response.raise_for_status()

    logger.info("s3_uploaded", key=key, prefix=prefix, size_bytes=len(data), content_type=content_type)
    return key


async def upload_file_to_key(prefix: str, file_path: str, content_type: str) -> str:
    """Upload a file from disk to S3 via backend presigned URL."""
    p = prefix if prefix in ("crops", "thumbnails", "streaming", "web") else "thumbnails"
    result = await api._request("POST", "/s3/upload-url", json={
        "prefix": p,
        "contentType": content_type,
    })
    key = result["key"]
    url = result["url"]

    async with httpx.AsyncClient(timeout=httpx.Timeout(600.0)) as client:
        with open(file_path, "rb") as f:
            response = await client.put(url, content=f.read(), headers={"Content-Type": content_type})
            response.raise_for_status()

    logger.info("s3_file_uploaded", key=key, prefix=prefix, content_type=content_type)
    return key
