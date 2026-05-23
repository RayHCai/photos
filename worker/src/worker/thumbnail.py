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


def generate_photo_thumbnail(image: Image.Image) -> bytes:
    img = image.copy()
    img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.Resampling.LANCZOS)
    img = img.convert("RGB")

    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=WEBP_QUALITY)
    buf.seek(0)
    result = buf.read()
    logger.info("photo_thumbnail_generated", width=img.width, height=img.height, size_bytes=len(result))
    return result


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


def extract_video_frames(video_path: str, interval_seconds: float = 5.0, max_frames: int = 10) -> list[Image.Image]:
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
