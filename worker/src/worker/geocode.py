from __future__ import annotations

import asyncio
from typing import Any

import httpx

from worker import backend_client as api
from worker.log import get_logger

logger = get_logger(__name__)

_NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
_USER_AGENT = "photos-app/1.0"
_TIMEOUT = 10.0

# Simple cache keyed on rounded lat/lng (3 decimals ~ 111m)
_cache: dict[tuple[float, float], tuple[str | None, str | None]] = {}

# Track last request time to respect 1 req/sec rate limit
_last_request_time: float = 0.0


def _round_coords(lat: float, lng: float) -> tuple[float, float]:
    return (round(lat, 3), round(lng, 3))


async def reverse_geocode(lat: float, lng: float) -> tuple[str | None, str | None]:
    """Reverse geocode coordinates to (city, country) using Nominatim.

    Returns (None, None) on any failure.
    """
    global _last_request_time

    key = _round_coords(lat, lng)
    if key in _cache:
        return _cache[key]

    # Rate limit: 1 request per second
    now = asyncio.get_event_loop().time()
    elapsed = now - _last_request_time
    if elapsed < 1.0:
        await asyncio.sleep(1.0 - elapsed)

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                _NOMINATIM_URL,
                params={"lat": lat, "lon": lng, "format": "json", "zoom": 14},
                headers={"User-Agent": _USER_AGENT},
            )
            _last_request_time = asyncio.get_event_loop().time()
            resp.raise_for_status()
            data = resp.json()
    except Exception:
        logger.warning("reverse_geocode_failed", lat=lat, lng=lng)
        _cache[key] = (None, None)
        return (None, None)

    address: dict[str, Any] = data.get("address", {})
    city = (
        address.get("city")
        or address.get("town")
        or address.get("village")
        or address.get("hamlet")
        or address.get("municipality")
    )
    country = address.get("country")

    result = (city, country)
    _cache[key] = result
    logger.info("reverse_geocoded", lat=lat, lng=lng, city=city, country=country)
    return result


async def run_geocode_backfill() -> dict[str, int]:
    """Backfill city/country for all media items with GPS but no location name."""
    items = await api.query_media_for_geocoding()
    logger.info("geocode_backfill_start", total=len(items))

    geocoded = 0
    for item in items:
        media_id = item["id"]
        lat = item["latitude"]
        lng = item["longitude"]

        city, country = await reverse_geocode(lat, lng)
        if city or country:
            await api.persist_geocoding(media_id, city, country)
            geocoded += 1
            logger.info(
                "geocode_backfill_item",
                media_item_id=media_id,
                city=city,
                country=country,
            )

    logger.info("geocode_backfill_done", geocoded=geocoded, total=len(items))
    return {"geocoded": geocoded}
