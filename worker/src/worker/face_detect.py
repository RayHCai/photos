from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np
from insightface.app import FaceAnalysis

from worker.config import settings
from worker.log import get_logger

if TYPE_CHECKING:
    from numpy.typing import NDArray
    from PIL import Image

logger = get_logger(__name__)

_app: FaceAnalysis | None = None

# Guards first load. CPU stages now run in a thread pool, so without this several
# threads could each build their own ~275 MB model on the first job.
_load_lock = threading.Lock()


def is_loaded() -> bool:
    return _app is not None


def warm_up() -> None:
    """Load the model eagerly so the first real job does not pay for it."""
    _load_model()


def _load_model() -> FaceAnalysis:
    global _app  # noqa: PLW0603
    if _app is not None:
        return _app

    with _load_lock:
        if _app is not None:
            return _app
        logger.info("loading_insightface_model")
        app = FaceAnalysis(
            name="buffalo_l",
            providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
        )
        app.prepare(ctx_id=0, det_size=(640, 640), det_thresh=settings.face_det_thresh)
        _app = app
        logger.info("insightface_model_loaded")
        return _app


@dataclass
class DetectedFace:
    box_x: float
    box_y: float
    box_width: float
    box_height: float
    confidence: float
    embedding: NDArray[np.float32]
    crop: Image.Image


def detect_faces(image: Image.Image) -> list[DetectedFace]:
    app = _load_model()
    img_array = np.array(image.convert("RGB"))
    # InsightFace expects BGR
    img_bgr = img_array[:, :, ::-1]
    faces = app.get(img_bgr)

    h, w = img_array.shape[:2]
    results: list[DetectedFace] = []

    for face in faces:
        if face.embedding is None:
            continue

        bbox = face.bbox.astype(int)
        x1, y1, x2, y2 = bbox[0], bbox[1], bbox[2], bbox[3]

        # Skip faces that are too small — tiny faces produce unreliable embeddings
        face_w = x2 - x1
        face_h = y2 - y1
        if face_w < settings.face_min_size or face_h < settings.face_min_size:
            continue

        # Normalize bounding box to 0-1 range
        box_x = max(0.0, x1 / w)
        box_y = max(0.0, y1 / h)
        box_width = min(1.0, (x2 - x1) / w)
        box_height = min(1.0, (y2 - y1) / h)

        # Crop face with some padding
        pad_x = int((x2 - x1) * 0.2)
        pad_y = int((y2 - y1) * 0.2)
        crop_x1 = max(0, x1 - pad_x)
        crop_y1 = max(0, y1 - pad_y)
        crop_x2 = min(w, x2 + pad_x)
        crop_y2 = min(h, y2 + pad_y)
        crop = image.crop((crop_x1, crop_y1, crop_x2, crop_y2))

        # Normalize embedding
        emb = face.embedding.astype(np.float32)
        emb /= np.linalg.norm(emb)

        results.append(
            DetectedFace(
                box_x=box_x,
                box_y=box_y,
                box_width=box_width,
                box_height=box_height,
                confidence=float(face.det_score),
                embedding=emb,
                crop=crop,
            )
        )

    confidences = [round(float(f.confidence), 3) for f in results]
    logger.info("faces_detected", count=len(results), confidences=confidences)
    return results
