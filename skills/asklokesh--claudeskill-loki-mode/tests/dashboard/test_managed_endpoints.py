"""
tests/dashboard/test_managed_endpoints.py
v6.83.x Phase 5: HTTP tests for the Managed Agents read-only bridge.

Covers:
    - /api/managed/events returns [] on empty file.
    - /api/managed/events tails and filters by since / type.
    - /api/managed/status returns enabled=false by default.
    - /api/managed/memory_versions/{id} returns 503 when flags are off.
    - /api/managed/memory_versions/{id} returns 404 for a non-existent id
      when flags are enabled and the SDK path is stubbed.

All tests use FastAPI's TestClient and never hit the real Anthropic API.
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock


class _ForceLokiDir:
    """Context manager that pins dashboard.server._get_loki_dir() to a tmp path."""

    def __init__(self, tmpdir: str):
        self.tmp = tmpdir
        self._orig = None

    def __enter__(self):
        from dashboard import server as _server
        self._orig = _server._get_loki_dir
        # Patch to return a fixed path regardless of CWD/env.
        _server._get_loki_dir = lambda: Path(self.tmp)
        return self

    def __exit__(self, exc_type, exc, tb):
        from dashboard import server as _server
        if self._orig is not None:
            _server._get_loki_dir = self._orig


class ManagedEndpointTests(unittest.TestCase):
    _FLAG_KEYS = ("LOKI_MANAGED_AGENTS", "LOKI_MANAGED_MEMORY", "ANTHROPIC_API_KEY")

    def setUp(self):
        # Save prior env so we can restore it in tearDown -- other test
        # modules set these flags at import time; we must not leak state.
        self._saved_env = {k: os.environ.get(k) for k in self._FLAG_KEYS}
        # Ensure flags are OFF by default for these tests; individual tests
        # that need them on will set them.
        for k in ("LOKI_MANAGED_AGENTS", "LOKI_MANAGED_MEMORY"):
            os.environ.pop(k, None)
        self.tmp = tempfile.mkdtemp(prefix="loki-mgd-dash-")
        # Pre-create .loki/managed/ so tests that write events don't race.
        (Path(self.tmp) / "managed").mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        for k, v in self._saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def _client(self):
        # Import lazily so env changes propagate into snapshots.
        from dashboard.server import app
        from fastapi.testclient import TestClient
        return TestClient(app, raise_server_exceptions=False)

    def _events_path(self) -> Path:
        return Path(self.tmp) / "managed" / "events.ndjson"

    # ---------- /api/managed/events ----------------------------------------

    def test_events_empty_file(self):
        with _ForceLokiDir(self.tmp):
            resp = self._client().get("/api/managed/events")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["events"], [])
        self.assertEqual(body["count"], 0)

    def test_events_tail_with_limit_and_type_filter(self):
        path = self._events_path()
        records = [
            {"ts": "2026-04-01T00:00:00Z", "type": "managed_memory_shadow_write", "payload": {"i": 1}},
            {"ts": "2026-04-02T00:00:00Z", "type": "managed_agents_fallback", "payload": {"reason": "x"}},
            {"ts": "2026-04-03T00:00:00Z", "type": "managed_memory_shadow_write", "payload": {"i": 2}},
        ]
        with open(path, "w", encoding="utf-8") as f:
            for r in records:
                f.write(json.dumps(r) + "\n")

        with _ForceLokiDir(self.tmp):
            resp = self._client().get(
                "/api/managed/events",
                params={"limit": 10, "type": "managed_memory_shadow_write"},
            )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["count"], 2)
        for rec in body["events"]:
            self.assertEqual(rec["type"], "managed_memory_shadow_write")

    def test_events_malformed_lines_skipped(self):
        path = self._events_path()
        with open(path, "w", encoding="utf-8") as f:
            f.write("not json\n")
            f.write(json.dumps({"ts": "2026-04-04T00:00:00Z", "type": "x", "payload": {}}) + "\n")
            f.write("{truncated\n")
        with _ForceLokiDir(self.tmp):
            resp = self._client().get("/api/managed/events")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        # Only the well-formed line survives.
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["events"][0]["type"], "x")

    # ---------- /api/managed/status ----------------------------------------

    def test_status_disabled_by_default(self):
        with _ForceLokiDir(self.tmp):
            resp = self._client().get("/api/managed/status")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertFalse(body["enabled"])
        self.assertFalse(body["parent_flag"])
        self.assertIn("beta_header", body)
        self.assertIsNotNone(body["beta_header"])
        self.assertIn("last_fallback_ts", body)

    def test_status_last_fallback_ts_reported(self):
        path = self._events_path()
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps({"ts": "2026-04-10T00:00:00Z",
                                "type": "managed_agents_fallback",
                                "payload": {"reason": "a"}}) + "\n")
            f.write(json.dumps({"ts": "2026-04-11T00:00:00Z",
                                "type": "managed_agents_fallback",
                                "payload": {"reason": "b"}}) + "\n")
        with _ForceLokiDir(self.tmp):
            resp = self._client().get("/api/managed/status")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        # Most recent fallback wins.
        self.assertEqual(body["last_fallback_ts"], "2026-04-11T00:00:00Z")

    def test_status_enabled_when_flags_on(self):
        os.environ["LOKI_MANAGED_AGENTS"] = "true"
        os.environ["LOKI_MANAGED_MEMORY"] = "true"
        try:
            with _ForceLokiDir(self.tmp):
                resp = self._client().get("/api/managed/status")
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            self.assertTrue(body["enabled"])
            self.assertTrue(body["parent_flag"])
            self.assertTrue(body["child_flags"]["LOKI_MANAGED_MEMORY"])
        finally:
            for k in ("LOKI_MANAGED_AGENTS", "LOKI_MANAGED_MEMORY"):
                os.environ.pop(k, None)

    # ---------- /api/managed/memory_versions/{id} --------------------------

    def test_memory_versions_503_when_flags_off(self):
        with _ForceLokiDir(self.tmp):
            resp = self._client().get("/api/managed/memory_versions/mem_abc")
        self.assertEqual(resp.status_code, 503)
        self.assertIn("disabled", resp.json()["detail"].lower())

    def test_memory_versions_400_on_bad_id(self):
        with _ForceLokiDir(self.tmp):
            resp = self._client().get("/api/managed/memory_versions/bad..id")
        self.assertEqual(resp.status_code, 400)

    def test_memory_versions_404_when_sdk_raises_not_found(self):
        os.environ["LOKI_MANAGED_AGENTS"] = "true"
        os.environ["LOKI_MANAGED_MEMORY"] = "true"
        os.environ["ANTHROPIC_API_KEY"] = "test-key-not-real"

        try:
            # Build a fake SDK-ish object: client._client.beta.memory_stores
            #                                   .memory_versions.list()
            class _NotFound(Exception):
                status_code = 404

            class _VersionsNS:
                def list(self, memory_id):
                    raise _NotFound(f"memory_id not found: {memory_id}")

            class _StoresNS:
                memory_versions = _VersionsNS()

            class _BetaNS:
                memory_stores = _StoresNS()

            class _SDKClient:
                beta = _BetaNS()

            class _Client:
                _client = _SDKClient()

            from memory.managed_memory import client as _client_mod
            _client_mod._singleton = _Client()  # type: ignore[attr-defined]

            try:
                with _ForceLokiDir(self.tmp):
                    resp = self._client().get("/api/managed/memory_versions/mem_missing")
                self.assertEqual(resp.status_code, 404)
                self.assertIn("not found", resp.json()["detail"].lower())
            finally:
                _client_mod.reset_client()
        finally:
            for k in ("LOKI_MANAGED_AGENTS", "LOKI_MANAGED_MEMORY", "ANTHROPIC_API_KEY"):
                os.environ.pop(k, None)

    def test_memory_versions_happy_path(self):
        os.environ["LOKI_MANAGED_AGENTS"] = "true"
        os.environ["LOKI_MANAGED_MEMORY"] = "true"
        os.environ["ANTHROPIC_API_KEY"] = "test-key-not-real"

        try:
            class _Result:
                data = [{"id": "v1", "memory_id": "mem_ok"}, {"id": "v2", "memory_id": "mem_ok"}]

            class _VersionsNS:
                def list(self, memory_id):
                    return _Result()

            class _StoresNS:
                memory_versions = _VersionsNS()

            class _BetaNS:
                memory_stores = _StoresNS()

            class _SDKClient:
                beta = _BetaNS()

            class _Client:
                _client = _SDKClient()

            from memory.managed_memory import client as _client_mod
            _client_mod._singleton = _Client()  # type: ignore[attr-defined]

            try:
                with _ForceLokiDir(self.tmp):
                    resp = self._client().get("/api/managed/memory_versions/mem_ok")
                self.assertEqual(resp.status_code, 200)
                body = resp.json()
                self.assertEqual(body["memory_id"], "mem_ok")
                self.assertEqual(body["count"], 2)
                self.assertEqual(len(body["versions"]), 2)
            finally:
                _client_mod.reset_client()
        finally:
            for k in ("LOKI_MANAGED_AGENTS", "LOKI_MANAGED_MEMORY", "ANTHROPIC_API_KEY"):
                os.environ.pop(k, None)


if __name__ == "__main__":
    unittest.main()
