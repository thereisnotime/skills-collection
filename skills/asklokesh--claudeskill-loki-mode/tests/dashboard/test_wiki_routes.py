"""tests/dashboard/test_wiki_routes.py
R5 auto-wiki dashboard endpoints -- HTTP tests.

Covers:
    - GET  /api/wiki              (manifest + section list)
    - GET  /api/wiki/{section}    (one section + citations)
    - POST /api/wiki/ask          (grounded cited Q&A; LLM stubbed)
    - traversal / unknown-section rejection (400)

Auth is disabled by default in the dashboard, so TestClient calls succeed
without keys. The LLM is mocked via LOKI_WIKI_LLM_STUB so no paid calls occur.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


class _ForceLokiDir:
    """Pin dashboard.server._get_loki_dir() to <project>/.loki for the test."""

    def __init__(self, loki_dir: str):
        self.loki = loki_dir
        self._orig = None

    def __enter__(self):
        from dashboard import server as _server
        self._orig = _server._get_loki_dir
        _server._get_loki_dir = lambda: Path(self.loki)
        return self

    def __exit__(self, exc_type, exc, tb):
        from dashboard import server as _server
        if self._orig is not None:
            _server._get_loki_dir = self._orig


_WIKI = {
    "schema_version": "1.0",
    "project": "fixture",
    "generated_at": "2026-06-03T01:02:03Z",
    "file_count": 2,
    "sections": [
        {"id": "architecture", "title": "Architecture Overview",
         "body": "Overview prose.",
         "citations": [{"file": "src/main.py", "line": 1}]},
        {"id": "modules", "title": "Key Modules",
         "body": "Modules prose.",
         "citations": [{"file": "src/main.py", "line": 1}]},
        {"id": "data-flow", "title": "Data Flow",
         "body": "Flow prose.",
         "citations": [{"file": "src/main.py", "line": 1}]},
    ],
}


class WikiRoutesTests(unittest.TestCase):
    def setUp(self):
        # Build a real project so /api/wiki/ask (which shells the python core)
        # has source files to index.
        self.project = tempfile.mkdtemp(prefix="loki-wiki-dash-")
        os.makedirs(os.path.join(self.project, "src"))
        with open(os.path.join(self.project, "src", "main.py"), "w") as f:
            f.write("def main():\n    return login()\n\n\n"
                    "def login():\n    return True\n")
        subprocess.run(["git", "init", "-q"], cwd=self.project, check=True)
        subprocess.run(["git", "add", "-A"], cwd=self.project, check=True)
        subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t",
                        "commit", "-qm", "init"], cwd=self.project, check=True)
        self.loki = os.path.join(self.project, ".loki")
        self.wiki = os.path.join(self.loki, "wiki")
        os.makedirs(self.wiki, exist_ok=True)
        with open(os.path.join(self.wiki, "wiki.json"), "w") as f:
            json.dump(_WIKI, f)
        with open(os.path.join(self.wiki, "wiki-manifest.json"), "w") as f:
            json.dump({"signature": "deadbeef", "sections":
                       ["architecture", "modules", "data-flow"]}, f)

    def tearDown(self):
        shutil.rmtree(self.project, ignore_errors=True)

    def _client(self):
        from dashboard.server import app
        from fastapi.testclient import TestClient
        return TestClient(app, raise_server_exceptions=False)

    def test_get_wiki_manifest(self):
        with _ForceLokiDir(self.loki):
            resp = self._client().get("/api/wiki")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body["generated"])
        self.assertEqual(body["project"], "fixture")
        self.assertEqual(len(body["sections"]), 3)
        self.assertEqual(body["sections"][0]["citation_count"], 1)

    def test_get_wiki_not_generated(self):
        empty_project = tempfile.mkdtemp(prefix="loki-wiki-empty-")
        empty_loki = os.path.join(empty_project, ".loki")
        os.makedirs(empty_loki)
        try:
            with _ForceLokiDir(empty_loki):
                resp = self._client().get("/api/wiki")
            self.assertEqual(resp.status_code, 200)
            self.assertFalse(resp.json()["generated"])
        finally:
            shutil.rmtree(empty_project, ignore_errors=True)

    def test_get_section(self):
        with _ForceLokiDir(self.loki):
            resp = self._client().get("/api/wiki/architecture")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["id"], "architecture")
        self.assertEqual(body["citations"][0]["file"], "src/main.py")

    def test_unknown_section_rejected(self):
        with _ForceLokiDir(self.loki):
            resp = self._client().get("/api/wiki/etc-passwd")
        self.assertEqual(resp.status_code, 400)

    def test_traversal_section_rejected(self):
        # The path param is constrained to the known section ids; anything with
        # separators is a different route or a 400.
        with _ForceLokiDir(self.loki):
            resp = self._client().get("/api/wiki/..%2f..%2fetc")
        self.assertIn(resp.status_code, (400, 404))

    def test_ask_returns_grounded_citations(self):
        os.environ["LOKI_WIKI_LLM_STUB"] = "The login function is at [1]."
        try:
            with _ForceLokiDir(self.loki):
                resp = self._client().post(
                    "/api/wiki/ask", json={"question": "where is login"})
        finally:
            os.environ.pop("LOKI_WIKI_LLM_STUB", None)
        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        self.assertTrue(body["citations"])
        for c in body["citations"]:
            self.assertTrue(os.path.isfile(os.path.join(self.project, c["file"])))

    def test_ask_validates_question(self):
        with _ForceLokiDir(self.loki):
            resp = self._client().post("/api/wiki/ask", json={"question": ""})
        self.assertEqual(resp.status_code, 422)  # pydantic min_length


if __name__ == "__main__":
    unittest.main()
