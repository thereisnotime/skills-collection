#!/usr/bin/env python3
"""
Regression tests for memory/engine.py wave-6 bug-hunt fixes.

Each test drives the REAL MemoryEngine against a throwaway tempdir and
asserts one specific failure mode does not recur. The non-vacuity note on
each test states exactly what the pre-fix code would do (the observable
failure the assertion rules out), so a passing run is meaningful rather
than trivially green.

Covered findings:
  M3 -- _detect_task_type crashes on context={"goal": None} (None.lower()).
  H3 -- store_skill path traversal via unsanitized skill name.
  H4 -- lost-update on index.json under concurrent store_episode /
        store_pattern (no single lock spanning read-modify-write).

Run directly:  python3 tests/test_memory_engine_wave6.py
Run via pytest: python3 -m pytest tests/test_memory_engine_wave6.py -q
"""

import tempfile
import threading
from pathlib import Path

import pytest

# Make the repo root importable so `import memory.*` resolves regardless of cwd.
import sys
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from memory.engine import MemoryEngine  # noqa: E402
from memory.schemas import ProceduralSkill  # noqa: E402


def _new_engine(tmpdir: str) -> MemoryEngine:
    """Fresh engine rooted at an isolated tempdir."""
    return MemoryEngine(base_path=Path(tmpdir))


# ---------------------------------------------------------------------------
# M3: None-guard in _detect_task_type
# ---------------------------------------------------------------------------

def test_detect_task_type_explicit_null_goal_does_not_crash() -> None:
    """
    M3: _detect_task_type must tolerate an explicit null goal/action/phase.

    Non-vacuity: pre-fix code did context.get("goal", "").lower(); an
    explicit {"goal": None} makes .get return None (the default only fires
    when the key is ABSENT, not when it is present-but-null), so None.lower()
    raised AttributeError. We assert the call returns a task-type string and
    raises nothing. The retrieval.py sibling was fixed in v7.61.0; this
    asserts the engine.py copy is now fixed too.
    """
    with tempfile.TemporaryDirectory() as tmp:
        engine = _new_engine(tmp)
        # Explicit None for every string field the function touches.
        result = engine._detect_task_type(
            {"goal": None, "action_type": None, "phase": None}
        )
        assert isinstance(result, str) and result, (
            "expected a non-empty task-type string, got %r" % (result,)
        )


def test_detect_task_type_null_goal_still_classifies_from_phase() -> None:
    """
    M3 follow-on: a null goal must not suppress classification from other
    signals. With goal=None but phase='debugging', the result should still
    reflect the debugging signal rather than defaulting blindly.

    Non-vacuity: pre-fix this input crashed before any classification could
    happen, so no meaningful task type could ever be returned.
    """
    with tempfile.TemporaryDirectory() as tmp:
        engine = _new_engine(tmp)
        result = engine._detect_task_type({"goal": None, "phase": "debugging"})
        assert result == "debugging", (
            "phase signal lost when goal is null; got %r" % (result,)
        )


# ---------------------------------------------------------------------------
# H3: store_skill path traversal
# ---------------------------------------------------------------------------

def test_store_skill_path_traversal_is_contained() -> None:
    """
    H3: a skill whose name encodes a traversal must NOT write any file
    outside the memory base_path.

    Non-vacuity: pre-fix code did
        filename = name.lower().replace(" ","-").replace("_","-")
    which left "/" and ".." intact, then raw open(base/"skills"/f"{name}.md").
    With name="../../../tmp/pwned_<unique>" that resolved OUTSIDE base_path,
    creating a .md file in /tmp. We assert (a) no path containing the unique
    marker exists anywhere outside base_path, and (b) the skill is still
    stored somewhere under base_path/skills.
    """
    import uuid

    marker = "pwned_%s" % uuid.uuid4().hex[:8]
    with tempfile.TemporaryDirectory() as tmp:
        engine = _new_engine(tmp)
        base = Path(tmp).resolve()
        # The escape target the pre-fix code would have written to.
        escape_target = (base / "skills" / ".." / ".." / ".." / "tmp" / (marker + ".md")).resolve()

        skill = ProceduralSkill(
            id="skill-traversal-001",
            name="../../../tmp/" + marker,
            description="attempts to escape the memory root",
        )
        engine.store_skill(skill)

        # (a) The escape file must not exist.
        assert not escape_target.exists(), (
            "store_skill wrote a file outside base_path: %s" % escape_target
        )

        # (b) The concrete escape locations a "../" traversal could reach from
        # base/skills must not contain a marker file. We check the specific
        # candidate paths rather than recursively globbing the temp-dir parent:
        # the parent here is the OS temp root (e.g. /private/var/folders/.../X),
        # and a recursive glob over it is both slow and crashes on macOS with
        # OSError Result too large on pseudo entries. The deterministic-target
        # check below is the real assertion; (a) already covers the primary one.
        escape_candidates = [
            base / "skills" / (marker + ".md"),
            base.parent / (marker + ".md"),
            base.parent / "tmp" / (marker + ".md"),
            base.parent.parent / "tmp" / (marker + ".md"),
            Path(tmp).parent / (marker + ".md"),
        ]
        for cand in escape_candidates:
            resolved = cand.resolve()
            if resolved.exists():
                assert base in resolved.parents or resolved == base, (
                    "marker file escaped base_path: %s" % resolved
                )

        # (c) The skill IS persisted, just under a sanitized name within base.
        skills_dir = base / "skills"
        md_files = list(skills_dir.glob("*.md")) if skills_dir.exists() else []
        assert md_files, "skill markdown was not written under base_path/skills"
        for md in md_files:
            # Resolved path stays under base.
            assert base in md.resolve().parents, (
                "skill file resolved outside base: %s" % md
            )
            # Sanitized filename carries no path separators or traversal.
            assert "/" not in md.stem and ".." not in md.stem, (
                "skill filename was not sanitized: %s" % md.name
            )


def test_store_skill_empty_after_sanitize_falls_back_to_id() -> None:
    """
    H3 edge: a name that sanitizes to empty (all separators) must fall back
    to a safe id-derived filename rather than producing ".md" or crashing.

    Non-vacuity: without the empty-fallback a name like "///" would collapse
    to "" and write a hidden ".md" file (or an ambiguous dotfile); the
    fallback guarantees a real, safe basename.
    """
    with tempfile.TemporaryDirectory() as tmp:
        engine = _new_engine(tmp)
        base = Path(tmp).resolve()
        skill = ProceduralSkill(
            id="skill-fallback-xyz",
            name="///",
            description="name collapses to empty after sanitization",
        )
        engine.store_skill(skill)
        skills_dir = base / "skills"
        md_files = list(skills_dir.glob("*.md"))
        assert md_files, "no skill markdown written for collapsing name"
        for md in md_files:
            assert md.stem, "skill filename is empty (dotfile) after sanitize"
            assert base in md.resolve().parents


# ---------------------------------------------------------------------------
# H4: lost-update on index.json under concurrency
# ---------------------------------------------------------------------------

def test_index_update_no_topic_dropped_under_concurrency() -> None:
    """
    H4: concurrent _update_index_with_episode calls, each introducing a
    DISTINCT topic, must all survive in index.json. The lock must span the
    full read-modify-write so no thread's read-then-write clobbers another's.

    Non-vacuity: pre-fix, each call did read_json (lock released) ... mutate
    ... write_json (separate lock). Two threads reading the same base index
    then writing their own topic would each drop the other's topic, so the
    final index would hold far fewer than N topics. We launch N threads
    behind a barrier (to maximize overlap) and assert ALL N distinct topics
    are present and total_memories == N.
    """
    n_threads = 16
    with tempfile.TemporaryDirectory() as tmp:
        engine = _new_engine(tmp)
        barrier = threading.Barrier(n_threads)
        errors: list = []

        def worker(i: int) -> None:
            try:
                barrier.wait()
                engine._update_index_with_episode({
                    "id": "ep-conc-%03d" % i,
                    "context": {"phase": "phase-%03d" % i, "goal": "goal %d" % i},
                    "cost_usd": 0.0,
                    "tokens_used": 0,
                    "files_modified": [],
                })
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(n_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=20)

        assert not errors, "worker raised: %r" % errors
        assert not any(t.is_alive() for t in threads), "thread hung (possible deadlock)"

        index = engine.storage.read_json("index.json") or {}
        topic_ids = {t.get("id") for t in index.get("topics", [])}
        expected = {"phase-%03d" % i for i in range(n_threads)}
        missing = expected - topic_ids
        assert not missing, "lost-update dropped topics: %s" % sorted(missing)
        assert index.get("total_memories") == n_threads, (
            "total_memories=%r, expected %d (lost-update under-count)"
            % (index.get("total_memories"), n_threads)
        )


def test_index_update_same_phase_counts_consistent_under_concurrency() -> None:
    """
    H4: concurrent episodes that all share ONE phase (one topic) must each be
    counted exactly once -- episode_count and episode_ids must equal N.

    Non-vacuity: pre-fix, concurrent read-modify-write on the same topic loses
    increments: two threads read episode_count=k, both write k+1, so one
    increment vanishes. episode_count would end below N and some episode_ids
    would be missing. We assert episode_count == N and all N ids are present.
    """
    n_threads = 16
    with tempfile.TemporaryDirectory() as tmp:
        engine = _new_engine(tmp)
        barrier = threading.Barrier(n_threads)
        errors: list = []

        def worker(i: int) -> None:
            try:
                barrier.wait()
                engine._update_index_with_episode({
                    "id": "ep-shared-%03d" % i,
                    "context": {"phase": "shared", "goal": "goal %d" % i},
                    "cost_usd": 1.0,
                    "tokens_used": 10,
                    "files_modified": [],
                })
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(n_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=20)

        assert not errors, "worker raised: %r" % errors
        assert not any(t.is_alive() for t in threads), "thread hung (possible deadlock)"

        index = engine.storage.read_json("index.json") or {}
        shared = next((t for t in index.get("topics", []) if t.get("id") == "shared"), None)
        assert shared is not None, "shared topic missing entirely"
        ids = set(shared.get("episode_ids", []))
        expected_ids = {"ep-shared-%03d" % i for i in range(n_threads)}
        assert ids == expected_ids, (
            "lost episode_ids under concurrency; missing=%s"
            % sorted(expected_ids - ids)
        )
        assert shared.get("episode_count") == n_threads, (
            "episode_count=%r, expected %d (lost increment)"
            % (shared.get("episode_count"), n_threads)
        )
        # Totals scale with N too (each contributed cost 1.0 / 10 tokens).
        assert shared.get("total_cost_usd") == float(n_threads)
        assert shared.get("total_tokens") == 10 * n_threads


def test_index_update_pattern_no_topic_dropped_under_concurrency() -> None:
    """
    H4 (pattern path): concurrent _update_index_with_pattern with distinct
    categories must keep all topics and a correct total_memories.

    Non-vacuity: same lost-update mechanism as the episode path -- pre-fix the
    pattern updater also released its read lock before writing, so concurrent
    distinct categories clobbered each other.
    """
    n_threads = 16
    with tempfile.TemporaryDirectory() as tmp:
        engine = _new_engine(tmp)
        barrier = threading.Barrier(n_threads)
        errors: list = []

        def worker(i: int) -> None:
            try:
                barrier.wait()
                engine._update_index_with_pattern({
                    "category": "cat-%03d" % i,
                    "pattern": "p %d" % i,
                    "confidence": 0.5,
                })
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(n_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=20)

        assert not errors, "worker raised: %r" % errors
        assert not any(t.is_alive() for t in threads), "thread hung (possible deadlock)"

        index = engine.storage.read_json("index.json") or {}
        topic_ids = {t.get("id") for t in index.get("topics", [])}
        expected = {"cat-%03d" % i for i in range(n_threads)}
        missing = expected - topic_ids
        assert not missing, "lost-update dropped pattern topics: %s" % sorted(missing)
        assert index.get("total_memories") == n_threads, (
            "total_memories=%r, expected %d" % (index.get("total_memories"), n_threads)
        )


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
