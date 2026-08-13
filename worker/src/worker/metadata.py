from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from PIL.ExifTags import GPSTAGS, IFD, TAGS

from worker.log import get_logger

if TYPE_CHECKING:
    from PIL import Image

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
    #: True UTC instant of capture. Only meaningful when the source told us the
    #: offset (EXIF OffsetTimeOriginal, or a genuinely UTC container timestamp).
    taken_at: datetime | None = None
    #: The camera's local wall clock, with no zone attached. Day/month bucketing is
    #: derived from this so a photo does not migrate between days depending on the
    #: viewer's timezone.
    taken_at_local: datetime | None = None
    #: Offset in minutes east of UTC, when the source recorded one.
    taken_at_offset_min: int | None = None
    latitude: float | None = None
    longitude: float | None = None
    camera_make: str | None = None
    camera_model: str | None = None
    city: str | None = None
    country: str | None = None
    #: Display rotation in degrees for video (0/90/180/270).
    video_rotation: int | None = None


def _dms_to_decimal(dms: tuple[float, ...], ref: str) -> float:
    degrees, minutes, seconds = float(dms[0]), float(dms[1]), float(dms[2])
    decimal = degrees + minutes / 60 + seconds / 3600
    if ref in ("S", "W"):
        decimal = -decimal
    return decimal


def _parse_exif_datetime(value: str) -> datetime | None:
    """Parse an EXIF datetime into a *naive* datetime.

    Deliberately naive. The previous version attached `tzinfo=timezone.utc` to what
    is a local wall-clock reading, so a photo taken at 20:00 local was persisted as
    20:00Z — every displayed capture time was wrong by the local offset, and a
    deterministic slice of each library landed on the wrong day header.
    """
    cleaned = value.replace("\x00", "").strip()
    for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y:%m:%dT%H:%M:%S"):
        try:
            return datetime.strptime(cleaned, fmt)
        except ValueError:
            continue
    return None


def _parse_exif_offset(value: object) -> int | None:
    """Parse an EXIF OffsetTime value ("+05:30", "-08:00") into minutes east of UTC."""
    text = str(value).replace("\x00", "").strip()
    match = re.fullmatch(r"([+-])(\d{2}):?(\d{2})", text)
    if not match:
        return None
    sign = 1 if match.group(1) == "+" else -1
    hours, minutes = int(match.group(2)), int(match.group(3))
    if hours > 14 or minutes > 59:
        return None
    return sign * (hours * 60 + minutes)


def extract_photo_metadata(image: Image.Image) -> MediaMetadata:
    meta = MediaMetadata(width=image.width, height=image.height)

    exif_data = image.getexif()
    if not exif_data:
        return meta

    decoded: dict[str, object] = {}
    for tag_id, value in exif_data.items():
        tag_name = TAGS.get(tag_id, str(tag_id))
        decoded[tag_name] = value

    # `getexif()` returns only base IFD0. DateTimeOriginal (0x9003),
    # DateTimeDigitized (0x9004), SubSecTimeOriginal and OffsetTimeOriginal all
    # live in the Exif *sub-IFD*, so the loop below could never match its two
    # preferred tags and always fell through to DateTime (0x0132) — the file
    # modification timestamp, which any editor or export pipeline rewrites.
    #
    # (GPS was already read correctly via get_ifd(IFD.GPSInfo) just below; dates
    # simply never got the same treatment.)
    try:
        exif_ifd = exif_data.get_ifd(IFD.Exif)
    except (KeyError, AttributeError, OSError):
        exif_ifd = {}

    for tag_id, value in exif_ifd.items():
        tag_name = TAGS.get(tag_id, str(tag_id))
        # Sub-IFD wins: it holds the authoritative capture time.
        decoded[tag_name] = value

    # Camera info
    if "Make" in decoded:
        meta.camera_make = _clean_exif_string(decoded["Make"])
    if "Model" in decoded:
        meta.camera_model = _clean_exif_string(decoded["Model"])

    # Capture time. DateTimeOriginal is the shutter-press time; DateTime is only a
    # last resort because it is a file timestamp, not a capture timestamp.
    for field in ("DateTimeOriginal", "DateTimeDigitized", "DateTime"):
        raw = decoded.get(field)
        if not raw:
            continue
        parsed = _parse_exif_datetime(str(raw))
        if not parsed:
            continue

        # Sub-second precision, when the camera recorded it.
        #
        # Pillow names these tags "SubsecTimeOriginal"/"SubsecTime" (lowercase 's' in
        # "sec"), while the EXIF specification writes "SubSecTime". Both spellings are
        # accepted so the lookup does not depend on which convention a given Pillow
        # version or another writer used — getting this wrong silently drops the
        # fractional part rather than failing.
        subsec = (
            decoded.get("SubsecTimeOriginal")
            or decoded.get("SubSecTimeOriginal")
            or decoded.get("SubsecTime")
            or decoded.get("SubSecTime")
        )
        if subsec is not None:
            digits = str(subsec).strip()[:6]
            if digits.isdigit():
                parsed = parsed.replace(microsecond=int(digits.ljust(6, "0")))

        meta.taken_at_local = parsed

        offset_raw = (
            decoded.get("OffsetTimeOriginal")
            or decoded.get("OffsetTimeDigitized")
            or decoded.get("OffsetTime")
        )
        offset_min = _parse_exif_offset(offset_raw) if offset_raw is not None else None
        meta.taken_at_offset_min = offset_min

        if offset_min is not None:
            meta.taken_at = (parsed - timedelta(minutes=offset_min)).replace(
                tzinfo=UTC
            )
        else:
            # Offset unknown. Storing the wall clock as if it were UTC keeps
            # ordering stable and matches what taken_at_local says; consumers
            # bucket by taken_at_local, so no date is derived from this value.
            meta.taken_at = parsed.replace(tzinfo=UTC)
        break

    # GPS coordinates
    gps_info = exif_data.get_ifd(IFD.GPSInfo)
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
            if stream.get("codec_type") != "video":
                continue

            width = int(stream.get("width", 0)) or None
            height = int(stream.get("height", 0)) or None
            rotation = _stream_rotation(stream)
            meta.video_rotation = rotation

            # A portrait phone video is stored as landscape frames plus a 90°
            # display matrix. Reporting the raw frame dimensions gave every such
            # video a landscape tile in the grid and cropped it in the lightbox.
            if rotation in (90, 270) and width and height:
                width, height = height, width

            meta.width = width
            meta.height = height
            break

        # Duration from format
        fmt = probe.get("format", {})
        if "duration" in fmt:
            meta.duration_seconds = float(fmt["duration"])

        # Container creation_time is genuinely UTC (unlike EXIF, which is local
        # wall clock), so the local field is derived from it rather than the
        # reverse. Without this, a photo and a video taken a minute apart at the
        # same event could sort onto different days.
        tags = fmt.get("tags", {})
        creation_time = tags.get("creation_time")
        if creation_time:
            try:
                parsed = datetime.fromisoformat(str(creation_time).replace("Z", "+00:00"))
            except ValueError:
                parsed = None
            if parsed is not None:
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=UTC)
                meta.taken_at = parsed
                meta.taken_at_offset_min = 0
                meta.taken_at_local = parsed.astimezone(UTC).replace(tzinfo=None)

    except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError, ValueError) as exc:
        logger.warning("video_metadata_extraction_failed", error=str(exc))

    logger.info(
        "video_metadata_extracted",
        width=meta.width,
        height=meta.height,
        duration_seconds=meta.duration_seconds,
        rotation=meta.video_rotation,
        has_taken_at=meta.taken_at is not None,
    )
    return meta


def _stream_rotation(stream: dict[str, object]) -> int:
    """Display rotation in degrees, from either the side-data matrix or a tag."""
    # Narrowed explicitly: ffprobe output is untrusted JSON, so `side_data_list` may be
    # absent, null, or something other than a list.
    side_data = stream.get("side_data_list")
    if isinstance(side_data, list):
        for side in side_data:
            if isinstance(side, dict) and "rotation" in side:
                try:
                    # ffprobe reports the matrix rotation, which is the negation of the
                    # clockwise display rotation.
                    return int(-float(side["rotation"])) % 360
                except (TypeError, ValueError):
                    pass

    tags = stream.get("tags")
    if isinstance(tags, dict) and "rotate" in tags:
        try:
            return int(float(tags["rotate"])) % 360
        except (TypeError, ValueError):
            pass

    return 0
