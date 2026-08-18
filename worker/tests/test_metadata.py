"""Regression tests for EXIF capture-time extraction.

These cover the two defects that made every displayed capture time wrong for any
household outside UTC, and put a deterministic slice of each library on the wrong day:

  1. `getexif()` returns only base IFD0, so the loop over
     (DateTimeOriginal, DateTimeDigitized, DateTime) could never match its two
     preferred tags — they live in the Exif sub-IFD — and always fell through to
     DateTime, which is the *file* timestamp that any editor or export pipeline
     rewrites.

  2. `_parse_exif_datetime` attached `tzinfo=utc` to what is a local wall-clock
     reading, so a photo shot at 20:00 local was persisted as 20:00Z.

EXIF is built with Pillow's own Exif API rather than a third-party writer, so the
fixtures exercise exactly the reader the production code uses.
"""

from __future__ import annotations

import io
from datetime import UTC, datetime
from pathlib import Path

import pytest
from PIL import Image
from PIL.ExifTags import IFD

from worker.metadata import (
    _parse_exif_datetime,
    _parse_exif_offset,
    extract_photo_metadata,
    extract_raw_metadata,
)

# Tag ids, so intent is legible at the call site.
_DATETIME = 0x0132  # IFD0 — file modification timestamp
_DATETIME_ORIGINAL = 0x9003  # Exif sub-IFD — shutter press
_SUBSEC_TIME_ORIGINAL = 0x9291  # Exif sub-IFD
_OFFSET_TIME_ORIGINAL = 0x9011  # Exif sub-IFD


def _image_with_exif(
    *,
    ifd0: dict[int, object] | None = None,
    exif_ifd: dict[int, object] | None = None,
) -> Image.Image:
    """A tiny in-memory JPEG carrying the given IFD0 and Exif sub-IFD tags."""
    exif = Image.Exif()
    for tag, value in (ifd0 or {}).items():
        exif[tag] = value

    if exif_ifd:
        # Touching get_ifd(IFD.Exif) creates the sub-IFD; writing into the returned
        # mapping is what puts tags there rather than in IFD0.
        sub = exif.get_ifd(IFD.Exif)
        for tag, value in exif_ifd.items():
            sub[tag] = value

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (128, 128, 128)).save(buf, format="JPEG", exif=exif.tobytes())
    buf.seek(0)
    return Image.open(buf)


def test_prefers_datetime_original_from_exif_sub_ifd() -> None:
    """DateTimeOriginal must win over IFD0's DateTime.

    DateTimeOriginal lives in the Exif sub-IFD, which `getexif()` does not return —
    so this used to resolve to the *file* timestamp (2020) instead.
    """
    image = _image_with_exif(
        ifd0={_DATETIME: "2020:01:01 00:00:00"},
        exif_ifd={_DATETIME_ORIGINAL: "2024:06:15 20:30:45"},
    )

    meta = extract_photo_metadata(image)

    assert meta.taken_at_local == datetime(2024, 6, 15, 20, 30, 45)


def test_falls_back_to_ifd0_datetime_when_no_original() -> None:
    image = _image_with_exif(ifd0={_DATETIME: "2019:03:04 05:06:07"})

    meta = extract_photo_metadata(image)

    assert meta.taken_at_local == datetime(2019, 3, 4, 5, 6, 7)


def test_offset_converts_local_wall_clock_to_true_utc() -> None:
    image = _image_with_exif(
        exif_ifd={
            _DATETIME_ORIGINAL: "2024:06:15 20:00:00",
            _OFFSET_TIME_ORIGINAL: "+05:30",
        }
    )

    meta = extract_photo_metadata(image)

    # 20:00 at +05:30 is 14:30Z. The old code stored 20:00Z.
    assert meta.taken_at == datetime(2024, 6, 15, 14, 30, tzinfo=UTC)
    assert meta.taken_at_offset_min == 330
    # The wall clock is kept separately, because day bucketing must not depend on the
    # viewer's timezone.
    assert meta.taken_at_local == datetime(2024, 6, 15, 20, 0, 0)


def test_without_offset_local_and_utc_agree_numerically() -> None:
    """Offset unknown: ordering stays stable and no date is derived from taken_at."""
    image = _image_with_exif(exif_ifd={_DATETIME_ORIGINAL: "2024:06:15 20:00:00"})

    meta = extract_photo_metadata(image)

    assert meta.taken_at_offset_min is None
    assert meta.taken_at == datetime(2024, 6, 15, 20, 0, tzinfo=UTC)
    assert meta.taken_at_local == datetime(2024, 6, 15, 20, 0)


def test_subsecond_precision_is_applied() -> None:
    image = _image_with_exif(
        exif_ifd={
            _DATETIME_ORIGINAL: "2024:06:15 20:00:00",
            _SUBSEC_TIME_ORIGINAL: "250",
        }
    )

    meta = extract_photo_metadata(image)

    assert meta.taken_at_local is not None
    assert meta.taken_at_local.microsecond == 250_000


def test_parse_exif_datetime_is_naive() -> None:
    """The parser must not invent a timezone for a local wall-clock reading."""
    parsed = _parse_exif_datetime("2024:06:15 20:30:45")
    assert parsed == datetime(2024, 6, 15, 20, 30, 45)
    assert parsed is not None and parsed.tzinfo is None


def test_parse_exif_datetime_tolerates_null_padding() -> None:
    assert _parse_exif_datetime("2024:06:15 20:30:45\x00") == datetime(2024, 6, 15, 20, 30, 45)


def test_parse_exif_datetime_rejects_garbage() -> None:
    assert _parse_exif_datetime("not a date") is None
    assert _parse_exif_datetime("") is None


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("+05:30", 330),
        ("-08:00", -480),
        ("+0000", 0),
        ("+00:00", 0),
        ("-11:30", -690),
        # Malformed or out-of-range must be rejected rather than silently shifting a
        # timestamp by a nonsense amount.
        ("+99:00", None),
        ("+05:99", None),
        ("garbage", None),
        ("", None),
    ],
)
def test_parse_exif_offset(raw: str, expected: int | None) -> None:
    assert _parse_exif_offset(raw) == expected


def test_no_exif_yields_dimensions_only() -> None:
    buf = io.BytesIO()
    Image.new("RGB", (12, 7)).save(buf, format="PNG")
    buf.seek(0)

    meta = extract_photo_metadata(Image.open(buf))

    assert (meta.width, meta.height) == (12, 7)
    assert meta.taken_at is None
    assert meta.taken_at_local is None


def test_raw_reads_sub_ifds_after_the_file_is_closed(tmp_path: Path) -> None:
    """A raw original's Exif and GPS sub-IFDs must survive the file being closed.

    `Image.Exif` resolves sub-IFDs lazily by seeking the file object it was loaded
    from, so reading them after the `with open(...)` block raised
    "ValueError: seek of closed file" and failed the whole job for every DNG that
    carries an Exif sub-IFD — i.e. essentially all of them. (The sample.dng fixture
    has no sub-IFD, so nothing caught it.)
    """
    exif = Image.Exif()
    exif[0x010F] = "Acme"
    exif[0x0110] = "TestCam Raw"
    exif.get_ifd(IFD.Exif)[_DATETIME_ORIGINAL] = "2024:06:15 20:30:45"
    gps = exif.get_ifd(IFD.GPSInfo)
    gps[1], gps[2] = "N", (51.0, 30.0, 0.0)
    gps[3], gps[4] = "W", (0.0, 7.0, 0.0)

    # A DNG is TIFF-based, and `tobytes()` minus its "Exif\x00\x00" prefix is exactly
    # the TIFF header + IFD stream that `load_from_fp` walks in a real one.
    raw_path = tmp_path / "with_sub_ifd.dng"
    raw_path.write_bytes(exif.tobytes()[6:])

    meta = extract_raw_metadata(str(raw_path))

    assert meta.camera_model == "TestCam Raw"
    assert meta.taken_at_local == datetime(2024, 6, 15, 20, 30, 45)
    assert meta.latitude == pytest.approx(51.5, abs=1e-4)
    assert meta.longitude == pytest.approx(-7 / 60, abs=1e-4)
