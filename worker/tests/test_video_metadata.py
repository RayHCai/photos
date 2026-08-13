"""Regression tests for video rotation and container probing.

Covers three defects:

  1. A portrait phone video is stored as landscape frames plus a 90-degree display
     matrix. Reporting the raw frame dimensions gave every such video a landscape tile
     in the grid and cropped it in the lightbox.

  2. ffprobe reports QuickTime as "mov,mp4,m4a,3gp,3g2,mj2", so a bare `"mp4" in
     format_name` substring test treated an H.264 .mov as an already-optimised mp4 —
     streaming_key stayed NULL and the browser was handed a raw video/quicktime
     original, which Chrome and Firefox may refuse to play.

  3. A video whose streams are already browser-safe but whose moov atom is in the
     wrong place needs a remux (seconds, I/O bound), not a full libx264 re-encode
     (minutes of CPU plus a generation of quality loss).

ffprobe output is injected rather than shelling out, so these exercise the parsing
logic without needing ffmpeg installed. The logic lives in worker.video rather than
worker.pipeline precisely so it can be imported without the ML stack.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import pytest

from worker import metadata as metadata_module
from worker import video as video_module
from worker.metadata import _stream_rotation, extract_video_metadata
from worker.video import probe_video_shape


def _probe(
    *,
    format_name: str = "mov,mp4,m4a,3gp,3g2,mj2",
    major_brand: str | None = None,
    video_codec: str = "h264",
    audio_codec: str | None = "aac",
    width: int = 1920,
    height: int = 1080,
    rotation: float | None = None,
    creation_time: str | None = None,
    duration: str | None = "12.5",
) -> dict[str, Any]:
    video: dict[str, Any] = {
        "codec_type": "video",
        "codec_name": video_codec,
        "width": width,
        "height": height,
    }
    if rotation is not None:
        video["side_data_list"] = [{"rotation": rotation}]

    streams: list[dict[str, Any]] = [video]
    if audio_codec:
        streams.append({"codec_type": "audio", "codec_name": audio_codec})

    fmt: dict[str, Any] = {"format_name": format_name}
    if duration is not None:
        fmt["duration"] = duration
    tags: dict[str, str] = {}
    if creation_time is not None:
        tags["creation_time"] = creation_time
    if major_brand is not None:
        tags["major_brand"] = major_brand
    if tags:
        fmt["tags"] = tags

    return {"streams": streams, "format": fmt}


class _CompletedProcess:
    def __init__(self, stdout: str, returncode: int = 0) -> None:
        self.stdout = stdout
        self.stderr = ""
        self.returncode = returncode


@pytest.fixture
def fake_ffprobe(monkeypatch: pytest.MonkeyPatch):
    """Replaces subprocess.run for both modules that shell out to ffprobe."""

    def _install(probe: dict[str, Any], returncode: int = 0) -> None:
        def fake_run(*_args: object, **_kwargs: object) -> _CompletedProcess:
            return _CompletedProcess(json.dumps(probe), returncode)

        monkeypatch.setattr(metadata_module.subprocess, "run", fake_run)
        monkeypatch.setattr(video_module.subprocess, "run", fake_run)

    return _install


# ─── Rotation ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("matrix_rotation", "expected"),
    [
        # ffprobe reports the *matrix* rotation, which is the negation of the
        # clockwise display rotation.
        (-90.0, 90),
        (-270.0, 270),
        (-180.0, 180),
        (0.0, 0),
        (None, 0),
    ],
)
def test_stream_rotation_from_side_data(matrix_rotation: float | None, expected: int) -> None:
    stream: dict[str, Any] = {}
    if matrix_rotation is not None:
        stream["side_data_list"] = [{"rotation": matrix_rotation}]
    assert _stream_rotation(stream) == expected


def test_stream_rotation_from_legacy_tag() -> None:
    """Older ffprobe reports rotation as a stream tag instead of side data."""
    assert _stream_rotation({"tags": {"rotate": "90"}}) == 90


def test_stream_rotation_tolerates_garbage() -> None:
    assert _stream_rotation({"side_data_list": [{"rotation": "nonsense"}]}) == 0
    assert _stream_rotation({"tags": {"rotate": "nonsense"}}) == 0


def test_portrait_video_dimensions_are_swapped(fake_ffprobe) -> None:
    """A 90-degree rotated 1920x1080 source displays as 1080x1920."""
    fake_ffprobe(_probe(width=1920, height=1080, rotation=-90.0))

    meta = extract_video_metadata("/tmp/example.mov")

    assert (meta.width, meta.height) == (1080, 1920)
    assert meta.video_rotation == 90


def test_unrotated_video_dimensions_are_untouched(fake_ffprobe) -> None:
    fake_ffprobe(_probe(width=1920, height=1080, rotation=0.0))

    meta = extract_video_metadata("/tmp/example.mp4")

    assert (meta.width, meta.height) == (1920, 1080)
    assert meta.video_rotation == 0


# ─── Timestamps ──────────────────────────────────────────────────────────────


def test_container_creation_time_is_utc_and_derives_local(fake_ffprobe) -> None:
    """Container creation_time is genuinely UTC, unlike EXIF's local wall clock."""
    fake_ffprobe(_probe(creation_time="2024-06-15T14:30:00.000000Z"))

    meta = extract_video_metadata("/tmp/example.mp4")

    assert meta.taken_at == datetime(2024, 6, 15, 14, 30, tzinfo=UTC)
    assert meta.taken_at_offset_min == 0
    # Local is derived *from* UTC here, the opposite direction to the photo path.
    assert meta.taken_at_local == datetime(2024, 6, 15, 14, 30)


def test_malformed_creation_time_is_ignored(fake_ffprobe) -> None:
    fake_ffprobe(_probe(creation_time="not-a-timestamp"))

    meta = extract_video_metadata("/tmp/example.mp4")

    assert meta.taken_at is None


def test_ffprobe_failure_returns_empty_metadata(fake_ffprobe) -> None:
    fake_ffprobe(_probe(), returncode=1)

    meta = extract_video_metadata("/tmp/example.mp4")

    assert meta.width is None and meta.duration_seconds is None


# ─── Container shape / transcode decision ────────────────────────────────────


def test_quicktime_container_is_not_treated_as_mp4(
    fake_ffprobe, monkeypatch: pytest.MonkeyPatch
) -> None:
    """ffmpeg reports the same demuxer list for .mov and .mp4, so format_name cannot
    discriminate — only major_brand can. `qt  ` is QuickTime."""
    monkeypatch.setattr(video_module, "has_faststart", lambda _p: True)
    fake_ffprobe(_probe(format_name="mov,mp4,m4a,3gp,3g2,mj2", major_brand="qt  "))

    shape = probe_video_shape("/tmp/example.mov")

    assert shape.is_mp4_container is False
    # Nothing to skip: a .mov must still be given a streaming variant, or Chrome and
    # Firefox may refuse to play the original.
    assert shape.needs_nothing is False
    # But its streams are fine, so a copy-remux suffices — no re-encode.
    assert shape.can_remux is True


def test_real_mp4_container_is_recognised(
    fake_ffprobe, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(video_module, "has_faststart", lambda _p: True)
    fake_ffprobe(_probe(major_brand="isom"))

    shape = probe_video_shape("/tmp/example.mp4")

    assert shape.is_mp4_container is True
    assert shape.needs_nothing is True


def test_faststart_miss_only_needs_a_remux(
    fake_ffprobe, monkeypatch: pytest.MonkeyPatch
) -> None:
    """H.264/AAC mp4 with moov after mdat: remux, never a full re-encode."""
    monkeypatch.setattr(video_module, "has_faststart", lambda _p: False)
    fake_ffprobe(_probe(major_brand="isom"))

    shape = probe_video_shape("/tmp/example.mp4")

    assert shape.needs_nothing is False
    assert shape.can_remux is True


def test_unsupported_codec_requires_reencode(
    fake_ffprobe, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(video_module, "has_faststart", lambda _p: True)
    fake_ffprobe(_probe(major_brand="isom", video_codec="hevc"))

    shape = probe_video_shape("/tmp/example.mp4")

    assert shape.can_remux is False
    assert shape.needs_nothing is False


def test_non_aac_audio_requires_reencode(
    fake_ffprobe, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(video_module, "has_faststart", lambda _p: True)
    fake_ffprobe(_probe(major_brand="isom", audio_codec="mp3"))

    shape = probe_video_shape("/tmp/example.mp4")

    assert shape.can_remux is False


def test_silent_video_can_remux(fake_ffprobe, monkeypatch: pytest.MonkeyPatch) -> None:
    """No audio stream at all must not be mistaken for unsupported audio."""
    monkeypatch.setattr(video_module, "has_faststart", lambda _p: True)
    fake_ffprobe(_probe(major_brand="isom", audio_codec=None))

    shape = probe_video_shape("/tmp/example.mp4")

    assert shape.is_aac_or_none is True
    assert shape.can_remux is True


@pytest.mark.parametrize("brand", ["isom", "iso2", "mp42", "avc1", "M4V"])
def test_mp4_brands_are_accepted(
    brand: str, fake_ffprobe, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(video_module, "has_faststart", lambda _p: True)
    fake_ffprobe(_probe(major_brand=brand))

    assert probe_video_shape("/tmp/example.mp4").is_mp4_container is True


def test_missing_brand_is_treated_as_not_known_good(
    fake_ffprobe, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Unknown container: remux rather than optimistically pass the original through."""
    monkeypatch.setattr(video_module, "has_faststart", lambda _p: True)
    fake_ffprobe(_probe(format_name="mov,mp4,m4a,3gp,3g2,mj2"))

    shape = probe_video_shape("/tmp/example.bin")

    assert shape.is_mp4_container is False
    assert shape.needs_nothing is False
