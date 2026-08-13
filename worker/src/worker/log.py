from __future__ import annotations

import logging
from typing import cast

import structlog

from worker.config import settings

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.format_exc_info,
        # Human-readable only at debug level; everything else emits JSON that an
        # aggregator can parse. The comparison is against the validated, lowercased
        # value from Settings, so "DEBUG" now works too.
        structlog.dev.ConsoleRenderer()
        if settings.log_level == "debug"
        else structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(
        logging.getLevelName(settings.log_level.upper())
    ),
)


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    # structlog.get_logger is annotated as returning Any, so under strict mode this
    # needs a cast rather than an ignore: the concrete type is whatever
    # wrapper_class was configured with above.
    return cast("structlog.stdlib.BoundLogger", structlog.get_logger(name))
