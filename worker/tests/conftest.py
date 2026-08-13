"""Shared test setup.

`worker.config` constructs Settings at import time, and WORKER_SECRET is now required
with a 32-char minimum (it used to default to "" and disable auth). Setting it here —
before any worker module is imported — keeps the suite independent of whatever is in
the developer's .env.
"""

from __future__ import annotations

import os

os.environ.setdefault("WORKER_SECRET", "x" * 32)
os.environ.setdefault("GEOCODING_ENABLED", "false")
