from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone

from PIL import Image
from PIL.ExifTags import GPS, GPSTAGS, TAGS

from worker.log import get_logger

logger = get_logger(__name__)


def _clean_exif_string(value: object) -> str | None:
    """Strip null bytes and whitespace from EXIF string values."""
    s = str(value).replace("\x00", "").strip()
    return s or None


def _finite_or_none(value: float | None) -> float | None:
    """Return None if value is NaN or Infinity."""
    if value is None:
        return None
    from math import isfinite
    return value if isfinite(value) else None


@dataclass
class MediaMetadata:
    width: int | None = None
    height: int | None = None
    duration_seconds: float | None = None
    taken_at: datetime | None = None
    latitude: float | None = None
    longitude: float | None = None
    camera_make: str | None = None
    camera_model: str | None = None
    city: str | None = None
    country: str | None = None


def _dms_to_decimal(dms: tuple[float, ...], ref: str) -> float:
    degrees, minutes, seconds = dms[0], dms[1], dms[2]
    decimal = degrees + minutes / 60 + seconds / 3600
    if ref in ("S", "W"):
        decimal = -decimal
    return decimal


def _parse_exif_datetime(value: str) -> datetime | None:
    for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y:%m:%dT%H:%M:%S"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def extract_photo_metadata(image: Image.Image) -> MediaMetadata:
    meta = MediaMetadata(width=image.width, height=image.height)

    exif_data = image.getexif()
    if not exif_data:
        return meta

    decoded: dict[str, object] = {}
    for tag_id, value in exif_data.items():
        tag_name = TAGS.get(tag_id, str(tag_id))
        decoded[tag_name] = value

    # Camera info
    if "Make" in decoded:
        meta.camera_make = _clean_exif_string(decoded["Make"])
    if "Model" in decoded:
        meta.camera_model = _clean_exif_string(decoded["Model"])

    # Date taken
    for field in ("DateTimeOriginal", "DateTimeDigitized", "DateTime"):
        if field in decoded and decoded[field]:
            parsed = _parse_exif_datetime(str(decoded[field]).replace("\x00", ""))
            if parsed:
                meta.taken_at = parsed
                break

    # GPS coordinates
    gps_info = exif_data.get_ifd(GPS)
    if gps_info:
        gps_decoded: dict[str, object] = {}
        for tag_id, value in gps_info.items():
            tag_name = GPSTAGS.get(tag_id, str(tag_id))
            gps_decoded[tag_name] = value

        lat_dms = gps_decoded.get("GPSLatitude")
        lat_ref = gps_decoded.get("GPSLatitudeRef")
        lon_dms = gps_decoded.get("GPSLongitude")
        lon_ref = gps_decoded.get("GPSLongitudeRef")

        if lat_dms and lat_ref and lon_dms and lon_ref:
            try:
                lat = _dms_to_decimal(lat_dms, str(lat_ref))  # type: ignore[arg-type]
                lon = _dms_to_decimal(lon_dms, str(lon_ref))  # type: ignore[arg-type]
                meta.latitude = _finite_or_none(lat)
                meta.longitude = _finite_or_none(lon)
            except (TypeError, IndexError, ValueError, ZeroDivisionError):
                logger.warning("failed_to_parse_gps")

    logger.info(
        "photo_metadata_extracted",
        width=meta.width,
        height=meta.height,
        has_taken_at=meta.taken_at is not None,
        has_gps=meta.latitude is not None,
        camera_make=meta.camera_make,
        camera_model=meta.camera_model,
    )
    return meta


def extract_video_metadata(file_path: str) -> MediaMetadata:
    meta = MediaMetadata()

    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v", "quiet",
                "-print_format", "json",
                "-show_format",
                "-show_streams",
                file_path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )

        if result.returncode != 0:
            logger.warning("ffprobe_failed", stderr=result.stderr[:200])
            return meta

        probe = json.loads(result.stdout)

        # Find video stream
        for stream in probe.get("streams", []):
            if stream.get("codec_type") == "video":
                meta.width = int(stream.get("width", 0)) or None
                meta.height = int(stream.get("height", 0)) or None
                break

        # Duration from format
        fmt = probe.get("format", {})
        if "duration" in fmt:
            meta.duration_seconds = float(fmt["duration"])

        # Tags (creation_time, etc.)
        tags = fmt.get("tags", {})
        creation_time = tags.get("creation_time")
        if creation_time:
            try:
                meta.taken_at = datetime.fromisoformat(
                    creation_time.replace("Z", "+00:00")
                )
            except ValueError:
                pass

    except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError) as exc:
        logger.warning("video_metadata_extraction_failed", error=str(exc))

    logger.info(
        "video_metadata_extracted",
        width=meta.width,
        height=meta.height,
        duration_seconds=meta.duration_seconds,
        has_taken_at=meta.taken_at is not None,
    )
    return meta
