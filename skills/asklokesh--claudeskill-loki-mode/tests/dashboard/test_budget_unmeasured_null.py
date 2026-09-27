"""An unmeasured spend is never a budget reading of $0.00 / 0.0%.

THE BUG. With a budget cap set and no cost recorded (cost_recorded false),
every budget reader in dashboard/server.py still answered with numbers:

  - /api/cost           budget_used 0.0, budget_remaining = the full limit
  - /api/budget         current_cost 0.0, remaining = the full limit
  - /api/cost/timeline  budget.used 0.0, percent_used 0.0, status "ok"
                        ("Within budget."), and every unmeasured iteration
                        carried cost_usd 0.0 / cumulative_usd 0.0

so the console drew "$0.00 of $10.00 used, 0.0%" for a run nobody measured.
The totals were already honest (estimated_cost_usd null); only the budget
fields and the per-iteration series re-derived a zero.

BOTH DIRECTIONS ARE ASSERTED. A measured zero (observed tokens, provider
reported $0) must still read 0.0, and a positive budget.json budget_used is a
recorded reading that stays the fallback (tests/dashboard/
test_provider_budget_ratelimit.py BUG 4b). A zero there is not: bash
check_budget_limit writes "budget_used": 0.0 for an unmeasured run.
"""

from __future__ import annotations

import json
import os
import pathlib
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_ROOT))


class _ForceLokiDir:
    """Pin dashboard.server._get_loki_dir() to a tmp dir (house pattern)."""

    def __init__(self, tmpdir: str):
        self.tmp = tmpdir
        self._orig = None

    def __enter__(self):
        from dashboard import server as _server
        self._orig = _server._get_loki_dir
        _server._get_loki_dir = lambda: Path(self.tmp)
        return self

    def __exit__(self, *exc):
        from dashboard import server as _server
        _server._get_loki_dir = self._orig
        return False


def _client():
    from fastapi.testclient import TestClient
    from dashboard import server as _server
    return TestClient(_server.app, raise_server_exceptions=False)


# A record that exists and parses but carries no observed value at all.
_NO_FIELDS = {"iteration": 1, "model": "sonnet", "phase": "build"}
# The all-zero shape a pre-v8.51.0 codex run wrote.
_ALL_ZERO = {"iteration": 1, "model": "gpt-5.3-codex", "phase": "build",
             "input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0,
             "cache_creation_tokens": 0, "cost_usd": 0.0}
_MEASURED = {"iteration": 1, "model": "sonnet", "phase": "build",
             "input_tokens": 1000, "output_tokens": 500, "cost_usd": 2.5}
_MEASURED_ZERO = {"iteration": 1, "model": "sonnet", "phase": "build",
                  "input_tokens": 9412, "output_tokens": 11008, "cost_usd": 0.0}


class BudgetUnmeasuredTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="loki-budget-null-")
        self.eff = Path(self.tmp) / "metrics" / "efficiency"
        self.eff.mkdir(parents=True, exist_ok=True)
        self._saved_env = os.environ.pop("LOKI_BUDGET_LIMIT", None)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)
        if self._saved_env is not None:
            os.environ["LOKI_BUDGET_LIMIT"] = self._saved_env

    def _seed(self, records, budget):
        for i, rec in enumerate(records, 1):
            (self.eff / f"iteration-{i}.json").write_text(json.dumps(rec))
        if budget is not None:
            (Path(self.tmp) / "metrics" / "budget.json").write_text(json.dumps(budget))

    def _get(self, path):
        with _ForceLokiDir(self.tmp):
            resp = _client().get(path)
        self.assertEqual(resp.status_code, 200, resp.text)
        return resp.json()

    def _assert_null(self, payload, keys, where):
        for k in keys:
            # Present AND null: a missing key would also read as "not 0".
            self.assertIn(k, payload, f"{where}: {k} missing")
            self.assertIsNone(payload[k], f"{where}: {k} is {payload[k]!r}, want null")

    # ---- unmeasured --------------------------------------------------------

    def test_unmeasured_record_with_cap_is_null_everywhere(self):
        self._seed([_NO_FIELDS], {"limit": 10})
        cost = self._get("/api/cost")
        self.assertFalse(cost["cost_recorded"])
        self.assertEqual(cost["budget_limit"], 10)
        self._assert_null(cost, ("budget_used", "budget_remaining"), "/api/cost")

        budget = self._get("/api/budget")
        self.assertEqual(budget["budget_limit"], 10.0)
        self._assert_null(budget, ("current_cost", "remaining"), "/api/budget")

        tl = self._get("/api/cost/timeline")
        b = tl["budget"]
        self.assertEqual(b["limit"], 10.0)
        self._assert_null(b, ("used", "remaining", "percent_used"), "timeline budget")
        self.assertEqual(b["status"], "unknown")
        self.assertFalse(b["exceeded"])
        it = tl["current_run"]["iterations"][0]
        self._assert_null(it, ("cost_usd", "cumulative_usd"), "timeline iteration")

    def test_bash_written_zero_budget_used_is_not_a_reading(self):
        # check_budget_limit writes budget_used 0.0 when it measured nothing.
        self._seed([_ALL_ZERO], {"limit": 10, "budget_limit": 10,
                                 "budget_used": 0.0, "exceeded": False})
        budget = self._get("/api/budget")
        self._assert_null(budget, ("current_cost", "remaining"), "/api/budget")
        self._assert_null(self._get("/api/cost"), ("budget_used", "budget_remaining"), "/api/cost")

    def test_status_helper_says_unknown_not_ok(self):
        from dashboard import server as _server
        self.assertEqual(_server._budget_status(None, 10.0), "unknown")
        self.assertEqual(_server._budget_status(None, None), "none")
        self.assertEqual(_server._budget_status(1.0, 10.0), "ok")

    def test_mixed_run_nulls_only_the_unmeasured_iteration(self):
        self._seed([_MEASURED, _NO_FIELDS], {"limit": 10})
        its = self._get("/api/cost/timeline")["current_run"]["iterations"]
        self.assertAlmostEqual(its[0]["cost_usd"], 2.5, places=6)
        self.assertAlmostEqual(its[0]["cumulative_usd"], 2.5, places=6)
        self._assert_null(its[1], ("cost_usd", "cumulative_usd"), "unmeasured iteration")

    # ---- controls: real readings stay numbers ------------------------------

    def test_measured_spend_is_a_number(self):
        self._seed([_MEASURED], {"limit": 10})
        cost = self._get("/api/cost")
        self.assertAlmostEqual(cost["budget_used"], 2.5, places=6)
        self.assertAlmostEqual(cost["budget_remaining"], 7.5, places=6)
        budget = self._get("/api/budget")
        self.assertAlmostEqual(budget["current_cost"], 2.5, places=4)
        self.assertAlmostEqual(budget["remaining"], 7.5, places=4)
        b = self._get("/api/cost/timeline")["budget"]
        self.assertAlmostEqual(b["used"], 2.5, places=6)
        self.assertEqual(b["percent_used"], 25.0)
        self.assertEqual(b["status"], "ok")

    def test_measured_zero_stays_zero(self):
        self._seed([_MEASURED_ZERO], {"limit": 10})
        cost = self._get("/api/cost")
        self.assertEqual(cost["budget_used"], 0.0)
        self.assertEqual(cost["budget_remaining"], 10.0)
        budget = self._get("/api/budget")
        self.assertEqual(budget["current_cost"], 0.0)
        self.assertEqual(budget["remaining"], 10.0)
        b = self._get("/api/cost/timeline")["budget"]
        self.assertEqual(b["used"], 0.0)
        self.assertEqual(b["percent_used"], 0.0)
        self.assertEqual(b["status"], "ok")
        self.assertEqual(self._get("/api/cost/timeline")["current_run"]["iterations"][0]["cost_usd"], 0.0)

    def test_recorded_budget_json_spend_is_still_the_fallback(self):
        shutil.rmtree(self.eff)
        self._seed([], {"limit": 5.0, "budget_used": 3.0})
        budget = self._get("/api/budget")
        self.assertAlmostEqual(budget["current_cost"], 3.0, places=4)
        self.assertAlmostEqual(budget["remaining"], 2.0, places=4)


if __name__ == "__main__":
    unittest.main()
