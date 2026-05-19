from __future__ import annotations

import numpy as np
from hdbscan import HDBSCAN

from worker import backend_client as api
from worker.log import get_logger

logger = get_logger(__name__)


async def run_recluster() -> dict[str, int]:
    """Run HDBSCAN over all face embeddings to surface merge/split candidates.

    Updates person assignments for faces that clearly belong to the same cluster.
    Returns stats about the clustering run.
    """
    faces_data = await api.get_all_face_embeddings()

    if len(faces_data) < 5:
        logger.info("recluster_skipped", reason="too_few_faces", count=len(faces_data))
        return {"total_faces": len(faces_data), "clusters": 0, "reassigned": 0}

    face_ids: list[str] = []
    person_ids: list[str | None] = []
    embeddings: list[list[float]] = []

    for face in faces_data:
        face_ids.append(face["id"])
        person_ids.append(face["personId"])
        embeddings.append(face["embedding"])

    matrix = np.array(embeddings, dtype=np.float32)

    clusterer = HDBSCAN(
        min_cluster_size=2,
        min_samples=1,
        metric="euclidean",
        cluster_selection_method="epi",
    )
    labels = clusterer.fit_predict(matrix)

    num_clusters = len(set(labels)) - (1 if -1 in labels else 0)

    # Group faces by cluster label
    cluster_map: dict[int, list[int]] = {}
    for idx, label in enumerate(labels):
        if label == -1:
            continue
        cluster_map.setdefault(label, []).append(idx)

    # Determine how many new persons we need to create
    clusters_needing_new_person: list[int] = []
    for label, indices in cluster_map.items():
        existing_persons: dict[str, int] = {}
        for idx in indices:
            pid = person_ids[idx]
            if pid:
                existing_persons[pid] = existing_persons.get(pid, 0) + 1
        if not existing_persons:
            clusters_needing_new_person.append(label)

    # Batch create all needed persons
    new_person_ids: list[str] = []
    if clusters_needing_new_person:
        new_person_ids = await api.batch_create_persons(len(clusters_needing_new_person))

    # Build reassignment list
    new_person_idx = 0
    assignments: list[dict[str, str]] = []

    for label, indices in cluster_map.items():
        # Find the most common existing person_id in this cluster
        existing_persons: dict[str, int] = {}
        for idx in indices:
            pid = person_ids[idx]
            if pid:
                existing_persons[pid] = existing_persons.get(pid, 0) + 1

        if existing_persons:
            target_person = max(existing_persons, key=existing_persons.get)  # type: ignore[arg-type]
        else:
            target_person = new_person_ids[new_person_idx]
            new_person_idx += 1

        # Reassign faces that don't match the target person
        for idx in indices:
            if person_ids[idx] != target_person:
                assignments.append({"faceId": face_ids[idx], "personId": target_person})

    # Batch reassign all faces
    reassigned = 0
    if assignments:
        reassigned = await api.batch_reassign_faces(assignments)

    # Clean up persons that lost all their faces during reassignment
    orphans_deleted = await api.delete_orphan_persons()

    logger.info(
        "recluster_completed",
        total_faces=len(face_ids),
        clusters=num_clusters,
        reassigned=reassigned,
        orphans_deleted=orphans_deleted,
    )

    return {
        "total_faces": len(face_ids),
        "clusters": num_clusters,
        "reassigned": reassigned,
    }
