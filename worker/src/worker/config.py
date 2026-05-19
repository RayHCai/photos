from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    redis_url: str = "redis://localhost:6379"
    backend_url: str = "http://localhost:4000"

    worker_port: int = 8001

    clip_model: str = "ViT-B-32"
    clip_pretrained: str = "openai"

    face_det_thresh: float = 0.5
    face_confidence_thresh: float = 0.65
    face_match_thresh: float = 0.45

    service_secret: str = ""

    log_level: str = "info"


settings = Settings()
