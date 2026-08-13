"""Pipeline stage identifiers and job-lock timing.

The mirror of backend/src/constants/pipeline.ts. Kept in its own module — with no
imports beyond the standard library — so the cross-language contract can be asserted
without pulling in torch, insightface or bullmq. tests/test_pipeline_contract.py
enforces that the two lists stay identical.

The list previously existed in four hand-maintained copies and had already drifted: the
backend's internal-route copy omitted 'metadata', so a retry for that stage was rejected
by zod and surfaced to the operator as an opaque 500.
"""

from __future__ import annotations

from typing import Literal

Stage = Literal[
    "full", "clip", "faces", "blurhash", "transcode", "web", "thumbnail-ladder", "metadata"
]

#: Must equal backend PIPELINE_STAGES, in order.
STAGES: tuple[Stage, ...] = (
    "full",
    "clip",
    "faces",
    "blurhash",
    "transcode",
    "web",
    "thumbnail-ladder",
    "metadata",
)

#: Longest a single stage may hold its BullMQ lock. Must exceed the worst-case
#: duration of any one stage (a long re-encode). The 30s default lapsed mid-transcode,
#: so the stalled-job checker re-delivered the item and it was processed twice —
#: duplicate streaming keys and duplicate face rows.
#:
#: Must equal backend JOB_LOCK_DURATION_MS.
LOCK_DURATION_MS = 15 * 60 * 1000
