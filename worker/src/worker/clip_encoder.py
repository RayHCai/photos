from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np
import open_clip
import torch
from PIL import Image

from worker.config import settings
from worker.log import get_logger

if TYPE_CHECKING:
    from numpy.typing import NDArray

logger = get_logger(__name__)

_model: torch.nn.Module | None = None
_preprocess: open_clip.transform.image_transform | None = None  # type: ignore[name-defined]
_tokenizer: open_clip.SimpleTokenizer | None = None  # type: ignore[attr-defined]
_device: str = "cuda" if torch.cuda.is_available() else "cpu"


def _load_model() -> (
    tuple[torch.nn.Module, open_clip.transform.image_transform, open_clip.SimpleTokenizer]  # type: ignore[name-defined]
):
    global _model, _preprocess, _tokenizer  # noqa: PLW0603
    if _model is None:
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
