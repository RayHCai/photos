from __future__ import annotations

from typing import TYPE_CHECKING

from worker import backend_client as api
from worker.config import settings
from worker.log import get_logger

if TYPE_CHECKING:
    import numpy as np
    from numpy.typing import NDArray

logger = get_logger(__name__)


async def find_nearest_person(embedding: NDArray[np.float32]) -> str | None:
    """Find the nearest person by cosine distance on face embeddings.

    Returns person_id if distance < face_match_thresh, else None.
    """
    person_id = await api.find_nearest_person(
        embedding=embedding.tolist(),
        threshold=settings.face_match_thresh,
    )

    if person_id:
        logger.info("face_matched", person_id=person_id)
    else:
        logger.info("face_no_match")

    return person_id


async def create_person() -> str:
    person_id = await api.create_person()
    logger.info("person_created", person_id=person_id)
    return person_id


async def insert_face(
    *,
    media_item_id: str,
    person_id: str,
    box_x: float,
    box_y: float,
    box_width: float,
    box_height: float,
    confidence: float,
    crop_key: str | None,
    embedding: NDArray[np.float32],
) -> str:
    face_id = await api.insert_face(
        media_item_id=media_item_id,
        person_id=person_id,
        box_x=box_x,
        box_y=box_y,
        box_width=box_width,
        box_height=box_height,
        confidence=confidence,
        crop_key=crop_key,
        embedding=embedding.tolist(),
    )
    logger.info("face_inserted", face_id=face_id, person_id=person_id)
    return face_id


async def assign_or_create(
    *,
    media_item_id: str,
    box_x: float,
    box_y: float,
    box_width: float,
    box_height: float,
    confidence: float,
    crop_key: str | None,
    embedding: NDArray[np.float32],
) -> str | None:
    """Find nearest person or create a new one, then insert the face.

    Returns face_id if inserted, None if skipped due to low confidence.
    """
    person_id = await find_nearest_person(embedding)

    if person_id is None:
        if confidence < settings.face_confidence_thresh:
            logger.info("face_skipped_low_confidence", confidence=round(confidence, 3))
            return None
        person_id = await create_person()

    face_id = await insert_face(
        media_item_id=media_item_id,
        person_id=person_id,
        box_x=box_x,
        box_y=box_y,
        box_width=box_width,
        box_height=box_height,
        confidence=confidence,
        crop_key=crop_key,
        embedding=embedding,
    )
    return face_id
