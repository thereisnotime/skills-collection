"""tests/test_functional_fact_record.py -- FV-2 record-half.

The FV-1 functional signal (did the built app actually DO what the spec asked?)
is now RECORDED on the evidence receipt as a descriptive fact -- but it is
DELIBERATELY NOT read by the deterministic headline, so it does not (yet) change
what "Verified" means. Making it gate the green headline is the founder-gated
trust-semantics decision (the second half of FV-2).

These tests prove: (1) the fact is collected from the FV-1 output file, and
(2) it is INERT to the verdict -- even a FAILED functional signal never changes
the headline or the degraded ledger. Safe + reversible.
"""
from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path


def _load():
    here = Path(__file__).resolve().parent.parent
    path = here / "autonomy" / "lib" / "proof-generator.py"
    spec = importlib.util.spec_from_file_location("proof_generator", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


PG = _load()

VERIFIED_FACTS = {
    "tests": {"status": "verified", "command": "npm test", "exit_code": 0},
    "build": {"status": "verified", "ran": True, "exit_code": 0},
    "security": {"ran": True, "high_active": 0},
    "quality_gates": [],
    "git": {"diff": {"count": 5}},
}


class CollectFunctional(unittest.TestCase):
    def test_absent_is_not_run(self):
        d = tempfile.mkdtemp()
        out = PG._collect_functional(d)
        self.assertFalse(out["ran"])
        self.assertEqual(out["functional_status"], "not_run")

    def test_present_is_recorded(self):
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, "quality"))
        json.dump(
            {"functional_status": "verified",
             "summary": {"passed": 3, "failed": 0, "inconclusive": 0}},
            open(os.path.join(d, "quality", "functional-results.json"), "w"),
        )
        out = PG._collect_functional(d)
        self.assertTrue(out["ran"])
        self.assertEqual(out["functional_status"], "verified")
        self.assertEqual(out["passed"], 3)


class FunctionalFactIsInertToVerdict(unittest.TestCase):
    def _verdict(self, facts):
        deg = PG._compute_degraded(facts)
        return PG._compute_headline(facts, deg), [d["item"] for d in deg]

    def test_failed_functional_does_not_change_headline(self):
        # A VERIFIED build must stay VERIFIED even if the functional signal failed.
        # (Recording != gating; gating is the founder-gated FV-2 second half.)
        hl0, deg0 = self._verdict(VERIFIED_FACTS)
        with_fn = dict(VERIFIED_FACTS, functional={
            "ran": True, "functional_status": "failed",
            "passed": 0, "failed": 3, "inconclusive": 0})
        hl1, deg1 = self._verdict(with_fn)
        self.assertEqual(hl0, "VERIFIED")
        self.assertEqual(hl1, hl0, "a functional fact must NOT change the headline")
        self.assertEqual(deg1, deg0, "a functional fact must NOT change the degraded ledger")

    def test_verified_functional_also_inert(self):
        with_fn = dict(VERIFIED_FACTS, functional={
            "ran": True, "functional_status": "verified",
            "passed": 3, "failed": 0, "inconclusive": 0})
        hl, _ = self._verdict(with_fn)
        self.assertEqual(hl, "VERIFIED")


class FunctionalGateOptIn(unittest.TestCase):
    """FV-2 gate-half: LOKI_FV_GATE=1 makes a failed functional check a hard NOT
    VERIFIED. Default-off keeps every existing verdict byte-identical."""

    def setUp(self):
        os.environ.pop("LOKI_FV_GATE", None)

    def tearDown(self):
        os.environ.pop("LOKI_FV_GATE", None)

    def _hl(self, facts):
        return PG._compute_headline(facts, PG._compute_degraded(facts))

    def test_gate_off_failed_functional_stays_verified(self):
        f = dict(VERIFIED_FACTS, functional={"ran": True, "functional_status": "failed"})
        self.assertEqual(self._hl(f), "VERIFIED")  # default off -> unchanged

    def test_gate_on_failed_functional_is_not_verified(self):
        os.environ["LOKI_FV_GATE"] = "1"
        f = dict(VERIFIED_FACTS, functional={"ran": True, "functional_status": "failed"})
        self.assertEqual(self._hl(f), "NOT VERIFIED")

    def test_gate_on_verified_functional_stays_verified(self):
        os.environ["LOKI_FV_GATE"] = "1"
        f = dict(VERIFIED_FACTS, functional={"ran": True, "functional_status": "verified"})
        self.assertEqual(self._hl(f), "VERIFIED")

    def test_gate_on_but_functional_not_run_stays_verified(self):
        # A not_run functional check must never flip a passing build (moat).
        os.environ["LOKI_FV_GATE"] = "1"
        f = dict(VERIFIED_FACTS, functional={"ran": False, "functional_status": "not_run"})
        self.assertEqual(self._hl(f), "VERIFIED")


class HealthcheckRecord(unittest.TestCase):
    """Evidence Receipt record-half: the app-runner liveness fact is recorded but
    inert to the verdict (gating it is the founder-gated decision)."""

    def test_collect_absent_present(self):
        d = tempfile.mkdtemp()
        self.assertEqual(PG._collect_healthcheck(d)["status"], "not_run")
        os.makedirs(os.path.join(d, "app-runner"))
        json.dump({"ok": True, "checked_at": "t"},
                  open(os.path.join(d, "app-runner", "health.json"), "w"))
        self.assertEqual(PG._collect_healthcheck(d)["status"], "healthy")

    def test_unhealthy_is_inert_to_verdict(self):
        f = dict(VERIFIED_FACTS, healthcheck={"ran": True, "ok": False, "status": "unhealthy"})
        hl = PG._compute_headline(f, PG._compute_degraded(f))
        self.assertEqual(hl, "VERIFIED")  # descriptive only; does not gate


if __name__ == "__main__":
    unittest.main()
