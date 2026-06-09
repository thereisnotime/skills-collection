#!/opt/homebrew/bin/python3.12
"""
Unit tests for hybrid codebase retrieval (Release 3, slices 1 + 2).

Covers the PURE logic so the suite runs without a live ChromaDB:
    - manifest diff (add / modify / rename / delete -> upsert + orphan delete)
    - staleness detection (mtime mismatch, deleted file)
    - reciprocal rank fusion determinism + dedup by file:line
    - budget truncation never exceeds and skips-and-continues on oversize
    - grep-only fallback returns results when semantic is unavailable

Live-ChromaDB parts are skipped cleanly (printed SKIP) when the container is
absent; the pure-logic assertions always run. Exit code is non-zero on any
failure so the bash wrapper / run-all-tests.sh can gate on it.
"""

import importlib.util
import os
import sys
import tempfile
from pathlib import Path

try:
    import pytest
except ImportError:  # the __main__ harness path does not need pytest
    pytest = None

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "tools"))

PASSED = 0
FAILED = 0


def check(name, cond):
    # Records for the __main__ harness summary AND raises so pytest sees a real
    # failure (pytest treats a non-raising test as passed regardless of prints).
    global PASSED, FAILED
    if cond:
        PASSED += 1
        print(f"  PASS: {name}")
    else:
        FAILED += 1
        print(f"  FAIL: {name}")
        raise AssertionError(name)


# pytest fixtures. The same loaders feed the __main__ harness via main(), so the
# file runs under bare `pytest -q` (local-ci) and `python3 test_hybrid_search.py`.
if pytest is not None:
    @pytest.fixture
    def idx():
        mod = _load_indexer()
        if mod is None:
            pytest.skip("index-codebase.py unavailable (chromadb import failed)")
        return mod

    @pytest.fixture
    def hs():
        return _load_hybrid()


def _load_indexer():
    """Load tools/index-codebase.py as a module (handles the hyphen in name).

    chromadb is imported at module top; if it is missing we skip the indexer
    tests but still run the fusion/budget tests.
    """
    spec = importlib.util.spec_from_file_location(
        "loki_index_codebase", str(REPO_ROOT / "tools" / "index-codebase.py"))
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
        return mod
    except Exception as e:
        print(f"  SKIP indexer tests (cannot import index-codebase.py: {e})")
        return None


def _load_hybrid():
    spec = importlib.util.spec_from_file_location(
        "loki_hybrid_search", str(REPO_ROOT / "tools" / "hybrid_search.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# -----------------------------------------------------------------------------
# Slice 1: manifest diff
# -----------------------------------------------------------------------------

def test_manifest_diff(idx):
    print("test_manifest_diff:")
    old = {
        "version": 1,
        "files": {
            "a.py": {"mtime": 1.0, "sha1": "aaa",
                     "chunk_ids": ["a.py::foo", "a.py::bar"]},
            "b.py": {"mtime": 2.0, "sha1": "bbb",
                     "chunk_ids": ["b.py::baz"]},
            "gone.py": {"mtime": 3.0, "sha1": "ggg",
                        "chunk_ids": ["gone.py::old"]},
        },
    }

    # a.py modified: bar removed, qux added. b.py untouched (not re-chunked).
    # new.py added. gone.py deleted from disk.
    current = [
        ("a.py", {"mtime": 9.0, "sha1": "zzz",
                  "chunk_ids": ["a.py::foo", "a.py::qux"]}),
        ("new.py", {"mtime": 9.0, "sha1": "nnn",
                    "chunk_ids": ["new.py::hello"]}),
    ]
    present = {"a.py", "b.py", "new.py"}  # gone.py absent from disk

    diff = idx.compute_manifest_diff(old, current, present)

    check("modified file upserts new chunks",
          "a.py::foo" in diff["upsert_ids"] and "a.py::qux" in diff["upsert_ids"])
    check("renamed/removed function is orphan-deleted",
          "a.py::bar" in diff["delete_ids"])
    check("added file upserts its chunk",
          "new.py::hello" in diff["upsert_ids"])
    check("deleted-from-disk file drops all its chunks",
          "gone.py::old" in diff["delete_ids"])
    check("untouched not-rechunked file is not deleted",
          "b.py::baz" not in diff["delete_ids"])
    check("delete_ids deduped + sorted",
          diff["delete_ids"] == sorted(set(diff["delete_ids"])))
    check("changed_files reflects re-chunked set",
          set(diff["changed_files"]) == {"a.py", "new.py"})
    check("removed_files reflects on-disk deletions",
          diff["removed_files"] == ["gone.py"])


def test_file_is_changed(idx):
    print("test_file_is_changed:")
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / "x.py"
        f.write_text("def a():\n    pass\n")
        rel = "x.py"
        sha = idx.file_sha1(f)
        mt = os.path.getmtime(f)
        manifest = {"files": {rel: {"mtime": mt, "sha1": sha, "chunk_ids": []}}}

        check("unchanged file -> not changed",
              idx.file_is_changed(f, rel, manifest) is False)
        check("file absent from manifest -> changed",
              idx.file_is_changed(f, "other.py", manifest) is True)

        # Content change with same mtime -> sha1 catches it.
        manifest2 = {"files": {rel: {"mtime": mt, "sha1": "different",
                                     "chunk_ids": []}}}
        check("content change (sha1 differs) -> changed",
              idx.file_is_changed(f, rel, manifest2) is True)


class _FakeCollection:
    """Minimal stand-in for a ChromaDB collection.

    Records delete/upsert calls so index_changed can be driven end-to-end
    without a live ChromaDB. Mirrors the attributes index_changed touches:
    .name, .delete(ids=...), .upsert(ids=, documents=, metadatas=).
    """

    def __init__(self, name="fake"):
        self.name = name
        self.deleted_ids = []
        self.upserted_ids = []

    def delete(self, ids=None):
        self.deleted_ids.extend(ids or [])

    def upsert(self, ids=None, documents=None, metadatas=None):
        self.upserted_ids.extend(ids or [])


def test_index_changed_integration(idx):
    print("test_index_changed_integration:")
    # Drive index_changed against a temp project so the live orchestration path
    # (file_is_changed loop, compute_manifest_diff, collection.delete/upsert,
    # save_manifest) runs end-to-end with a fake collection. This catches
    # integration bugs the isolated diff test cannot.
    import json as _json
    with tempfile.TemporaryDirectory() as d:
        proj = Path(d)
        manifest_path = proj / "manifest.json"

        # A python file with two functions.
        target = proj / "mod.py"
        target.write_text("def alpha():\n    return 1\n\n\ndef beta():\n    return 2\n")

        # Monkeypatch the indexer's PROJECT_ROOT, MANIFEST_PATH, and collect_files
        # so it operates on our temp project. Restore afterward.
        orig_root = idx.PROJECT_ROOT
        orig_manifest = idx.MANIFEST_PATH
        orig_collect = idx.collect_files
        try:
            idx.PROJECT_ROOT = proj
            idx.MANIFEST_PATH = manifest_path
            idx.collect_files = lambda: [(target, "python")]

            col = _FakeCollection("temp-collection")
            # First run: file is new -> both functions upserted, nothing deleted.
            changed, removed, upserted, deleted = idx.index_changed(col)
            check("first run reports file changed", changed == 1)
            check("first run upserts chunks", upserted >= 2)
            check("first run deletes nothing", deleted == 0)
            check("manifest written after first run", manifest_path.exists())

            man = _json.loads(manifest_path.read_text())
            check("manifest tracks the file", "mod.py" in man["files"])
            first_ids = set(man["files"]["mod.py"]["chunk_ids"])
            check("manifest records both function chunks",
                  any("alpha" in i for i in first_ids)
                  and any("beta" in i for i in first_ids))

            # Second run, no change -> nothing happens (mtime+sha1 match).
            col2 = _FakeCollection("temp-collection")
            changed2, _, upserted2, deleted2 = idx.index_changed(col2)
            check("unchanged second run re-chunks nothing", changed2 == 0)
            check("unchanged second run upserts nothing", upserted2 == 0)

            # Rename beta -> gamma (real edit): beta's chunk must be orphan-deleted.
            target.write_text("def alpha():\n    return 1\n\n\ndef gamma():\n    return 3\n")
            os.utime(target, (target.stat().st_atime, target.stat().st_mtime + 5))
            col3 = _FakeCollection("temp-collection")
            changed3, _, upserted3, deleted3 = idx.index_changed(col3)
            check("rename re-chunks the file", changed3 == 1)
            beta_orphan = any("beta" in i for i in col3.deleted_ids)
            check("renamed function chunk is orphan-deleted", beta_orphan)
            gamma_added = any("gamma" in i for i in col3.upserted_ids)
            check("new function chunk is upserted", gamma_added)

            man3 = _json.loads(manifest_path.read_text())
            ids3 = man3["files"]["mod.py"]["chunk_ids"]
            check("manifest no longer references removed function",
                  not any("beta" in i for i in ids3))

            # Delete the file from disk -> all its chunks dropped, dropped from manifest.
            target.unlink()
            idx.collect_files = lambda: []
            col4 = _FakeCollection("temp-collection")
            _, removed4, _, deleted4 = idx.index_changed(col4)
            check("deleted file is reported removed", removed4 == 1)
            check("deleted file drops all chunks", deleted4 >= 1)
            man4 = _json.loads(manifest_path.read_text())
            check("manifest drops the removed file", "mod.py" not in man4["files"])
        finally:
            idx.PROJECT_ROOT = orig_root
            idx.MANIFEST_PATH = orig_manifest
            idx.collect_files = orig_collect


def test_staleness(idx):
    print("test_staleness:")
    with tempfile.TemporaryDirectory() as d:
        manifest_path = Path(d) / "manifest.json"

        # Missing manifest -> not stale (fresh repo happy path).
        res = idx.check_staleness(manifest_path)
        check("missing manifest -> not stale", res["stale"] is False)
        check("missing manifest -> manifest_present False",
              res["manifest_present"] is False)

        # Build a manifest pointing at real files under REPO_ROOT.
        real_rel = "tools/hybrid_search.py"
        real_abs = REPO_ROOT / real_rel
        good_mtime = os.path.getmtime(real_abs)
        import json as _json
        manifest_path.write_text(_json.dumps({
            "version": 1,
            "files": {real_rel: {"mtime": good_mtime, "sha1": "x",
                                 "chunk_ids": []}},
        }))
        res = idx.check_staleness(manifest_path)
        check("matching mtime -> not stale", res["stale"] is False)

        # Now record a wrong mtime -> stale.
        manifest_path.write_text(_json.dumps({
            "version": 1,
            "files": {real_rel: {"mtime": good_mtime - 99999, "sha1": "x",
                                 "chunk_ids": []}},
        }))
        res = idx.check_staleness(manifest_path)
        check("mtime mismatch -> stale", res["stale"] is True)
        check("stale_files counts the mismatched file", res["stale_files"] == 1)

        # A manifest referencing a nonexistent file -> stale (deleted).
        manifest_path.write_text(_json.dumps({
            "version": 1,
            "files": {"does/not/exist.py": {"mtime": 1.0, "sha1": "x",
                                            "chunk_ids": []}},
        }))
        res = idx.check_staleness(manifest_path)
        check("deleted file -> stale", res["stale"] is True)


# -----------------------------------------------------------------------------
# Slice 2: RRF, dedup, budget, fallback
# -----------------------------------------------------------------------------

def test_rrf_determinism(hs):
    print("test_rrf_determinism:")
    grep = [
        {"file": "a.py", "line": 10, "snippet": "g1"},
        {"file": "b.py", "line": 20, "snippet": "g2"},
    ]
    sem = [
        {"file": "b.py", "line": 20, "snippet": "s1"},  # same loc as grep[1]
        {"file": "c.py", "line": 30, "snippet": "s2"},
    ]
    out1 = hs.reciprocal_rank_fusion(grep, sem, k=60)
    out2 = hs.reciprocal_rank_fusion(grep, sem, k=60)

    keys1 = [(r["file"], r["line"]) for r in out1]
    keys2 = [(r["file"], r["line"]) for r in out2]
    check("fusion is deterministic across runs", keys1 == keys2)

    # b.py:20 found by both -> highest fused score -> ranked first.
    check("location found by both ranks first", keys1[0] == ("b.py", 20))
    check("b.py:20 has both sources",
          out1[0]["_sources"] == ["grep", "semantic"])

    # Dedup: 4 raw inputs, 1 shared location -> 3 unique results.
    check("dedup by file:line", len(out1) == 3)

    # RRF math check for b.py:20: grep rank 2 (1/(60+2)) + sem rank 1 (1/(60+1)).
    expected = (1.0 / 62) + (1.0 / 61)
    check("RRF score matches 1/(k+rank) sum",
          abs(out1[0]["_fused_score"] - expected) < 1e-9)


def test_rrf_tiebreak(hs):
    print("test_rrf_tiebreak:")
    # Two items that will tie on score (each appears once, same rank) must order
    # deterministically by (file, line).
    grep = [{"file": "z.py", "line": 5, "snippet": "x"}]
    sem = [{"file": "a.py", "line": 5, "snippet": "y"}]
    out = hs.reciprocal_rank_fusion(grep, sem, k=60)
    # Equal scores -> sorted by file ascending: a.py before z.py.
    check("tie broken by file path ascending",
          [(r["file"], r["line"]) for r in out] == [("a.py", 5), ("z.py", 5)])


def test_budget(hs):
    print("test_budget:")
    # estimate_tokens ~ len//4. Build snippets with known sizes.
    results = [
        {"file": "a.py", "line": 1, "snippet": "x" * 400, "_fused_score": 0.9},
        {"file": "b.py", "line": 2, "snippet": "y" * 400, "_fused_score": 0.8},
        {"file": "c.py", "line": 3, "snippet": "z" * 40, "_fused_score": 0.7},
    ]
    # Budget small enough that the two big ones together exceed it but a small
    # one fits: tests skip-and-continue + never-exceed.
    budget = 120  # ~ header(a few) + one 400-char snippet (100) fits one big
    kept = hs.truncate_to_budget(results, budget)

    def total_cost(items):
        c = 0
        for it in items:
            header = f"{it['file']}:{it['line']} "
            c += hs.estimate_tokens(header) + hs.estimate_tokens(it.get("snippet", ""))
        return c

    check("budget never exceeded", total_cost(kept) <= budget)
    check("at least one result kept", len(kept) >= 1)

    # Oversize-single case: one giant result bigger than the whole budget, then
    # a tiny one. Greedy must skip the giant and keep the tiny (skip-continue).
    results2 = [
        {"file": "big.py", "line": 1, "snippet": "q" * 10000, "_fused_score": 1.0},
        {"file": "tiny.py", "line": 2, "snippet": "ok", "_fused_score": 0.5},
    ]
    kept2 = hs.truncate_to_budget(results2, 50)
    files2 = [r["file"] for r in kept2]
    check("oversize single skipped, smaller later kept",
          "big.py" not in files2 and "tiny.py" in files2)
    check("oversize case still within budget", total_cost(kept2) <= 50)

    # Zero / negative budget -> empty.
    check("zero budget -> empty", hs.truncate_to_budget(results, 0) == [])


def test_grep_only_fallback(hs):
    print("test_grep_only_fallback:")
    # grep-only mode must return results without touching ChromaDB. We search
    # for a literal token known to exist in an indexer-covered file
    # (memory/token_economics.py defines estimate_tokens). hybrid_search scopes
    # grep to the same files the indexer covers, by design.
    token = "estimate_tokens"
    payload = hs.hybrid_search(token, top=10, budget=5000, grep_only=True)
    check("grep-only mode label", payload["mode"] == "grep-only")
    check("grep-only returns results", len(payload["results"]) >= 1)
    check("grep tool was used (not none)",
          payload["grep_tool"] in ("ripgrep", "grep", "python-scan"))
    found = any("token_economics.py" in r["file"] for r in payload["results"])
    check("grep-only finds the known token's file", found)

    # Simulate semantic unavailable in a hybrid call: monkeypatch semantic_search
    # to report unavailable, confirm fallback flag + results still return.
    orig = hs.semantic_search
    try:
        hs.semantic_search = lambda *a, **k: ([], False)
        payload2 = hs.hybrid_search(token, top=10, budget=5000)
        check("hybrid with semantic down sets fallback flag",
              payload2["fallback"] is True)
        check("hybrid with semantic down still returns grep results",
              len(payload2["results"]) >= 1)
    finally:
        hs.semantic_search = orig


def main():
    idx = _load_indexer()
    hs = _load_hybrid()

    if idx is not None:
        test_manifest_diff(idx)
        test_file_is_changed(idx)
        test_index_changed_integration(idx)
        test_staleness(idx)
    else:
        print("  (indexer pure-logic tests skipped: chromadb import unavailable)")

    test_rrf_determinism(hs)
    test_rrf_tiebreak(hs)
    test_budget(hs)
    test_grep_only_fallback(hs)

    print(f"\nResults: {PASSED} passed, {FAILED} failed")
    return 0 if FAILED == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
