from __future__ import annotations

import asyncio
from typing import Any

import httpx

from worker import backend_client as api
from worker.config import settings
from worker.log import get_logger

logger = get_logger(__name__)

_TIMEOUT = 10.0
_MIN_REQUEST_INTERVAL = 1.0

# Successful lookups are effectively permanent; failures must not be, or one
# outage poisons every coordinate for the process lifetime.
_SUCCESS_TTL = 30 * 24 * 3600.0
_FAILURE_TTL = 300.0
_CACHE_MAX_ENTRIES = 50_000

# (city, country, cached_at, ttl)
_cache: dict[tuple[float, float], tuple[str | None, str | None, float, float]] = {}

# Serialises outbound requests. The previous implementation compared and then
# updated a bare module global with an await in between, so with
# media_concurrency > 1 several coroutines read the same timestamp, slept the same
# amount and fired simultaneously — violating the 1 req/s policy the code was
# trying to honour and risking an IP block.
_request_lock = asyncio.Lock()
_last_request_time = 0.0


def _round_coords(lat: float, lng: float) -> tuple[float, float]:
    return (round(lat, 3), round(lng, 3))


def _cache_get(key: tuple[float, float]) -> tuple[str | None, str | None] | None:
    entry = _cache.get(key)
    if entry is None:
        return None
    city, country, cached_at, ttl = entry
    if asyncio.get_running_loop().time() - cached_at > ttl:
        del _cache[key]
        return None
    return (city, country)


def _cache_put(
    key: tuple[float, float], city: str | None, country: str | None, ttl: float
) -> None:
    if len(_cache) >= _CACHE_MAX_ENTRIES:
        # Cheap bound: dicts preserve insertion order, so this drops the oldest
        # inserted entry. FIFO rather than LRU, which is fine for coordinates.
        _cache.pop(next(iter(_cache)))
    _cache[key] = (city, country, asyncio.get_running_loop().time(), ttl)


async def reverse_geocode(lat: float, lng: float) -> tuple[str | None, str | None]:
    """Reverse geocode coordinates to (city, country).

    Disabled unless settings.geocoding_enabled. This egresses photo GPS — rounded
    to ~111m, i.e. house level — to a third-party service, which for a self-hosted
    private photo library should be a deliberate choice rather than a silent
    default. Point settings.geocode_provider_url at a self-hosted Nominatim to keep
    the data in-house.

    Returns (None, None) on any failure.
    """
    if not settings.geocoding_enabled:
        return (None, None)

    key = _round_coords(lat, lng)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    try:
        data = await _fetch(lat, lng)
    except Exception as exc:
        # Short TTL: a provider outage must not permanently blank out locations.
        logger.warning("reverse_geocode_failed", error=type(exc).__name__)
        _cache_put(key, None, None, _FAILURE_TTL)
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

    _cache_put(key, city, country, _SUCCESS_TTL)
    # Coordinates are deliberately not logged: they are the sensitive part.
    logger.info("reverse_geocoded", city=city, country=country)
    return (city, country)


async def _fetch(lat: float, lng: float) -> dict[str, Any]:
    """One rate-limited provider request."""
    global _last_request_time  # noqa: PLW0603

    async with _request_lock:
        loop = asyncio.get_running_loop()
        elapsed = loop.time() - _last_request_time
        if elapsed < _MIN_REQUEST_INTERVAL:
            await asyncio.sleep(_MIN_REQUEST_INTERVAL - elapsed)

        # Reserved *before* the request, so a slow or failing call cannot let the
        # next one fire immediately. Previously this was assigned only after a
        # successful response, so a timeout left a stale timestamp and the next
        # call hammered the provider with no backoff at all.
        _last_request_time = loop.time()

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.get(
                settings.geocode_provider_url,
                params={"lat": lat, "lon": lng, "format": "json", "zoom": 14},
                headers={"User-Agent": settings.geocode_user_agent},
            )
            response.raise_for_status()
            result: dict[str, Any] = response.json()
            return result


async def run_geocode_backfill() -> dict[str, int]:
    """Backfill city/country for media items with GPS but no location name."""
    if not settings.geocoding_enabled:
        logger.info("geocode_backfill_skipped", reason="geocoding_disabled")
        return {"geocoded": 0, "total": 0}

    items = await api.query_media_for_geocoding()
    logger.info("geocode_backfill_start", total=len(items))

    geocoded = 0
    consecutive_failures = 0

    for item in items:
        city, country = await reverse_geocode(item["latitude"], item["longitude"])

        if city or country:
            await api.persist_geocoding(item["id"], city, country)
            geocoded += 1
            consecutive_failures = 0
        else:
            consecutive_failures += 1
            # Give up rather than walking the whole library at 1 req/s against a
            # provider that is clearly refusing us.
            if consecutive_failures >= 10:
                logger.warning(
                    "geocode_backfill_aborted",
                    reason="consecutive_failures",
                    geocoded=geocoded,
                )
                break

    logger.info("geocode_backfill_done", geocoded=geocoded, total=len(items))
    return {"geocoded": geocoded, "total": len(items)}
