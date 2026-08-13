from __future__ import annotations

import asyncio
from collections import Counter

import numpy as np

from worker import backend_client as api
from worker.log import get_logger

logger = get_logger(__name__)

# HDBSCAN accepts only "eom" (excess of mass) or "leaf".
#
# This was "epi", which is not a valid value — HDBSCAN validates it inside fit()
# and raised ValueError on every run, so this job had never once completed and
# face-clustering maintenance silently did nothing for the life of the deployment.
# A unit test pins the parameter (tests/test_recluster.py).
_CLUSTER_SELECTION_METHOD = "eom"

_MIN_FACES_TO_CLUSTER = 5


async def _load_faces() -> tuple[list[str], list[str | None], list[bool], np.ndarray]:
    """Fetch all face embeddings, page by page, into parallel arrays."""
    face_ids: list[str] = []
    person_ids: list[str | None] = []
    manual_flags: list[bool] = []
    embeddings: list[list[float]] = []

    async for page in api.iter_face_embeddings():
        for face in page:
            face_ids.append(face["id"])
            person_ids.append(face["personId"])
            manual_flags.append(bool(face.get("manuallyAssigned", False)))
            embeddings.append(face["embedding"])

    matrix = (
        np.array(embeddings, dtype=np.float32)
        if embeddings
        else np.empty((0, 512), dtype=np.float32)
    )
    return face_ids, person_ids, manual_flags, matrix


def _fit(matrix: np.ndarray) -> np.ndarray:
    """Run HDBSCAN. Pure CPU, so callers push it off the event loop.

    hdbscan is imported here rather than at module scope so the clustering *decision*
    logic below — which is where the name-destroying bug lived — can be imported and
    tested without the ML stack installed.
    """
    from hdbscan import HDBSCAN

    clusterer = HDBSCAN(
        min_cluster_size=2,
        min_samples=1,
        metric="euclidean",
        cluster_selection_method=_CLUSTER_SELECTION_METHOD,
    )
    labels: np.ndarray = clusterer.fit_predict(matrix)
    return labels


async def run_recluster() -> dict[str, int]:
    """Re-cluster face embeddings to merge groups belonging to one person.

    Safety contract: this job may *add* structure but must never destroy a human's
    labelling. It will not move a face marked manuallyAssigned, and it prefers an
    existing *named* person as a cluster's target so a name is never orphaned. The
    backend enforces the same rule independently.
    """
    face_ids, person_ids, manual_flags, matrix = await _load_faces()

    if len(face_ids) < _MIN_FACES_TO_CLUSTER:
        logger.info("recluster_skipped", reason="too_few_faces", count=len(face_ids))
        return {"total_faces": len(face_ids), "clusters": 0, "reassigned": 0}

    # HDBSCAN over tens of thousands of 512-dim vectors is seconds to minutes of
    # pure CPU; on the event loop it blocked the health endpoint and every other
    # job for that whole time.
    labels = await asyncio.to_thread(_fit, matrix)

    num_clusters = len(set(labels.tolist())) - (1 if -1 in labels else 0)

    cluster_map: dict[int, list[int]] = {}
    for idx, label in enumerate(labels):
        if label == -1:
            continue
        cluster_map.setdefault(int(label), []).append(idx)

    named_person_ids = await _named_person_ids()

    targets: dict[int, str | None] = {}
    clusters_needing_new_person: list[int] = []

    for label, indices in cluster_map.items():
        counts = Counter(person_ids[i] for i in indices if person_ids[i] is not None)
        if not counts:
            clusters_needing_new_person.append(label)
            targets[label] = None
            continue

        # Prefer a named person over a bare machine-generated group even if the
        # unnamed one holds more faces: merging into the unnamed person would
        # strand the name.
        named_candidates = [pid for pid in counts if pid in named_person_ids]
        if named_candidates:
            targets[label] = max(named_candidates, key=lambda pid: counts[pid])
        else:
            targets[label] = counts.most_common(1)[0][0]

    new_person_ids: list[str] = []
    if clusters_needing_new_person:
        new_person_ids = await api.batch_create_persons(len(clusters_needing_new_person))

    new_person_idx = 0
    assignments: list[dict[str, str]] = []
    skipped_manual = 0

    for label, indices in cluster_map.items():
        target = targets[label]
        if target is None:
            target = new_person_ids[new_person_idx]
            new_person_idx += 1

        for idx in indices:
            if person_ids[idx] == target:
                continue
            if manual_flags[idx]:
                # A human put this face where it is. Leave it alone.
                skipped_manual += 1
                continue
            assignments.append({"faceId": face_ids[idx], "personId": target})

    reassigned = 0
    if assignments:
        reassigned = await api.batch_reassign_faces(assignments)

    orphans_deleted = await api.delete_orphan_persons()

    logger.info(
        "recluster_completed",
        total_faces=len(face_ids),
        clusters=num_clusters,
        reassigned=reassigned,
        skipped_manual=skipped_manual,
        orphans_deleted=orphans_deleted,
    )

    return {
        "total_faces": len(face_ids),
        "clusters": num_clusters,
        "reassigned": reassigned,
        "skipped_manual": skipped_manual,
    }


async def _named_person_ids() -> set[str]:
    """Ids of persons that carry a user-entered name."""
    persons = await api.list_named_persons()
    return {p["id"] for p in persons if p.get("name")}
