#!/usr/bin/env python3
"""S-62 / BACKLOG 118: council-state and active-notifications reads must not
fabricate a zero/empty result when the underlying read itself failed.

THE GAP THIS CLOSES. Both dashboard/server.py sites returned the exact same
payload for "genuinely nothing recorded yet" and "the state file exists but is
corrupt/unreadable": /api/council/state returned total_votes: 0 either way, and
/api/notifications returned an all-zero summary either way. A caller cannot
tell "the council recorded 0 votes" from "we could not read council state" --
the same false-green class as S-46's guessed "completed" status.

THE FIX. council_state() and read_active_notifications() (both plain,
importable functions, no FastAPI/event loop needed) now return None markers
(plus an "error" key) when the file exists but fails to parse, and only return
the real zero/empty shape when the file is genuinely absent.

Run: python3 -m pytest tests/test_dashboard_honest_zero_fallbacks.py -q
or:  python3 tests/test_dashboard_honest_zero_fallbacks.py
"""

import asyncio
import contextlib
import os
import sys
import tempfile
import pathlib

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dashboard import server  # noqa: E402


@contextlib.contextmanager
def _mkdir(*parts):
    with tempfile.TemporaryDirectory() as d:
        p = pathlib.Path(d)
        for sub in parts:
            (p / sub).mkdir(parents=True, exist_ok=True)
        yield p


# -- council_state -----------------------------------------------------------

def test_council_state_missing_file_is_genuine_zero():
    """POSITIVE CONTROL: no state.json at all means the council really has
    recorded zero votes. Must stay a real 0, not get swept into the error
    path just because nothing is there yet."""
    with _mkdir("council") as loki_dir:
        result = server.council_state(loki_dir)
    assert result["total_votes"] == 0
    assert result["enabled"] is False
    assert result["verdicts"] == []
    assert "error" not in result


def test_council_state_corrupt_file_is_not_fabricated_zero():
    """state.json exists but is not valid JSON (torn write). total_votes must
    be None, never a fabricated 0 that reads as a real vote count."""
    with _mkdir("council") as loki_dir:
        (loki_dir / "council" / "state.json").write_text("{not valid json")
        result = server.council_state(loki_dir)
    assert result["total_votes"] is None
    assert result["total_votes"] != 0
    assert result["enabled"] is None
    assert result["verdicts"] is None
    assert result.get("error") == "unreadable_state"


def test_council_state_genuine_votes_pass_through():
    """A real, parseable state.json with real votes is returned verbatim --
    the fix must not touch the healthy path."""
    with _mkdir("council") as loki_dir:
        (loki_dir / "council" / "state.json").write_text(
            '{"enabled": true, "total_votes": 7, "verdicts": ["PASS"]}'
        )
        result = server.council_state(loki_dir)
    assert result["total_votes"] == 7
    assert result["enabled"] is True
    assert "error" not in result


# -- read_active_notifications -----------------------------------------------

def test_active_notifications_missing_file_is_genuine_empty():
    """POSITIVE CONTROL: no active.json at all means there really are no
    active notifications. Must stay a real all-zero summary."""
    with _mkdir("notifications") as loki_dir:
        result = server.read_active_notifications(loki_dir)
    assert result["notifications"] == []
    assert result["summary"] == {
        "total": 0, "unacknowledged": 0, "critical": 0, "warning": 0, "info": 0,
    }
    assert "error" not in result


def test_active_notifications_corrupt_file_is_not_fabricated_zero():
    """active.json exists but is malformed JSON. Both notifications and
    summary must be None, never the fabricated all-zero summary that reads
    as a genuinely empty, healthy state."""
    with _mkdir("notifications") as loki_dir:
        (loki_dir / "notifications" / "active.json").write_text("{'bad': json,,,")
        result = server.read_active_notifications(loki_dir)
    assert result["notifications"] is None
    assert result["summary"] is None
    assert result.get("error") == "unreadable_active_notifications"


def test_active_notifications_genuine_data_passes_through():
    """A real, parseable active.json is returned verbatim."""
    with _mkdir("notifications") as loki_dir:
        (loki_dir / "notifications" / "active.json").write_text(
            '{"notifications": [{"id": "n1", "severity": "critical", '
            '"acknowledged": false}], '
            '"summary": {"total": 1, "unacknowledged": 1, "critical": 1, '
            '"warning": 0, "info": 0}}'
        )
        result = server.read_active_notifications(loki_dir)
    assert result["notifications"] == [
        {"id": "n1", "severity": "critical", "acknowledged": False}
    ]
    assert result["summary"]["total"] == 1
    assert "error" not in result


def test_get_notifications_route_survives_corrupt_file_with_filters():
    """The route handler (not just the pure helper) must short-circuit on the
    None-notifications error path -- severity/unread_only filtering iterates
    the notifications list, which would crash on None if the guard were
    missing or misplaced."""
    with _mkdir("notifications") as loki_dir:
        (loki_dir / "notifications" / "active.json").write_text("not json at all")

        original_get_loki_dir = server._get_loki_dir
        server._get_loki_dir = lambda: loki_dir
        try:
            result = asyncio.run(
                server.get_notifications(severity="critical", unread_only=True)
            )
        finally:
            server._get_loki_dir = original_get_loki_dir

    assert result["notifications"] is None
    assert result["summary"] is None
    assert result.get("error") == "unreadable_active_notifications"


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(list(globals().items())):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
            print("  PASS: %s" % name)
        except AssertionError as exc:
            print("  FAIL: %s -- %s" % (name, exc))
            failures += 1
    print("\n  Failed: %d" % failures)
    sys.exit(1 if failures else 0)
