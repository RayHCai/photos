"""DNG (raw photo) intake.

Pillow raises `UnidentifiedImageError` on a raw Bayer mosaic, so a DNG upload used to
be undecodable by the photo pipeline (and was not on the upload allowlist at all).
These pin the two things that make a DNG behave like any other photo:

  1. `is_raw_photo` routes only raw extensions to the rawpy path.
  2. `decode_raw` returns an upright RGB image the rest of the pipeline can consume.
  3. Capture time / camera come from the file's TIFF/EXIF via the *same* reader logic
     as JPEG/HEIC, with the shutter-press `DateTimeOriginal` winning over the IFD0
     file-modification `DateTime`.

The fixture is a tiny synthetic RGGB frame (see tests/fixtures/sample.dng); rawpy is
skipped gracefully where it is not installed, matching the suite's other optional-dep
guards.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest

from worker.metadata import extract_raw_metadata
from worker.raw import is_raw_photo

rawpy = pytest.importorskip("rawpy")

FIXTURE = Path(__file__).parent / "fixtures" / "sample.dng"


def test_is_raw_photo_matches_only_raw_extensions() -> None:
    assert is_raw_photo("IMG_1234.dng")
    assert is_raw_photo("IMG_1234.DNG")  # case-insensitive
    assert is_raw_photo("/some/path/photo.dng")
    assert not is_raw_photo("photo.jpg")
    assert not is_raw_photo("clip.mov")
    assert not is_raw_photo("noext")


def test_decode_raw_returns_upright_rgb() -> None:
    from worker.raw import decode_raw

    image = decode_raw(str(FIXTURE))
    assert image.mode == "RGB"
    # The fixture is a 96x64 landscape frame with Horizontal orientation, so the
    # decode must come back landscape (no accidental transpose on top of rawpy's flip).
    assert image.size == (96, 64)


def test_raw_metadata_prefers_shutter_time_and_reads_camera() -> None:
    meta = extract_raw_metadata(str(FIXTURE))
    # DateTimeOriginal (shutter press), NOT the later IFD0 DateTime file-mod stamp.
    assert meta.taken_at_local == datetime(2026, 3, 4, 20, 0, 0, 250000)
    assert meta.camera_make == "Acme"
    assert meta.camera_model == "TestCam DNG"


def test_raw_metadata_survives_a_non_raw_file(tmp_path: Path) -> None:
    # A file with no parseable EXIF must degrade to empty metadata, not raise: the
    # photo is still perfectly processable, it just has no capture time or camera.
    junk = tmp_path / "not_really.dng"
    junk.write_bytes(b"not a tiff container")
    meta = extract_raw_metadata(str(junk))
    assert meta.taken_at_local is None
    assert meta.camera_make is None
