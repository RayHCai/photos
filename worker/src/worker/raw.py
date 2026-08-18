from __future__ import annotations

from pathlib import Path

import rawpy
from PIL import Image

from worker.config import settings
from worker.log import get_logger

logger = get_logger(__name__)

#: Raw photo extensions decoded with rawpy instead of Pillow.
#:
#: Only DNG is accepted for upload today (see the media-format allowlist in
#: backend/frontend `mediaFormats.ts`), but rawpy demosaics the rest of these too, so
#: widening the allowlist to another raw format needs no worker change beyond adding
#: its extension here.
RAW_PHOTO_EXTENSIONS = frozenset({"dng"})


def is_raw_photo(file_name: str) -> bool:
    """Whether this original must be demosaiced (rawpy) rather than opened by Pillow."""
    return Path(file_name).suffix.lower().lstrip(".") in RAW_PHOTO_EXTENSIONS


def decode_raw(file_path: str) -> Image.Image:
    """Demosaic a raw original into an 8-bit sRGB image the rest of the pipeline uses.

    Pillow raises `UnidentifiedImageError` on a raw Bayer mosaic, so `Image.open` is
    not an option; rawpy demosaics it into an ordinary RGB array that every downstream
    stage (thumbnail, web, CLIP, faces) already handles unchanged.

    `use_camera_wb` applies the as-shot white balance so colour matches the camera's own
    rendering rather than a flat auto-WB. The orientation flag is applied by
    `postprocess`, so the returned image is already upright and callers must NOT
    `exif_transpose` it again (the decoded image carries no EXIF anyway).

    rawpy bypasses Pillow's `Image.MAX_IMAGE_PIXELS` decompression-bomb guard, so the
    same ceiling is enforced here against the sensor dimensions before postprocess
    allocates the full-resolution buffer.
    """
    with rawpy.imread(file_path) as raw:
        sizes = raw.sizes
        pixels = sizes.width * sizes.height
        if pixels > settings.max_image_pixels:
            raise ValueError(
                f"raw image {sizes.width}x{sizes.height} ({pixels}px) exceeds the "
                f"{settings.max_image_pixels}px decode limit"
            )
        rgb = raw.postprocess(use_camera_wb=True)

    image = Image.fromarray(rgb, "RGB")
    logger.info("raw_decoded", width=image.width, height=image.height)
    return image
