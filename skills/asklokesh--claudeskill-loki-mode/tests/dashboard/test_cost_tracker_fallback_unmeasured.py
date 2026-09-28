"""S-178 (BACKLOG 112): the /api/cost context-tracker fallback.

THE BUG: when efficiency files carry no tokens, _compute_cost_snapshot falls
back to .loki/context/tracking.json. Tokens > 0 set cost_recorded and read
`totals.get("total_cost_usd", 0.0)`, so a tracker that recorded tokens but no
USD figure rendered a measured $0.00. The model also defaulted to "sonnet"
when the tracker named no provider.

BOTH DIRECTIONS: a missing USD figure is null, a recorded 0.0 stays 0.0.
"""

from __future__ import annotations

import json
import pathlib
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_ROOT))

from dashboard import server as _server  # noqa: E402


class TrackerFallbackUnmeasured(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="loki-s178-")
        self.loki = Path(self.tmp)
        (self.loki / "context").mkdir(parents=True)
        (self.loki / "metrics").mkdir(parents=True)
        self._orig = _server._get_loki_dir
        _server._get_loki_dir = lambda: self.loki

    def tearDown(self):
        _server._get_loki_dir = self._orig
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _snap(self, ctx, budget=None):
        (self.loki / "context" / "tracking.json").write_text(json.dumps(ctx))
        if budget is not None:
            (self.loki / "metrics" / "budget.json").write_text(json.dumps(budget))
        return _server._compute_cost_snapshot()

    def test_tokens_without_usd_give_null_cost(self):
        snap = self._snap({
            "provider": "claude",
            "totals": {"total_input": 1200, "total_output": 300},
            "per_iteration": [{"input_tokens": 1200, "output_tokens": 300}],
        }, budget={"limit": 10})
        self.assertEqual(snap["total_input_tokens"], 1200)
        self.assertEqual(snap["total_output_tokens"], 300)
        self.assertIsNone(snap["estimated_cost_usd"])
        self.assertIsNone(snap["budget_used"])
        self.assertIsNone(snap["budget_remaining"])
        self.assertIsNone(snap["by_model"]["claude"]["cost_usd"])
        self.assertEqual(snap["by_model"]["claude"]["input_tokens"], 1200)

    def test_recorded_zero_stays_zero(self):
        snap = self._snap({
            "provider": "claude",
            "totals": {"total_input": 1200, "total_output": 300, "total_cost_usd": 0.0},
            "per_iteration": [{"input_tokens": 1200, "output_tokens": 300, "cost_usd": 0.0}],
        }, budget={"limit": 10})
        self.assertEqual(snap["estimated_cost_usd"], 0.0)
        self.assertEqual(snap["budget_used"], 0.0)
        self.assertEqual(snap["by_model"]["claude"]["cost_usd"], 0.0)

    def test_no_provider_gives_model_unknown(self):
        snap = self._snap({
            "totals": {"total_input": 10, "total_output": 5, "total_cost_usd": 1.5},
            "per_iteration": [{"input_tokens": 10, "output_tokens": 5, "cost_usd": 1.5}],
        })
        self.assertEqual(list(snap["by_model"]), ["unknown"])
        self.assertEqual(snap["estimated_cost_usd"], 1.5)
        self.assertEqual(snap["by_model"]["unknown"]["cost_usd"], 1.5)


if __name__ == "__main__":
    unittest.main()
