"""
tests/dashboard/test_checklist_waivers_read_error.py
BACKLOG 118: GET /api/checklist/waivers must not report a corrupt
waivers.json as a clean 200 {"waivers": []}. A missing file is a legitimate
empty state (200); a file that exists but fails to parse is a read error
(500), matching the DELETE sibling's handling of the same failure.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path


class _ForceLokiDir:
    """Pin dashboard.server._get_loki_dir() to a tmp path."""

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


class ChecklistWaiversReadErrorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="loki-waivers-read-")
        self.waivers_file = Path(self.tmp) / "checklist" / "waivers.json"

    def _client(self):
        from dashboard.server import app
        from fastapi.testclient import TestClient
        return TestClient(app, raise_server_exceptions=False)

    def test_missing_file_returns_200_empty_list(self):
        with _ForceLokiDir(self.tmp):
            resp = self._client().get("/api/checklist/waivers")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"waivers": []})

    def test_corrupt_file_returns_500_with_error_body(self):
        self.waivers_file.parent.mkdir(parents=True, exist_ok=True)
        self.waivers_file.write_text("{not valid json", encoding="utf-8")
        with _ForceLokiDir(self.tmp):
            resp = self._client().get("/api/checklist/waivers")
        self.assertEqual(resp.status_code, 500)
        body = resp.json()
        self.assertIn("error", body)


if __name__ == "__main__":
    unittest.main()
