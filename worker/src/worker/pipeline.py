from __future__ import annotations

import io
import tempfile
from pathlib import Path
from typing import Literal

from PIL import Image, ImageOps

from worker import backend_client as api, s3
from worker.clip_encoder import encode_image, encode_images
from worker.config import settings
from worker.face_assign import assign_or_create
from worker.face_detect import detect_faces
from worker.log import get_logger
from worker.metadata import MediaMetadata, extract_photo_metadata, extract_video_metadata
from worker.thumbnail import (
    extract_video_frames,
    generate_blurhash,
    generate_photo_thumbnail,
    generate_video_thumbnail,
)

logger = get_logger(__name__)

Stage = Literal["full", "clip", "faces", "blurhash"]


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
    if meta.taken_at:
        parts.append(meta.taken_at.strftime("%Y %B"))
    return " ".join(parts)


# ─── Stage: Content (metadata + thumbnail + CLIP) ───────────────────────────


async def _stage_content_photo(
    image: Image.Image,
    media_item_id: str,
    file_name: str,
) -> None:
    logger.info("step_extract_metadata", media_item_id=media_item_id)
    meta = extract_photo_metadata(image)

    logger.info("step_generate_thumbnail", media_item_id=media_item_id, width=image.width, height=image.height)
    thumb_bytes = generate_photo_thumbnail(image)

    logger.info("step_upload_thumbnail", media_item_id=media_item_id, size_bytes=len(thumb_bytes))
    thumb_key = await s3.generate_key_and_upload("thumbnails", thumb_bytes, "image/webp")

    logger.info("step_generate_blurhash", media_item_id=media_item_id)
    thumb_image = Image.open(io.BytesIO(thumb_bytes))
    blur_hash = generate_blurhash(thumb_image)

    logger.info("step_encode_clip", media_item_id=media_item_id)
    clip_emb = encode_image(image)
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
        latitude=meta.latitude,
        longitude=meta.longitude,
        camera_make=meta.camera_make,
        camera_model=meta.camera_model,
        city=meta.city,
        country=meta.country,
        fts_document=fts_doc,
        thumbnail_key=thumb_key,
        clip_embedding=clip_emb.tolist(),
        blur_hash=blur_hash,
    )
    logger.info("stage_content_done", media_item_id=media_item_id)


async def _stage_content_video(
    tmp_path: str,
    frames: list[Image.Image],
    media_item_id: str,
    file_name: str,
) -> None:
    logger.info("step_extract_metadata", media_item_id=media_item_id)
    meta = extract_video_metadata(tmp_path)

    logger.info(
        "step_generate_thumbnail",
        media_item_id=media_item_id,
        width=meta.width,
        height=meta.height,
        duration_seconds=meta.duration_seconds,
    )
    thumb_bytes = generate_video_thumbnail(tmp_path)

    logger.info("step_upload_thumbnail", media_item_id=media_item_id, size_bytes=len(thumb_bytes))
    thumb_key = await s3.generate_key_and_upload("thumbnails", thumb_bytes, "image/webp")

    logger.info("step_generate_blurhash", media_item_id=media_item_id)
    thumb_image = Image.open(io.BytesIO(thumb_bytes))
    blur_hash = generate_blurhash(thumb_image)

    clip_embedding: list[float] | None = None
    if frames:
        logger.info("step_encode_clip", media_item_id=media_item_id, frame_count=len(frames))
        clip_emb = encode_images(frames)
        clip_embedding = clip_emb.tolist()
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
        latitude=meta.latitude,
        longitude=meta.longitude,
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
    clip_emb = encode_image(image)
    await api.persist_clip_only(media_item_id, clip_emb.tolist())
    logger.info("stage_clip_done", media_item_id=media_item_id)


async def _stage_clip_video(frames: list[Image.Image], media_item_id: str) -> None:
    if not frames:
        logger.warning("stage_clip_no_frames", media_item_id=media_item_id)
        return
    clip_emb = encode_images(frames)
    await api.persist_clip_only(media_item_id, clip_emb.tolist())
    logger.info("stage_clip_done", media_item_id=media_item_id)


# ─── Stage: Faces ───────────────────────────────────────────────────────────


async def _stage_faces_photo(image: Image.Image, media_item_id: str) -> None:
    logger.info("step_clear_faces", media_item_id=media_item_id)
    await api.clear_faces(media_item_id)

    logger.info("step_detect_faces", media_item_id=media_item_id)
    all_faces = detect_faces(image)
    faces = [f for f in all_faces if f.confidence >= settings.face_confidence_thresh]
    logger.info("step_faces_found", media_item_id=media_item_id, detected=len(all_faces), accepted=len(faces))

    for i, face in enumerate(faces):
        logger.info(
            "step_upload_face_crop",
            media_item_id=media_item_id,
            face_index=i,
            confidence=round(face.confidence, 3),
        )
        crop_buf = io.BytesIO()
        face.crop.save(crop_buf, format="WEBP", quality=80)
        crop_key = await s3.generate_key_and_upload("crops", crop_buf.getvalue(), "image/webp")

        logger.info("step_assign_face", media_item_id=media_item_id, face_index=i)
        await assign_or_create(
            media_item_id=media_item_id,
            box_x=face.box_x,
            box_y=face.box_y,
            box_width=face.box_width,
            box_height=face.box_height,
            confidence=face.confidence,
            crop_key=crop_key,
            embedding=face.embedding,
        )
    logger.info("stage_faces_done", media_item_id=media_item_id, count=len(faces))


async def _stage_faces_video(frames: list[Image.Image], media_item_id: str) -> None:
    logger.info("step_clear_faces", media_item_id=media_item_id)
    await api.clear_faces(media_item_id)

    total = 0
    for frame_idx, frame in enumerate(frames):
        logger.info("step_detect_faces", media_item_id=media_item_id, frame_index=frame_idx, total_frames=len(frames))
        all_faces = detect_faces(frame)
        faces = [f for f in all_faces if f.confidence >= settings.face_confidence_thresh]
        logger.info("step_faces_found", media_item_id=media_item_id, frame_index=frame_idx, detected=len(all_faces), accepted=len(faces))

        for face in faces:
            # Deduplicate across frames
            existing = await api.find_nearest_existing(
                media_item_id, face.embedding.tolist(), 0.3
            )
            if existing is not None:
                logger.info("step_face_deduplicated", media_item_id=media_item_id, frame_index=frame_idx)
                continue

            logger.info(
                "step_upload_face_crop",
                media_item_id=media_item_id,
                frame_index=frame_idx,
                confidence=round(face.confidence, 3),
            )
            crop_buf = io.BytesIO()
            face.crop.save(crop_buf, format="WEBP", quality=80)
            crop_key = await s3.generate_key_and_upload("crops", crop_buf.getvalue(), "image/webp")

            logger.info("step_assign_face", media_item_id=media_item_id, frame_index=frame_idx)
            await assign_or_create(
                media_item_id=media_item_id,
                box_x=face.box_x,
                box_y=face.box_y,
                box_width=face.box_width,
                box_height=face.box_height,
                confidence=face.confidence,
                crop_key=crop_key,
                embedding=face.embedding,
            )
            total += 1
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
        logger.info("photo_processed", media_item_id=media_item_id)
        return

    logger.info("step_download_original", media_item_id=media_item_id, key=original_key)
    raw = await s3.download_to_bytes(original_key)
    image = Image.open(io.BytesIO(raw))
    image = ImageOps.exif_transpose(image) or image
    logger.info("step_original_opened", media_item_id=media_item_id, size_bytes=len(raw), width=image.width, height=image.height, mode=image.mode)

    if start_stage == "full":
        await _stage_content_photo(image, media_item_id, file_name)
        await _stage_faces_photo(image, media_item_id)
    elif start_stage == "clip":
        await _stage_clip_photo(image, media_item_id)
        await _stage_faces_photo(image, media_item_id)
    elif start_stage == "faces":
        await _stage_faces_photo(image, media_item_id)
        await api.set_processing_status(media_item_id, "COMPLETED")

    logger.info("photo_processed", media_item_id=media_item_id)


async def process_video(
    media_item_id: str,
    original_key: str,
    file_name: str,
    start_stage: Stage = "full",
) -> None:
    logger.info("processing_video", media_item_id=media_item_id, stage=start_stage)

    if start_stage == "blurhash":
        await _stage_blurhash(media_item_id)
        logger.info("video_processed", media_item_id=media_item_id)
        return

    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=Path(file_name).suffix, delete=False) as tmp:
            tmp_path = tmp.name
        logger.info("step_download_original", media_item_id=media_item_id, key=original_key)
        await s3.download_to_file(original_key, tmp_path)
        logger.info("step_original_downloaded", media_item_id=media_item_id, size_bytes=Path(tmp_path).stat().st_size)

        logger.info("step_extract_video_frames", media_item_id=media_item_id)
        frames = extract_video_frames(tmp_path)
        logger.info("step_video_frames_ready", media_item_id=media_item_id, frame_count=len(frames))

        if start_stage == "full":
            await _stage_content_video(tmp_path, frames, media_item_id, file_name)
            await _stage_faces_video(frames, media_item_id)
        elif start_stage == "clip":
            await _stage_clip_video(frames, media_item_id)
            await _stage_faces_video(frames, media_item_id)
        elif start_stage == "faces":
            await _stage_faces_video(frames, media_item_id)
            await api.set_processing_status(media_item_id, "COMPLETED")

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
            logger.warning("unknown_media_type", media_type=media_type)
            await api.set_processing_status(media_item_id, "FAILED", f"Unknown type: {media_type}")
    except Exception as exc:
        await api.set_processing_status(media_item_id, "FAILED", str(exc))
        raise
