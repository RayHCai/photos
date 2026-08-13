"""Cross-service contract checks.

The pipeline stage list existed in four hand-maintained copies (worker/pipeline.py,
backend queue.service.ts, media.service.ts, and internal.routes.ts) and had already
drifted: the internal-route copy omitted 'metadata', so a retry requesting that stage
was rejected by zod and surfaced to the operator as an opaque 500.

The backend now derives its three copies from one constant. This test pins the Python
copy against that constant by parsing the TypeScript source, so the two languages
cannot silently diverge again.

Parsing rather than importing because there is no Node runtime inside the Python test
process — a brittle-but-checked link is still far better than the unchecked duplication
it replaces. The Python copies live in worker/stages.py, which imports nothing beyond
the standard library, so this contract can be asserted without torch or bullmq present.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

_BACKEND_CONSTANTS = (
    Path(__file__).resolve().parents[2] / "backend" / "src" / "constants" / "pipeline.ts"
)


def _parse_ts_string_array(source: str, name: str) -> list[str]:
    match = re.search(rf"export const {name} = \[(.*?)\] as const;", source, re.S)
    if match is None:
        raise AssertionError(f"could not find `export const {name}` in pipeline.ts")
    return re.findall(r"'([^']+)'", match.group(1))


@pytest.mark.skipif(
    not _BACKEND_CONSTANTS.exists(),
    reason="backend source not present (worker checked out standalone)",
)
def test_pipeline_stages_match_backend() -> None:
    from worker.stages import STAGES

    backend_stages = _parse_ts_string_array(
        _BACKEND_CONSTANTS.read_text(encoding="utf-8"), "PIPELINE_STAGES"
    )

    assert list(STAGES) == backend_stages, (
        "worker STAGES and backend PIPELINE_STAGES have diverged. "
        "A stage the backend can enqueue but the worker does not handle leaves the "
        "media row stuck in PROCESSING; a stage the worker accepts but the backend's "
        "zod enum rejects surfaces as an opaque 500."
    )


@pytest.mark.skipif(
    not _BACKEND_CONSTANTS.exists(),
    reason="backend source not present",
)
def test_job_lock_duration_matches_backend() -> None:
    """The worker's BullMQ lockDuration must match what the backend documents.

    The default 30s lapsed during a 4K transcode, so the stalled-job checker
    re-delivered the item and it was processed twice — duplicate streaming keys and
    duplicate face rows.
    """
    from worker.stages import LOCK_DURATION_MS

    source = _BACKEND_CONSTANTS.read_text(encoding="utf-8")
    match = re.search(r"JOB_LOCK_DURATION_MS = ([\d\s*_]+);", source)
    assert match is not None, "JOB_LOCK_DURATION_MS not found in pipeline.ts"

    # The literal is a product of integers (e.g. `15 * 60 * 1000`); multiply the
    # factors rather than eval'ing source text.
    factors = [int(part) for part in match.group(1).replace("_", "").split("*")]
    backend_ms = 1
    for factor in factors:
        backend_ms *= factor

    assert backend_ms == LOCK_DURATION_MS
