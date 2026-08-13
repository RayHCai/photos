"""Regression tests for the face reclustering job.

Two defects:

  1. `cluster_selection_method="epi"` is not a valid HDBSCAN value — it accepts only
     "eom" or "leaf" — so `fit_predict` raised ValueError on *every* run. The weekly
     cron and every manual trigger had never once completed, silently, for the life of
     the deployment.

  2. Once it did run, it reassigned every non-majority face in a cluster to the modal
     person and then hard-deleted the losers, with no way to tell a human's assignment
     from a machine guess — so a single run could destroy named people.

hdbscan is not imported here: the first test asserts the *parameter*, and the rest
inject a labelling so the clustering decision logic can be exercised without the ML
stack (which is also why `_fit` is a separate function).
"""

from __future__ import annotations

import numpy as np
import pytest

from worker import recluster as recluster_module


def test_cluster_selection_method_is_valid() -> None:
    """Pins the parameter that made this job crash on every single run.

    HDBSCAN validates this inside fit(), so an invalid value is not a typo that
    degrades behaviour — it is a hard failure with no output at all.
    """
    assert recluster_module._CLUSTER_SELECTION_METHOD in {"eom", "leaf"}


class _FakeApi:
    """Records what the job asks the backend to do."""

    def __init__(
        self,
        faces: list[dict[str, object]],
        named: list[dict[str, object]] | None = None,
    ) -> None:
        self._faces = faces
        self._named = named or []
        self.reassignments: list[dict[str, str]] = []
        self.created_persons = 0
        self.orphans_deleted = 0

    async def iter_face_embeddings(self):
        if self._faces:
            yield self._faces

    async def list_named_persons(self) -> list[dict[str, object]]:
        return self._named

    async def batch_create_persons(self, count: int) -> list[str]:
        self.created_persons += count
        return [f"new-person-{i}" for i in range(count)]

    async def batch_reassign_faces(self, assignments: list[dict[str, str]]) -> int:
        self.reassignments.extend(assignments)
        return len(assignments)

    async def delete_orphan_persons(self) -> int:
        self.orphans_deleted += 1
        return 0


def _face(
    face_id: str,
    person_id: str | None,
    *,
    manual: bool = False,
    vector: float = 0.0,
) -> dict[str, object]:
    return {
        "id": face_id,
        "personId": person_id,
        "manuallyAssigned": manual,
        "embedding": [vector] * 512,
    }


@pytest.fixture
def patched(monkeypatch: pytest.MonkeyPatch):
    """Installs a fake API and a deterministic clustering result."""

    def _install(faces: list[dict[str, object]], labels: list[int], named=None) -> _FakeApi:
        api = _FakeApi(faces, named)
        monkeypatch.setattr(recluster_module, "api", api)
        monkeypatch.setattr(
            recluster_module, "_fit", lambda _matrix: np.array(labels, dtype=np.int64)
        )
        return api

    return _install


async def test_skips_when_too_few_faces(patched) -> None:
    api = patched([_face("f1", None)], [0])

    stats = await recluster_module.run_recluster()

    assert stats["total_faces"] == 1
    assert api.reassignments == []


async def test_merges_cluster_onto_majority_person(patched) -> None:
    """Three faces of one person plus one mislabelled: the odd one moves."""
    faces = [
        _face("f1", "person-a"),
        _face("f2", "person-a"),
        _face("f3", "person-a"),
        _face("f4", "person-b"),
        _face("f5", "person-a"),
    ]
    api = patched(faces, [0, 0, 0, 0, 0])

    await recluster_module.run_recluster()

    assert api.reassignments == [{"faceId": "f4", "personId": "person-a"}]


async def test_never_moves_a_manually_assigned_face(patched) -> None:
    """A human put f4 where it is. The cron must leave it alone."""
    faces = [
        _face("f1", "person-a"),
        _face("f2", "person-a"),
        _face("f3", "person-a"),
        _face("f4", "person-b", manual=True),
        _face("f5", "person-a"),
    ]
    api = patched(faces, [0, 0, 0, 0, 0])

    stats = await recluster_module.run_recluster()

    assert api.reassignments == []
    assert stats["skipped_manual"] == 1


async def test_prefers_a_named_person_over_a_larger_unnamed_group(patched) -> None:
    """The name is the only user-entered data here, so it must survive the merge.

    person-b holds more faces, but person-a is named — merging into person-b would
    strand the name and then delete it as an orphan.
    """
    faces = [
        _face("f1", "person-a"),
        _face("f2", "person-b"),
        _face("f3", "person-b"),
        _face("f4", "person-b"),
        _face("f5", "person-b"),
    ]
    api = patched(faces, [0, 0, 0, 0, 0], named=[{"id": "person-a", "name": "Ada"}])

    await recluster_module.run_recluster()

    assert {r["personId"] for r in api.reassignments} == {"person-a"}
    assert {r["faceId"] for r in api.reassignments} == {"f2", "f3", "f4", "f5"}


async def test_creates_a_person_for_an_entirely_unassigned_cluster(patched) -> None:
    faces = [_face(f"f{i}", None) for i in range(1, 6)]
    api = patched(faces, [0, 0, 0, 0, 0])

    await recluster_module.run_recluster()

    assert api.created_persons == 1
    assert {r["personId"] for r in api.reassignments} == {"new-person-0"}


async def test_noise_labels_are_ignored(patched) -> None:
    """-1 is HDBSCAN's noise label; those faces must not be forced into a cluster."""
    faces = [
        _face("f1", "person-a"),
        _face("f2", "person-a"),
        _face("f3", "person-a"),
        _face("f4", "person-b"),
        _face("f5", "person-b"),
    ]
    api = patched(faces, [0, 0, 0, -1, -1])

    await recluster_module.run_recluster()

    # f4 and f5 are noise, so nothing about person-b is touched.
    assert api.reassignments == []


async def test_faces_already_on_the_target_are_not_reassigned(patched) -> None:
    faces = [_face(f"f{i}", "person-a") for i in range(1, 6)]
    api = patched(faces, [0, 0, 0, 0, 0])

    await recluster_module.run_recluster()

    assert api.reassignments == []
