"""tests/dashboard/test_proofs_routes.py
R1 proof-of-run dashboard endpoints -- HTTP tests.

Covers the three read-only routes added in dashboard/server.py:
    - GET /api/proofs               (list, server.py:7212)
    - GET /api/proofs/{run_id}      (proof.json, server.py:7244)
    - GET /api/proofs/{run_id}/html (page,      server.py:7257)
plus the path-traversal guard _safe_proof_run_dir (server.py:7195), asserted
both at the function level (HTTP clients normalize "..", so the precise guard
test calls it directly) and via an HTTP negative.

Uses FastAPI TestClient with raise_server_exceptions=False and the
_ForceLokiDir pattern from tests/dashboard/test_phase1_endpoints.py.
"""

from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path


class _ForceLokiDir:
    """Context manager that pins dashboard.server._get_loki_dir() to a tmp."""

    def __init__(self, tmpdir: str):
        self.tmp = tmpdir
        self._orig = None

    def __enter__(self):
        from dashboard import server as _server
        self._orig = _server._get_loki_dir
        _server._get_loki_dir = lambda: Path(self.tmp)
        return self

    def __exit__(self, exc_type, exc, tb):
        from dashboard import server as _server
        if self._orig is not None:
            _server._get_loki_dir = self._orig


_RUN_ID = "20260603T010203Z-abc123"
_PROOF = {
    "schema_version": "1.0",
    "run_id": _RUN_ID,
    "generated_at": "2026-06-03T01:02:03Z",
    "loki_version": "7.9.0",
    "cost": {"usd": 1.84},
    "files_changed": {"count": 3},
    "council": {"final_verdict": "APPROVE"},
    "redaction": {"applied": True, "rules_version": "1.0",
                  "redactions_count": 2},
}


class ProofsRoutesTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="loki-proofs-dash-")
        self.proofs = Path(self.tmp) / "proofs"
        self.run_dir = self.proofs / _RUN_ID
        self.run_dir.mkdir(parents=True, exist_ok=True)
        with open(self.run_dir / "proof.json", "w", encoding="utf-8") as f:
            json.dump(_PROOF, f)
        (self.run_dir / "index.html").write_text(
            "<!DOCTYPE html><html><body>Proof</body></html>",
            encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _client(self):
        from dashboard.server import app
        from fastapi.testclient import TestClient
        return TestClient(app, raise_server_exceptions=False)

    # ---------- GET /api/proofs --------------------------------------------

    def test_list_empty_when_dir_missing(self):
        empty = tempfile.mkdtemp(prefix="loki-proofs-empty-")
        try:
            with _ForceLokiDir(empty):
                resp = self._client().get("/api/proofs")
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json(), {"proofs": []})
        finally:
            shutil.rmtree(empty, ignore_errors=True)

    def test_list_returns_fixture_proof(self):
        with _ForceLokiDir(self.tmp):
            resp = self._client().get("/api/proofs")
        self.assertEqual(resp.status_code, 200)
        proofs = resp.json()["proofs"]
        self.assertEqual(len(proofs), 1)
        item = proofs[0]
        self.assertEqual(item["run_id"], _RUN_ID)
        self.assertEqual(item["cost_usd"], 1.84)
        self.assertEqual(item["files_changed"], 3)
        self.assertEqual(item["final_verdict"], "APPROVE")
        self.assertTrue(item["has_html"])

    # ---------- GET /api/proofs/{run_id} -----------------------------------

    def test_get_proof_returns_json(self):
        with _ForceLokiDir(self.tmp):
            resp = self._client().get("/api/proofs/" + _RUN_ID)
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["run_id"], _RUN_ID)
        self.assertEqual(body["schema_version"], "1.0")

    def test_get_proof_404_when_missing(self):
        with _ForceLokiDir(self.tmp):
            resp = self._client().get("/api/proofs/no-such-run-xyz")
        self.assertEqual(resp.status_code, 404)

    # ---------- GET /api/proofs/{run_id}/html ------------------------------

    def test_get_proof_html_serves_page(self):
        with _ForceLokiDir(self.tmp):
            resp = self._client().get("/api/proofs/" + _RUN_ID + "/html")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/html", resp.headers.get("content-type", ""))
        self.assertIn("Proof", resp.text)

    def test_get_proof_html_404_when_missing(self):
        with _ForceLokiDir(self.tmp):
            resp = self._client().get("/api/proofs/no-such-run-xyz/html")
        self.assertEqual(resp.status_code, 404)

    # ---------- path-traversal guard (server.py:7195) ----------------------

    def test_traversal_guard_rejects_at_function_level(self):
        # HTTP clients collapse ".." before routing, so assert the guard
        # directly the way the route handlers call it.
        from dashboard import server as _server
        from fastapi import HTTPException
        bad_ids = [
            "../../etc/passwd",
            "..",
            "a/b",
            "a\\b",
            ".hidden",
            "",
            "foo/../../bar",
        ]
        with _ForceLokiDir(self.tmp):
            for bad in bad_ids:
                with self.assertRaises(HTTPException) as ctx:
                    _server._safe_proof_run_dir(bad)
                self.assertEqual(
                    ctx.exception.status_code, 400,
                    "expected 400 for traversal id %r" % bad)

    def test_traversal_guard_accepts_valid_id(self):
        from dashboard import server as _server
        with _ForceLokiDir(self.tmp):
            resolved = _server._safe_proof_run_dir(_RUN_ID)
        self.assertTrue(str(resolved).endswith(_RUN_ID))

    def test_http_encoded_traversal_does_not_escape(self):
        # Bonus HTTP-level negative: a URL-encoded traversal attempt must not
        # return the contents of a file outside .loki/proofs. Either the guard
        # rejects (400) or the route 404s; never a 200 with foreign content.
        with _ForceLokiDir(self.tmp):
            resp = self._client().get("/api/proofs/..%2f..%2fetc%2fpasswd")
        self.assertNotEqual(resp.status_code, 200)
        self.assertNotIn("root:", resp.text)


class ProofsSummaryTests(unittest.TestCase):
    """GET /api/proofs/summary -- honest aggregate over real receipts only."""

    def _client(self):
        from dashboard.server import app
        from fastapi.testclient import TestClient
        return TestClient(app, raise_server_exceptions=False)

    def _write_proof(self, base: Path, run_id: str, headline):
        """Write a proof.json under base/proofs/<run_id>/.

        headline=None writes a schema v1.0 proof with NO honesty block (the
        "unknown" bucket). Otherwise writes a v1.1 proof with the given
        deterministic honesty.headline.
        """
        run_dir = base / "proofs" / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        if headline is None:
            proof = {"schema_version": "1.0", "run_id": run_id}
        else:
            proof = {
                "schema_version": "1.1",
                "run_id": run_id,
                "honesty": {"headline": headline, "degraded": []},
            }
        with open(run_dir / "proof.json", "w", encoding="utf-8") as f:
            json.dump(proof, f)

    def test_summary_all_zeros_when_no_proofs(self):
        empty = tempfile.mkdtemp(prefix="loki-proofs-sum-empty-")
        try:
            with _ForceLokiDir(empty):
                resp = self._client().get("/api/proofs/summary")
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json(), {
                "total_receipts": 0, "verified": 0, "with_gaps": 0,
                "not_verified": 0, "unknown": 0,
            })
        finally:
            shutil.rmtree(empty, ignore_errors=True)

    def test_summary_counts_each_bucket_honestly(self):
        tmp = tempfile.mkdtemp(prefix="loki-proofs-sum-")
        try:
            base = Path(tmp)
            self._write_proof(base, "20260601T000000Z-aaa", "VERIFIED")
            self._write_proof(base, "20260601T000001Z-bbb", "NOT VERIFIED")
            self._write_proof(base, "20260601T000002Z-ccc", None)  # v1.0
            with _ForceLokiDir(tmp):
                resp = self._client().get("/api/proofs/summary")
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            # HONEST: a v1.0 proof is NOT counted as verified -- it is unknown.
            self.assertEqual(body, {
                "total_receipts": 3, "verified": 1, "with_gaps": 0,
                "not_verified": 1, "unknown": 1,
            })
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_summary_counts_with_gaps_bucket(self):
        tmp = tempfile.mkdtemp(prefix="loki-proofs-sum-gaps-")
        try:
            base = Path(tmp)
            self._write_proof(base, "20260601T000000Z-aaa", "VERIFIED WITH GAPS")
            with _ForceLokiDir(tmp):
                resp = self._client().get("/api/proofs/summary")
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            self.assertEqual(body["with_gaps"], 1)
            self.assertEqual(body["verified"], 0)
            self.assertEqual(body["total_receipts"], 1)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_summary_does_not_collide_with_run_id_route(self):
        # /api/proofs/summary must resolve to the aggregate, never be captured
        # as a run_id by GET /api/proofs/{run_id} (route ordering guard).
        tmp = tempfile.mkdtemp(prefix="loki-proofs-sum-order-")
        try:
            self._write_proof(Path(tmp), "20260601T000000Z-aaa", "VERIFIED")
            with _ForceLokiDir(tmp):
                resp = self._client().get("/api/proofs/summary")
            self.assertEqual(resp.status_code, 200)
            self.assertIn("total_receipts", resp.json())
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
