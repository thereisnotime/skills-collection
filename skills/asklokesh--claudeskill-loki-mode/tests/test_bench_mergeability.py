"""tests/test_bench_mergeability.py -- scored mergeability harness (Rank 12).

Covers the credibility-critical invariants of benchmarks/bench/mergeability_
score.py, all CI-safe (no engine, no tokens, mocked adapter):

  - The PURE scorer: score=0 on ANY blocker failure; else weighted non-blocker
    sum in [0,1]. A "mergeable" result (all pass) scores high; an "unmergeable"
    result (blocker fails) scores 0. Deterministic: two calls on the same input
    are BYTE-IDENTICAL (exact equality, not tolerance).
  - "Loki never grades itself": the scorer refuses a results dict smuggling a
    pre-baked verdict / adapter / council key.
  - Non-vacuity of the shipped tasks: each task's FAIL_TO_PASS blocker FAILS on
    the base fixture (RED) and PASSES after the reference correct change (GREEN),
    proven by running the HELD-OUT grader on both trees.
  - End-to-end via a mock adapter: a solving adapter scores high, a no-op
    adapter (leaves the bug) scores 0 -- and the score comes from the held-out
    grader, never the adapter output.
  - Reproducibility: scoring the SAME task with the SAME (deterministic) adapter
    twice yields an identical headline (exact).
"""

from __future__ import annotations

import os
import shutil
import sys
import unittest

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_BENCH = os.path.join(_REPO, "benchmarks", "bench")
if _BENCH not in sys.path:
    sys.path.insert(0, _BENCH)

import mergeability_score as ms  # noqa: E402

_TASKS = os.path.join(_BENCH, "tasks", "mergeability")
_SLUGIFY = os.path.join(_TASKS, "slugify-empty-crash", "task.json")
_CONFIG = os.path.join(_TASKS, "config-merge-mutation", "task.json")


# ---------------------------------------------------------------------------
# 1. the PURE scorer: blocker -> 0, weighted sum otherwise, deterministic
# ---------------------------------------------------------------------------

_RUBRIC = [
    {"id": "fail_to_pass", "weight": 0, "blocker": True},
    {"id": "a", "weight": 4, "blocker": False},
    {"id": "b", "weight": 3, "blocker": False},
    {"id": "c", "weight": 2, "blocker": False},
    {"id": "d", "weight": 1, "blocker": False},
]


class PureScorerTest(unittest.TestCase):
    def test_mergeable_all_pass_scores_full(self):
        res = ms.score_from_results(_RUBRIC, {
            "fail_to_pass": True, "a": True, "b": True, "c": True, "d": True,
        })
        self.assertFalse(res["blocked"])
        self.assertEqual(res["score"], 1.0)
        self.assertEqual(res["blocker_failures"], [])

    def test_blocker_failure_scores_zero(self):
        # Every non-blocker passes, but the blocker fails -> hard 0.
        res = ms.score_from_results(_RUBRIC, {
            "fail_to_pass": False, "a": True, "b": True, "c": True, "d": True,
        })
        self.assertTrue(res["blocked"])
        self.assertEqual(res["score"], 0.0)
        self.assertEqual(res["blocker_failures"], ["fail_to_pass"])

    def test_partial_nonblocker_weighted_sum(self):
        # blocker ok; a(4)+c(2) pass, b(3)+d(1) fail -> 6/10 = 0.6.
        res = ms.score_from_results(_RUBRIC, {
            "fail_to_pass": True, "a": True, "b": False, "c": True, "d": False,
        })
        self.assertFalse(res["blocked"])
        self.assertEqual(res["score"], 0.6)
        self.assertEqual(res["nonblocker_weight_total"], 10.0)
        self.assertEqual(res["nonblocker_weight_earned"], 6.0)

    def test_missing_check_counts_as_failure(self):
        # 'd' absent -> treated as a failure (never silently a pass).
        res = ms.score_from_results(_RUBRIC, {
            "fail_to_pass": True, "a": True, "b": True, "c": True,
        })
        self.assertEqual(res["score"], 0.9)  # 9/10

    def test_scorer_is_deterministic_exact(self):
        payload = {"fail_to_pass": True, "a": True, "b": False, "c": True, "d": True}
        r1 = ms.score_from_results(_RUBRIC, dict(payload))
        r2 = ms.score_from_results(_RUBRIC, dict(payload))
        self.assertEqual(r1, r2)  # exact equality, not "within tolerance"

    def test_scorer_refuses_smuggled_verdict(self):
        for bad_key in ("score", "success", "verdict", "council", "adapter"):
            with self.assertRaises(ms.RubricError):
                ms.score_from_results(_RUBRIC, {
                    "fail_to_pass": True, "a": True, "b": True, "c": True,
                    "d": True, bad_key: True,
                })

    def test_invalid_rubric_rejected(self):
        with self.assertRaises(ms.RubricError):
            ms.score_from_results([], {})
        # no non-blocker weight at all
        with self.assertRaises(ms.RubricError):
            ms.score_from_results(
                [{"id": "only_blocker", "weight": 0, "blocker": True}],
                {"only_blocker": True})


# ---------------------------------------------------------------------------
# 2. the shipped tasks validate + have well-formed rubrics
# ---------------------------------------------------------------------------

class ShippedTaskRubricTest(unittest.TestCase):
    def test_tasks_load_and_have_valid_rubrics(self):
        for path in (_SLUGIFY, _CONFIG):
            self.assertTrue(os.path.isfile(path), "missing task: %s" % path)
            spec = ms.runner.load_task(path)  # also runs frozen validate_task_spec
            self.assertEqual(ms.validate_rubric(spec.get("rubric")), [])
            # exactly one blocker, named fail_to_pass (the reverse-classical anchor)
            blockers = [c for c in spec["rubric"] if c.get("blocker")]
            self.assertEqual(len(blockers), 1)
            self.assertEqual(blockers[0]["id"], "fail_to_pass")


# ---------------------------------------------------------------------------
# 3. NON-VACUITY: FAIL_TO_PASS fails on base (RED), passes after the reference
#    correct change (GREEN). Runs the HELD-OUT grader on both trees directly.
# ---------------------------------------------------------------------------

class NonVacuityTest(unittest.TestCase):
    """For each shipped task, prove the blocker is real: the held-out grader
    reports fail_to_pass=False on the base fixture and True after applying the
    task's reference_change. A blocker that already passed on base would prove
    nothing (exactly what _loki_test_provenance guards against)."""

    def setUp(self):
        self.tmp = None

    def tearDown(self):
        if self.tmp:
            shutil.rmtree(self.tmp, ignore_errors=True)

    def _grade_tree(self, task_dir, spec, replace_with_reference):
        fixture_dir = ms.runner.resolve_fixture_dir(
            os.path.join(task_dir, "task.json"), spec)
        # Reuse the runner's fixture-copy (handles subdirs, fresh mktemp workdir).
        self.tmp = ms.runner.prepare_workdir(fixture_dir, "nonvac")
        if replace_with_reference:
            # Apply the reference correct change: it replaces the single source
            # file. Find the one .py file in the fixture and overwrite it.
            ref = os.path.join(task_dir, spec["reference_change"])
            src_files = [f for f in os.listdir(fixture_dir) if f.endswith(".py")]
            self.assertEqual(len(src_files), 1)
            shutil.copy2(ref, os.path.join(self.tmp, src_files[0]))
        # Run the held-out grader (overlays acceptance/, captures per-check JSON).
        checks = ms.run_held_out_grader(self.tmp, spec, task_dir)
        return checks

    def _assert_red_then_green(self, task_json):
        task_dir = os.path.dirname(task_json)
        spec = ms.runner.load_task(task_json)
        red = self._grade_tree(task_dir, spec, replace_with_reference=False)
        self.assertIs(red.get("fail_to_pass"), False,
                      "RED expected: base fixture must FAIL fail_to_pass, got %r"
                      % red)
        self.tmp and shutil.rmtree(self.tmp, ignore_errors=True)
        green = self._grade_tree(task_dir, spec, replace_with_reference=True)
        self.assertIs(green.get("fail_to_pass"), True,
                      "GREEN expected: reference change must PASS fail_to_pass, "
                      "got %r" % green)
        # And the reference change earns a perfect mergeability score.
        scored = ms.score_from_results(spec["rubric"], green)
        self.assertEqual(scored["score"], 1.0)

    def test_slugify_blocker_is_non_vacuous(self):
        self._assert_red_then_green(_SLUGIFY)

    def test_config_merge_blocker_is_non_vacuous(self):
        self._assert_red_then_green(_CONFIG)


# ---------------------------------------------------------------------------
# 4. END-TO-END via a MOCK adapter (no engine, no tokens). The score comes from
#    the held-out grader, NOT the adapter -- a cheating adapter cannot inflate it.
# ---------------------------------------------------------------------------

def _mock_solving_adapter_for(task_id):
    """Return an adapter that applies the task's reference correct change."""
    def adapter(workdir, spec, *, model="m", timeout=900, runner=None):
        # spec is the materialized prompt-file PATH; we ignore it and instead
        # write the correct source. This simulates a tool that solved the task.
        ref_dir = os.path.join(_TASKS, task_id)
        # Overwrite the single .py source file with the reference change.
        for name in os.listdir(workdir):
            if name.endswith(".py") and name != "BENCH_PROMPT.md":
                spec_dict = ms.runner.load_task(os.path.join(ref_dir, "task.json"))
                shutil.copy2(os.path.join(ref_dir, spec_dict["reference_change"]),
                             os.path.join(workdir, name))
                break
        return {
            "tool": "mock", "tool_version": "0.0.1", "model_used": model,
            "duration_s": 1.0, "exit_status": "completed",
            "provenance": {"kind": "automated", "verified": True},
            "cost_usd": None,
        }
    return adapter


def _mock_noop_adapter(workdir, spec, *, model="m", timeout=900, runner=None):
    """An adapter that changes nothing -> the base bug remains -> blocker fails."""
    return {
        "tool": "mock", "tool_version": "0.0.1", "model_used": model,
        "duration_s": 1.0, "exit_status": "completed",
        "provenance": {"kind": "automated", "verified": True},
        "cost_usd": None,
    }


def _mock_cheating_adapter(workdir, spec, *, model="m", timeout=900, runner=None):
    """Tries to cheat by writing a bogus checks JSON and tampering the grader.

    It overwrites rubric.py in the workdir to always report all-pass. The
    held-out overlay must restore the REAL grader after the agent runs, so the
    cheat is defeated and the blocker still fails (base bug untouched)."""
    with open(os.path.join(workdir, "rubric.py"), "w") as fh:
        fh.write('print(\'{"checks": {"fail_to_pass": true}}\')\n')
    return {
        "tool": "mock", "tool_version": "0.0.1", "model_used": model,
        "duration_s": 1.0, "exit_status": "completed",
        "provenance": {}, "cost_usd": None,
    }


class EndToEndMockTest(unittest.TestCase):
    def test_solving_adapter_scores_high(self):
        row = ms.score_task(_SLUGIFY, "mock", trials=1,
                            adapter=_mock_solving_adapter_for("slugify-empty-crash"))
        self.assertFalse(row["mergeability_trials"][0]["blocked"])
        self.assertEqual(row["summary"]["mergeability_pct"], 100.0)

    def test_noop_adapter_scores_zero(self):
        row = ms.score_task(_SLUGIFY, "mock", trials=1, adapter=_mock_noop_adapter)
        self.assertTrue(row["mergeability_trials"][0]["blocked"])
        self.assertEqual(row["summary"]["mergeability_pct"], 0.0)

    def test_cheating_adapter_cannot_inflate_score(self):
        # The agent tampers the in-workdir grader; the held-out overlay restores
        # the real one AFTER the agent runs, so the blocker still fails.
        row = ms.score_task(_CONFIG, "mock", trials=1,
                            adapter=_mock_cheating_adapter)
        self.assertTrue(row["mergeability_trials"][0]["blocked"])
        self.assertEqual(row["summary"]["mergeability_pct"], 0.0)

    def test_config_solving_adapter_scores_high(self):
        row = ms.score_task(_CONFIG, "mock", trials=1,
                            adapter=_mock_solving_adapter_for("config-merge-mutation"))
        self.assertEqual(row["summary"]["mergeability_pct"], 100.0)


# ---------------------------------------------------------------------------
# 5. REPRODUCIBILITY: two runs of the same task + deterministic adapter -> the
#    SAME headline, exactly. (Tolerance only matters under real-engine stochast-
#    icity; the instrument itself is exact.)
# ---------------------------------------------------------------------------

class ReproducibilityTest(unittest.TestCase):
    def test_two_runs_identical_headline(self):
        adapter = _mock_solving_adapter_for("slugify-empty-crash")
        row1 = ms.score_task(_SLUGIFY, "mock", trials=2, adapter=adapter)
        row2 = ms.score_task(_SLUGIFY, "mock", trials=2, adapter=adapter)
        # Same task_hash (reproducibility anchor) and same headline summary.
        self.assertEqual(row1["task_hash"], row2["task_hash"])
        self.assertEqual(row1["summary"], row2["summary"])
        self.assertEqual(row1["summary"]["mergeability_pct"],
                         row2["summary"]["mergeability_pct"])

    def test_task_hash_folds_rubric(self):
        # Changing a rubric weight must change task_hash (rubric is held-out
        # content bound into the reproducibility anchor).
        import bench_schema as schema
        spec = ms.runner.load_task(_SLUGIFY)
        fixture_dir = ms.runner.resolve_fixture_dir(_SLUGIFY, spec)
        h1 = schema.compute_task_hash(spec, fixture_dir)
        spec2 = dict(spec)
        spec2["rubric"] = [dict(c) for c in spec["rubric"]]
        spec2["rubric"][1]["weight"] = 999
        h2 = schema.compute_task_hash(spec2, fixture_dir)
        self.assertNotEqual(h1, h2)


if __name__ == "__main__":
    unittest.main()
