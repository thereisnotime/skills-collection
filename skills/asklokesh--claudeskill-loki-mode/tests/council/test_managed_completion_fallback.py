"""
tests/council/test_managed_completion_fallback.py

v7.0.0 Phase 4: ManagedUnavailable from providers.managed.run_completion_council
must produce a fallback event and propagate so the Bash caller can fall through
to legacy local voting.

Coverage:
    1. run_completion_council raises ManagedUnavailable when flags are off.
    2. Injected session factory that raises ManagedUnavailable -> caller sees
       the exception AND a managed_agents_fallback event in events.ndjson.
    3. Overall budget timeout (session thread never returns) -> fallback event
       with reason=overall_budget_timeout.
    4. SDK shape error (factory raises AttributeError/TypeError) -> translated
       to ManagedUnavailable with a session_shape_error fallback event.

No network is touched. FakeMultiagentSession via _set_session_factory_for_tests.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path


def _read_events(target_dir: str):
    p = Path(target_dir) / ".loki" / "managed" / "events.ndjson"
    if not p.exists():
        return []
    out = []
    with open(p, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


class FallbackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="loki-managed-council-")
        os.environ["LOKI_TARGET_DIR"] = self.tmp

        # Seed an agent_ids cache so resolve_agent_ids doesn't try to
        # materialize new IDs via agents.managed_registry.
        cache_dir = Path(self.tmp) / ".loki" / "managed"
        cache_dir.mkdir(parents=True, exist_ok=True)
        (cache_dir / "agent_ids.json").write_text(
            json.dumps(
                {
                    "requirements_verifier": "agent_rv_01",
                    "test_auditor": "agent_ta_01",
                    "devils_advocate": "agent_da_01",
                }
            ),
            encoding="utf-8",
        )

        # v7.0.2: snapshot prior env state so tearDown restores cleanly
        # instead of unconditionally stripping (the v7.0.0 CI failure was
        # caused by this class wiping flags that downstream test classes
        # depended on).
        self._env_snapshot = {
            k: os.environ.get(k)
            for k in (
                "LOKI_MANAGED_AGENTS",
                "LOKI_EXPERIMENTAL_MANAGED_AGENTS",
                "LOKI_EXPERIMENTAL_MANAGED_COUNCIL",
                "LOKI_TARGET_DIR",
            )
        }

        # Enable the full flag stack so is_enabled() returns True (we probe
        # via importlib.util.find_spec; anthropic may or may not be installed
        # in CI -- the factory override bypasses the real SDK either way).
        os.environ["LOKI_MANAGED_AGENTS"] = "true"
        os.environ["LOKI_EXPERIMENTAL_MANAGED_AGENTS"] = "true"
        os.environ["LOKI_EXPERIMENTAL_MANAGED_COUNCIL"] = "true"
        # ANTHROPIC_API_KEY is required by _build_client(); set a dummy so
        # the override path is the only exercised branch.
        os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-placeholder")

        from providers import managed as managed_mod
        self.managed = managed_mod
        # Inject a harmless cached client so _get_client() never tries to
        # import anthropic in the test environment.
        managed_mod._cached_client = object()  # type: ignore[attr-defined]
        # Force the SDK-availability probe to True. In CI the anthropic SDK
        # may not be installed; our session factory override bypasses the
        # real SDK entirely, so this is safe.
        self._orig_sdk_available = managed_mod._sdk_available
        managed_mod._sdk_available = lambda: True  # type: ignore[assignment]

    def tearDown(self):
        self.managed._set_session_factory_for_tests(None)
        self.managed._reset_client()
        # Restore _sdk_available.
        try:
            self.managed._sdk_available = self._orig_sdk_available  # type: ignore[assignment]
        except AttributeError:
            pass
        # v7.0.2: restore env vars from setUp snapshot rather than blind pop.
        # If a key was unset on entry, pop it; if it had a value, restore.
        for k, prior in self._env_snapshot.items():
            if prior is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = prior

    def _flags_off(self):
        for k in (
            "LOKI_MANAGED_AGENTS",
            "LOKI_EXPERIMENTAL_MANAGED_AGENTS",
            "LOKI_EXPERIMENTAL_MANAGED_COUNCIL",
        ):
            os.environ.pop(k, None)

    def test_flags_off_raises_managed_unavailable(self):
        self._flags_off()
        with self.assertRaises(self.managed.ManagedUnavailable):
            self.managed.run_completion_council(
                voters=["requirements_verifier", "test_auditor", "devils_advocate"],
                context={"diff_summary": "x", "test_summary": "y", "pending_tasks": "[]"},
                timeout_s=5,
            )
        events = _read_events(self.tmp)
        self.assertTrue(
            any(
                e.get("type") == "managed_agents_fallback"
                and e.get("payload", {}).get("op") == "run_completion_council"
                for e in events
            ),
            msg=f"no flags_off fallback event found: {events}",
        )

    def test_session_raises_managed_unavailable_propagates(self):
        class BoomSession:
            def __init__(self, *a, **kw):
                pass

            def run(self_inner):
                raise self.managed.ManagedUnavailable("session blew up in test")

        def _factory(client, *, agent_ids, context, timeout_s):
            return BoomSession()

        self.managed._set_session_factory_for_tests(_factory)
        with self.assertRaises(self.managed.ManagedUnavailable):
            self.managed.run_completion_council(
                voters=["requirements_verifier", "test_auditor", "devils_advocate"],
                context={"diff_summary": "x"},
                timeout_s=5,
            )
        events = _read_events(self.tmp)
        reasons = [e.get("payload", {}).get("reason") for e in events if e.get("type") == "managed_agents_fallback"]
        # At least one fallback event should explain WHY we fell back.
        self.assertTrue(any(r for r in reasons), msg=f"no fallback event with reason: {events}")

    def test_sdk_shape_error_translated(self):
        def _factory(client, *, agent_ids, context, timeout_s):
            raise AttributeError("beta.sessions not present")

        self.managed._set_session_factory_for_tests(_factory)
        with self.assertRaises(self.managed.ManagedUnavailable):
            self.managed.run_completion_council(
                voters=["requirements_verifier", "test_auditor", "devils_advocate"],
                context={"diff_summary": ""},
                timeout_s=5,
            )
        events = _read_events(self.tmp)
        shape_reasons = [
            e.get("payload", {}).get("reason")
            for e in events
            if e.get("type") == "managed_agents_fallback"
        ]
        self.assertIn("session_shape_error", shape_reasons, msg=f"events={events}")

    def test_overall_budget_timeout_fallback(self):
        """If the session thread never returns, the budget must fire fast."""
        block = threading.Event()

        class StuckSession:
            def __init__(self, *a, **kw):
                pass

            def run(self_inner):
                # Block until the test releases us, well past the tiny budget.
                block.wait(timeout=5.0)
                return {"raw": None, "session_id": None}

        def _factory(client, *, agent_ids, context, timeout_s):
            return StuckSession()

        self.managed._set_session_factory_for_tests(_factory)
        start = time.monotonic()
        with self.assertRaises(self.managed.ManagedUnavailable):
            self.managed.run_completion_council(
                voters=["requirements_verifier", "test_auditor", "devils_advocate"],
                context={"diff_summary": ""},
                timeout_s=1,  # deliberately tiny so the test is fast
            )
        elapsed = time.monotonic() - start
        # Release the worker so daemon thread can exit cleanly.
        block.set()
        # Must have returned promptly once the budget fired.
        self.assertLess(elapsed, 3.0, msg=f"budget timeout took too long: {elapsed:.2f}s")

        events = _read_events(self.tmp)
        reasons = [
            e.get("payload", {}).get("reason")
            for e in events
            if e.get("type") == "managed_agents_fallback"
        ]
        self.assertIn("overall_budget_timeout", reasons, msg=f"events={events}")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
