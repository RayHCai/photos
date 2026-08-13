from __future__ import annotations

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    redis_url: str = "redis://localhost:6379"
    backend_url: str = "http://localhost:4000"

    worker_port: int = 8001

    clip_model: str = "ViT-B-32"
    clip_pretrained: str = "openai"

    # Face detection / assignment thresholds.
    #
    # NB: face_match_thresh is a *distance* threshold (matched when
    # distance < threshold), so a lower value makes matching stricter and
    # over-splits one person into several. The shipped .env.example used to set
    # values contradicting these defaults in exactly that direction, silently
    # changing recognition behaviour between deployments.
    face_det_thresh: float = 0.6
    face_confidence_thresh: float = 0.72
    face_new_person_thresh: float = 0.87
    face_match_thresh: float = 0.55
    face_min_size: int = 50

    # Shared secret for the backend <-> worker internal API.
    #
    # Required, with no usable default. It used to default to "" and both sides
    # treated an empty value as "auth disabled", so the documented configuration
    # left the entire internal surface unauthenticated. Read from WORKER_SECRET so
    # one value configures both services — the two previously used different
    # variable names, and setting only one silently disabled auth on that side.
    service_secret: str = Field(min_length=32, validation_alias="WORKER_SECRET")

    # Concurrent media jobs. CPU-bound stages run in a thread pool sized from
    # this, so it also bounds peak decoded-image memory.
    media_concurrency: int = 3

    # Hard ceiling on decoded pixels, as a decompression-bomb guard for
    # user-supplied images. 120 MP covers any real camera or phone panorama.
    max_image_pixels: int = 120_000_000

    # Reverse geocoding is off by default: it sends photo GPS coordinates to a
    # third party. Point geocode_provider_url at a self-hosted Nominatim to keep
    # location data in-house.
    geocoding_enabled: bool = False
    geocode_provider_url: str = "https://nominatim.openstreetmap.org/reverse"
    # Nominatim's usage policy requires a real contact address in the User-Agent.
    geocode_user_agent: str = "photos-app/1.0"

    log_level: str = "info"

    @field_validator("log_level")
    @classmethod
    def _validate_log_level(cls, v: str) -> str:
        """Reject unknown levels at startup.

        `logging.getLevelName` returns the *string* "Level FOO" for an unknown
        name, which structlog then compares against an int — so a typo used to
        crash the worker at import with an unrelated TypeError.
        """
        allowed = {"critical", "error", "warning", "warn", "info", "debug", "notset"}
        normalized = v.strip().lower()
        if normalized not in allowed:
            raise ValueError(f"log_level must be one of {sorted(allowed)}, got {v!r}")
        return normalized


settings = Settings()
