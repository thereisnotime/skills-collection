"""tests/dashboard/test_rollback_endpoint.py
R6 1-click rollback dashboard endpoint -- HTTP tests.

Covers POST /api/checkpoints/{id}/rollback (dashboard/server.py), which
un-deads the rollback button that the loki-checkpoint-viewer component already
POSTs to. Asserts:
    - restore actually reverts .loki/ state files (glob-restore)
    - a forced pre-rollback snapshot is created (re-undoability invariant)
    - 404 for a missing checkpoint
    - the path-traversal guard rejects bad ids

Uses FastAPI TestClient with the _ForceLokiDir pattern from
tests/dashboard/test_proofs_routes.py. Enterprise auth is disabled by default
(LOKI_ENTERPRISE_AUTH unset), so require_scope("control") allows access.
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


class RollbackEndpointTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="loki-rollback-dash-")
        loki = Path(self.tmp)
        # Current (post-iteration, "bad") state.
        (loki / "state").mkdir(parents=True, exist_ok=True)
        (loki / "queue").mkdir(parents=True, exist_ok=True)
        (loki / "state" / "orchestrator.json").write_text(
            json.dumps({"currentPhase": "BAD_LIVE"}))
        (loki / "CONTINUITY.md").write_text("BAD LIVE CONTEXT\n")

        # A checkpoint capturing the "good" earlier state.
        self.cp_id = "cp-2-1700000002"
        cp = loki / "state" / "checkpoints" / self.cp_id
        (cp / "state").mkdir(parents=True, exist_ok=True)
        (cp / "state" / "orchestrator.json").write_text(
            json.dumps({"currentPhase": "GOOD_CHECKPOINT"}))
        (cp / "CONTINUITY.md").write_text("GOOD CONTEXT\n")
        (cp / "metadata.json").write_text(json.dumps({
            "id": self.cp_id, "timestamp": "2026-06-03T00:00:00Z",
            "git_sha": "abc123", "message": "good checkpoint",
        }))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _client(self):
        from dashboard.server import app
        from fastapi.testclient import TestClient
        return TestClient(app, raise_server_exceptions=False)

    def _checkpoint_dirs(self):
        root = Path(self.tmp) / "state" / "checkpoints"
        return sorted(d.name for d in root.iterdir() if d.is_dir())

    def test_rollback_reverts_state_and_context(self):
        with _ForceLokiDir(self.tmp):
            resp = self._client().post(
                "/api/checkpoints/%s/rollback" % self.cp_id)
        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        self.assertEqual(body["id"], self.cp_id)
        self.assertGreaterEqual(body["restored"], 1)
        self.assertEqual(body["errors"], [])

        # State actually reverted to the checkpointed content.
        orch = json.loads(
            (Path(self.tmp) / "state" / "orchestrator.json").read_text())
        self.assertEqual(orch["currentPhase"], "GOOD_CHECKPOINT")
        continuity = (Path(self.tmp) / "CONTINUITY.md").read_text()
        self.assertEqual(continuity, "GOOD CONTEXT\n")

    def test_rollback_creates_pre_rollback_snapshot(self):
        before = self._checkpoint_dirs()
        with _ForceLokiDir(self.tmp):
            resp = self._client().post(
                "/api/checkpoints/%s/rollback" % self.cp_id)
        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        pre_id = body["pre_rollback_snapshot"]
        self.assertTrue(pre_id.startswith("rb-pre-"))

        after = self._checkpoint_dirs()
        self.assertIn(pre_id, after)
        self.assertNotIn(pre_id, before)

        # The snapshot preserved the prior ("bad") state so the user can undo
        # the undo -- re-undoability invariant.
        snap = Path(self.tmp) / "state" / "checkpoints" / pre_id
        snap_continuity = snap / "CONTINUITY.md"
        self.assertTrue(snap_continuity.exists())
        self.assertEqual(snap_continuity.read_text(), "BAD LIVE CONTEXT\n")

    def test_rollback_404_for_missing_checkpoint(self):
        with _ForceLokiDir(self.tmp):
            resp = self._client().post(
                "/api/checkpoints/cp-9-9999999999/rollback")
        self.assertEqual(resp.status_code, 404)

    def test_rollback_rejects_traversal_id_at_function_level(self):
        # HTTP clients collapse ".." before routing, so assert the sanitizer
        # the way the handler calls it.
        from dashboard import server as _server
        from fastapi import HTTPException
        for bad in ["../../etc/passwd", "..", "a/b", "foo/../bar", ""]:
            with self.assertRaises(HTTPException) as ctx:
                _server._sanitize_checkpoint_id(bad)
            self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
