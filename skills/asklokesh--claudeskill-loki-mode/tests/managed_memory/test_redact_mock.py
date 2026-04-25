"""
tests/managed_memory/test_redact_mock.py
v6.83.x Phase 5: unit tests for the loki_memory_redact MCP tool.

These tests exercise ``mcp.managed_tools.redact_memory_versions`` directly,
which is the same function the MCP ``loki_memory_redact`` tool wraps. This
avoids pulling in the FastMCP runtime (which may not be installed in CI).

Covers:
    - Happy path: a regex match triggers one redact() call per matching
      memory version and the count is reported correctly.
    - Scope filter: scope="user" skips stores whose scope is "org".
    - Per-redact failures collected in "errors" without raising.
    - Disabled flags: raises ManagedDisabled with a clear message.
    - Invalid regex / scope: returns a JSON body with "error".
    - Writes a managed_memory_redact event on each successful redaction.
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path


class _FakeVersionsNS:
    def __init__(self, versions_by_store):
        self._versions_by_store = versions_by_store
        self.redacted: list[tuple[str, str]] = []
        self.should_raise_on = None  # (store_id, version_id) to force failure

    def list(self, store_id):
        class _R:
            pass
        r = _R()
        r.data = list(self._versions_by_store.get(store_id, []))
        return r

    def redact(self, store_id, memory_version_id):
        if self.should_raise_on == (store_id, memory_version_id):
            raise RuntimeError("simulated redact failure")
        self.redacted.append((store_id, memory_version_id))
        return {"ok": True}


class _FakeStoresNS:
    def __init__(self, stores, versions):
        self._stores = stores
        self.memory_versions = _FakeVersionsNS(versions)

    def list(self):
        class _R:
            pass
        r = _R()
        r.data = list(self._stores)
        return r


class _FakeBeta:
    def __init__(self, stores, versions):
        self.memory_stores = _FakeStoresNS(stores, versions)


class _FakeSDKClient:
    def __init__(self, stores, versions):
        self.beta = _FakeBeta(stores, versions)


class _FakeManagedClient:
    """Mimics just enough of ManagedClient for redact_memory_versions."""

    def __init__(self, stores, versions):
        self._client = _FakeSDKClient(stores, versions)


class RedactToolTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="loki-mgd-redact-")
        # Save and overwrite env so we can restore prior values in tearDown.
        # Other test modules set these flags at module import time, so we
        # must NOT leave them cleared -- restoring the original string value
        # (or "true") keeps sibling suites happy under any collection order.
        self._saved_env = {
            k: os.environ.get(k)
            for k in (
                "LOKI_TARGET_DIR",
                "LOKI_MANAGED_AGENTS",
                "LOKI_MANAGED_MEMORY",
            )
        }
        os.environ["LOKI_TARGET_DIR"] = self.tmp
        os.environ["LOKI_MANAGED_AGENTS"] = "true"
        os.environ["LOKI_MANAGED_MEMORY"] = "true"

    def tearDown(self):
        from memory.managed_memory import client as _client_mod
        _client_mod.reset_client()
        for k, v in self._saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def _inject(self, fake):
        from memory.managed_memory import client as _client_mod
        _client_mod._singleton = fake  # type: ignore[attr-defined]

    def _events(self) -> list[dict]:
        path = Path(self.tmp) / ".loki" / "managed" / "events.ndjson"
        if not path.exists():
            return []
        with open(path, "r", encoding="utf-8") as f:
            return [json.loads(line) for line in f if line.strip()]

    def _redact(self, *, pattern: str, scope: str = "all"):
        from mcp.managed_tools import redact_memory_versions
        return redact_memory_versions(pattern=pattern, scope=scope)

    # ---------- happy path -------------------------------------------------

    def test_happy_path_redacts_matching_versions(self):
        stores = [
            {"id": "store_user_1", "scope": "user", "name": "personal"},
            {"id": "store_org_1", "scope": "org", "name": "team"},
        ]
        versions = {
            "store_user_1": [
                {"id": "v_email", "content": "contact me at user@example.com"},
                {"id": "v_plain", "content": "no pii here"},
            ],
            "store_org_1": [
                {"id": "v_ssn", "content": "SSN: 123-45-6789"},
            ],
        }
        fake = _FakeManagedClient(stores, versions)
        self._inject(fake)

        body = self._redact(pattern=r"[\w\.]+@[\w\.]+\.\w+", scope="all")

        self.assertEqual(body["redacted_count"], 1)
        self.assertEqual(body["errors"], [])
        self.assertGreaterEqual(body["scanned"], 3)
        vs = fake._client.beta.memory_stores.memory_versions
        self.assertIn(("store_user_1", "v_email"), vs.redacted)

        # One managed_memory_redact event per successful redaction.
        events = [e for e in self._events() if e["type"] == "managed_memory_redact"]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["payload"]["store_id"], "store_user_1")
        self.assertEqual(events[0]["payload"]["memory_version_id"], "v_email")

    def test_scope_user_skips_org_stores(self):
        stores = [
            {"id": "store_user_1", "scope": "user", "name": "personal"},
            {"id": "store_org_1", "scope": "org", "name": "team"},
        ]
        versions = {
            "store_user_1": [{"id": "v1", "content": "secret-token-abc"}],
            "store_org_1": [{"id": "v2", "content": "secret-token-xyz"}],
        }
        fake = _FakeManagedClient(stores, versions)
        self._inject(fake)

        body = self._redact(pattern=r"secret-token", scope="user")

        self.assertEqual(body["redacted_count"], 1)
        vs = fake._client.beta.memory_stores.memory_versions
        self.assertEqual(vs.redacted, [("store_user_1", "v1")])

    def test_errors_collected_without_raising(self):
        stores = [{"id": "store_1", "scope": "user", "name": "s"}]
        versions = {
            "store_1": [
                {"id": "v_bad", "content": "match here"},
                {"id": "v_good", "content": "match here"},
            ],
        }
        fake = _FakeManagedClient(stores, versions)
        fake._client.beta.memory_stores.memory_versions.should_raise_on = (
            "store_1", "v_bad",
        )
        self._inject(fake)

        body = self._redact(pattern=r"match", scope="all")

        self.assertEqual(body["redacted_count"], 1)
        self.assertEqual(len(body["errors"]), 1)
        self.assertEqual(body["errors"][0]["memory_version_id"], "v_bad")

    # ---------- disabled path ----------------------------------------------

    def test_raises_managed_disabled_when_flags_off(self):
        os.environ["LOKI_MANAGED_MEMORY"] = "false"
        fake = _FakeManagedClient([], {})
        self._inject(fake)

        from memory.managed_memory import ManagedDisabled

        with self.assertRaises(ManagedDisabled) as ctx:
            self._redact(pattern=r".*", scope="all")
        self.assertIn("LOKI_MANAGED", str(ctx.exception))

    # ---------- invalid inputs ---------------------------------------------

    def test_invalid_scope_returns_error(self):
        self._inject(_FakeManagedClient([], {}))
        body = self._redact(pattern=r".*", scope="nope")
        self.assertIn("error", body)
        self.assertEqual(body["redacted_count"], 0)

    def test_invalid_regex_returns_error(self):
        self._inject(_FakeManagedClient([], {}))
        body = self._redact(pattern=r"[unclosed", scope="all")
        self.assertIn("error", body)
        self.assertEqual(body["redacted_count"], 0)

    # ---------- SDK surface missing ----------------------------------------

    def test_missing_sdk_returns_error(self):
        """If the SDK does not expose memory_versions.list/redact, we get an error dict."""
        class _MinimalSDKClient:
            class beta:
                memory_stores = None  # no memory_stores attribute at all

        class _MinimalClient:
            _client = _MinimalSDKClient()

        self._inject(_MinimalClient())
        body = self._redact(pattern=r".*", scope="all")
        self.assertIn("error", body)
        self.assertEqual(body["redacted_count"], 0)


if __name__ == "__main__":
    unittest.main()
