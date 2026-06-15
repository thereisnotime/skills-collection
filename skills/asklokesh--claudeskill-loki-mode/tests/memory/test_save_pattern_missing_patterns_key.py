"""
Regression test for MemoryStorage.save_pattern when patterns.json lacks the
"patterns" key.

Bug (v7.41.5, LOW defensive): save_pattern's upsert loop subscripted
patterns_file["patterns"] directly. If patterns.json already existed and was
valid JSON but had no "patterns" key (a partial/external write, an alternate
schema, or a {"version": ...}-only file), this raised KeyError. The atomic
write never ran, so the pattern was silently lost while the caller believed the
save succeeded (it expected the returned pattern_id to be persisted).

Other sites (load_pattern, list_patterns, update_pattern) already used
.get("patterns", []) safely; save_pattern was the isolated inconsistency.

Fix: patterns_file.setdefault("patterns", []) before the upsert loop, so the
loop, the index-write, and the append all operate on an ensured list.

These tests:
  1. Pre-seed patterns.json with {"version": "1.1.0"} (no "patterns" key),
     save a pattern, and assert it persists (read back via load_pattern).
  2. Confirm a normal save into a well-formed file still works (no regression).
  3. Confirm a save into a completely empty/new dir still works.
"""

import json
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from memory.schemas import SemanticPattern  # noqa: E402
from memory.storage import MemoryStorage  # noqa: E402


def _make_pattern(pattern_id: str = "sem-test-001") -> SemanticPattern:
    return SemanticPattern(
        id=pattern_id,
        pattern="Ensure the patterns key exists before upsert",
        category="error-handling",
        conditions=["partial write", "alternate schema"],
        correct_approach="setdefault patterns list",
        confidence=0.85,
        source_episodes=["ep-1"],
        usage_count=1,
    )


@pytest.fixture
def storage(tmp_path):
    return MemoryStorage(base_path=str(tmp_path / "memory"))


def _patterns_path(storage: MemoryStorage) -> Path:
    return storage.base_path / "semantic" / "patterns.json"


def test_save_pattern_into_file_missing_patterns_key_persists(storage):
    """A valid-JSON patterns.json with no 'patterns' key must not lose the save."""
    patterns_path = _patterns_path(storage)
    patterns_path.parent.mkdir(parents=True, exist_ok=True)

    # Pre-existing file: valid JSON, version-only, no "patterns" key.
    with open(patterns_path, "w") as f:
        json.dump({"version": "1.1.0"}, f)

    pattern = _make_pattern("sem-missing-key-001")
    returned_id = storage.save_pattern(pattern)

    assert returned_id == "sem-missing-key-001"

    # The save must have persisted: read it back from disk.
    loaded = storage.load_pattern("sem-missing-key-001")
    assert loaded is not None
    assert loaded.get("id") == "sem-missing-key-001"
    assert loaded.get("pattern") == pattern.pattern

    # The on-disk structure must now have a populated patterns list and have
    # preserved the original version field.
    with open(patterns_path, "r") as f:
        on_disk = json.load(f)
    assert isinstance(on_disk.get("patterns"), list)
    assert len(on_disk["patterns"]) == 1
    assert on_disk.get("version") == "1.1.0"


def test_save_pattern_into_well_formed_file_still_works(storage):
    """No regression: a normal save into a well-formed file appends correctly."""
    first = _make_pattern("sem-normal-001")
    second = _make_pattern("sem-normal-002")
    second.pattern = "A second distinct pattern"

    storage.save_pattern(first)
    storage.save_pattern(second)

    loaded_first = storage.load_pattern("sem-normal-001")
    loaded_second = storage.load_pattern("sem-normal-002")
    assert loaded_first is not None and loaded_first.get("id") == "sem-normal-001"
    assert loaded_second is not None and loaded_second.get("id") == "sem-normal-002"

    with open(_patterns_path(storage), "r") as f:
        on_disk = json.load(f)
    assert len(on_disk["patterns"]) == 2


def test_save_pattern_upsert_into_well_formed_file(storage):
    """An upsert (same id) updates in place rather than duplicating."""
    pattern = _make_pattern("sem-upsert-001")
    storage.save_pattern(pattern)

    pattern.pattern = "Updated approach text"
    storage.save_pattern(pattern)

    with open(_patterns_path(storage), "r") as f:
        on_disk = json.load(f)
    assert len(on_disk["patterns"]) == 1
    assert on_disk["patterns"][0]["pattern"] == "Updated approach text"


def test_save_pattern_into_new_directory_still_works(storage):
    """No regression: saving with no pre-existing file creates it cleanly."""
    pattern = _make_pattern("sem-fresh-001")
    storage.save_pattern(pattern)

    loaded = storage.load_pattern("sem-fresh-001")
    assert loaded is not None
    assert loaded.get("id") == "sem-fresh-001"
