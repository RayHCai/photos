"""Video container inspection and the transcode decision.

Extracted from pipeline.py, which imports torch, insightface and pillow_heif at module
scope — so none of this logic could be tested (or even imported) without the entire
multi-gigabyte ML stack present. Container probing has nothing to do with inference.
"""

from __future__ import annotations

import json
import struct
import subprocess

from worker.log import get_logger

logger = get_logger(__name__)

_PROBE_TIMEOUT = 30


class VideoShape:
    """What a source video already is, and therefore what work it needs."""

    __slots__ = ("is_mp4_container", "is_h264", "is_aac_or_none", "has_faststart")

    def __init__(
        self,
        *,
        is_mp4_container: bool,
        is_h264: bool,
        is_aac_or_none: bool,
        has_faststart: bool,
    ) -> None:
        self.is_mp4_container = is_mp4_container
        self.is_h264 = is_h264
        self.is_aac_or_none = is_aac_or_none
        self.has_faststart = has_faststart

    @property
    def needs_nothing(self) -> bool:
        return (
            self.is_mp4_container
            and self.is_h264
            and self.is_aac_or_none
            and self.has_faststart
        )

    @property
    def can_remux(self) -> bool:
        """Streams are already browser-safe; only the container/atom order is wrong.

        Worth distinguishing because a remux is an I/O-bound stream copy that takes
        seconds, whereas the previous code ran a full libx264 re-encode — minutes of
        CPU and a generation of quality loss — whenever *anything* about the container
        was off, including a mere faststart miss.
        """
        return self.is_h264 and self.is_aac_or_none


UNKNOWN_SHAPE = VideoShape(
    is_mp4_container=False, is_h264=False, is_aac_or_none=False, has_faststart=False
)


def probe_video_shape(file_path: str) -> VideoShape:
    """Inspect container and codecs. Blocking; callers run it off the event loop."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "quiet", "-print_format", "json",
                "-show_format", "-show_streams", file_path,
            ],
            capture_output=True,
            text=True,
            timeout=_PROBE_TIMEOUT,
            check=False,
        )
        if result.returncode != 0:
            return UNKNOWN_SHAPE

        probe = json.loads(result.stdout)
        fmt = probe.get("format", {})
        is_mp4 = _is_mp4_container(fmt)

        is_h264 = False
        audio_codecs: list[str] = []
        for stream in probe.get("streams", []):
            kind = stream.get("codec_type")
            if kind == "video" and not is_h264:
                is_h264 = stream.get("codec_name") == "h264"
            elif kind == "audio":
                audio_codecs.append(str(stream.get("codec_name")))

        return VideoShape(
            is_mp4_container=is_mp4,
            is_h264=is_h264,
            # No audio at all is fine; it must not be mistaken for unsupported audio.
            is_aac_or_none=all(c == "aac" for c in audio_codecs),
            has_faststart=has_faststart(file_path),
        )
    except (OSError, struct.error, json.JSONDecodeError, subprocess.TimeoutExpired):
        return UNKNOWN_SHAPE


# ISO-BMFF brands that mean "this really is an MP4 a browser will accept".
# 'qt  ' is QuickTime, which Chrome and Firefox may refuse to play.
_MP4_BRANDS = frozenset(
    {"isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "dash", "mmp4", "m4v"}
)


def _is_mp4_container(fmt: dict[str, object]) -> bool:
    """Whether the container is genuinely MP4 rather than QuickTime.

    `format_name` cannot answer this. ffmpeg uses one demuxer for the whole ISO-BMFF
    family, so it reports "mov,mp4,m4a,3gp,3g2,mj2" for *both* .mov and .mp4 — which is
    why the original substring test (and an exact match against the split list, which
    also contains "mp4") both misidentify QuickTime as an optimised MP4. The result was
    that streaming_key stayed NULL for H.264 .mov files and the browser was handed a
    raw video/quicktime original.

    `major_brand` is the container's own declaration and does discriminate.
    """
    tags = fmt.get("tags")
    brand = ""
    if isinstance(tags, dict):
        brand = str(tags.get("major_brand", "")).strip().lower()

    if brand:
        return brand in _MP4_BRANDS

    # No brand tag (a raw stream, or a demuxer that does not surface one). Fall back to
    # the demuxer list, and treat the shared mov/mp4 family as *not* known-good so the
    # file is remuxed rather than optimistically passed through.
    names = [n.strip() for n in str(fmt.get("format_name", "")).split(",")]
    return names == ["mp4"]


def has_faststart(file_path: str) -> bool:
    """True when the moov atom precedes mdat, so playback can begin before download."""
    try:
        with open(file_path, "rb") as f:
            while True:
                header = f.read(8)
                if len(header) < 8:
                    break
                size = struct.unpack(">I", header[:4])[0]
                atom_type = header[4:8]
                if atom_type == b"moov":
                    return True
                if atom_type == b"mdat":
                    return False
                if size == 0:
                    break
                if size == 1:  # 64-bit extended size
                    ext = f.read(8)
                    if len(ext) < 8:
                        break
                    size = struct.unpack(">Q", ext)[0]
                    f.seek(size - 16, 1)
                else:
                    f.seek(size - 8, 1)
        return False
    except (OSError, struct.error):
        return False


def run_ffmpeg(args: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    """Blocking ffmpeg invocation. Callers run it off the event loop.

    argv list, never a shell string, so a filename can never be interpreted as shell
    syntax.
    """
    return subprocess.run(
        args, capture_output=True, text=True, timeout=timeout, check=False
    )


def build_transcode_args(src: str, dest: str, *, remux_only: bool) -> tuple[list[str], int]:
    """ffmpeg argv and timeout for the chosen strategy."""
    if remux_only:
        return (
            ["ffmpeg", "-i", src, "-c", "copy", "-movflags", "+faststart", "-y", dest],
            300,
        )
    return (
        [
            "ffmpeg", "-i", src,
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            "-y", dest,
        ],
        3600,
    )
