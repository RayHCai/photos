from __future__ import annotations

import asyncio
import io
import math
import subprocess
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING

import pillow_heif
from PIL import Image, ImageOps

from worker import backend_client as api
from worker import s3
from worker.clip_encoder import encode_image, encode_images
from worker.config import settings
from worker.face_assign import resolve_person
from worker.face_detect import DetectedFace, detect_faces
from worker.geocode import reverse_geocode
from worker.log import get_logger
from worker.metadata import MediaMetadata, extract_photo_metadata, extract_video_metadata
from worker.thumbnail import (
    extract_thumbnail_frame,
    extract_video_frames,
    generate_blurhash,
    generate_photo_thumbnail,
    generate_thumbnail_ladder,
    generate_web_image,
)
from worker.video import build_transcode_args, probe_video_shape, run_ffmpeg

if TYPE_CHECKING:
    from worker.stages import Stage

logger = get_logger(__name__)

pillow_heif.register_heif_opener()

# Decompression-bomb guard for user-supplied images. Pillow's own default warns at
# ~89 MP and refuses at 2x that; an explicit ceiling makes the limit a deliberate
# product decision and keeps peak per-image memory bounded (a 120 MP RGB decode is
# already ~360 MB, and several copies are live at once during processing).
Image.MAX_IMAGE_PIXELS = settings.max_image_pixels

#: Distance below which two faces in different frames of the same video are taken
#: to be the same person. Was an inline 0.3 at each of three call sites.
FACE_FRAME_DEDUP_DISTANCE = 0.3


async def _run_cpu(func, /, *args):  # type: ignore[no-untyped-def]
    """Run a blocking CPU-bound callable off the event loop.

    Every stage in this module used to execute inline: torch and onnxruntime
    inference, full-resolution LANCZOS resamples, and `subprocess.run` for ffmpeg
    (up to a 10-minute timeout). One 4K video therefore froze the FastAPI health
    endpoint and every other queued job for the whole transcode, made
    media_concurrency=3 a fiction, and — because BullMQ's lock-renewal timer lives
    on the same loop — let the job lock lapse so the stalled-job checker
    re-delivered the item and processed it twice.
    """
    return await asyncio.to_thread(func, *args)


class EmbeddingError(RuntimeError):
    """A CLIP embedding came back non-finite and cannot be stored."""


def _encode_clip_checked(image: Image.Image) -> list[float]:
    """Encode an image and refuse to return a non-finite embedding.

    The old `full` path replaced NaN/Inf with 0.0 across all 512 dimensions and
    then marked the item COMPLETED — storing a zero vector, which is silently
    unfindable by similarity search with no error recorded anywhere. The
    `clip`-only path skipped the sanitisation altogether. Failing loudly here means
    one behaviour for every caller, and the item lands in FAILED where the retry
    surface can see it.
    """
    rgb = image.convert("RGB") if image.mode != "RGB" else image
    values = encode_image(rgb).tolist()
    if not all(math.isfinite(v) for v in values):
        raise EmbeddingError("CLIP produced a non-finite embedding")
    return list(values)


def _encode_clip_frames_checked(frames: list[Image.Image]) -> list[float]:
    values = encode_images(frames).tolist()
    if not all(math.isfinite(v) for v in values):
        raise EmbeddingError("CLIP produced a non-finite embedding")
    return list(values)


async def _upload_thumbnail_ladder(
    image: Image.Image, thumb_key: str, media_item_id: str
) -> None:
    """Generate and upload the responsive thumbnail widths.

    Raises on failure — callers decide whether that should be fatal. The main
    content stage treats it as non-fatal (an optimisation whose loss degrades
    sharpness, not correctness); the dedicated `thumbnail-ladder` backfill stage
    does not, since producing the ladder is its entire job.
    """
    ladder = await _run_cpu(generate_thumbnail_ladder, image)
    for width, data in ladder.items():
        await s3.upload_bytes_to_derived_key(thumb_key, f"@{width}w", data, "image/webp")
    logger.info("thumbnail_ladder_uploaded", media_item_id=media_item_id, widths=sorted(ladder))


def _build_fts_document(meta: MediaMetadata, file_name: str) -> str:
    parts = [file_name]
    if meta.camera_make:
        parts.append(meta.camera_make)
    if meta.camera_model:
        parts.append(meta.camera_model)
    if meta.city:
        parts.append(meta.city)
    if meta.country:
        parts.append(meta.country)
    # Derived from the capture-local wall clock so the indexed month matches the
    # month the UI groups the photo under.
    stamp = meta.taken_at_local or meta.taken_at
    if stamp:
        parts.append(stamp.strftime("%Y %B"))
    return " ".join(parts)


# ─── Stage: Transcode ────────────────────────────────────────────────────────


async def _stage_transcode(tmp_path: str, media_item_id: str) -> None:
    """Produce a browser-playable H.264 MP4 with faststart."""
    logger.info("step_check_transcode_needed", media_item_id=media_item_id)

    shape = await _run_cpu(probe_video_shape, tmp_path)

    if shape.needs_nothing:
        logger.info(
            "step_transcode_skipped", media_item_id=media_item_id, reason="already_optimized"
        )
        return

    # Streams are already browser-safe, so copy them and only fix the container.
    # Seconds of I/O instead of minutes of CPU, with no quality loss.
    remux_only = shape.can_remux
    logger.info(
        "step_transcode_start",
        media_item_id=media_item_id,
        mode="remux" if remux_only else "reencode",
    )

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as out_tmp:
        out_path = out_tmp.name

    try:
        args, timeout = build_transcode_args(tmp_path, out_path, remux_only=remux_only)

        try:
            result = await _run_cpu(run_ffmpeg, args, timeout)
        except subprocess.TimeoutExpired:
            # Previously uncaught, so it propagated as a bare TimeoutExpired with no
            # context about which item or mode timed out.
            logger.error(
                "step_transcode_timeout",
                media_item_id=media_item_id,
                mode="remux" if remux_only else "reencode",
                timeout_seconds=timeout,
            )
            raise RuntimeError(f"ffmpeg timed out after {timeout}s") from None

        if result.returncode != 0:
            logger.error(
                "step_transcode_failed",
                media_item_id=media_item_id,
                stderr=result.stderr[:500],
            )
            raise RuntimeError(f"ffmpeg transcode failed: {result.stderr[:200]}")

        out_size = Path(out_path).stat().st_size
        logger.info("step_transcode_done", media_item_id=media_item_id, output_size=out_size)

        streaming_key = await s3.upload_file_to_key("streaming", out_path, "video/mp4")
        logger.info("step_persist_streaming_key", media_item_id=media_item_id, key=streaming_key)
        await api.persist_streaming_key(media_item_id, streaming_key)

        logger.info("stage_transcode_done", media_item_id=media_item_id)
    finally:
        Path(out_path).unlink(missing_ok=True)


# ─── Stage: Content (metadata + thumbnail + CLIP) ───────────────────────────


async def _stage_content_photo(
    image: Image.Image,
    meta: MediaMetadata,
    media_item_id: str,
    file_name: str,
) -> None:

    if meta.latitude is not None and meta.longitude is not None:
        logger.info("step_reverse_geocode", media_item_id=media_item_id)
        meta.city, meta.country = await reverse_geocode(meta.latitude, meta.longitude)

    logger.info(
        "step_generate_thumbnail",
        media_item_id=media_item_id,
        width=image.width,
        height=image.height,
    )
    thumb_bytes = await _run_cpu(generate_photo_thumbnail, image)

    logger.info("step_upload_thumbnail", media_item_id=media_item_id, size_bytes=len(thumb_bytes))
    thumb_key = await s3.generate_key_and_upload("thumbnails", thumb_bytes, "image/webp")

    # Responsive ladder alongside the canonical thumbnail, at derived keys the client
    # reconstructs from thumbnailKey alone. Best-effort: losing it degrades sharpness,
    # not correctness, and shouldn't fail the whole photo.
    try:
        await _upload_thumbnail_ladder(image, thumb_key, media_item_id)
    except Exception:
        logger.exception("thumbnail_ladder_failed", media_item_id=media_item_id)

    logger.info("step_generate_blurhash", media_item_id=media_item_id)
    with Image.open(io.BytesIO(thumb_bytes)) as thumb_image:
        blur_hash = await _run_cpu(generate_blurhash, thumb_image)

    logger.info("step_generate_web_image", media_item_id=media_item_id)
    web_bytes = await _run_cpu(generate_web_image, image)
    logger.info("step_upload_web_image", media_item_id=media_item_id, size_bytes=len(web_bytes))
    web_key = await s3.generate_key_and_upload("web", web_bytes, "image/webp")

    logger.info("step_encode_clip", media_item_id=media_item_id)
    # CLIP downscales to 224px internally, so the already-downscaled web variant
    # gives an identical embedding for a fraction of the decode cost and memory of
    # the full-resolution original.
    with Image.open(io.BytesIO(web_bytes)) as web_image:
        clip_list = await _run_cpu(_encode_clip_checked, web_image)

    fts_doc = _build_fts_document(meta, file_name)

    logger.info(
        "step_persist_content",
        media_item_id=media_item_id,
        has_gps=meta.latitude is not None,
        has_taken_at=meta.taken_at is not None,
        camera=f"{meta.camera_make or ''} {meta.camera_model or ''}".strip() or None,
    )
    await api.persist_content(
        media_item_id,
        width=meta.width,
        height=meta.height,
        duration_seconds=meta.duration_seconds,
        taken_at=meta.taken_at.isoformat() if meta.taken_at else None,
        taken_at_local=meta.taken_at_local.isoformat() if meta.taken_at_local else None,
        taken_at_offset_min=meta.taken_at_offset_min,
        video_rotation=meta.video_rotation,
        latitude=float(meta.latitude) if meta.latitude is not None else None,
        longitude=float(meta.longitude) if meta.longitude is not None else None,
        camera_make=meta.camera_make,
        camera_model=meta.camera_model,
        city=meta.city,
        country=meta.country,
        fts_document=fts_doc,
        thumbnail_key=thumb_key,
        clip_embedding=clip_list,
        blur_hash=blur_hash,
        web_key=web_key,
    )
    logger.info("stage_content_done", media_item_id=media_item_id)


async def _stage_content_video(
    tmp_path: str,
    frames: list[Image.Image],
    media_item_id: str,
    file_name: str,
) -> None:
    logger.info("step_extract_metadata", media_item_id=media_item_id)
    meta = await _run_cpu(extract_video_metadata, tmp_path)

    if meta.latitude is not None and meta.longitude is not None:
        logger.info("step_reverse_geocode", media_item_id=media_item_id)
        meta.city, meta.country = await reverse_geocode(meta.latitude, meta.longitude)

    logger.info(
        "step_generate_thumbnail",
        media_item_id=media_item_id,
        width=meta.width,
        height=meta.height,
        duration_seconds=meta.duration_seconds,
    )
    frame = await _run_cpu(extract_thumbnail_frame, tmp_path)
    try:
        thumb_bytes = await _run_cpu(generate_photo_thumbnail, frame)

        logger.info(
            "step_upload_thumbnail", media_item_id=media_item_id, size_bytes=len(thumb_bytes)
        )
        thumb_key = await s3.generate_key_and_upload("thumbnails", thumb_bytes, "image/webp")

        # Same best-effort ladder as a photo, from the full-resolution poster frame.
        # Its absence is not cosmetic for videos: the client builds the srcset from
        # thumbnailKey alone, so a missing ladder makes every candidate a 404 and the
        # grid cell renders empty.
        try:
            await _upload_thumbnail_ladder(frame, thumb_key, media_item_id)
        except Exception:
            logger.exception("thumbnail_ladder_failed", media_item_id=media_item_id)
    finally:
        frame.close()

    logger.info("step_generate_blurhash", media_item_id=media_item_id)
    thumb_image = Image.open(io.BytesIO(thumb_bytes))
    blur_hash = generate_blurhash(thumb_image)

    clip_embedding: list[float] | None = None
    if frames:
        logger.info("step_encode_clip", media_item_id=media_item_id, frame_count=len(frames))
        clip_emb = encode_images(frames)
        clip_embedding = [0.0 if (math.isnan(v) or math.isinf(v)) else v for v in clip_emb.tolist()]
    else:
        logger.warning("step_encode_clip_skipped", media_item_id=media_item_id, reason="no_frames")

    fts_doc = _build_fts_document(meta, file_name)

    logger.info(
        "step_persist_content",
        media_item_id=media_item_id,
        has_gps=meta.latitude is not None,
        has_taken_at=meta.taken_at is not None,
        duration_seconds=meta.duration_seconds,
    )
    await api.persist_content(
        media_item_id,
        width=meta.width,
        height=meta.height,
        duration_seconds=meta.duration_seconds,
        taken_at=meta.taken_at.isoformat() if meta.taken_at else None,
        taken_at_local=meta.taken_at_local.isoformat() if meta.taken_at_local else None,
        taken_at_offset_min=meta.taken_at_offset_min,
        video_rotation=meta.video_rotation,
        latitude=float(meta.latitude) if meta.latitude is not None else None,
        longitude=float(meta.longitude) if meta.longitude is not None else None,
        camera_make=meta.camera_make,
        camera_model=meta.camera_model,
        city=meta.city,
        country=meta.country,
        fts_document=fts_doc,
        thumbnail_key=thumb_key,
        clip_embedding=clip_embedding,
        blur_hash=blur_hash,
    )
    logger.info("stage_content_done", media_item_id=media_item_id)


# ─── Stage: CLIP only ───────────────────────────────────────────────────────


async def _stage_clip_photo(image: Image.Image, media_item_id: str) -> None:
    clip_list = await _run_cpu(_encode_clip_checked, image)
    await api.persist_clip_only(media_item_id, clip_list)
    logger.info("stage_clip_done", media_item_id=media_item_id)


async def _stage_clip_video(frames: list[Image.Image], media_item_id: str) -> None:
    if not frames:
        logger.warning("stage_clip_no_frames", media_item_id=media_item_id)
        return
    clip_list = await _run_cpu(_encode_clip_frames_checked, frames)
    await api.persist_clip_only(media_item_id, clip_list)
    logger.info("stage_clip_done", media_item_id=media_item_id)


# ─── Stage: Faces ───────────────────────────────────────────────────────────


def _encode_crop(face_crop: Image.Image) -> bytes:
    buf = io.BytesIO()
    face_crop.save(buf, format="WEBP", quality=80)
    return buf.getvalue()


async def _store_face(media_item_id: str, face: DetectedFace, **log_ctx: object) -> bool:
    """Persist one detected face, uploading its crop only if it will be referenced.

    The crop used to be encoded and uploaded *before* the assignment decision,
    which returns nothing when the face matched nobody and is below
    face_new_person_thresh. Every such detection therefore cost a WEBP encode, a
    presign round trip and an S3 PUT for an object referenced by nothing and never
    garbage-collected — repeated on every retry.
    """
    person_id = await resolve_person(confidence=face.confidence, embedding=face.embedding)

    if person_id is None:
        logger.info("step_face_below_threshold", media_item_id=media_item_id, **log_ctx)
        return False

    crop_bytes = await _run_cpu(_encode_crop, face.crop)
    crop_key = await s3.generate_key_and_upload("crops", crop_bytes, "image/webp")

    await api.insert_face(
        media_item_id=media_item_id,
        person_id=person_id,
        box_x=face.box_x,
        box_y=face.box_y,
        box_width=face.box_width,
        box_height=face.box_height,
        confidence=face.confidence,
        crop_key=crop_key,
        embedding=face.embedding.tolist(),
    )
    return True


async def _stage_faces_photo(image: Image.Image, media_item_id: str) -> None:
    logger.info("step_clear_faces", media_item_id=media_item_id)
    await api.clear_faces(media_item_id)

    logger.info("step_detect_faces", media_item_id=media_item_id)
    all_faces = await _run_cpu(detect_faces, image)
    faces = [f for f in all_faces if f.confidence >= settings.face_confidence_thresh]
    logger.info(
        "step_faces_found",
        media_item_id=media_item_id,
        detected=len(all_faces),
        accepted=len(faces),
    )

    stored = 0
    for i, face in enumerate(faces):
        if await _store_face(media_item_id, face, face_index=i):
            stored += 1

    # Recorded whether or not anything was found, so `rerun-missing-faces` stops
    # re-downloading and re-detecting landscapes and documents on every run.
    await api.mark_faces_scanned(media_item_id)

    logger.info("stage_faces_done", media_item_id=media_item_id, count=stored)


async def _stage_faces_video(frames: list[Image.Image], media_item_id: str) -> None:
    logger.info("step_clear_faces", media_item_id=media_item_id)
    await api.clear_faces(media_item_id)

    total = 0
    for frame_idx, frame in enumerate(frames):
        logger.info(
            "step_detect_faces",
            media_item_id=media_item_id,
            frame_index=frame_idx,
            total_frames=len(frames),
        )
        all_faces = await _run_cpu(detect_faces, frame)
        faces = [f for f in all_faces if f.confidence >= settings.face_confidence_thresh]
        logger.info(
            "step_faces_found",
            media_item_id=media_item_id,
            frame_index=frame_idx,
            detected=len(all_faces),
            accepted=len(faces),
        )

        for face in faces:
            # Deduplicate across frames: the same person appears in most of them.
            existing = await api.find_nearest_existing(
                media_item_id, face.embedding.tolist(), FACE_FRAME_DEDUP_DISTANCE
            )
            if existing is not None:
                logger.info(
                    "step_face_deduplicated",
                    media_item_id=media_item_id,
                    frame_index=frame_idx,
                )
                continue

            if await _store_face(media_item_id, face, frame_index=frame_idx):
                total += 1

    await api.mark_faces_scanned(media_item_id)
    logger.info("stage_faces_done", media_item_id=media_item_id, count=total)


# ─── Stage: BlurHash only ──────────────────────────────────────────────────


async def _stage_blurhash(media_item_id: str) -> None:
    """Download existing thumbnail from S3 and compute blurhash."""
    logger.info("step_get_thumbnail_key", media_item_id=media_item_id)
    thumb_key = await api.get_thumbnail_key(media_item_id)
    if not thumb_key:
        logger.warning("stage_blurhash_no_thumbnail", media_item_id=media_item_id)
        return

    logger.info("step_download_thumbnail", media_item_id=media_item_id, key=thumb_key)
    thumb_bytes = await s3.download_to_bytes(thumb_key)
    thumb_image = Image.open(io.BytesIO(thumb_bytes))

    logger.info("step_generate_blurhash", media_item_id=media_item_id)
    blur_hash = generate_blurhash(thumb_image)

    logger.info("step_persist_blurhash", media_item_id=media_item_id, hash=blur_hash)
    await api.persist_blurhash_only(media_item_id, blur_hash)
    logger.info("stage_blurhash_done", media_item_id=media_item_id)


# ─── Stage: Web-optimized image ────────────────────────────────────────────


async def _stage_web(image: Image.Image, media_item_id: str) -> None:
    """Generate and upload a web-optimized image for fast lightbox viewing."""
    logger.info("step_generate_web_image", media_item_id=media_item_id)
    web_bytes = generate_web_image(image)

    logger.info("step_upload_web_image", media_item_id=media_item_id, size_bytes=len(web_bytes))
    web_key = await s3.generate_key_and_upload("web", web_bytes, "image/webp")

    logger.info("step_persist_web_key", media_item_id=media_item_id, key=web_key)
    await api.persist_web_key(media_item_id, web_key)
    logger.info("stage_web_done", media_item_id=media_item_id)


# ─── Stage: Thumbnail ladder only ──────────────────────────────────────────


async def _stage_thumbnail_ladder(image: Image.Image, media_item_id: str) -> None:
    """Regenerate the responsive thumbnail widths for an item's existing thumbnail.

    Unlike the ladder step folded into the main content stage, failures here are
    not swallowed: producing the ladder is this stage's only job, so if it can't,
    the item should land in FAILED and be visible to the retry-failed flow.
    """
    logger.info("step_get_thumbnail_key", media_item_id=media_item_id)
    thumb_key = await api.get_thumbnail_key(media_item_id)
    if not thumb_key:
        logger.warning("stage_thumbnail_ladder_no_thumbnail", media_item_id=media_item_id)
        return

    await _upload_thumbnail_ladder(image, thumb_key, media_item_id)
    logger.info("stage_thumbnail_ladder_done", media_item_id=media_item_id)


# ─── Orchestrators ───────────────────────────────────────────────────────────


async def process_photo(
    media_item_id: str,
    original_key: str,
    file_name: str,
    start_stage: Stage = "full",
) -> None:
    logger.info("processing_photo", media_item_id=media_item_id, stage=start_stage)

    if start_stage == "blurhash":
        await _stage_blurhash(media_item_id)
        await api.set_processing_status(media_item_id, "COMPLETED")
        logger.info("photo_processed", media_item_id=media_item_id)
        return

    logger.info("step_download_original", media_item_id=media_item_id, key=original_key)

    # Streamed to disk rather than held in memory: an original can be a 120 MP
    # panorama, and the raw bytes used to stay referenced for the whole function
    # alongside the decoded image and each of its copies.
    with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        await s3.download_to_file(original_key, tmp_path)

        with Image.open(tmp_path) as opened:
            # Metadata BEFORE exif_transpose: transposing strips the GPS sub-IFD.
            logger.info("step_extract_metadata", media_item_id=media_item_id)
            meta = await _run_cpu(extract_photo_metadata, opened)

            image = await _run_cpu(_transpose, opened)

        # Dimensions come from the transposed image: they may be swapped.
        meta.width = image.width
        meta.height = image.height
        logger.info(
            "step_original_opened",
            media_item_id=media_item_id,
            width=image.width,
            height=image.height,
            mode=image.mode,
        )

        try:
            if start_stage == "full":
                await _stage_content_photo(image, meta, media_item_id, file_name)
                await _stage_faces_photo(image, media_item_id)
            elif start_stage == "clip":
                await _stage_clip_photo(image, media_item_id)
                await _stage_faces_photo(image, media_item_id)
            elif start_stage == "faces":
                await _stage_faces_photo(image, media_item_id)
                await api.set_processing_status(media_item_id, "COMPLETED")
            elif start_stage == "web":
                await _stage_web(image, media_item_id)
                await api.set_processing_status(media_item_id, "COMPLETED")
            elif start_stage == "thumbnail-ladder":
                await _stage_thumbnail_ladder(image, media_item_id)
                await api.set_processing_status(media_item_id, "COMPLETED")
            elif start_stage == "metadata":
                await _stage_metadata_only(meta, media_item_id, file_name)
            else:
                # Both stage dispatchers were if/elif chains with no else, so an
                # unhandled (stage, media_type) pair fell through silently, logged
                # "photo_processed", and left the row PROCESSING forever — claim_task
                # had already flipped it.
                raise ValueError(
                    f"stage {start_stage!r} is not applicable to a photo"
                )
        finally:
            image.close()
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    logger.info("photo_processed", media_item_id=media_item_id)


def _transpose(image: Image.Image) -> Image.Image:
    """Apply the EXIF orientation, returning an independent image."""
    return ImageOps.exif_transpose(image) or image.copy()


async def _stage_metadata_only(
    meta: MediaMetadata, media_item_id: str, file_name: str
) -> None:
    if meta.latitude is not None and meta.longitude is not None:
        meta.city, meta.country = await reverse_geocode(meta.latitude, meta.longitude)
    fts_doc = _build_fts_document(meta, file_name)
    await api.persist_content(
        media_item_id,
        width=meta.width,
        height=meta.height,
        taken_at=meta.taken_at.isoformat() if meta.taken_at else None,
        taken_at_local=meta.taken_at_local.isoformat() if meta.taken_at_local else None,
        taken_at_offset_min=meta.taken_at_offset_min,
        latitude=meta.latitude,
        longitude=meta.longitude,
        camera_make=meta.camera_make,
        camera_model=meta.camera_model,
        city=meta.city,
        country=meta.country,
        fts_document=fts_doc,
    )
    await api.set_processing_status(media_item_id, "COMPLETED")


async def process_video(
    media_item_id: str,
    original_key: str,
    file_name: str,
    start_stage: Stage = "full",
) -> None:
    logger.info("processing_video", media_item_id=media_item_id, stage=start_stage)

    if start_stage == "blurhash":
        await _stage_blurhash(media_item_id)
        await api.set_processing_status(media_item_id, "COMPLETED")
        logger.info("video_processed", media_item_id=media_item_id)
        return

    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=Path(file_name).suffix, delete=False) as tmp:
            tmp_path = tmp.name
        logger.info("step_download_original", media_item_id=media_item_id, key=original_key)
        await s3.download_to_file(original_key, tmp_path)
        logger.info(
            "step_original_downloaded",
            media_item_id=media_item_id,
            size_bytes=Path(tmp_path).stat().st_size,
        )

        if start_stage == "transcode":
            await _stage_transcode(tmp_path, media_item_id)
            await api.set_processing_status(media_item_id, "COMPLETED")
            logger.info("video_processed", media_item_id=media_item_id)
            return

        if start_stage == "thumbnail-ladder":
            # Ahead of frame extraction: the ladder needs one poster frame, not the
            # CLIP sample set, and extract_video_frames is the expensive part.
            frame = await _run_cpu(extract_thumbnail_frame, tmp_path)
            try:
                await _stage_thumbnail_ladder(frame, media_item_id)
            finally:
                frame.close()
            await api.set_processing_status(media_item_id, "COMPLETED")
            logger.info("video_processed", media_item_id=media_item_id)
            return

        if start_stage == "metadata":
            meta = await _run_cpu(extract_video_metadata, tmp_path)
            if meta.latitude is not None and meta.longitude is not None:
                meta.city, meta.country = await reverse_geocode(meta.latitude, meta.longitude)
            fts_doc = _build_fts_document(meta, file_name)
            await api.persist_content(
                media_item_id,
                width=meta.width,
                height=meta.height,
                duration_seconds=meta.duration_seconds,
                taken_at=meta.taken_at.isoformat() if meta.taken_at else None,
                latitude=meta.latitude,
                longitude=meta.longitude,
                camera_make=meta.camera_make,
                camera_model=meta.camera_model,
                city=meta.city,
                country=meta.country,
                fts_document=fts_doc,
            )
            await api.set_processing_status(media_item_id, "COMPLETED")
            logger.info("video_processed", media_item_id=media_item_id)
            return

        logger.info("step_extract_video_frames", media_item_id=media_item_id)
        frames = extract_video_frames(tmp_path)
        logger.info("step_video_frames_ready", media_item_id=media_item_id, frame_count=len(frames))

        if start_stage == "full":
            await _stage_content_video(tmp_path, frames, media_item_id, file_name)
            await _stage_faces_video(frames, media_item_id)
            await _stage_transcode(tmp_path, media_item_id)
        elif start_stage == "clip":
            await _stage_clip_video(frames, media_item_id)
            await _stage_faces_video(frames, media_item_id)
        elif start_stage == "faces":
            await _stage_faces_video(frames, media_item_id)
            await api.set_processing_status(media_item_id, "COMPLETED")
        else:
            # process_photo grew this guard; the video chain never did, so a stage
            # with no video branch — 'thumbnail-ladder', until now — fell through,
            # logged "video_processed", and left the row PROCESSING forever. That is
            # exactly how the ladder backfill appeared to run and changed nothing.
            raise ValueError(f"stage {start_stage!r} is not applicable to a video")

        logger.info("video_processed", media_item_id=media_item_id)

    finally:
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)


async def process_media(
    media_item_id: str,
    original_key: str,
    mime_type: str,
    media_type: str,
    start_stage: Stage = "full",
) -> None:
    try:
        file_name = await api.get_file_name(media_item_id)

        if media_type == "PHOTO":
            await process_photo(media_item_id, original_key, file_name, start_stage)
        elif media_type == "VIDEO":
            await process_video(media_item_id, original_key, file_name, start_stage)
        else:
            raise ValueError(f"Unknown media type: {media_type}")

    except asyncio.CancelledError:
        # CancelledError is a BaseException, so `except Exception` never caught it:
        # every ordinary container restart left the row PROCESSING forever. PENDING
        # rather than FAILED because nothing is actually wrong with the item — it
        # simply needs to be picked up again.
        await _safe_set_status(media_item_id, "PENDING", None)
        raise

    except Exception as exc:
        await _safe_set_status(media_item_id, "FAILED", _failure_message(exc))
        raise


def _failure_message(exc: BaseException) -> str:
    """A diagnostic string safe to persist and return to a client.

    httpx embeds the full request URL in HTTPStatusError messages, so `str(exc)`
    wrote presigned URLs — including X-Amz-Signature — straight into
    media_items.processing_error, which is part of the media DTO.
    """
    return f"{type(exc).__name__}: {api.redact_presigned(str(exc))}"[:1000]


async def _safe_set_status(media_item_id: str, status: str, error: str | None) -> None:
    """Best-effort status write that cannot mask the original failure.

    The only place an item was marked FAILED was this handler, over HTTP — so when
    the failure *was* the backend or the network, set_processing_status raised, the
    new exception replaced the original (no `raise ... from`), the real diagnostic
    never reached the database, and the row stayed PROCESSING with a null error.
    The backend's reaper is the backstop, but it should not be the first line of
    defence.
    """
    try:
        await api.set_processing_status(media_item_id, status, error)
    except Exception:
        logger.exception(
            "status_write_failed",
            media_item_id=media_item_id,
            intended_status=status,
        )
