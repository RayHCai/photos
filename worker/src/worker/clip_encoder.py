from __future__ import annotations

import os
import threading
from typing import TYPE_CHECKING

import open_clip
import torch

from worker.config import settings
from worker.log import get_logger

if TYPE_CHECKING:
    import numpy as np
    from numpy.typing import NDArray
    from PIL import Image

logger = get_logger(__name__)

_model: torch.nn.Module | None = None
_preprocess: open_clip.transform.image_transform | None = None  # type: ignore[name-defined]
_tokenizer: open_clip.SimpleTokenizer | None = None  # type: ignore[attr-defined]
_device: str = "cuda" if torch.cuda.is_available() else "cpu"

# Cap intra-op threads so N concurrent worker threads do not each spawn a full
# core-count thread pool and oversubscribe the CPU (which makes everything slower,
# not faster).
if _device == "cpu":
    torch.set_num_threads(max(1, (os.cpu_count() or 2) // max(1, settings.media_concurrency)))


"""Lazy model loading is guarded by a lock and exposed via warm_up().

With media_concurrency > 1 the CPU stages now run in a thread pool, so several
threads could enter _load_model concurrently on the very first job and each build
its own copy of the model — several hundred MB apiece. The lock makes the first
loader win and the rest wait.
"""
_load_lock = threading.Lock()


def is_loaded() -> bool:
    return _model is not None


def warm_up() -> None:
    """Load the model eagerly, so the first real job does not pay for it."""
    _load_model()


def _load_model() -> (
    tuple[torch.nn.Module, open_clip.transform.image_transform, open_clip.SimpleTokenizer]  # type: ignore[name-defined]
):
    global _model, _preprocess, _tokenizer  # noqa: PLW0603
    if _model is not None:
        return _model, _preprocess, _tokenizer  # type: ignore[return-value]

    with _load_lock:
        if _model is not None:
            return _model, _preprocess, _tokenizer  # type: ignore[return-value]
        logger.info(
            "loading_clip_model",
            model=settings.clip_model,
            pretrained=settings.clip_pretrained,
            device=_device,
        )
        _model, _, _preprocess = open_clip.create_model_and_transforms(
            settings.clip_model, pretrained=settings.clip_pretrained
        )
        _model = _model.to(_device).eval()
        _tokenizer = open_clip.get_tokenizer(settings.clip_model)
        logger.info("clip_model_loaded")
    return _model, _preprocess, _tokenizer  # type: ignore[return-value]


def encode_image(image: Image.Image) -> NDArray[np.float32]:
    model, preprocess, _ = _load_model()
    tensor = preprocess(image).unsqueeze(0).to(_device)  # type: ignore[union-attr]
    with torch.no_grad(), torch.amp.autocast(_device):
        features = model.encode_image(tensor)
        features = features / features.norm(dim=-1, keepdim=True)
    return features.cpu().float().numpy().flatten()


def encode_images(images: list[Image.Image]) -> NDArray[np.float32]:
    """Encode multiple images, return averaged + normalized embedding."""
    model, preprocess, _ = _load_model()
    tensors = torch.stack([preprocess(img) for img in images]).to(_device)  # type: ignore[union-attr, misc]
    with torch.no_grad(), torch.amp.autocast(_device):
        features = model.encode_image(tensors)
        features = features / features.norm(dim=-1, keepdim=True)
    avg = features.mean(dim=0)
    avg = avg / avg.norm()
    return avg.cpu().float().numpy().flatten()


def encode_text(text: str) -> NDArray[np.float32]:
    model, _, tokenizer = _load_model()
    tokens = tokenizer(text).to(_device)  # type: ignore[union-attr]
    with torch.no_grad(), torch.amp.autocast(_device):
        features = model.encode_text(tokens)
        features = features / features.norm(dim=-1, keepdim=True)
    return features.cpu().float().numpy().flatten()
