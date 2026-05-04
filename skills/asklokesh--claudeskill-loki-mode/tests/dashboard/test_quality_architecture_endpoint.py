"""
tests/dashboard/test_quality_architecture_endpoint.py
v7.5.15: GET /api/quality/architecture -- sentrux drift series HTTP tests.

Mirrors the _ForceLokiDir context manager pattern from
tests/dashboard/test_phase1_endpoints.py. The endpoint reads
.loki/state/findings-sentrux-*.json files written by the iteration loop
when LOKI_SENTRUX_GATE=1 is set.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path


class _ForceLokiDir:
    """Context manager that pins dashboard.server._get_loki_dir() to a tmp path."""

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


class QualityArchitectureEndpointTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="loki-sentrux-dash-")
        (Path(self.tmp) / "state").mkdir(parents=True, exist_ok=True)

    def _client(self):
        from dashboard.server import app
        from fastapi.testclient import TestClient
        return TestClient(app, raise_server_exceptions=False)

    def _write_finding(self, iteration: int, before: int, after: int,
                       verdict: str = "DEGRADED",
                       timestamp: str = "2026-05-03T10:00:00+00:00") -> Path:
        path = (Path(self.tmp) / "state"
                / f"findings-sentrux-{iteration}.json")
        payload = {
            "type": "architectural-drift",
            "iteration": iteration,
            "before": before,
            "after": after,
            "verdict": verdict,
            "timestamp": timestamp,
            "source": "sentrux",
        }
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def test_empty_series_when_no_findings_files(self):
        """No findings files at all -> empty series, samples=0, 200 OK."""
        with _ForceLokiDir(self.tmp):
            resp = self._client().get("/api/quality/architecture")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body, {"series": [], "current": None, "samples": 0})

    def test_empty_series_when_state_dir_missing(self):
        """Even if .loki/state/ doesn't exist, endpoint returns empty 200."""
        # Use a tmp dir with no state subdir.
        empty_tmp = tempfile.mkdtemp(prefix="loki-sentrux-empty-")
        with _ForceLokiDir(empty_tmp):
            resp = self._client().get("/api/quality/architecture")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["series"], [])
        self.assertIsNone(body["current"])
        self.assertEqual(body["samples"], 0)

    def test_happy_path_three_findings_sorted_ascending(self):
        """3 findings files, returned sorted by iteration ascending."""
        # Write out of order to verify the endpoint sorts.
        self._write_finding(3, before=8000, after=7500, verdict="DEGRADED",
                            timestamp="2026-05-03T12:00:00+00:00")
        self._write_finding(1, before=9000, after=8800, verdict="OK",
                            timestamp="2026-05-03T10:00:00+00:00")
        self._write_finding(2, before=8800, after=8000, verdict="DEGRADED",
                            timestamp="2026-05-03T11:00:00+00:00")

        with _ForceLokiDir(self.tmp):
            resp = self._client().get("/api/quality/architecture")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["samples"], 3)
        self.assertEqual(len(body["series"]), 3)
        iterations = [e["iteration"] for e in body["series"]]
        self.assertEqual(iterations, [1, 2, 3])
        # current = last after (iteration 3 -> 7500).
        self.assertEqual(body["current"], 7500)
        # Verify shape of one entry.
        first = body["series"][0]
        self.assertEqual(first["iteration"], 1)
        self.assertEqual(first["before"], 9000)
        self.assertEqual(first["after"], 8800)
        self.assertEqual(first["verdict"], "OK")
        self.assertEqual(first["timestamp"], "2026-05-03T10:00:00+00:00")

    def test_resilient_to_corrupt_file(self):
        """One corrupt JSON file is skipped; valid files still returned."""
        self._write_finding(1, before=9000, after=8500)
        # Corrupt JSON.
        bad = (Path(self.tmp) / "state" / "findings-sentrux-2.json")
        bad.write_text("{not valid json,,,", encoding="utf-8")
        self._write_finding(3, before=8500, after=7000)

        with _ForceLokiDir(self.tmp):
            resp = self._client().get("/api/quality/architecture")
        # Endpoint must NOT 500 -- it returns 200 with the 2 valid entries.
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["samples"], 2)
        iterations = [e["iteration"] for e in body["series"]]
        self.assertEqual(iterations, [1, 3])
        self.assertEqual(body["current"], 7000)

    def test_skips_non_object_payload(self):
        """A JSON file containing a list (not object) is skipped, not 500."""
        self._write_finding(1, before=9000, after=8500)
        bad = (Path(self.tmp) / "state" / "findings-sentrux-2.json")
        bad.write_text(json.dumps([1, 2, 3]), encoding="utf-8")

        with _ForceLokiDir(self.tmp):
            resp = self._client().get("/api/quality/architecture")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["samples"], 1)
        self.assertEqual(body["series"][0]["iteration"], 1)


if __name__ == "__main__":
    unittest.main()
