from __future__ import annotations

import io
import subprocess
import tempfile
from pathlib import Path

import blurhash
from PIL import Image

from worker.log import get_logger

logger = get_logger(__name__)

MAX_DIMENSION = 400
WEB_MAX_DIMENSION = 2000
WEBP_QUALITY = 80

#: Widths emitted for each thumbnail, so the client can serve a cell with pixels
#: appropriate to its size and DPR. A single 400px file served everything from a
#: ~63 CSS px mobile cell to a ~400px desktop cell across DPR 1-3, so retina
#: phones upscaled (visibly soft) while dense grids over-downloaded ~4x.
#:
#: Keep in sync with frontend/src/lib/api/media.ts THUMBNAIL_WIDTHS.
THUMBNAIL_WIDTHS: tuple[int, ...] = (200, 400, 800)


def _encode_webp(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="WEBP", quality=WEBP_QUALITY)
    buf.seek(0)
    return buf.read()


def generate_photo_thumbnail(image: Image.Image) -> bytes:
    """The canonical MAX_DIMENSION thumbnail (also the srcset fallback `src`)."""
    img = image.copy()
    img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.Resampling.LANCZOS)
    result = _encode_webp(img)
    logger.info(
        "photo_thumbnail_generated",
        width=img.width,
        height=img.height,
        size_bytes=len(result),
    )
    img.close()
    return result


def generate_thumbnail_ladder(image: Image.Image) -> dict[int, bytes]:
    """Encode one thumbnail per THUMBNAIL_WIDTHS entry.

    A width larger than the source is skipped rather than upscaled: upscaling costs
    bytes and adds no detail, and the browser falls back to the next candidate.
    """
    out: dict[int, bytes] = {}
    for width in THUMBNAIL_WIDTHS:
        if width > image.width and width != THUMBNAIL_WIDTHS[0]:
            continue
        img = image.copy()
        img.thumbnail((width, width), Image.Resampling.LANCZOS)
        out[width] = _encode_webp(img)
        img.close()

    logger.info(
        "thumbnail_ladder_generated",
        widths=sorted(out),
        total_bytes=sum(len(v) for v in out.values()),
    )
    return out


def generate_web_image(image: Image.Image) -> bytes:
    """Generate a web-optimized version (~2000px max dimension) for fast lightbox viewing."""
    img = image.copy()
    # Skip if image is already smaller than web size
    if img.width <= WEB_MAX_DIMENSION and img.height <= WEB_MAX_DIMENSION:
        img = img.convert("RGB")
    else:
        img.thumbnail((WEB_MAX_DIMENSION, WEB_MAX_DIMENSION), Image.Resampling.LANCZOS)
        img = img.convert("RGB")

    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=WEBP_QUALITY)
    buf.seek(0)
    result = buf.read()
    logger.info("web_image_generated", width=img.width, height=img.height, size_bytes=len(result))
    return result


def _extract_frame(video_path: str, tmp_path: str, seek: str) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-ss", seek,
            "-i", video_path,
            "-vframes", "1",
            "-q:v", "2",
            tmp_path,
        ],
        capture_output=True,
        timeout=30,
        check=True,
    )


def generate_video_thumbnail(video_path: str) -> bytes:
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        try:
            _extract_frame(video_path, tmp_path, "1")
        except subprocess.CalledProcessError:
            _extract_frame(video_path, tmp_path, "0")
        frame = Image.open(tmp_path)
        return generate_photo_thumbnail(frame)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        logger.warning("video_thumbnail_failed", error=str(exc))
        raise
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def extract_video_frames(
    video_path: str,
    interval_seconds: float = 5.0,
    max_frames: int = 10,
) -> list[Image.Image]:
    """Extract frames from video at regular intervals for CLIP + face processing."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        try:
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-i", video_path,
                    "-vf", f"fps=1/{interval_seconds}",
                    "-frames:v", str(max_frames),
                    "-q:v", "2",
                    f"{tmp_dir}/frame_%04d.jpg",
                ],
                capture_output=True,
                timeout=120,
                check=True,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            logger.warning("video_frame_extraction_failed", error=str(exc))
            return []

        frames: list[Image.Image] = []
        for frame_path in sorted(Path(tmp_dir).glob("frame_*.jpg")):
            frames.append(Image.open(frame_path).copy())

        logger.info("video_frames_extracted", count=len(frames), interval_seconds=interval_seconds)
        return frames


def generate_blurhash(image: Image.Image, x_components: int = 4, y_components: int = 4) -> str:
    """Generate a BlurHash string from a PIL Image (ideally the thumbnail)."""
    img = image.copy().convert("RGB")
    img.thumbnail((64, 64), Image.Resampling.LANCZOS)
    hash_str: str = blurhash.encode(img, x_components, y_components)
    logger.info("blurhash_generated", hash=hash_str, width=img.width, height=img.height)
    return hash_str
