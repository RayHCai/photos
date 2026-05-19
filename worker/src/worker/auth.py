from __future__ import annotations

import hmac

from fastapi import Header, HTTPException

from worker.config import settings


async def verify_service_secret(
    x_service_secret: str | None = Header(default=None),
) -> None:
    """Validate the X-Service-Secret header against the configured secret.

    If no service_secret is configured, all requests are allowed (local dev).
    """
    if not settings.service_secret:
        return

    if not x_service_secret or not hmac.compare_digest(
        x_service_secret, settings.service_secret
    ):
        raise HTTPException(status_code=401, detail="Invalid or missing service secret")
